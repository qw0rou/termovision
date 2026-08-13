require('dotenv').config();const express=require('express'),cors=require('cors'),multer=require('multer'),path=require('path'),db=require('./db'),telemetry=require('./lib/telemetrySim'),{zone}=require('./lib/network');const {matchTk,logUnmatched}=require('./lib/matchTk');
const app=express(),upload=multer({dest:path.join(__dirname,'uploads')});app.use(cors());app.use(express.json());app.use(express.static(path.join(__dirname,'../web')));app.use('/uploads',express.static(path.join(__dirname,'uploads')));const id=p=>p+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),fc=(rows,g)=>({type:'FeatureCollection',features:rows.map(x=>({type:'Feature',properties:x,geometry:g(x)}))});
app.get('/api/session/roles',(q,s)=>s.json(db.prepare('SELECT * FROM roles').all()));
app.get('/api/map',(q,s)=>{
	const base = db.prepare('SELECT * FROM nodes').all();
	const nodes = base.map(n => ({
		...n,
		status: db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM bursts WHERE node_id=? AND status='active') THEN 'emergency' WHEN EXISTS(SELECT 1 FROM bursts WHERE node_id=? AND status='capital_repair') THEN 'repair' WHEN EXISTS(SELECT 1 FROM defects WHERE node_id=? AND resolved=0) THEN 'monitored' ELSE (SELECT status FROM nodes WHERE id=?) END state").get(n.id, n.id, n.id, n.id).state
	}));
	const pipes = db.prepare('SELECT * FROM pipes').all().map(p => ({
		...p,
		status: nodes.find(n => n.id === p.from_node_id)?.status === 'emergency' || nodes.find(n => n.id === p.to_node_id)?.status === 'emergency' ? 'emergency' : nodes.find(n => n.id === p.from_node_id)?.status === 'repair' || nodes.find(n => n.id === p.to_node_id)?.status === 'repair' ? 'repair' : p.status
	}));

	// Build houses positions: prefer node coordinates; if missing, try first candidate from matchTk; add small deterministic jitter to separate multiple houses at same point
	const allHouses = db.prepare('SELECT * FROM houses').all();
	function jitter(id){
		let h=0; for(let i=0;i<id.length;i++)h=(h*31+id.charCodeAt(i))>>>0; const ang=(h%360)*(Math.PI/180); const r=(5e-5)*((h%10)/10+0.2); return [Math.cos(ang)*r, Math.sin(ang)*r];
	}
	const housesFeatures = allHouses.map(h => {
		let lon=0, lat=0;
		const node = h.node_id && nodes.find(n=>n.id===h.node_id);
		if(node && node.lon && node.lat){ lon = node.lon; lat = node.lat; }
		else if(h.tk){
			try{ const m = require('./lib/matchTk').matchTk(h.tk); if(m && m.candidates && m.candidates.length){ const c = nodes.find(n=>n.id===m.candidates[0].id); if(c && c.lon && c.lat){ lon=c.lon; lat=c.lat; } }
			}catch(e){}
		}
		if(lon===0 && lat===0){ lon = 0; lat = 0; }
		const off = jitter(String(h.id||h.tk||Math.random())); lon += off[0]; lat += off[1];
		return {type:'Feature',properties:h,geometry:{type:'Point',coordinates:[lon,lat]}};
	});

	s.json({
		nodes: fc(nodes, x => ({type: 'Point', coordinates: [x.lon, x.lat]})),
		pipes: fc(pipes, x => ({type: 'LineString', coordinates: JSON.parse(x.coordinates)})),
		houses: { type: 'FeatureCollection', features: housesFeatures }
	});
});
app.get('/api/nodes',(q,s)=>s.json(fc(db.prepare('SELECT * FROM nodes').all(),x=>({type:'Point',coordinates:[x.lon,x.lat]}))));app.get('/api/pipes',(q,s)=>s.json(fc(db.prepare('SELECT * FROM pipes').all(),x=>({type:'LineString',coordinates:JSON.parse(x.coordinates)}))));
app.get('/api/passports/node/:id',(q,s)=>{const n=db.prepare('SELECT * FROM nodes WHERE id=?').get(q.params.id);if(!n)return s.sendStatus(404);s.json({node:n,pipes:db.prepare('SELECT * FROM pipes WHERE from_node_id=? OR to_node_id=?').all(n.id,n.id),houses:db.prepare('SELECT * FROM houses WHERE node_id=?').all(n.id),bursts:db.prepare('SELECT * FROM bursts WHERE node_id=? ORDER BY date_detected DESC').all(n.id),defects:db.prepare('SELECT * FROM defects WHERE node_id=? ORDER BY date_observed DESC').all(n.id),inspections:db.prepare('SELECT * FROM inspections WHERE node_id=? ORDER BY observed_at DESC').all(n.id)})});
app.get('/api/passports/house/:id',(q,s)=>{const h=db.prepare('SELECT * FROM houses WHERE id=?').get(q.params.id);if(!h)return s.sendStatus(404);s.json({house:h,node:h.node_id&&db.prepare('SELECT * FROM nodes WHERE id=?').get(h.node_id),outages:[],history:h.node_id?db.prepare('SELECT * FROM bursts WHERE node_id=? ORDER BY date_detected DESC').all(h.node_id):[]})});
app.get('/api/passports/pipe/:id',(q,s)=>{const p=db.prepare('SELECT * FROM pipes WHERE id=?').get(q.params.id);if(!p)return s.sendStatus(404);const from=db.prepare('SELECT * FROM nodes WHERE id=?').get(p.from_node_id),to=db.prepare('SELECT * FROM nodes WHERE id=?').get(p.to_node_id);const nodeIds=[p.from_node_id,p.to_node_id].filter(Boolean);let m=nodeIds.map(()=>'?').join(',');if(!m)m='NULL';const bursts=nodeIds.length?db.prepare(`SELECT * FROM bursts WHERE node_id IN (${m}) ORDER BY date_detected DESC`).all(...nodeIds):[];const defects=nodeIds.length?db.prepare(`SELECT * FROM defects WHERE node_id IN (${m}) ORDER BY date_observed DESC`).all(...nodeIds):[];s.json({pipe:p,fromNode:from,toNode:to,bursts,defects})});
app.post('/api/outage-zone',(q,s)=>{try{s.json(zone(q.body))}catch(e){s.status(400).json({error:e.message})}});app.post('/api/scenarios',(q,s)=>{try{const z=zone(q.body),x={id:id('scenario'),title:q.body.title||'Сценарий ремонта',pipe_id:q.body.pipeId||null,node_id:q.body.nodeId||null,created_by:q.body.createdBy||'Диспетчер',created_at:new Date().toISOString(),zone_json:JSON.stringify(z),note:q.body.note||''};db.prepare('INSERT INTO scenarios VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(x));s.json({...x,zone:z})}catch(e){s.status(400).json({error:e.message})}});app.get('/api/scenarios',(q,s)=>s.json(db.prepare('SELECT * FROM scenarios ORDER BY created_at DESC').all()));
app.get('/api/analytics',(q,s)=>{const risk=db.prepare(`SELECT n.id,n.name,n.type,COUNT(DISTINCT b.id) bursts,COUNT(DISTINCT d.id) defects,ROUND(COUNT(DISTINCT b.id)*4+COUNT(DISTINCT d.id)*2+COALESCE(AVG(CASE WHEN p.diameter_mm<150 THEN 2 ELSE 0 END),0),1) score FROM nodes n LEFT JOIN bursts b ON b.node_id=n.id LEFT JOIN defects d ON d.node_id=n.id LEFT JOIN pipes p ON p.from_node_id=n.id OR p.to_node_id=n.id GROUP BY n.id HAVING score>0 ORDER BY score DESC LIMIT 20`).all();s.json({counts:{nodes:db.prepare('SELECT count(*) n FROM nodes').get().n,pipes:db.prepare('SELECT count(*) n FROM pipes').get().n,houses:db.prepare('SELECT count(*) n FROM houses').get().n,activeBursts:db.prepare("SELECT count(*) n FROM bursts WHERE status='active'").get().n,openDefects:db.prepare('SELECT count(*) n FROM defects WHERE resolved=0').get().n},risk})});
app.get('/api/telemetry',(q,s)=>s.json({simulated:true,updatedAt:new Date().toISOString(),items:telemetry.all()}));app.get('/api/trail/:nodeId',(q,s)=>s.json({bursts:db.prepare('SELECT * FROM bursts WHERE node_id=? ORDER BY date_detected DESC').all(q.params.nodeId),defects:db.prepare('SELECT * FROM defects WHERE node_id=? ORDER BY date_observed DESC').all(q.params.nodeId),inspections:db.prepare('SELECT * FROM inspections WHERE node_id=? ORDER BY observed_at DESC').all(q.params.nodeId)}));
app.get('/api/search',(req,res)=>{
	const q=(req.query.q||'').trim(); if(!q) return res.json({nodes:[],houses:[],pipes:[]}); const like='%'+q.toLowerCase()+'%'; const type=req.query.type||'all'; const out={nodes:[],houses:[],pipes:[]};
	const allNodes = db.prepare('SELECT * FROM nodes').all();
	function jitter(id){let h=0; for(let i=0;i<id.length;i++)h=(h*31+id.charCodeAt(i))>>>0; const ang=(h%360)*(Math.PI/180); const r=(5e-5)*((h%10)/10+0.2); return [Math.cos(ang)*r, Math.sin(ang)*r];}
	if(type==='all'||type==='node'){
		out.nodes = db.prepare("SELECT * FROM nodes WHERE lower(id) LIKE ? OR lower(name) LIKE ? LIMIT 200").all(like,like);
	}
	if(type==='all'||type==='house'){
		out.houses = db.prepare("SELECT * FROM houses WHERE lower(street||' '||house||' '||tk||' '||note) LIKE ? LIMIT 500").all(like);
		// enrich houses with node, pipes and computed coords
		out.houses = out.houses.map(h=>{
			const node = h.node_id?db.prepare('SELECT * FROM nodes WHERE id=?').get(h.node_id):null;
			const pipes = node?db.prepare('SELECT * FROM pipes WHERE from_node_id=? OR to_node_id=?').all(node.id,node.id):[];
			let lon=0,lat=0; if(node && node.lon && node.lat){ lon=node.lon; lat=node.lat; } else if(h.tk){ try{ const m=require('./lib/matchTk').matchTk(h.tk); if(m && m.candidates && m.candidates.length){ const c = allNodes.find(n=>n.id===m.candidates[0].id); if(c && c.lon && c.lat){ lon=c.lon; lat=c.lat; } } }catch(e){} }
			const off = jitter(String(h.id||h.tk||Math.random())); lon+=off[0]; lat+=off[1];
			return {...h,node,linkedPipes:pipes,geometry:{type:'Point',coordinates:[lon,lat]}};
		});
	}
	if(type==='all'||type==='pipe'){
		out.pipes = db.prepare("SELECT * FROM pipes WHERE lower(id) LIKE ? OR lower(name) LIKE ? LIMIT 200").all(like,like);
	}
	res.json(out);
});
app.get('/api/field/tasks',(q,s)=>s.json(db.prepare("SELECT t.*,n.name node_name FROM inspection_tasks t LEFT JOIN nodes n ON n.id=t.node_id WHERE t.status!='done' ORDER BY t.priority DESC, t.planned_at").all()));app.post('/api/field/tasks/:id/complete',upload.array('photos',4),(q,s)=>{const t=db.prepare('SELECT * FROM inspection_tasks WHERE id=?').get(q.params.id);if(!t)return s.sendStatus(404);db.prepare('INSERT INTO inspections VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id('inspection'),t.node_id,t.id,q.body.worker||'Бригада',new Date().toISOString(),q.body.result||'Выполнено',q.body.note||'',JSON.stringify((q.files||[]).map(f=>'/uploads/'+f.filename)),q.body.lat||null,q.body.lon||null,new Date().toISOString());db.prepare("UPDATE inspection_tasks SET status='done' WHERE id=?").run(t.id);s.json({ok:true})});
app.post('/api/field/defects',upload.array('photos',4),(q,s)=>{const x=q.body,m=matchTk(x.tk),i=id('defect');db.prepare('INSERT INTO defects VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(i,x.source||'',x.dateObserved||new Date().toISOString(),x.tk||'',m.nodeId,x.address||'',x.defectType||'',x.networkType||'',x.note||'',x.detectedBy||'',+x.priority||5,x.planDate||'',0,'','',JSON.stringify((q.files||[]).map(f=>'/uploads/'+f.filename)),JSON.stringify(x));logUnmatched('defect',i,x.tk,m);if(m.nodeId)db.prepare("UPDATE nodes SET status='monitored' WHERE id=? AND status='normal'").run(m.nodeId);s.json({id:i,nodeId:m.nodeId})});app.post('/api/field/topology-edit',(q,s)=>{db.prepare('INSERT INTO topology_edits(node_id,lat,lon,note) VALUES(?,?,?,?)').run(q.body.nodeId,q.body.lat,q.body.lon,q.body.note||'');s.json({ok:true})});
app.get('/api/utilities',(q,s)=>s.json(db.prepare('SELECT * FROM utility_crossings').all()));app.post('/api/utilities',(q,s)=>{const x=q.body;db.prepare('INSERT INTO utility_crossings(type,lat,lon,note) VALUES(?,?,?,?)').run(x.type,x.lat,x.lon,x.note||'');s.json({ok:true})});
app.get('/api/admin/unmatched',(q,s)=>s.json(db.prepare('SELECT * FROM unmatched_tk WHERE resolved_node_id IS NULL LIMIT 500').all()));app.post('/api/admin/unmatched/:i',(q,s)=>{const x=db.prepare('SELECT * FROM unmatched_tk WHERE id=?').get(q.params.i),tab={house:'houses',burst:'bursts',defect:'defects',complaint:'complaints'}[x?.entity_type];if(!tab||!q.body.nodeId)return s.status(400).json({error:'Некорректные данные'});db.prepare(`UPDATE ${tab} SET node_id=? WHERE id=?`).run(q.body.nodeId,x.entity_id);db.prepare('UPDATE unmatched_tk SET resolved_node_id=? WHERE id=?').run(q.body.nodeId,x.id);s.json({ok:true})});
app.get('/api/admin/config',(q,s)=>s.json({thresholds:db.prepare('SELECT * FROM thresholds').all(),types:db.prepare('SELECT * FROM node_types').all(),fields:db.prepare('SELECT * FROM passport_fields').all()}));app.put('/api/admin/thresholds/:k',(q,s)=>{db.prepare('UPDATE thresholds SET min=?,max=? WHERE key=?').run(+q.body.min,+q.body.max,q.params.k);s.json({ok:true})});app.post('/api/admin/node-types',(q,s)=>{db.prepare('INSERT INTO node_types(name,color) VALUES(?,?)').run(q.body.name,q.body.color||'#64748b');s.json({ok:true})});app.post('/api/admin/passport-fields',(q,s)=>{db.prepare('INSERT INTO passport_fields(entity_type,field_key,label,field_type) VALUES(?,?,?,?)').run(q.body.entityType,q.body.key,q.body.label,q.body.type||'text');s.json({ok:true})});
const seed=()=>{if(!db.prepare('SELECT count(*) n FROM inspection_tasks').get().n){const ns=db.prepare('SELECT id,name FROM nodes LIMIT 5').all();for(const[n,x]of ns.entries())db.prepare('INSERT INTO inspection_tasks(id,node_id,title,planned_at,priority,status,assignee,note) VALUES(?,?,?,?,?,?,?,?)').run('task-'+(n+1),x.id,'Плановый осмотр: '+x.name,new Date(Date.now()+n*864e5).toISOString(),10-n,'planned','Бригада №1','Фото и GPS обязательны')}if(!db.prepare('SELECT count(*) n FROM utility_crossings').get().n){for(const x of [[53.214,63.624,'Кабельная линия'],[53.218,63.632,'Водопровод'],[53.221,63.627,'Канализация']])db.prepare('INSERT INTO utility_crossings(type,lat,lon,note) VALUES(?,?,?,?)').run(x[2],x[0],x[1],'Демо-слой для безопасных земляных работ')}};seed();app.listen(process.env.PORT||4000,()=>console.log('KTEK platform on http://localhost:'+(process.env.PORT||4000)));
