const db = require('../db');
function normalizeTk(value, stripSuffix = false) {
  let v = String(value || '').toUpperCase().replace(/\s+/g, '').replace(/^ТК[-_.]?/u, '').replace(/[._]/g, '-').replace(/–/g, '-');
  v = v.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return stripSuffix ? v.replace(/[А-ЯA-Z]+$/u, '') : v;
}
function candidates(value) {
  const norm = normalizeTk(value), loose = normalizeTk(value, true);
  const nodes = db.prepare('SELECT id,name FROM nodes').all();
  return nodes.filter(n => normalizeTk(n.name) === norm || normalizeTk(n.id) === norm || normalizeTk(n.name, true) === loose || normalizeTk(n.id, true) === loose).slice(0, 8);
}
function matchTk(value) { const found = candidates(value); return { nodeId: found.length === 1 ? found[0].id : null, normalized: normalizeTk(value), candidates: found }; }
function logUnmatched(entityType, entityId, raw, result) { if (!result.nodeId) db.prepare('INSERT OR REPLACE INTO unmatched_tk(entity_type,entity_id,tk_raw,normalized,candidates) VALUES(?,?,?,?,?)').run(entityType, String(entityId), raw || '', result.normalized, JSON.stringify(result.candidates)); }
module.exports = { normalizeTk, matchTk, logUnmatched };
