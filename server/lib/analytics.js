const db = require('../db');

/** Risk score based on real historical data (interpretable baseline model).
 *  Replaceable later by a real ML model behind same interface.
 */
function riskScores(limit = 50) {
  return db.prepare(`
    SELECT n.id, n.name, n.type,
      COUNT(DISTINCT b.id) AS bursts,
      COUNT(DISTINCT d.id) AS defects,
      COUNT(DISTINCT i.id) AS inspections,
      COALESCE(AVG(CASE WHEN p.diameter_mm < 150 THEN 2 ELSE 0 END),0) AS small_diam_factor,
      COALESCE(MAX(CASE WHEN p.material IN ('не указан в исходном KML','') THEN 1 ELSE 0 END),0) AS unknown_material,
      (SELECT COUNT(*) FROM houses h WHERE h.node_id = n.id) AS consumers
    FROM nodes n
    LEFT JOIN bursts b ON b.node_id = n.id
    LEFT JOIN defects d ON d.node_id = n.id
    LEFT JOIN inspections i ON i.node_id = n.id
    LEFT JOIN pipes p ON p.from_node_id = n.id OR p.to_node_id = n.id
    GROUP BY n.id
  `).all().map(r => {
    const ageScore = 0; // install year not present in KML
    const burstScore = Math.min(r.bursts * 4, 40);
    const defectScore = Math.min(r.defects * 2, 30);
    const diamScore = Math.min(r.small_diam_factor * 10, 10);
    const materialScore = r.unknown_material ? 5 : 0;
    const consumerScore = Math.min(r.consumers / 20, 10);
    const inspectionScore = Math.min(r.inspections * 0.5, 5);
    const score = Math.round(burstScore + defectScore + diamScore + materialScore + consumerScore + inspectionScore + ageScore);
    let level = 'low';
    if (score >= 40) level = 'critical';
    else if (score >= 25) level = 'high';
    else if (score >= 12) level = 'medium';
    let status = 'normal';
    if (r.bursts > 5) status = 'high_risk';
    else if (score >= 25) status = 'high_risk';
    return {
      ...r,
      score,
      level,
      status,
      factors: {
        bursts: r.bursts,
        defects: r.defects,
        inspections: r.inspections,
        smallDiameter: r.small_diam_factor > 0,
        unknownMaterial: r.unknown_material === 1,
        consumers: r.consumers
      }
    };
  }).filter(r => r.bursts > 0 || r.defects > 0 || r.consumers > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Identify anomalies in telemetry vs thresholds (real thresholds from admin). */
function telemetryAnomalies(items) {
  const out = [];
  for (const it of items || []) {
    for (const m of it.metrics || []) {
      if (!m.alert) continue;
      out.push({
        nodeId: it.nodeId,
        nodeName: it.name,
        key: m.key,
        value: m.value,
        min: m.min,
        max: m.max,
        severity: m.value > m.max ? 'high' : (m.value < m.min ? 'high' : 'medium'),
        type: m.value > m.max ? 'exceeded' : 'below',
        message: `${it.name}: ${m.key} ${m.value} (норма ${m.min}–${m.max})`
      });
    }
  }
  return out.sort((a, b) => b.severity.localeCompare(a.severity)).slice(0, 100);
}

/** Consumption analytics: compare house load vs average for similar buildings. */
function consumptionAnalytics() {
  const houses = db.prepare(`
    SELECT h.*, n.name AS node_name, n.type AS node_type,
    (SELECT COUNT(*) FROM bursts b WHERE b.node_id = h.node_id AND b.status='active') AS active_bursts
    FROM houses h LEFT JOIN nodes n ON n.id = h.node_id
    WHERE h.node_id IS NOT NULL
  `).all();
  const withLoad = houses.filter(h => h.load && h.load > 0);
  const avgLoad = withLoad.length ? withLoad.reduce((s, h) => s + h.load, 0) / withLoad.length : 0;
  // normalize heat load: house.load is already Gcal/h
  const anomalous = withLoad
    .filter(h => h.load > avgLoad * 2.2 || h.load < Math.max(0.05, avgLoad * 0.1))
    .map(h => ({
      house: `${h.street} ${h.house}`,
      houseId: h.id,
      nodeId: h.node_id,
      nodeName: h.node_name || h.node_id,
      load: h.load,
      avgLoad: Math.round(avgLoad * 100) / 100,
      deviation: Math.round((h.load / avgLoad - 1) * 100),
      activeBursts: h.active_bursts,
      flags: []
    }))
    .sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation))
    .slice(0, 30);
  return { avgLoad: Math.round(avgLoad * 100) / 100, anomalous, totalHouses: houses.length, measuredHouses: withLoad.length };
}

