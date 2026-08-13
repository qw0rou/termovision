const db = require('../db');

/** Build undirected graph from pipes: node -> [{node, pipe}] */
function graph() {
  const es = db.prepare('SELECT id,from_node_id a,to_node_id b FROM pipes WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL').all();
  const a = new Map();
  for (const e of es) {
    for (const [x, y] of [[e.a, e.b], [e.b, e.a]]) {
      a.set(x, [...(a.get(x) || []), { node: y, pipe: e.id }]);
    }
  }
  return { es, a };
}

/** Find source nodes (ТЭЦ/РК/БМК) in the network. */
function sourceNodes() {
  return db.prepare("SELECT id FROM nodes WHERE type='Источник' OR lower(name) LIKE '%тэц%' OR lower(name) LIKE '%рк%' OR lower(name) LIKE '%бмк%'").all().map(r => r.id);
}

/** Connected component containing `start` (node id). */
function component(start) {
  const { a } = graph();
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of a.get(cur) || []) {
      if (!seen.has(e.node)) { seen.add(e.node); queue.push(e.node); }
    }
  }
  return [...seen];
}

/**
 * Compute the affected zone when a node or pipe is shut down.
 *
 * Logic is honest about the source data:
 *  - the zone is the connected component reachable from the shut-down object,
 *    because the KML topology only contains the "supply-drawn" lines and we
 *    cannot reliably determine direction of every valve;
 *  - `dataLimited` is true when the component does not contain a heat source,
 *    which means the affected area cannot be computed exactly from current data
 *    (the discharge valve may be inside this component while the source is
 *    outside). The UI must show this limitation instead of a fake number.
 */
function zone({ nodeId, pipeId }) {
  const { es, a } = graph();
  let start = nodeId;
  if (pipeId) {
    const p = es.find(x => x.id === pipeId);
    if (!p) throw Error('Участок не найден');
    start = p.b;
  }
  if (!start) throw Error('Выберите узел или участок');

  // Traverse the component, collecting all nodes and pipes.
  const seen = new Set([start]), pipes = new Set(), queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of a.get(cur) || []) {
      pipes.add(e.pipe);
      if (!seen.has(e.node)) { seen.add(e.node); queue.push(e.node); }
    }
  }

  const ids = [...seen];
  const m = ids.map(() => '?').join(',');
  const nodes = db.prepare(`SELECT * FROM nodes WHERE id IN (${m})`).all(...ids);
  const houses = db.prepare(`SELECT * FROM houses WHERE node_id IN (${m})`).all(...ids);
  const social = db.prepare(`SELECT * FROM social_objects WHERE source_id IN (${m})`).all(...ids);
  const pipesRows = db.prepare(`SELECT * FROM pipes WHERE id IN (${[...pipes].map(() => '?').join(',')})`).all(...pipes);
  const critical = social.filter(s => {
    try { return ['school', 'clinic', 'hospital', 'kindergarten'].includes(JSON.parse(s.meta || '{}').category); }
    catch (e) { return false; }
  });
  const itpCount = nodes.filter(n => /итп|цтп/i.test(n.name || '')).length + houses.filter(h => h.itp_id).length;

  // Upstream source: nearest source in the connected component (BFS from start).
  let upstreamSource = null;
  const sources = sourceNodes();
  if (sources.length) {
    const seenAll = new Set(), qq = [start];
    seenAll.add(start);
    while (qq.length) {
      const cur = qq.shift();
      if (sources.includes(cur)) { upstreamSource = cur; break; }
      for (const e of a.get(cur) || []) {
        if (!seenAll.has(e.node)) { seenAll.add(e.node); qq.push(e.node); }
      }
    }
  }
  const sourceRow = upstreamSource ? db.prepare('SELECT id,name FROM nodes WHERE id=?').get(upstreamSource) : null;

  // Active emergencies inside the zone (real operational data).
  const bm = ids.map(() => '?').join(',');
  const activeBursts = ids.length
    ? db.prepare(`SELECT * FROM bursts WHERE node_id IN (${bm}) AND status='active'`).all(...ids)
    : [];
  const openDefects = ids.length
    ? db.prepare(`SELECT * FROM defects WHERE node_id IN (${bm}) AND resolved=0`).all(...ids)
    : [];

  return {
    startNodeId: start,
    dataLimited: !sourceRow,           // honest flag: no upstream source found in data
    limitationMessage: sourceRow
      ? ''
      : 'В исходных данных граф сети фрагментирован: для выбранного объекта не найден подключённый источник тепла. Зона отключения определена как компонент связности и может быть шире фактической. Заполните топологию (редактор карты) для точного расчёта.',
    nodeIds: ids,
    pipeIds: [...pipes],
    nodes,
    pipes: pipesRows,
    houses,
    socialObjects: social,
    criticalConsumers: critical,
    affectedFlats: houses.reduce((s, h) => s + (h.flats || 0), 0),
    itpCount,
    upstreamSource: sourceRow ? { id: sourceRow.id, name: sourceRow.name } : null,
    houseCount: houses.length,
    socialCount: social.length,
    activeBursts,
    openDefects
  };
}

/**
 * Find downstream consumers from a specific node (component-limited).
 */
function downstream({ nodeId }) {
  if (!nodeId) throw Error('Укажите узел');
  const { a } = graph();
  const seen = new Set([nodeId]), queue = [nodeId];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of a.get(cur) || []) {
      if (!seen.has(e.node)) { seen.add(e.node); queue.push(e.node); }
    }
  }
  const m = [...seen].map(() => '?').join(',');
  return {
    nodeIds: [...seen],
    nodes: db.prepare(`SELECT * FROM nodes WHERE id IN (${m})`).all(...seen),
    houses: db.prepare(`SELECT * FROM houses WHERE node_id IN (${m})`).all(...seen)
  };
}

module.exports = { zone, downstream, graph, sourceNodes, component };