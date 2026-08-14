const Database=require('better-sqlite3'),path=require('path'),fs=require('fs');
const dir=path.join(__dirname,'db');fs.mkdirSync(dir,{recursive:true});const db=new Database(path.join(dir,'heatnet.sqlite'));db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY,name TEXT,type TEXT,status TEXT DEFAULT 'normal',lon REAL,lat REAL,folder TEXT,meta TEXT,install_year INTEGER,condition TEXT,notes TEXT);
CREATE TABLE IF NOT EXISTS pipes (id TEXT PRIMARY KEY,name TEXT,status TEXT DEFAULT 'normal',diameter_mm REAL,length_m REAL,coordinates TEXT,folder TEXT,from_node_id TEXT,to_node_id TEXT,meta TEXT);
CREATE TABLE IF NOT EXISTS houses (id TEXT PRIMARY KEY,street TEXT,house TEXT,block TEXT,tk TEXT,node_id TEXT,area REAL,owner TEXT,active INTEGER,note TEXT,year INTEGER,sq REAL,flats INTEGER,floors INTEGER,load REAL,source TEXT,raw TEXT);
CREATE TABLE IF NOT EXISTS bursts (id TEXT PRIMARY KEY,status TEXT,source TEXT,tk TEXT,node_id TEXT,brigade TEXT,date_detected TEXT,date_shutdown TEXT,address TEXT,defect_char TEXT,note TEXT,social_objects TEXT,plan_date TEXT,deadline TEXT,actual_fix_date TEXT,detected_by TEXT,master TEXT,diameter TEXT,is_magistral INTEGER,is_opres INTEGER,is_water_on INTEGER,is_invest INTEGER,is_kap INTEGER,is_plan_kap INTEGER,is_not_ours INTEGER,photos TEXT,raw TEXT);
CREATE TABLE IF NOT EXISTS defects (id TEXT PRIMARY KEY,source TEXT,date_observed TEXT,tk TEXT,node_id TEXT,address TEXT,defect_type TEXT,network_type TEXT,note TEXT,detected_by TEXT,priority INTEGER,plan_date TEXT,resolved INTEGER,resolve_date TEXT,master TEXT,photos TEXT,raw TEXT);
CREATE TABLE IF NOT EXISTS unmatched_tk (id INTEGER PRIMARY KEY AUTOINCREMENT,entity_type TEXT,entity_id TEXT,tk_raw TEXT,normalized TEXT,candidates TEXT,resolved_node_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(entity_type,entity_id));
CREATE TABLE IF NOT EXISTS thresholds (key TEXT PRIMARY KEY,min REAL,max REAL,label TEXT);
CREATE TABLE IF NOT EXISTS node_types (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,color TEXT DEFAULT '#64748b');
CREATE TABLE IF NOT EXISTS passport_fields (id INTEGER PRIMARY KEY AUTOINCREMENT,entity_type TEXT,field_key TEXT,label TEXT,field_type TEXT DEFAULT 'text');
CREATE TABLE IF NOT EXISTS object_passports (id INTEGER PRIMARY KEY AUTOINCREMENT,entity_type TEXT,entity_id TEXT,entity_name TEXT,passport_url TEXT,section_number TEXT,diameter_mm TEXT,year_installed TEXT,material TEXT,status TEXT,notes TEXT,coordinates TEXT,source TEXT,raw TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(entity_type,entity_id));
CREATE TABLE IF NOT EXISTS topology_edits (id INTEGER PRIMARY KEY AUTOINCREMENT,node_id TEXT,lat REAL,lon REAL,note TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS utility_crossings (id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT,lat REAL,lon REAL,note TEXT);
CREATE TABLE IF NOT EXISTS inspections (id TEXT PRIMARY KEY,node_id TEXT,task_id TEXT,worker TEXT,observed_at TEXT,result TEXT,note TEXT,photos TEXT,lat REAL,lon REAL,synced_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS inspection_tasks (id TEXT PRIMARY KEY,node_id TEXT,title TEXT,planned_at TEXT,priority INTEGER,status TEXT DEFAULT 'planned',assignee TEXT,note TEXT);
CREATE TABLE IF NOT EXISTS scenarios (id TEXT PRIMARY KEY,title TEXT,pipe_id TEXT,node_id TEXT,created_by TEXT,created_at TEXT,zone_json TEXT,note TEXT);
CREATE TABLE IF NOT EXISTS social_objects (id TEXT PRIMARY KEY,name TEXT,type TEXT,status TEXT DEFAULT 'normal',lat REAL,lon REAL,address TEXT,notes TEXT,source_id TEXT,meta TEXT,district TEXT);
CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY,label TEXT);

-- ---- Extended schema (phase 2) ----
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,username TEXT UNIQUE,password_hash TEXT,name TEXT,role_id TEXT,active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS permissions (role_id TEXT PRIMARY KEY,actions TEXT DEFAULT '[]');
CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY,user_id TEXT,user_name TEXT,action TEXT,entity_type TEXT,entity_id TEXT,detail TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS repair_tasks (id TEXT PRIMARY KEY,title TEXT,description TEXT,node_id TEXT,pipe_id TEXT,reason TEXT,priority INTEGER DEFAULT 5,status TEXT DEFAULT 'planned',assignee TEXT,brigade TEXT,planned_date TEXT,deadline TEXT,actual_fix_date TEXT,affected_houses INTEGER,affected_social INTEGER,created_at TEXT,created_by TEXT,scenario_id TEXT);
CREATE TABLE IF NOT EXISTS heat_meters (id TEXT PRIMARY KEY,house_id TEXT,node_id TEXT,type TEXT,model TEXT,status TEXT DEFAULT 'active',installed_at TEXT,source TEXT DEFAULT 'mock');
CREATE TABLE IF NOT EXISTS meter_readings (id TEXT PRIMARY KEY,meter_id TEXT,recorded_at TEXT,temperature_supply REAL,temperature_return REAL,pressure_supply REAL,pressure_return REAL,flow_m3h REAL,heat_gcal REAL,source TEXT DEFAULT 'mock');
CREATE TABLE IF NOT EXISTS vehicle_positions (id TEXT PRIMARY KEY,vehicle_id TEXT,name TEXT,lat REAL,lon REAL,status TEXT,recorded_at TEXT,source TEXT DEFAULT 'mock');
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY,type TEXT,severity TEXT DEFAULT 'info',title TEXT,message TEXT,entity_type TEXT,entity_id TEXT,created_at TEXT,read_at TEXT);
CREATE TABLE IF NOT EXISTS object_status_history (id TEXT PRIMARY KEY,entity_type TEXT,entity_id TEXT,old_status TEXT,new_status TEXT,changed_at TEXT,changed_by TEXT,reason TEXT);
CREATE TABLE IF NOT EXISTS defect_types (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS severity_levels (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,value INTEGER,color TEXT);
CREATE TABLE IF NOT EXISTS repair_priorities (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,value INTEGER);
`);
// Legacy tables created dynamically by import scripts
for(const t of ['outages','complaints'])try{db.exec(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY,house_id TEXT,tk TEXT,node_id TEXT,raw TEXT)`) }catch{};
// Safe ALTER migrations
for(const q of [
  "ALTER TABLE nodes ADD COLUMN passport TEXT DEFAULT '{}'",
  "ALTER TABLE pipes ADD COLUMN supply_diameter_mm REAL",
  "ALTER TABLE pipes ADD COLUMN return_diameter_mm REAL",
  "ALTER TABLE pipes ADD COLUMN installation_type TEXT",
  "ALTER TABLE pipes ADD COLUMN material TEXT",
  "ALTER TABLE houses ADD COLUMN itp_id TEXT",
  "ALTER TABLE nodes ADD COLUMN zone TEXT"
])try{db.exec(q)}catch{};

