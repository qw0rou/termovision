const fs = require('fs'), path = require('path'); const { XMLParser } = require('fast-xml-parser'); const db = require('../db');
const kml = fs.readFileSync(path.join(__dirname, '../data/doc.kml'), 'utf8'); const parsed = new XMLParser({ ignoreAttributes:false, trimValues:true }).parse(kml);
const features=[]; function walk(o, folder='') { if (!o || typeof o !== 'object') return; if (o.Placemark) for (const p of (Array.isArray(o.Placemark)?o.Placemark:[o.Placemark])) features.push({p,folder}); if(o.Folder) for(const f of (Array.isArray(o.Folder)?o.Folder:[o.Folder])) walk(f, f.name || folder); if(o.Document) for(const d of (Array.isArray(o.Document)?o.Document:[o.Document])) walk(d, folder); }
walk(parsed.kml); db.exec('DELETE FROM pipes; DELETE FROM nodes;'); const insNode=db.prepare('INSERT INTO nodes(id,name,type,lon,lat,folder,meta) VALUES(?,?,?,?,?,?,?)'), insPipe=db.prepare('INSERT INTO pipes(id,name,diameter_mm,length_m,coordinates,folder,meta) VALUES(?,?,?,?,?,?,?)');
const importFeatures = db.transaction(() => {
  features.forEach((x, i) => {
    const p = x.p, name = String(p.name || `object-${i + 1}`);
    if (p.Point?.coordinates) {
      const [lon, lat] = String(p.Point.coordinates).trim().split(',').map(Number);
      const type=/БМК|ТЭЦ|РК/u.test(name)?'Источник':/дрен/u.test(name)?'Дренаж':/возд|вент/u.test(name)?'Воздушник':/узел/u.test(name)?'Узел':'Камера';
      insNode.run(`N${i + 1}`, name, type, lon, lat, x.folder, JSON.stringify(p));
    } else if (p.LineString?.coordinates) {
      const coords = String(p.LineString.coordinates).trim().split(/\s+/).map(s => { const [lon, lat] = s.split(',').map(Number); return [lon, lat]; });
      const diameter = (name.match(/[DД]\s*(\d+)/iu) || [])[1] || null;
      const length = ((name.match(/(\d+(?:[.,]\d+)?)\s*[mм]/iu) || [])[1] || '').replace(',', '.') || null;
      insPipe.run(`P${i + 1}`, name, diameter, length, JSON.stringify(coords), x.folder, JSON.stringify(p));
    }
  });
});
importFeatures();
db.prepare('UPDATE pipes SET supply_diameter_mm=diameter_mm, return_diameter_mm=diameter_mm, installation_type=CASE WHEN lower(folder) LIKE ? THEN ? ELSE ? END, material=COALESCE(material,?)').run('%подзем%', 'подземная', 'наружная', 'не указан в исходном KML');
const nodes=db.prepare('SELECT id,lon,lat FROM nodes').all(); const near=(pt)=>nodes.reduce((best,n)=>{const d=(n.lon-pt[0])**2+(n.lat-pt[1])**2;return !best||d<best.d?{id:n.id,d}:best},null)?.id; for(const pipe of db.prepare('SELECT id,coordinates FROM pipes').all()){const c=JSON.parse(pipe.coordinates); db.prepare('UPDATE pipes SET from_node_id=?,to_node_id=? WHERE id=?').run(near(c[0]),near(c[c.length-1]),pipe.id); } console.log(JSON.stringify({nodes:db.prepare('SELECT count(*) n FROM nodes').get().n,pipes:db.prepare('SELECT count(*) n FROM pipes').get().n}));
