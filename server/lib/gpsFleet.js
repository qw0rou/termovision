const db = require('../db');

/** Fleet positions: real adapter if GPS_FLEET_API_URL configured, otherwise clearly-labelled mock. */
async function getVehicles() {
  const apiUrl = process.env.GPS_FLEET_API_URL;
  if (apiUrl) {
    try {
      const res = await fetch(apiUrl, { headers: { Authorization: 'Bearer ' + (process.env.GPS_FLEET_API_KEY || '') } });
      const data = await res.json();
      const now = new Date().toISOString();
      db.prepare('DELETE FROM vehicle_positions').run();
      const ins = db.prepare('INSERT INTO vehicle_positions(id,vehicle_id,name,lat,lon,status,recorded_at,source) VALUES(?,?,?,?,?,?,?,?)');
      for (const v of (Array.isArray(data) ? data : data.vehicles || [])) {
        ins.run('veh-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), v.id || v.vehicleId, v.name, v.lat, v.lon, v.status || 'unknown', v.recorded_at || now, 'real-api');
      }
      return db.prepare('SELECT * FROM vehicle_positions ORDER BY recorded_at DESC').all();
    } catch (e) {
      // fall through to mock on API failure, but log that real integration failed
      console.warn('[gps] real API failed, falling back to mock:', e.message);
    }
  }
  // Mock fleet — explicitly labelled. Positioned near KTEK sources (real coordinates).
  const mock = [
    { id: 'BR-07', name: 'Аварийная бригада 07', lat: 53.2144, lon: 63.6241, status: 'on_route' },
    { id: 'BR-12', name: 'Бригада 12', lat: 53.2208, lon: 63.6320, status: 'available' },
    { id: 'BR-03', name: 'Аварийная бригада 03', lat: 53.2091, lon: 63.6187, status: 'working' }
  ];
  const now = new Date().toISOString();
  db.prepare('DELETE FROM vehicle_positions').run();
  const ins = db.prepare('INSERT INTO vehicle_positions(id,vehicle_id,name,lat,lon,status,recorded_at,source) VALUES(?,?,?,?,?,?,?,?)');
  for (const v of mock) ins.run('veh-' + v.id, v.id, v.name, v.lat, v.lon, v.status, now, 'mock');
  return db.prepare('SELECT * FROM vehicle_positions ORDER BY recorded_at DESC').all();
}

/** Movement history for a vehicle (real or mock). */
function vehicleHistory(vehicleId, limit = 50) {
  return db.prepare('SELECT * FROM vehicle_positions WHERE vehicle_id=? ORDER BY recorded_at DESC LIMIT ?').all(vehicleId, limit);
}

/** Assignment analysis: match active repair/inspection tasks to nearest vehicle. */
function assignmentAnalysis() {
  const vehicles = db.prepare('SELECT * FROM vehicle_positions').all();
  const tasks = db.prepare("SELECT t.*, n.lat, n.lon, n.name node_name FROM inspection_tasks t LEFT JOIN nodes n ON n.id=t.node_id WHERE t.status!='done'").all();
  const repairs = db.prepare("SELECT r.*, n.lat, n.lon, n.name node_name FROM repair_tasks r LEFT JOIN nodes n ON n.id=r.node_id WHERE r.status NOT IN ('done','cancelled')").all();
  function nearestVehicle(lat, lon) {
    if (!lat || !lon || !vehicles.length) return null;
    let best = null, bestD = Infinity;
    for (const v of vehicles) {
      const d = (v.lat - lat) ** 2 + (v.lon - lon) ** 2;
      if (d < bestD) { bestD = d; best = v; }
    }
    return { vehicle: best, distanceKm: Math.round(Math.sqrt(bestD) * 111) };
  }
  return {
    vehicles,
    inspectionTaskAssignments: tasks.map(t => ({ task: t, assignment: nearestVehicle(t.lat, t.lon) })),
    repairTaskAssignments: repairs.map(r => ({ repair: r, assignment: nearestVehicle(r.lat, r.lon) }))
  };
}

module.exports = { getVehicles, vehicleHistory, assignmentAnalysis };