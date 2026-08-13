/**
 * Link houses to network nodes using TK (chamber) identifiers.
 *
 * The original import linked only houses whose TK matched exactly. This pass
 * re-tries all houses with a TK but no node, using the same normalizer as the
 * import (so results are consistent with the imported topology). It never
 * guesses: a house is linked only when the TK resolves to exactly one node.
 * Unmatched houses remain honestly unlinked and are listed in unmatched_tk.
 */
const db = require('../db');
const { matchTk, logUnmatched } = require('../lib/matchTk');

const houses = db.prepare("SELECT id, tk FROM houses WHERE node_id IS NULL AND tk IS NOT NULL AND tk != ''").all();
console.log('[link-houses] unlinked houses with TK:', houses.length);

let linked = 0, stillUnmatched = 0;
db.transaction(() => {
  for (const h of houses) {
    const m = matchTk(h.tk);
    if (m.nodeId) {
      db.prepare('UPDATE houses SET node_id=? WHERE id=?').run(m.nodeId, h.id);
      linked++;
    } else {
      logUnmatched('house', h.id, h.tk, m);
      stillUnmatched++;
    }
  }
})();

console.log(`[link-houses] linked: ${linked}, still unmatched: ${stillUnmatched}`);
console.log('[link-houses] houses linked total:', db.prepare('SELECT count(*) n FROM houses WHERE node_id IS NOT NULL').get().n);