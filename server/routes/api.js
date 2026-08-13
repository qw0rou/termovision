const express = require('express');
const db = require('../db');
const network = require('../lib/network');
const analytics = require('../lib/analytics');
const telemetry = require('../lib/telemetrySim');
const heatMeters = require('../lib/heatMeters');
const gpsFleet = require('../lib/gpsFleet');
const auth = require('../lib/auth');

const router = express.Router();
router.use(express.json());

const id = p => p + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
const f = v => (v == null || v === '') ? '—' : v;

// ---------------- AUTH ----------------
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(username || '').trim());
  if (!user || !auth.verifyPassword(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const s = auth.createSession(user.id);
  auth.logAudit({ userId: user.id, name: user.name }, 'auth.login', 'user', user.id, { username });
  res.json(s);
});
router.post('/auth/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  auth.destroySession(token);
  res.json({ ok: true });
});
router.get('/auth/session', (req, res) => {
  const user = auth.currentUser(req);
  res.json({ user: user ? { name: user.name, roleId: user.roleId, username: user.username } : null });
});
router.get('/roles', (req, res) => res.json(db.prepare('SELECT * FROM roles').all()));
router.post('/users', (req, res) => {
  try {
    const { username, password, name, roleId } = req.body || {};
    if (!username || !password || !roleId) return res.status(400).json({ error: 'Заполните все поля' });
    const uid = 'u-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    db.prepare('INSERT INTO users(id,username,password_hash,name,role_id,active) VALUES(?,?,?,?,?,1)')
      .run(uid, username, auth.hashPassword(password), name || username, roleId);
    auth.logAudit(auth.currentUser(req), 'user.create', 'user', uid, { username, roleId });
    res.json({ ok: true, id: uid });
  } catch (e) { res.status(400).json({ error: 'Не удалось создать пользователя: ' + e.message }); }
});
router.get('/users', (req, res) => res.json(db.prepare("SELECT id,username,name,role_id,active,created_at FROM users WHERE id != 'u-field' OR 1=1 ORDER BY created_at").all()));
router.put('/users/:id', (req, res) => {
  const { name, roleId, active, password } = req.body || {};
  const old = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!old) return res.sendStatus(404);
  if (password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(auth.hashPassword(password), req.params.id);
  if (name) db.prepare('UPDATE users SET name=? WHERE id=?').run(name, req.params.id);
  if (roleId) db.prepare('UPDATE users SET role_id=? WHERE id=?').run(roleId, req.params.id);
  if (active !== undefined) db.prepare('UPDATE users SET active=? WHERE id=?').run(active ? 1 : 0, req.params.id);
  auth.logAudit(auth.currentUser(req), 'user.update', 'user', req.params.id, { name, roleId, active: !!active });
  res.json({ ok: true });
});
router.get('/audit', (req, res) => res.json(db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200').all()));

// ---------------- DASHBOARD / ANALYTICS ----------------
router.get('/dashboard', (req, res) => {
  const kpis = analytics.dashboardKpis();
  const risk = analytics.riskScores(20);
  const anomalies = analytics.telemetryAnomalies(telemetry.all());
  const timeline = analytics.burstTimeline(12);
  const districts = analytics.reliabilityByDistrict();
  res.json({ kpis, risk, anomalies: anomalies.slice(0, 10), timeline, districts });
});
router.get('/analytics/risk', (req, res) => {
  const rows = analytics.riskScores(+req.query.limit || 100);
  const coordMap = new Map(db.prepare('SELECT id, lat, lon FROM nodes WHERE id IN (' + rows.map(() => '?').join(',') + ')').all(...rows.map(r => r.id)).map(n => [n.id, { lat: n.lat, lon: n.lon }]));
  res.json(rows.map(r => ({ ...r, lat: coordMap.get(r.id)?.lat || 53.214, lon: coordMap.get(r.id)?.lon || 63.63 })));
});
router.get('/analytics/consumption', (req, res) => res.json({ analytics: analytics.consumptionAnalytics(), houses: heatMeters.consumptionByHouse(+req.query.limit || 50) }));
router.get('/analytics/repeat-bursts', (req, res) => res.json(analytics.repeatBursts(+req.query.limit || 30)));
router.get('/analytics/reliability', (req, res) => res.json({
  byDistrict: analytics.reliabilityByDistrict(),
  byType: analytics.reliabilityByType(),
  byDiameter: analytics.reliabilityByDiameter(),
  timeline: analytics.burstTimeline(12)
}));
router.get('/analytics/impact', (req, res) => {
  try {
    const z = network.zone(req.query);
    const impact = analytics.affectedImpact(z);
    res.json({ zone: z, impact });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------------- REPAIRS ----------------
router.get('/repairs', (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, n.name node_name, p.name pipe_name,
      (SELECT COUNT(*) FROM houses h WHERE h.node_id = r.node_id) house_count
    FROM repair_tasks r
    LEFT JOIN nodes n ON n.id = r.node_id
    LEFT JOIN pipes p ON p.id = r.pipe_id
    ORDER BY (r.status='planned') DESC, r.priority DESC, r.planned_date
  `).all();
  res.json(rows);
});
router.post('/repairs', (req, res) => {
  const b = req.body || {};
  if (!b.title && !b.nodeId && !b.pipeId) return res.status(400).json({ error: 'Укажите объект и название' });
  let affectedHouses = 0, affectedSocial = 0, scenarioId = b.scenarioId || null;
  if (b.nodeId || b.pipeId) {
    try {
      const z = network.zone({ nodeId: b.nodeId, pipeId: b.pipeId });
      affectedHouses = z.houseCount;
      affectedSocial = z.socialCount;
      if (!scenarioId && b.saveScenario) {
        const scId = id('scenario');
        db.prepare('INSERT INTO scenarios VALUES(?,?,?,?,?,?,?,?)').run(scId, b.title || 'Ремонт', b.pipeId || null, b.nodeId || null, auth.currentUser(req)?.name || 'Диспетчер', new Date().toISOString(), JSON.stringify(z), 'Создано из ремонтного задания');
        scenarioId = scId;
      }
    } catch (e) { /* zone calc may fail for unlinked objects — keep 0 */ }
  }
  const row = {
    id: id('repair'),
    title: b.title || 'Ремонтные работы',
    description: b.description || '',
    node_id: b.nodeId || null,
    pipe_id: b.pipeId || null,
    reason: b.reason || 'Плановые работы',
    priority: +b.priority || 5,
    status: b.status || 'planned',
    assignee: b.assignee || '',
    brigade: b.brigade || '',
    planned_date: b.plannedDate || new Date().toISOString().slice(0, 10),
    deadline: b.deadline || '',
    actual_fix_date: null,
    affected_houses: affectedHouses,
    affected_social: affectedSocial,
    created_at: new Date().toISOString(),
    created_by: auth.currentUser(req)?.name || 'Диспетчер',
    scenario_id: scenarioId
  };
  db.prepare('INSERT INTO repair_tasks(id,title,description,node_id,pipe_id,reason,priority,status,assignee,brigade,planned_date,deadline,actual_fix_date,affected_houses,affected_social,created_at,created_by,scenario_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(row));
  auth.logAudit(auth.currentUser(req), 'repair.create', 'repair', row.id, { title: row.title, node: b.nodeId, priority: row.priority });
  res.json({ ok: true, ...row });
});
router.put('/repairs/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM repair_tasks WHERE id=?').get(req.params.id);
  if (!r) return res.sendStatus(404);
  const b = req.body || {};
  const fields = ['title','description','node_id','pipe_id','reason','priority','status','assignee','brigade','planned_date','deadline','actual_fix_date'];
  for (const k of fields) if (b[k] !== undefined) db.prepare(`UPDATE repair_tasks SET ${k}=? WHERE id=?`).run(b[k], r.id);
  if (b.status === 'done' && !r.actual_fix_date) db.prepare("UPDATE repair_tasks SET actual_fix_date=? WHERE id=?").run(new Date().toISOString(), r.id);
  if (b.status === 'in_progress' && r.node_id) {
    db.prepare("UPDATE nodes SET status='repair' WHERE id=? AND status='normal'").run(r.node_id);
  }
  auth.logAudit(auth.currentUser(req), 'repair.update', 'repair', r.id, { status: b.status || null });
  res.json({ ok: true });
});

// ---------------- NOTIFICATIONS ----------------
router.get('/notifications', (req, res) => {
  const unreadOnly = req.query.unread === '1';
  const q = unreadOnly ? "SELECT * FROM notifications WHERE read_at IS NULL ORDER BY created_at DESC LIMIT 100" : 'SELECT * FROM notifications ORDER BY created_at DESC LIMIT 200';
  res.json(db.prepare(q).all());
});
router.post('/notifications', (req, res) => {
  const b = req.body || {};
  const nid = id('notif');
  db.prepare('INSERT INTO notifications(id,type,severity,title,message,entity_type,entity_id,created_at,read_at) VALUES(?,?,?,?,?,?,?,?,NULL)')
    .run(nid, b.type || 'info', b.severity || 'info', b.title || '', b.message || '', b.entityType || '', b.entityId || '', new Date().toISOString());
  res.json({ ok: true, id: nid });
});
router.post('/notifications/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET read_at=? WHERE id=?').run(new Date().toISOString(), req.params.id);
  res.json({ ok: true });
});

// ---------------- FLEET / GPS ----------------
router.get('/fleet', async (req, res) => res.json(await gpsFleet.getVehicles()));
router.get('/fleet/:vehicleId/history', (req, res) => res.json(gpsFleet.vehicleHistory(req.params.vehicleId, +req.query.limit || 50)));
router.get('/fleet/assignments', (req, res) => res.json(gpsFleet.assignmentAnalysis()));

// ---------------- HEAT METERS ----------------
router.get('/meters', (req, res) => {
  const limit = +req.query.limit || 100;
  const rows = db.prepare(`
    SELECT hm.*, h.street, h.house, h.tk, n.name node_name
    FROM heat_meters hm
    LEFT JOIN houses h ON h.id = hm.house_id
    LEFT JOIN nodes n ON n.id = hm.node_id
    LIMIT ?
  `).all(limit);
  res.json({ simulated: !process.env.HEAT_METER_DB_CONN, meters: rows });
});
router.get('/meters/:id/readings', async (req, res) => {
  const out = await heatMeters.getReadingsForMeter(req.params.id, +req.query.minutes || 90);
  res.json(out);
});

// ---------------- MISC extended ----------------
router.get('/trail/:nodeId', (req, res) => {
  const nid = req.params.nodeId;
  const bursts = db.prepare('SELECT * FROM bursts WHERE node_id=? ORDER BY date_detected DESC').all(nid);
  const defects = db.prepare('SELECT * FROM defects WHERE node_id=? ORDER BY date_observed DESC').all(nid);
  const inspections = db.prepare('SELECT * FROM inspections WHERE node_id=? ORDER BY observed_at DESC').all(nid);
  const repairs = db.prepare('SELECT * FROM repair_tasks WHERE node_id=? ORDER BY created_at DESC').all(nid);
  const statusChanges = db.prepare('SELECT * FROM object_status_history WHERE entity_type=? AND entity_id=? ORDER BY changed_at DESC LIMIT 20').all('node', nid);
  res.json({ bursts, defects, inspections, repairs, statusChanges });
});

// Risk-aware map layer: node risk overlay
router.get('/map/risk', (req, res) => {
  const risk = analytics.riskScores(+req.query.limit || 300);
  const levelColor = { low: '#22c55e', medium: '#f59e0b', high: '#f97316', critical: '#ef4444' };
  const coordMap = new Map(db.prepare('SELECT id, lat, lon FROM nodes WHERE id IN (' + risk.map(() => '?').join(',') + ')').all(...risk.map(r => r.id)).map(n => [n.id, { lat: n.lat, lon: n.lon }]));
  res.json({
    type: 'FeatureCollection',
    features: risk.map(r => ({ type: 'Feature', properties: { ...r, color: levelColor[r.level], lat: coordMap.get(r.id)?.lat || 53.214, lon: coordMap.get(r.id)?.lon || 63.63 }, geometry: { type: 'Point', coordinates: [coordMap.get(r.id)?.lon || 63.63, coordMap.get(r.id)?.lat || 53.214] } }))
  });
});

// ---------------- TOPOLOGY EDITOR ----------------
router.post('/editor/nodes', auth.requirePermission('editor.edit'), (req, res) => {
  const b = req.body || {};
  if (!b.lat || !b.lon) return res.status(400).json({ error: 'Укажите координаты' });
  const nid = b.id || 'N' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  try {
    db.prepare('INSERT INTO nodes(id,name,type,lat,lon,folder,meta) VALUES(?,?,?,?,?,?,?)')
      .run(nid, b.name || 'Новый узел', b.type || 'Камера', +b.lat, +b.lon, b.folder || 'Слой без названия', b.meta ? JSON.stringify(b.meta) : '{}');
    db.prepare('UPDATE nodes SET status=? WHERE id=?').run(b.status || 'normal', nid);
    auth.logAudit(auth.currentUser(req), 'editor.node.create', 'node', nid, b);
    res.json({ ok: true, id: nid });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.put('/editor/nodes/:id', auth.requirePermission('editor.edit'), (req, res) => {
  const n = db.prepare('SELECT * FROM nodes WHERE id=?').get(req.params.id);
  if (!n) return res.sendStatus(404);
  const b = req.body || {};
  const fields = ['name', 'type', 'lat', 'lon', 'folder', 'status', 'condition', 'notes', 'install_year'];
  for (const k of fields) if (b[k] !== undefined) db.prepare(`UPDATE nodes SET ${k}=? WHERE id=?`).run(b[k], n.id);
  auth.logAudit(auth.currentUser(req), 'editor.node.update', 'node', n.id, b);
  res.json({ ok: true });
});
router.delete('/editor/nodes/:id', auth.requirePermission('editor.edit'), (req, res) => {
  const n = db.prepare('SELECT * FROM nodes WHERE id=?').get(req.params.id);
  if (!n) return res.sendStatus(404);
  // delete connected pipes to avoid dangling links
  db.prepare('DELETE FROM pipes WHERE from_node_id=? OR to_node_id=?').run(n.id, n.id);
  db.prepare('DELETE FROM nodes WHERE id=?').run(n.id);
  auth.logAudit(auth.currentUser(req), 'editor.node.delete', 'node', n.id, {});
  res.json({ ok: true });
});
router.post('/editor/pipes', auth.requirePermission('editor.edit'), (req, res) => {
  const b = req.body || {};
  if (!b.fromNodeId || !b.toNodeId) return res.status(400).json({ error: 'Укажите узлы' });
  const coords = b.coordinates || (() => {
    const f = db.prepare('SELECT lat,lon FROM nodes WHERE id=?').get(b.fromNodeId);
    const t = db.prepare('SELECT lat,lon FROM nodes WHERE id=?').get(b.toNodeId);
    if (!f || !t) return null;
    return [[f.lon, f.lat], [t.lon, t.lat]];
  })();
  if (!coords) return res.status(400).json({ error: 'Узлы не найдены' });
  const pid = b.id || 'P' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  try {
    db.prepare('INSERT INTO pipes(id,name,status,diameter_mm,length_m,coordinates,folder,from_node_id,to_node_id,meta) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(pid, b.name || 'Новый участок', b.status || 'normal', b.diameter_mm || null, b.length_m || null, JSON.stringify(coords), b.folder || 'Слой без названия', b.fromNodeId, b.toNodeId, b.meta ? JSON.stringify(b.meta) : '{}');
    db.prepare('UPDATE pipes SET supply_diameter_mm=?, return_diameter_mm=?, installation_type=?, material=? WHERE id=?')
      .run(b.diameter_mm || null, b.diameter_mm || null, b.installationType || 'подземная', b.material || 'сталь', pid);
    auth.logAudit(auth.currentUser(req), 'editor.pipe.create', 'pipe', pid, b);
    res.json({ ok: true, id: pid });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.put('/editor/pipes/:id', auth.requirePermission('editor.edit'), (req, res) => {
  const p = db.prepare('SELECT * FROM pipes WHERE id=?').get(req.params.id);
  if (!p) return res.sendStatus(404);
  const b = req.body || {};
  const fields = ['name', 'status', 'diameter_mm', 'length_m', 'from_node_id', 'to_node_id', 'folder'];
  for (const k of fields) if (b[k] !== undefined) db.prepare(`UPDATE pipes SET ${k}=? WHERE id=?`).run(b[k], p.id);
  if (b.coordinates) db.prepare('UPDATE pipes SET coordinates=? WHERE id=?').run(JSON.stringify(b.coordinates), p.id);
  auth.logAudit(auth.currentUser(req), 'editor.pipe.update', 'pipe', p.id, b);
  res.json({ ok: true });
});
router.delete('/editor/pipes/:id', auth.requirePermission('editor.edit'), (req, res) => {
  const p = db.prepare('SELECT * FROM pipes WHERE id=?').get(req.params.id);
  if (!p) return res.sendStatus(404);
  db.prepare('DELETE FROM pipes WHERE id=?').run(p.id);
  auth.logAudit(auth.currentUser(req), 'editor.pipe.delete', 'pipe', p.id, {});
  res.json({ ok: true });
});

// nearby objects / spatial search (real spatial point-in-radius)
router.get('/spatial/nearby', (req, res) => {
  const lat = +req.query.lat, lon = +req.query.lon, radiusKm = +req.query.radiusKm || 0.3;
  if (!lat || !lon) return res.status(400).json({ error: 'lat/lon required' });
  const deg = radiusKm / 111;
  const nodes = db.prepare('SELECT * FROM nodes WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?').all(lat - deg, lat + deg, lon - deg, lon + deg);
  const social = db.prepare('SELECT * FROM social_objects WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?').all(lat - deg, lat + deg, lon - deg, lon + deg);
  const utilities = db.prepare('SELECT * FROM utility_crossings WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?').all(lat - deg, lat + deg, lon - deg, lon + deg);
  res.json({ nodes, socialObjects: social, utilities });
});

module.exports = router;
module.exports.id = id;
module.exports.f = f;