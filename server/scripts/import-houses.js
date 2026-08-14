const fs = require('fs');
const path = require('path');
const db = require('../db');
const { matchTk, logUnmatched } = require('../lib/matchTk');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/teploset_backup.json'), 'utf8'));

db.exec("DELETE FROM houses; DELETE FROM outages; DELETE FROM complaints; DELETE FROM unmatched_tk WHERE entity_type IN ('house', 'complaint')");

const insertHouse = db.prepare('INSERT INTO houses VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
const insertOutage = db.prepare('INSERT INTO outages(id, house_id, raw) VALUES(?,?,?)');
const insertComplaint = db.prepare('INSERT INTO complaints(id, tk, node_id, raw) VALUES(?,?,?,?)');

db.transaction(() => {
  data.houses.forEach((house, i) => {
    const match = matchTk(house.tk);
    insertHouse.run(
      String(house.id || i + 1),
      house.street || '',
      house.house || '',
      house.block || '',
      house.tk || '',
      match.nodeId,
      house.area || null,
      house.owner || '',
      house.active ? 1 : 0,
      house.note || '',
      house.year || null,
      house.sq || null,
      house.flats || null,
      house.floors || null,
      house.load || null,
      house.source || '',
      JSON.stringify(house),
      null // itp_id
    );
    logUnmatched('house', house.id || i + 1, house.tk, match);
  });

  data.outages.forEach((outage, i) => {
    insertOutage.run(
      String(outage.id || i + 1),
      String(outage.houseId || outage.house_id || ''),
      JSON.stringify(outage)
    );
  });

  data.complaints.forEach((complaint, i) => {
    const match = matchTk(complaint.tk);
    insertComplaint.run(
      String(complaint.id || i + 1),
      complaint.tk || '',
      match.nodeId,
      JSON.stringify(complaint)
    );
    logUnmatched('complaint', complaint.id || i + 1, complaint.tk, match);
  });
})();

console.log(JSON.stringify({
  houses: data.houses.length,
  outages: data.outages.length,
  complaints: data.complaints.length
}));