// ---- Indexes for performance ----
try{db.exec(`CREATE INDEX IF NOT EXISTS idx_pipes_from ON pipes(from_node_id); CREATE INDEX IF NOT EXISTS idx_pipes_to ON pipes(to_node_id); CREATE INDEX IF NOT EXISTS idx_houses_node ON houses(node_id); CREATE INDEX IF NOT EXISTS idx_houses_tk ON houses(tk); CREATE INDEX IF NOT EXISTS idx_bursts_node ON bursts(node_id); CREATE INDEX IF NOT EXISTS idx_defects_node ON defects(node_id); CREATE INDEX IF NOT EXISTS idx_inspections_node ON inspections(node_id); CREATE INDEX IF NOT EXISTS idx_repair_node ON repair_tasks(node_id); CREATE INDEX IF NOT EXISTS idx_repair_pipe ON repair_tasks(pipe_id); CREATE INDEX IF NOT EXISTS idx_readings_meter ON meter_readings(meter_id); CREATE INDEX IF NOT EXISTS idx_readings_time ON meter_readings(recorded_at); CREATE INDEX IF NOT EXISTS idx_vehicle_time ON vehicle_positions(recorded_at); CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read_at); CREATE INDEX IF NOT EXISTS idx_history_entity ON object_status_history(entity_type,entity_id);`)}catch{};

