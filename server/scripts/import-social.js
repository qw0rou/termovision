/**
 * Import real social objects from the operational data (houses with
 * owner='social' and a meaningful object type in note). Social objects are
 * placed at their linked node coordinates; unlinked ones are kept with
 * coordinates only if we can resolve them later. The system never fabricates
 * institutions.
 */
const db = require('../db');
const { matchTk } = require('../lib/matchTk');

const CATEGORY_RULES = [
  [/(школ|лицей|гимназ|колледж|универ|институт|академи|учил|техникум|учеб)/iu, 'school', 'Образование'],
  [/(детский сад|детсад|садик|ясли|сад)/iu, 'kindergarten', 'Детский сад'],
  [/(поликлин|больниц|амбулатор|роддом|стационар|санатор|стоматолог|клиник|скорая|медпункт|здравпункт|диспансер|лечеб)/iu, 'clinic', 'Медицина'],
  [/(общежитие|интернат)/iu, 'housing', 'Общежитие'],
  [/(акимат|администрац|админ|управление|отдел|учреждение|департамент|комитет|инспекц|налогов|казнач|прокуратур|суд)/iu, 'admin', 'Административное здание'],
  [/(вокзал|аэропорт|почт|связь|пожар|полиц|мчс|казарм)/iu, 'infrastructure', 'Инфраструктура'],
  [/(музей|театр|библиотек|дом культ|центр|спорт|стадион|бассейн|кинотеатр|филармон)/iu, 'culture', 'Культура и спорт'],
  [/(храм|церков|мечет)/iu, 'religion', 'Религия'],
  [/(гостиниц|кафе|ресторан|столов|магазин|торгов|рынок|банк)/iu, 'commerce', 'Коммерция'],
  [/(абк|кпп|проходн|гараж|цех|склад|котельн|тэц|бмк|насосн|подстанц)/iu, 'utility', 'Инженерный объект']
];

function categorize(note, owner) {
  const n = String(note || '').toLowerCase();
  for (const [re, cat, label] of CATEGORY_RULES) {
    if (re.test(n)) return { category: cat, label };
  }
  return owner === 'social' ? { category: 'social', label: 'Социальный объект' } : null;
}

function run() {
  const existing = db.prepare('SELECT count(*) n FROM social_objects').get().n;
  if (existing > 0) {
    console.log('[social] already imported, skipping. Delete rows to re-import.');
    return;
  }

  const houses = db.prepare(`
    SELECT id, street, house, block, tk, node_id, owner, note, load, source
    FROM houses WHERE owner='social' AND note IS NOT NULL AND note != ''
  `).all();

  const ins = db.prepare('INSERT INTO social_objects(id,name,type,status,lat,lon,address,notes,source_id,meta,district) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const nodeById = new Map(db.prepare('SELECT id, lat, lon, name, folder FROM nodes').all().map(n => [n.id, n]));

  let imported = 0, unlinked = 0;
  db.transaction(() => {
    for (const h of houses) {
      const c = categorize(h.note, h.owner);
      if (!c) continue;
      let nodeId = h.node_id;
      let node = nodeId ? nodeById.get(nodeId) : null;
      // Try to resolve by TK if node not linked yet
      if (!node && h.tk) {
        const m = matchTk(h.tk);
        if (m.nodeId) {
          node = nodeById.get(m.nodeId);
          nodeId = m.nodeId;
        }
      }
      const address = [h.street, h.house, h.block].filter(Boolean).join(' ') || '—';
      const name = ((h.note || '').replace(/^\[[^\]]*\]\s*/u, '') || address);
      const lat = node ? node.lat : null;
      const lon = node ? node.lon : null;
      const id = 'so-' + String(h.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 30);
      ins.run(id, name, c.label, 'normal', lat, lon, address, h.note || '', nodeId || null, JSON.stringify({ category: c.category, houseId: h.id, load: h.load || null, source: h.source || '' }), node ? (node.folder || 'Центр') : 'Центр');
      if (!nodeId) unlinked++; else imported++;
      // update house link
      if (nodeId && !h.node_id) db.prepare('UPDATE houses SET node_id=? WHERE id=?').run(nodeId, h.id);
    }
  })();

  console.log(`[social] imported ${imported}, unlinked (coordinates pending): ${unlinked}`);
}

run();