/** Affected area impact: consumers, social objects, critical infrastructure. */
function affectedImpact(zoneResult) {
  if (!zoneResult || !zoneResult.nodeIds) return null;
  const ids = zoneResult.nodeIds, m = ids.map(() => '?').join(',');
  const houses = zoneResult.houses || db.prepare(`SELECT * FROM houses WHERE node_id IN (${m})`).all(...ids);
  const social = db.prepare(`SELECT * FROM social_objects WHERE source_id IN (${m})`).all(...ids);
  const socialMissing = db.prepare(`SELECT * FROM social_objects WHERE source_id NOT IN (${m}) AND (source_id IS NULL OR source_id='')`).all().length;
  let socialCount = social.length;
  return {
    houses: houses.length,
    socialObjects: socialCount,
    socialList: social,
    criticalConsumers: social.filter(s => {
      try { const meta = JSON.parse(s.meta || '{}'); return meta.category === 'school' || meta.category === 'clinic' || meta.category === 'hospital' || meta.category === 'kindergarten'; }
      catch (e) { return false; }
    }),
    totalFlats: houses.reduce((s, h) => s + (h.flats || 0), 0)
  };
}

/** Repeat-burst analysis: same TK/address recurring bursts. */
function repeatBursts(limit = 30) {
  return db.prepare(`
    SELECT tk, address, COUNT(*) AS cnt,
      GROUP_CONCAT(DISTINCT status) AS statuses,
      MIN(date_detected) AS first_at,
      MAX(date_detected) AS last_at,
      GROUP_CONCAT(DISTINCT defect_char) AS defect_chars
    FROM bursts WHERE tk IS NOT NULL AND tk != ''
    GROUP BY tk HAVING cnt > 1
    ORDER BY cnt DESC LIMIT ?
  `).all(limit).map(b => ({
    ...b,
    nodeId: (db.prepare('SELECT node_id FROM bursts WHERE tk=? AND node_id IS NOT NULL LIMIT 1').get(b.tk) || {}).node_id || null
  }));
}

/** Reliability report by district / type / diameter. */
function reliabilityByDistrict() {
  const rows = db.prepare(`
    SELECT COALESCE(n.folder,'') AS district,
      COUNT(DISTINCT n.id) AS nodes,
      COUNT(DISTINCT CASE WHEN b.node_id IS NOT NULL THEN b.id END) AS bursts,
      COUNT(DISTINCT CASE WHEN d.node_id IS NOT NULL THEN d.id END) AS defects
    FROM nodes n
    LEFT JOIN bursts b ON b.node_id = n.id
    LEFT JOIN defects d ON d.node_id = n.id
    GROUP BY n.folder
    ORDER BY bursts DESC
  `).all();
  return rows;
}

function reliabilityByType() {
  return db.prepare(`
    SELECT COALESCE(n.type,'Неизвестно') AS type,
      COUNT(DISTINCT n.id) AS nodes,
      COUNT(DISTINCT CASE WHEN b.node_id IS NOT NULL THEN b.id END) AS bursts,
      COUNT(DISTINCT CASE WHEN d.node_id IS NOT NULL THEN d.id END) AS defects
    FROM nodes n
    LEFT JOIN bursts b ON b.node_id = n.id
    LEFT JOIN defects d ON d.node_id = n.id
    GROUP BY n.type ORDER BY bursts DESC
  `).all();
}