// ---- Seed reference data ----
for(const r of [['dispatcher','Диспетчер'],['field','Выездная бригада'],['admin','Администратор']])db.prepare('INSERT OR IGNORE INTO roles VALUES(?,?)').run(...r);
for(const r of [['temperature',55,95,'Температура подачи, °C'],['pressure',3,12,'Давление, бар'],['load',0,20,'Нагрузка, Гкал/ч']])db.prepare('INSERT OR IGNORE INTO thresholds VALUES(?,?,?,?)').run(...r);
for(const r of [['Камера','#2563eb'],['Источник','#7c3aed'],['Узел','#0f766e'],['Дренаж','#0ea5e9'],['Воздушник','#f59e0b'],['Задвижка','#dc2626']])db.prepare('INSERT OR IGNORE INTO node_types(name,color) VALUES(?,?)').run(...r);
for(const r of [['Течь','1'],['Коррозия','2'],['Нарушение изоляции','3'],['Затопление камеры','4'],['Повреждение задвижки','5']])db.prepare('INSERT OR IGNORE INTO defect_types(name) VALUES(?)').run(r[0]);
for(const r of [['Низкая',3,'#22c55e'],['Средняя',5,'#f59e0b'],['Высокая',8,'#ef4444'],['Критическая',10,'#7f1d1d']])db.prepare('INSERT OR IGNORE INTO severity_levels(name,value,color) VALUES(?,?,?)').run(...r);
for(const r of [['Низкий',1],['Средний',5],['Высокий',8],['Аварийный',10]])db.prepare('INSERT OR IGNORE INTO repair_priorities(name,value) VALUES(?,?)').run(...r);
for(const r of [['admin','["*"]'],['dispatcher','["map.view","search","scenarios.run","scenarios.save","tasks.manage","repairs.manage","reports.view","analytics.view","notifications.view","editor.edit"]'],['field','["map.view","search","field.work","field.defects","field.topology","offline.sync"]']])db.prepare('INSERT OR IGNORE INTO permissions VALUES(?,?)').run(...r);
for(const row of [
  ['heat_chamber','object_type','Тип объекта','text'],
  ['heat_chamber','object_name','Наименование','text'],
  ['heat_chamber','object_code','Код/номер','text'],
  ['heat_chamber','passport_google_drive_url','Ссылка на паспорт','text'],
  ['heat_chamber','coordinates','Координаты','coordinates'],
  ['heat_chamber','section_number','Секция/номер участка','text'],
  ['heat_chamber','diameter_mm','Диаметр, мм','number'],
  ['heat_chamber','year_installed','Год установки','number'],
  ['heat_chamber','status','Статус','select'],
  ['heat_chamber','material','Материал','text'],
  ['heat_chamber','notes','Примечания','text'],
  ['heat_chamber','source','Источник данных','text'],
  ['pipe','object_type','Тип объекта','text'],
  ['pipe','object_name','Наименование','text'],
  ['pipe','diameter_mm','Диаметр, мм','number'],
  ['pipe','length_m','Длина, м','number'],
  ['pipe','material','Материал','text'],
  ['pipe','year_installed','Год установки','number'],
  ['pipe','status','Статус','select'],
  ['pipe','source','Источник данных','text'],
  ['node','object_type','Тип объекта','text'],
  ['node','object_name','Наименование','text'],
  ['node','coordinates','Координаты','coordinates'],
  ['node','status','Статус','select'],
  ['node','source','Источник данных','text'],
  ['heat_source','object_type','Тип объекта','text'],
  ['heat_source','object_name','Наименование','text'],
  ['heat_source','coordinates','Координаты','coordinates'],
  ['heat_source','status','Статус','select'],
  ['heat_source','source','Источник данных','text'],
  ['drain','object_type','Тип объекта','text'],
  ['drain','object_name','Наименование','text'],
  ['drain','coordinates','Координаты','coordinates'],
  ['drain','status','Статус','select'],
  ['air_vent','object_type','Тип объекта','text'],
  ['air_vent','object_name','Наименование','text'],
  ['air_vent','coordinates','Координаты','coordinates'],
  ['air_vent','status','Статус','select']
])db.prepare('INSERT OR IGNORE INTO passport_fields(entity_type,field_key,label,field_type) VALUES(?,?,?,?)').run(...row);

