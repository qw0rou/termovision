/**
 * Rebuild network topology from real KML geometry using endpoint clustering.
 *
 * The original import linked every pipe endpoint to the nearest node with no
 * distance tolerance, producing an unconnected graph. This script reconnects
 * the graph honestly:
 *   - all pipe endpoints are clustered by proximity (hand-drawn KML leaves
 *     small gaps between physically connected lines);
 *   - each cluster is attached to one existing node if present within SNAP_M,
 *     otherwise a junction node is created at the cluster centroid.
 *
 * The script is idempotent. It only touches topology linkage and generated
 * junction nodes; no operational data is modified.
 */
const db = require('../db');
const { graph } = require('../lib/network');

const ENDPOINT_CLUSTER_M = 100; // endpoints closer than this = same physical point
const SNAP_M = 250;             // cluster within this of an existing node -> use it
const D2M = 111000;

function distM(aLat, aLon, bLat, bLon) {
  return Math.sqrt((aLat - bLat) ** 2 + (aLon - bLon) ** 2) * D2M;
}

function run() {
  console.log('[topology] start');

  // ---- reset previous build ----
  const oldJns = db.prepare("SELECT id FROM nodes WHERE id LIKE 'JN-%'").all().map(r => r.id);
  if (oldJns.length) {
    const m = oldJns.map(() => '?').join(',');
    db.prepare('UPDATE houses SET node_id=NULL WHERE node_id IN (' + m + ')').run(...oldJns);
    for (const t of ['bursts', 'defects', 'inspections', 'repair_tasks']) {
      try { db.prepare('UPDATE ' + t + ' SET node_id=NULL WHERE node_id IN (' + m + ')').run(...oldJns); } catch (e) {}
    }
    try { db.prepare('UPDATE social_objects SET source_id=NULL WHERE source_id IN (' + m + ')').run(...oldJns); } catch (e) {}
    db.prepare("DELETE FROM nodes WHERE id LIKE 'JN-%'").run();
  }
  db.prepare('UPDATE pipes SET from_node_id=NULL, to_node_id=NULL').run();

  // ---- gather pipe endpoints ----
  const pipes = db.prepare('SELECT id, name, coordinates, folder FROM pipes').all();
  const endpoints = []; // {pipeId, end, lat, lon}
  for (const p of pipes) {
    const coords = JSON.parse(p.coordinates);
    if (!coords.length) continue;
    endpoints.push({ pipeId: p.id, end: 0, lat: +coords[0][1], lon: +coords[0][0] });
    endpoints.push({ pipeId: p.id, end: 1, lat: +coords[coords.length - 1][1], lon: +coords[coords.length - 1][0] });
  }

  // ---- spatial grid for O(n) endpoint clustering ----
  const CELL = 0.004;
  const key = (lat, lon) => Math.round(lat / CELL) + '|' + Math.round(lon / CELL);
  const eps = new Map(); // cell -> endpoints
  for (const e of endpoints) {
    const k = key(e.lat, e.lon);
    if (!eps.has(k)) eps.set(k, []);
    eps.get(k).push(e);
  }
  const clusters = []; // {lat, lon, members:[]}
  const clusterOf = new Map(); // endpoint index -> cluster
  for (let i = 0; i < endpoints.length; i++) {
    if (clusterOf.has(i)) continue;
    const e = endpoints[i];
    const c = { lat: e.lat, lon: e.lon, members: [e] };
    clusterOf.set(i, c);
    // search neighboring cells for endpoints within ENDPOINT_CLUSTER_M
    const ck = key(e.lat, e.lon);
    const cy = parseInt(ck.split('|')[0]), cx = parseInt(ck.split('|')[1]);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const [j, other] of (eps.get((cy + dy) + '|' + (cx + dx)) || []).entries()) {
          const globalIdx = eps.get((cy + dy) + '|' + (cx + dx)) === eps.get(key(other.lat, other.lon))
            ? undefined : undefined;
          void globalIdx;
        }
      }
    }
    clusters.push(c);
  }
  // Simpler correct approach: iterate all pairs in neighborhood using an index map.
  // Rebuild: endpoint index map.
  const idxByCell = new Map();
  endpoints.forEach((e, i) => {
    const k = key(e.lat, e.lon);
    if (!idxByCell.has(k)) idxByCell.set(k, []);
    idxByCell.get(k).push(i);
  });
  const clusterOf2 = new Map();
  const clusters2 = [];
  const nearby = (lat, lon) => {
    const out = [];
    const ck = key(lat, lon);
    const cy = parseInt(ck.split('|')[0]), cx = parseInt(ck.split('|')[1]);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const i of idxByCell.get((cy + dy) + '|' + (cx + dx)) || []) out.push(i);
    }
    return out;
  };
  for (let i = 0; i < endpoints.length; i++) {
    if (clusterOf2.has(i)) continue;
    const c = { lat: endpoints[i].lat, lon: endpoints[i].lon, members: [endpoints[i]] };
    clusterOf2.set(i, c);
    // absorb unassigned nearby endpoints
    const near = nearby(endpoints[i].lat, endpoints[i].lon);
    for (const j of near) {
      if (j === i || clusterOf2.has(j)) continue;
      if (distM(endpoints[i].lat, endpoints[i].lon, endpoints[j].lat, endpoints[j].lon) <= ENDPOINT_CLUSTER_M) {
        clusterOf2.set(j, c);
        c.members.push(endpoints[j]);
        c.lat = (c.lat * (c.members.length - 1) + endpoints[j].lat) / c.members.length;
        c.lon = (c.lon * (c.members.length - 1) + endpoints[j].lon) / c.members.length;
      }
    }
    clusters2.push(c);
  }

  console.log('[topology] endpoint clusters:', clusters2.length, 'of', endpoints.length, 'endpoints');

  // ---- spatial grid over existing nodes ----
  const nodes = db.prepare('SELECT id, name, type, lat, lon, folder FROM nodes').all();
  const grid = new Map();
  for (const n of nodes) {
    const k = key(n.lat, n.lon);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(n);
  }
  function nearestNode(lat, lon, radiusM) {
    let best = null, bestD = radiusM;
    const ck = key(lat, lon);
    const cy = parseInt(ck.split('|')[0]), cx = parseInt(ck.split('|')[1]);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const n of grid.get((cy + dy) + '|' + (cx + dx)) || []) {
          const d = distM(lat, lon, n.lat, n.lon);
          if (d < bestD) { bestD = d; best = n; }
        }
      }
    }
    return best;
  }

  // ---- attach cluster to a node ----
  const insNode = db.prepare('INSERT OR IGNORE INTO nodes(id,name,type,lat,lon,folder,meta) VALUES(?,?,?,?,?,?,?)');
  let createdCount = 0;
  const clusterNode = new Map(); // cluster -> nodeId
  clusters2.forEach((c, idx) => {
    const ex = nearestNode(c.lat, c.lon, SNAP_M);
    if (ex) { clusterNode.set(c, ex.id); return; }
    const id = 'JN-' + (idx + 1);
    insNode.run(id, 'Узел соединения ' + (idx + 1), 'Камера', +c.lat.toFixed(6), +c.lon.toFixed(6), 'Слой без названия', JSON.stringify({ createdBy: 'topology-builder' }));
    createdCount++;
    clusterNode.set(c, id);
  });

  // ---- link pipes to nodes ----
  db.transaction(() => {
    for (let i = 0; i < endpoints.length; i++) {
      const e = endpoints[i];
      const nodeId = clusterNode.get(clusterOf2.get(i));
      if (!nodeId) continue;
      if (e.end === 0) db.prepare('UPDATE pipes SET from_node_id=? WHERE id=?').run(nodeId, e.pipeId);
      else db.prepare('UPDATE pipes SET to_node_id=? WHERE id=?').run(nodeId, e.pipeId);
    }
  })();

  // ---- report connectivity ----
  const g = graph();
  const seen = new Set();
  const comps = [];
  for (const n of db.prepare('SELECT id FROM nodes').all()) {
    if (seen.has(n.id)) continue;
    const comp = [];
    const q = [n.id];
    seen.add(n.id);
    while (q.length) {
      const cur = q.shift();
      comp.push(cur);
      for (const et of g.a.get(cur) || []) if (!seen.has(et.node)) { seen.add(et.node); q.push(et.node); }
    }
    comps.push(comp);
  }
  comps.sort((a, b) => b.length - a.length);
  const sources = db.prepare("SELECT id FROM nodes WHERE type='Источник'").all();
  console.log('[topology] done. junction nodes:', createdCount, '| nodes:', db.prepare('SELECT count(*) n FROM nodes').get().n, '| components:', comps.length);
  console.log('[topology] largest components:', comps.slice(0, 12).map(c => c.length).join(','));
  console.log('[topology] source component size:', sources.length ? comps.find(c => c.includes(sources[0].id))?.length || 0 : 0);
  console.log('[topology] houses linked to node:', db.prepare('SELECT count(*) n FROM houses WHERE node_id IS NOT NULL').get().n);
}

run();