function reliabilityByDiameter() {
  return db.prepare(`
    SELECT CASE
        WHEN p.diameter_mm < 80 THEN '<80'
        WHEN p.diameter_mm < 150 THEN '80–150'
        WHEN p.diameter_mm < 300 THEN '150–300'
        ELSE '≥300'
      END AS dia_group,
      COUNT(DISTINCT p.id) AS pipes,
      COUNT(DISTINCT CASE WHEN b.node_id IS NOT NULL THEN b.id END) AS bursts
    FROM pipes p
    LEFT JOIN bursts b ON b.node_id = p.from_node_id OR b.node_id = p.to_node_id
    GROUP BY dia_group ORDER BY bursts DESC
  `).all();
}

/** Executive dashboard KPIs with real data. */
function dashboardKpis() {
  const c = {
    nodes: db.prepare('SELECT COUNT(*) n FROM nodes').get().n,
    pipes: db.prepare('SELECT COUNT(*) n FROM pipes').get().n,
    houses: db.prepare('SELECT COUNT(*) n FROM houses').get().n,
    activeBursts: db.prepare("SELECT COUNT(*) n FROM bursts WHERE status='active'").get().n,
    capitalRepairs: db.prepare("SELECT COUNT(*) n FROM bursts WHERE status='capital_repair'").get().n,
    openDefects: db.prepare('SELECT COUNT(*) n FROM defects WHERE resolved=0').get().n,
    openRepairs: db.prepare("SELECT COUNT(*) n FROM repair_tasks WHERE status NOT IN ('done','cancelled')").get().n,
    activeTasks: db.prepare("SELECT COUNT(*) n FROM inspection_tasks WHERE status != 'done'").get().n,
    inspections: db.prepare('SELECT COUNT(*) n FROM inspections').get().n,
    scenarios: db.prepare('SELECT COUNT(*) n FROM scenarios').get().n,
    anomalies: db.prepare('SELECT COUNT(*) n FROM notifications WHERE type=? AND read_at IS NULL').get('anomaly')?.n || 0
  };
  const risk = riskScores(1000);
  c.highRiskNodes = risk.filter(r => r.level === 'high' || r.level === 'critical').length;
  c.criticalRiskNodes = risk.filter(r => r.level === 'critical').length;
  // total affected consumers today from active bursts
  const activeAffected = db.prepare("SELECT node_id FROM bursts WHERE status='active' AND node_id IS NOT NULL").all().map(r => r.node_id);
  let affectedConsumers = 0;
  if (activeAffected.length) {
    const m = activeAffected.map(() => '?').join(',');
    affectedConsumers = db.prepare(`SELECT SUM(cnt) AS total FROM (SELECT node_id, COUNT(*) AS cnt FROM houses WHERE node_id IN (${m}) GROUP BY node_id)`).get(...activeAffected)?.total || 0;
  }
  c.affectedConsumers = affectedConsumers;
  const lastYear = new Date(Date.now() - 365 * 864e5).toISOString();
  c.burstsLastYear = db.prepare('SELECT COUNT(*) n FROM bursts WHERE date_detected >= ?').get(lastYear)?.n || 0;
  return c;
}

/** Time-series of bursts for trend charts. */
function burstTimeline(months = 12) {
  const rows = db.prepare('SELECT date_detected, status FROM bursts WHERE date_detected IS NOT NULL AND date_detected != ?').all('');
  const buckets = {};
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets[d.toISOString().slice(0, 7)] = { month: d.toLocaleString('ru', { month: 'short', year: '2-digit' }), total: 0, active: 0 };
  }
  for (const r of rows) {
    const key = String(r.date_detected).slice(0, 7);
    if (!buckets[key]) continue;
    buckets[key].total++;
    if (r.status === 'active') buckets[key].active++;
  }
  return Object.values(buckets);
}

module.exports = { riskScores, telemetryAnomalies, consumptionAnalytics, affectedImpact, repeatBursts, reliabilityByDistrict, reliabilityByType, reliabilityByDiameter, dashboardKpis, burstTimeline };