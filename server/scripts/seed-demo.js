#!/usr/bin/env node
/**
 * Generate realistic demo data for HeatNet Digital Twin
 * Creates demo scenarios, work orders, inspections, defects, etc.
 */

const db = require('../db');
const network = require('../lib/network');

const id = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

console.log('🌱 Generating demo data...');

// Get some real nodes
const nodes = db.prepare('SELECT * FROM nodes LIMIT 20').all();
const pipes = db.prepare('SELECT * FROM pipes LIMIT 30').all();
const houses = db.prepare('SELECT * FROM houses LIMIT 100').all();

if (!nodes.length || !pipes.length) {
  console.error('❌ Database is empty. Run import-all first.');
  process.exit(1);
}

// Demo users / roles
const roles = [
  { id: 'dispatcher', label: 'Диспетчер' },
  { id: 'engineer', label: 'Инженер' },
  { id: 'field_worker', label: 'Полевой сотрудник' },
  { id: 'manager', label: 'Руководитель' },
  { id: 'admin', label: 'Администратор' }
];

try {
  // Ensure roles exist
  for (const role of roles) {
    try {
      db.prepare('INSERT OR IGNORE INTO roles(id, label) VALUES(?, ?)').run(role.id, role.label);
    } catch (e) {}
  }

  // Create demo users
  const demo_users = [
    { username: 'dispatcher@demo.local', name: 'Диспетчер Иван', role: 'dispatcher' },
    { username: 'engineer@demo.local', name: 'Инженер Петр', role: 'engineer' },
    { username: 'field@demo.local', name: 'Бригада #1', role: 'field_worker' },
    { username: 'manager@demo.local', name: 'Руководитель Сергей', role: 'manager' },
    { username: 'admin@demo.local', name: 'Администратор', role: 'admin' }
  ];

  for (const user of demo_users) {
    try {
      const hash = require('crypto').createHash('sha256').update('Demo123!').digest('hex');
      db.prepare('INSERT OR IGNORE INTO users(id, username, password_hash, name, role_id, active) VALUES(?, ?, ?, ?, ?, 1)')
        .run(`u-${user.role}`, user.username, hash, user.name, user.role);
    } catch (e) {}
  }

  // Create inspection tasks
  console.log('📋 Creating inspection tasks...');
  for (let i = 0; i < 5; i++) {
    const node = nodes[Math.floor(Math.random() * nodes.length)];
    const taskId = id('task');
    const plannedDate = new Date(Date.now() + Math.random() * 7 * 86400e3).toISOString();
    db.prepare(`
      INSERT INTO inspection_tasks(id, node_id, title, planned_at, priority, status, assignee, note)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskId,
      node.id,
      `Плановый осмотр: ${node.name}`,
      plannedDate,
      Math.floor(Math.random() * 5) + 1,
      Math.random() > 0.7 ? 'in_progress' : 'planned',
      'Бригада #' + (Math.floor(Math.random() * 3) + 1),
      'Фото и GPS обязательны. Проверить изоляцию и запорную арматуру.'
    );
  }

  // Create repair tasks
  console.log('🔧 Creating repair tasks...');
  for (let i = 0; i < 3; i++) {
    const node = nodes[Math.floor(Math.random() * nodes.length)];
    const repairId = id('repair');
    const plannedDate = new Date(Date.now() + Math.random() * 14 * 86400e3).toISOString();

    // Calculate affected area
    let affectedHouses = 0;
    try {
      const zone = network.zone({ nodeId: node.id });
      affectedHouses = zone.houseCount || 0;
    } catch (e) {}

    db.prepare(`
      INSERT INTO repair_tasks(id, title, description, node_id, reason, priority, status, assignee, brigade, planned_date, affected_houses, created_at, created_by)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      repairId,
      `Ремонт камеры ${node.name}`,
      'Замена изоляции и проверка запорной арматуры',
      node.id,
      Math.random() > 0.5 ? 'Плановый ремонт' : 'Аварийное восстановление',
      Math.floor(Math.random() * 5) + 1,
      ['planned', 'in_progress', 'done'][Math.floor(Math.random() * 3)],
      `Мастер ${Math.floor(Math.random() * 5) + 1}`,
      `Бригада #${Math.floor(Math.random() * 3) + 1}`,
      plannedDate,
      affectedHouses,
      new Date().toISOString(),
      'Диспетчер'
    );
  }

  // Create some high-risk scenario
  console.log('⚠️ Creating high-risk scenario...');
  const riskNode = nodes.find(n => Math.random() > 0.7) || nodes[0];
  try {
    const zone = network.zone({ nodeId: riskNode.id });
    const scenarioId = id('scenario');
    db.prepare(`
      INSERT INTO scenarios(id, title, pipe_id, node_id, created_by, created_at, zone_json, note)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      scenarioId,
      `Анализ отключения: ${riskNode.name}`,
      null,
      riskNode.id,
      'dispatcher@demo.local',
      new Date().toISOString(),
      JSON.stringify(zone),
      `Расчет зоны отключения для объекта ${riskNode.name}. Затрагивает ${zone.houseCount} домов.`
    );
  } catch (e) {
    console.log('  (zone calculation skipped for', riskNode.id, ')');
  }

  // Create notifications for high-risk objects
  console.log('🔔 Creating notifications...');
  const notif = [
    { type: 'incident', severity: 'critical', title: 'Критическая аномалия давления', message: 'На участке PIPE-017 обнаружена аномалия давления 8.4 bar (норма 7.5 bar)' },
    { type: 'incident', severity: 'warning', title: 'Проблемный участок выявлен', message: 'TK20-13 имеет высокий риск отказа (score 87)' },
    { type: 'repair', severity: 'info', title: 'Ремонт завершен', message: 'Ремонт камеры TK-042 успешно завершен' }
  ];

  for (const n of notif) {
    db.prepare(`
      INSERT INTO notifications(id, type, severity, title, message, created_at, read_at)
      VALUES(?, ?, ?, ?, ?, ?, NULL)
    `).run(
      id('notif'),
      n.type,
      n.severity,
      n.title,
      n.message,
      new Date(Date.now() - Math.random() * 3 * 86400e3).toISOString()
    );
  }

  // Create some vehicle positions (GPS fleet)
  console.log('🚗 Creating vehicle positions...');
  for (let i = 1; i <= 3; i++) {
    const vehicleId = `vehicle-${i}`;
    const lat = 53.214 + (Math.random() - 0.5) * 0.05;
    const lon = 63.63 + (Math.random() - 0.5) * 0.05;
    db.prepare(`
      INSERT INTO vehicle_positions(id, vehicle_id, name, lat, lon, status, recorded_at, source)
      VALUES(?, ?, ?, ?, ?, ?, ?, 'mock')
    `).run(
      id('vehicle'),
      vehicleId,
      `КТ-0${i}`,
      lat,
      lon,
      Math.random() > 0.3 ? 'en_route' : 'at_work',
      new Date().toISOString(),
    );
  }

  // Create heat meter readings
  console.log('📊 Creating telemetry data...');
  const demoReadings = [
    { temp_supply: 90.2, temp_return: 42.1, pressure: 6.8, flow: 145.3 },
    { temp_supply: 89.5, temp_return: 41.8, pressure: 6.9, flow: 142.1 },
    { temp_supply: 91.1, temp_return: 42.9, pressure: 6.7, flow: 148.9 },
    { temp_supply: 87.3, temp_return: 40.2, pressure: 7.2, flow: 138.5 }, // anomaly
  ];

  for (const reading of demoReadings) {
    db.prepare(`
      INSERT INTO meter_readings(id, meter_id, recorded_at, temperature_supply, temperature_return, pressure_supply, flow_m3h, source)
      VALUES(?, ?, ?, ?, ?, ?, ?, 'mock')
    `).run(
      id('reading'),
      'meter-demo-01',
      new Date(Date.now() - Math.random() * 86400e3).toISOString(),
      reading.temp_supply,
      reading.temp_return,
      reading.pressure,
      reading.flow
    );
  }

  // Create some defects for high-risk nodes
  console.log('⚠️ Creating defects...');
  const defectTypes = [
    'Повреждение изоляции',
    'Коррозия металла',
    'Утечка теплоносителя',
    'Повреждение покрытия',
    'Слабое крепление'
  ];
  
  for (let i = 0; i < 3; i++) {
    const node = nodes[Math.floor(Math.random() * nodes.length)];
    db.prepare(`
      INSERT INTO defects(id, source, date_observed, node_id, defect_type, note, detected_by, priority, resolved)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id('defect'),
      'field',
      new Date(Date.now() - Math.random() * 30 * 86400e3).toISOString(),
      node.id,
      defectTypes[Math.floor(Math.random() * defectTypes.length)],
      'Обнаружено при плановом осмотре',
      'Бригада #1',
      Math.floor(Math.random() * 5),
      Math.random() > 0.6 ? 1 : 0
    );
  }

  console.log('✅ Demo data generated successfully!');
  console.log('\n📝 Demo users:');
  console.log('  dispatcher@demo.local / Demo123!');
  console.log('  engineer@demo.local / Demo123!');
  console.log('  field@demo.local / Demo123!');
  console.log('  manager@demo.local / Demo123!');
  console.log('  admin@demo.local / Demo123!');
  console.log('\n📊 Statistics:');
  const stats = {
    tasks: db.prepare('SELECT COUNT(*) n FROM inspection_tasks').get().n,
    repairs: db.prepare('SELECT COUNT(*) n FROM repair_tasks').get().n,
    notifications: db.prepare('SELECT COUNT(*) n FROM notifications').get().n,
    defects: db.prepare("SELECT COUNT(*) n FROM defects WHERE resolved = 0").get().n,
    vehicles: db.prepare('SELECT COUNT(DISTINCT vehicle_id) n FROM vehicle_positions').get().n
  };
  console.log(`  Inspection tasks: ${stats.tasks}`);
  console.log(`  Repair tasks: ${stats.repairs}`);
  console.log(`  Notifications: ${stats.notifications}`);
  console.log(`  Open defects: ${stats.defects}`);
  console.log(`  Vehicles: ${stats.vehicles}`);

} catch (e) {
  console.error('❌ Error generating demo data:', e.message);
  process.exit(1);
}
