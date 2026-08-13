const db=require('./server/db');
console.log('houses total',db.prepare('SELECT count(*) n FROM houses').get().n);
console.log('houses with node',db.prepare("SELECT count(*) n FROM houses WHERE node_id IS NOT NULL AND node_id != ''").get().n);
console.log('distinct node_ids',db.prepare("SELECT count(DISTINCT node_id) n FROM houses WHERE node_id IS NOT NULL AND node_id != ''").get().n);
console.log('sample',db.prepare("SELECT id,node_id,street,house FROM houses WHERE node_id IS NOT NULL LIMIT 5").all());
