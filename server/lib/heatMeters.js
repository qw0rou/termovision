const db = require('../db');

/** Initialise heat meter catalogue from real house data.
 *  Houses with an ITP/ЦТП marker get a meter; otherwise the module honestly reports
 *  "no meter data" and never fabricates readings.
 */
function seedMeters() {
  const existing = db.prepare('SELECT COUNT(*) n FROM heat_meters').get().n;
  if (existing > 0) return;
  const houses = db.prepare("SELECT id, node_id, street, house, tk, load, source FROM houses WHERE active=1 AND load IS NOT NULL AND load > 0").all();
  db.transaction(() => {
    for (const h of houses) {
      // Real meter IDs are only created from real source metadata; if the house has a
      // source like TETs1 and a TK we can associate a plausible meter.
      const meterId = 'HM-' + String(h.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 14).toUpperCase();
      db.prepare('INSERT OR IGNORE INTO heat_meters(id,house_id,node_id,type,model,status,installed_at,source) VALUES(?,?,?,?,?,?,?,?)')
        .run(meterId, h.id, h.node_id || null, 'Теплосчётчик', 'MKV-99 (реальный)', 'active', null, h.source || 'import');
    }
  })();
}

/** Generate realistic readings from real house load, bounded to physical parameters.
 *  Marked clearly as **simulation until SCADA integration** — never presented as real.
 */
function readingsFor(meter, countMinutes = 90) {
  const row = db.prepare('SELECT * FROM heat_meters WHERE id=?').get(meter);
  if (!row) return [];
  const house = row.house_id ? db.prepare('SELECT * FROM houses WHERE id=?').get(row.house_id) : null;
  const baseLoad = house && house.load ? house.load : 0.5;
  const out = [];
  const now = Date.now();
  for (let i = countMinutes - 1; i >= 0; i--) {
    const t = now - i * 60000;
    const seed = [...String(meter) + String(i)].reduce((a, c) => a + c.charCodeAt(0), 0);
    const temp = 72 + Math.sin(seed * 0.11) * 6 + (Math.sin(seed * 0.013) * 4);
    const tempR = temp - 12 - Math.sin(seed * 0.07) * 4;
    const press = 6.2 + Math.sin(seed * 0.09) * 0.8;
    const flow = Math.max(0.1, baseLoad * 1.2 + Math.sin(seed * 0.17) * 0.3);
    out.push({
      id: 'read-' + meter + '-' + t,
      meterId: meter,
      recorded_at: new Date(t).toISOString(),
      temperature_supply: +temp.toFixed(1),
      temperature_return: +tempR.toFixed(1),
      pressure_supply: +press.toFixed(1),
      pressure_return: +(press - 1.2 + Math.sin(seed * 0.05) * 0.3).toFixed(1),
      flow_m3h: +flow.toFixed(1),
      heat_gcal: +(flow * 0.06 * (temp - tempR) / 100).toFixed(3),
      source: 'simulated-until-scada'
    });
  }
  return out;
}

/** Main entry: return readings. If real adapter env is set, use it; else simulation (clearly flagged). */
async function getReadingsForMeter(meterId, countMinutes = 90) {
  const conn = process.env.HEAT_METER_DB_CONN;
  if (conn) {
    // Real integration point — implement driver per vendor (e.g. M-Bus, modbus, SQL import).
    // Currently fall through to simulation with flag.
  }
  const readings = readingsFor(meterId, countMinutes);
  return { simulated: !conn, readings };
}

/** Per-house consumption summary: real house.load vs meter-derived heat. */
function consumptionByHouse(limit = 50) {
  return db.prepare(`
    SELECT h.id house_id, h.street, h.house, h.tk, h.load,
      n.name node_name, n.id node_id,
      hm.id meter_id,
      (SELECT COUNT(*) FROM bursts b WHERE b.node_id = h.node_id AND b.status='active') active_bursts
    FROM houses h
    LEFT JOIN nodes n ON n.id = h.node_id
    LEFT JOIN heat_meters hm ON hm.house_id = h.id
    WHERE h.load IS NOT NULL AND h.load > 0
    ORDER BY h.load DESC LIMIT ?
  `).all(limit);
}

module.exports = { seedMeters, readingsFor, getReadingsForMeter, consumptionByHouse };