function normalizePassportName(name=''){ return String(name||'').trim(); }
function normalizePassportValue(value){ return (value === undefined || value === null || value === '') ? null : String(value).trim(); }
function parseSectionFromName(name=''){ const match = String(name).match(/(?:TK|ТК|TM|ТМ|OT|от|No|№)?\s*(\d{2}-\d{2}(?:-\d+)*)/i); return match ? match[1] : null; }
function inferObjectType(name, isPipe=false){ const n = String(name||'').toLowerCase(); if (isPipe || /\b(?:tm|тм|от)\b/.test(n)) return 'pipe'; if (/\b(?:tk|тк)\b/.test(n)) return 'heat_chamber'; if (/\b(?:бмк|рк|тэц|источник)\b/.test(n)) return 'heat_source'; if (/\b(?:дрен|drain)\b/.test(n)) return 'drain'; if (/\b(?:вент|возд|vent|air)\b/.test(n)) return 'air_vent'; if (/\b(?:узел|узл)\b/.test(n)) return 'node'; return 'heat_chamber'; }
function passportUrlFromMeta(raw){ if (!raw || typeof raw !== 'object') return null; const desc = raw.description || raw.Description || ''; const text = normalizePassportValue(desc) || ''; const match = text.match(/https?:\/\/[^\s<>"']+/i) || text.match(/https:\/\/drive\.google\.com\/file\/d\/[^\s<>"']+/i); return match ? match[0] : null; }
function safeJsonParse(value){ try { return value ? JSON.parse(value) : {}; } catch (e) { return {}; } }
function seedObjectPassports(){
  db.prepare('DELETE FROM object_passports').run();
  const entries = [];
  for (const node of db.prepare('SELECT * FROM nodes').all()) {
    const raw = safeJsonParse(node.meta);
    const name = normalizePassportName(node.name);
    const type = inferObjectType(name, false);
    if (!name) continue;
    if (type === 'heat_chamber' || type === 'heat_source' || type === 'drain' || type === 'air_vent' || type === 'node') {
      entries.push({
        entity_type: type,
        entity_id: node.id,
        entity_name: name,
        passport_url: passportUrlFromMeta(raw),
        section_number: parseSectionFromName(name),
        diameter_mm: null,
        year_installed: null,
        material: null,
        status: normalizePassportValue(node.status),
        notes: normalizePassportValue(node.notes),
        coordinates: node.lat && node.lon ? JSON.stringify({ lat: node.lat, lon: node.lon }) : null,
        source: normalizePassportValue(node.folder) || 'KML import',
        raw: JSON.stringify(raw)
      });
    }
  }
  for (const pipe of db.prepare('SELECT * FROM pipes').all()) {
    const raw = safeJsonParse(pipe.meta);
    const name = normalizePassportName(pipe.name);
    const type = inferObjectType(name, true);
    if (!name) continue;
    entries.push({
      entity_type: type,
      entity_id: pipe.id,
      entity_name: name,
      passport_url: passportUrlFromMeta(raw),
      section_number: parseSectionFromName(name),
      diameter_mm: pipe.diameter_mm != null ? String(pipe.diameter_mm) : null,
      year_installed: null,
      material: normalizePassportValue(pipe.material),
      status: normalizePassportValue(pipe.status),
      notes: normalizePassportValue(pipe.meta),
      coordinates: pipe.coordinates ? pipe.coordinates : null,
      source: normalizePassportValue(pipe.folder) || 'KML import',
      raw: JSON.stringify(raw)
    });
  }
  const insert = db.prepare('INSERT INTO object_passports(entity_type,entity_id,entity_name,passport_url,section_number,diameter_mm,year_installed,material,status,notes,coordinates,source,raw) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const row of entries) {
    insert.run(row.entity_type,row.entity_id,row.entity_name,row.passport_url,row.section_number,row.diameter_mm,row.year_installed,row.material,row.status,row.notes,row.coordinates,row.source,row.raw);
  }
}

db.seedObjectPassports = seedObjectPassports;
seedObjectPassports();
module.exports=db;