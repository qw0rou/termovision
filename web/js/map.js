let map, layers = {nodes: null, pipes: null}, selection = [];
let selectedTarget = null; // {type:'node'|'pipe', id, name}
let previewSelection = [];

const color = {normal: '#22c55e', monitored: '#f59e0b', emergency: '#ef4444', repair: '#8b5cf6', data_missing: '#94a3b8', high_risk: '#f97316'};
const globalFilterState = {type: 'all', status: 'all', district: 'all'};
window.layers = layers;
window.globalFilterState = globalFilterState;
function setFilterState(nextState){ Object.assign(globalFilterState, nextState); if(typeof applyMapFilters === 'function') applyMapFilters(); }
window.setFilterState = setFilterState;
function layerMatchesFilter(kind, props){
	const type = globalFilterState.type;
	const status = globalFilterState.status;
	const district = globalFilterState.district;
	if(type !== 'all'){
		if(kind === 'node'){
			const allowed = type === 'node' || (type === 'source' && (props.type === 'Источник' || props.type === 'source'));
			if(!allowed) return false;
		} else if(type !== kind) return false;
	}
	if(status !== 'all' && String(props.status || 'normal') !== status) return false;
	if(district !== 'all'){
		const value = String((props.district || props.folder || props.area || '') || '').toLowerCase();
		if(!value || value !== String(district).toLowerCase()) return false;
	}
	return true;
}
function applyMapFilters(){
	if(!map) return;
	const groups = [
		{layer: layers.pipes, kind: 'pipe'},
		{layer: layers.nodes, kind: 'node'},
		{layer: layers.social, kind: 'social'}
	];
	groups.forEach(({layer, kind}) => {
		if(!layer || !layer.eachLayer) return;
		layer.eachLayer(item => {
			const props = item.feature && item.feature.properties ? item.feature.properties : {};
			const visible = layerMatchesFilter(kind, props);
			if(item.setStyle){
				const base = item.options && item.options.style ? item.options.style : {};
				item.setStyle({opacity: visible ? 1 : 0.08, fillOpacity: visible ? (base.fillOpacity ?? 0.9) : 0.04, weight: visible ? (base.weight ?? 2) : 0});
			} else {
				item.setOpacity ? item.setOpacity(visible ? 1 : 0.08) : null;
			}
		});
	});
}

function initMap() {
	map = L.map('map').setView([53.214, 63.63], 12);
	L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution: '© OpenStreetMap'}).addTo(map);

	// Load nodes, pipes and houses in one request
	api.get('map').then(m => {
		const n = m.nodes, p = m.pipes, h = m.houses;

		layers.pipes = L.geoJSON(p, {
			style: f => ({color: color[f.properties.status] || '#64748b', weight: 3}),
			onEachFeature: (f, l) => {
				l.bindPopup(`<b>${f.properties.name}</b><br>${f.properties.diameter_mm || '—'} мм`);
				l.on('click', ()=>{ if(f.properties && f.properties.id){ selectedTarget={type:'pipe',id:f.properties.id,name:f.properties.name||f.properties.id}; showPipePassport(f.properties.id); } });
			}
		}).addTo(map);

			const typeColor = { 'Источник': '#7c3aed', 'Камера': '#2563eb', 'Узел': '#0f766e', 'Дренаж': '#0ea5e9', 'Воздушник': '#f59e0b' };
			layers.nodes = L.geoJSON(n, {
				pointToLayer: (f, ll) => {
					const t = f.properties.type || 'Камера';
					const clr = typeColor[t] || (color[f.properties.status] || '#22c55e');
					const r = t === 'Источник' ? 8 : (t === 'Узел' ? 6 : 4);
					return L.circleMarker(ll, {radius: r, color: clr, fillOpacity: .95});
				},
				onEachFeature: (f, l) => {
					l.on('click', () => { selectedTarget={type:'node',id:f.properties.id,name:f.properties.name||f.properties.id}; selectNode(f.properties.id, f.properties.name); });
					l.bindPopup(`<b>${f.properties.name}</b><br>Тип: ${f.properties.type || '—'}<br>Статус: ${f.properties.status||'—'}`);
				}
			}).addTo(map);

		window.layers = layers;
		layers.social = L.geoJSON(m.socialObjects || {type:'FeatureCollection', features: []}, {
			pointToLayer: (f, ll) => L.circleMarker(ll, {radius: 6, color: '#38bdf8', fillOpacity: .92, weight: 2}),
			onEachFeature: (f, l) => {
				l.bindPopup(`<b>${f.properties.name || 'Социальный объект'}</b><br>Тип: ${f.properties.type || '—'}<br>Адрес: ${f.properties.address || '—'}<br>Статус: ${f.properties.status || 'normal'}`);
			}
		}).addTo(map);

		applyMapFilters();

		// Fit bounds to nodes, pipes and houses
		try {
			const group = L.featureGroup([layers.nodes, layers.pipes]);
			const bounds = group.getBounds();
			if (bounds.isValid()) map.fitBounds(bounds, {padding: [20, 20]});
			else if (layers.nodes && layers.nodes.getBounds) map.fitBounds(layers.nodes.getBounds(), {padding: [20, 20]});
		} catch (e) {
			if (layers.nodes && layers.nodes.getBounds) map.fitBounds(layers.nodes.getBounds(), {padding: [20, 20]});
		}
	});

	// create scenario UI panel
	createScenarioPanel();
}

// telemetry polling: refresh node colors based on /api/telemetry
let telemetryIntervalId = null;
function startTelemetryPolling(intervalMs = 15000){
	if(telemetryIntervalId) clearInterval(telemetryIntervalId);
	const fetchAndApply = ()=>{
		api.get('telemetry').then(t=>{
			// t.items is array of {nodeId, metrics}
			const mapStatus = new Map();
			for(const it of t.items||[]){
				const hasAlert = it.metrics.some(m=>m.alert);
				mapStatus.set(it.nodeId, hasAlert? 'monitored': 'normal');
			}
			if(layers.nodes && layers.nodes.eachLayer){
				layers.nodes.eachLayer(layer=>{
					const props = layer.feature && layer.feature.properties;
					if(!props) return;
					const s = mapStatus.get(props.id) || props.status || 'normal';
					// apply alert style overlay (red stroke) when monitored
					if(s==='monitored') layer.setStyle({weight:2, color:'#f59e0b'});
					else layer.setStyle({weight:1, color: layer.options.color || (color[props.status]||'#22c55e')});
				});
			}
		}).catch(()=>{});
	};
	fetchAndApply();
	telemetryIntervalId = setInterval(fetchAndApply, intervalMs);
}

startTelemetryPolling(15000);

function showNearbyHouseList(houses, title = 'Прилежащие дома') {
	const items = Array.isArray(houses) ? houses : [];
	if(!items.length) return;
	let modal = document.getElementById('nearby-house-list');
	if(!modal){
		modal = document.createElement('div');
		modal.id = 'nearby-house-list';
		modal.style.position='fixed'; modal.style.right='20px'; modal.style.top='84px'; modal.style.width='360px'; modal.style.maxHeight='80vh'; modal.style.overflow='auto';
		modal.style.background='#091827'; modal.style.border='1px solid #29445f'; modal.style.padding='12px'; modal.style.borderRadius='8px'; modal.style.zIndex=99999; modal.style.color='#e9f2fc';
		document.body.appendChild(modal);
	}
	const rows = items.slice(0, 60).map(h => {
		const address = [h.street, h.house, h.block].filter(Boolean).join(' ') || h.id || 'Дом';
		const year = h.year ? ` • ${h.year}` : '';
		return `<div style="padding:8px 6px;border-bottom:1px solid #18314d"><button data-house-id="${h.id}" style="background:#18314d;color:#e9f2fc;border:0;padding:8px;border-radius:6px;width:100%;text-align:left;margin:0">${address}${year}</button></div>`;
	}).join('');
	modal.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><strong>${title}</strong><button id="nh-close" style="background:#16324d;color:#a8dbff;border:0;padding:6px;border-radius:6px">Закрыть</button></div><div>${rows}</div>`;
	modal.querySelector('#nh-close').onclick = () => modal.remove();
	modal.querySelectorAll('[data-house-id]').forEach(btn => btn.onclick = () => showHousePassport(btn.getAttribute('data-house-id')));
}

function selectNode(id, name) {
	document.querySelector('#selected').textContent = name;
	api.post('outage-zone', {nodeId: id}).then(z => {
		// clear previous selection layers
		selection.forEach(l => map.removeLayer(l)); selection = [];

		// highlight nodes in zone
		const nodeLayer = L.geoJSON({type: 'FeatureCollection', features: z.nodes.map(x => ({type: 'Feature', properties: x, geometry: {type: 'Point', coordinates: [x.lon, x.lat]}}))}, {pointToLayer: (f, ll) => L.circleMarker(ll, {radius: 7, color: '#f43f5e', weight: 3, fillOpacity: .2})}).addTo(map);
		selection.push(nodeLayer);

		// highlight pipes in zone (create GeoJSON from existing pipes data)
		try {
			const allPipes = layers.pipes && layers.pipes.toGeoJSON ? layers.pipes.toGeoJSON() : null;
			if (allPipes) {
				const sel = {type: 'FeatureCollection', features: allPipes.features.filter(f => z.pipeIds.includes(f.properties.id))};
				const pipeLayer = L.geoJSON(sel, {style: ()=>({color: '#f43f5e', weight: 5, opacity: 0.9})}).addTo(map);
				selection.push(pipeLayer);
			}
		} catch(e){}

		// optionally show houses list and highlight houses in zone
		const housesLayer = L.geoJSON({type: 'FeatureCollection', features: z.houses.map(x => ({type: 'Feature', properties: x, geometry: {type: 'Point', coordinates: [x.lon, x.lat]}}))}, {pointToLayer: (f, ll) => L.circleMarker(ll, {radius: 4, color: '#0ea5e9', fillOpacity: .7})}).addTo(map);
		selection.push(housesLayer);

		document.querySelector('#zone').innerHTML = `<b>${z.houses.length}</b> потребителей в зоне<br><small>${z.nodeIds.length} узлов, ${z.pipeIds.length} участков</small>`;
		return api.get('trail/' + id);
	}).then(t => {
		document.querySelector('#trail').innerHTML = [...t.bursts.map(x => `💥 ${x.status}: ${x.defect_char || x.address || '—'}`), ...t.defects.map(x => `🔧 P${x.priority}: ${x.defect_type}`)].slice(0, 8).join('<br>') || 'История отсутствует';
		return api.get('passports/node/' + id);
	}).then(r => {
		if (Array.isArray(r.houses) && r.houses.length) showNearbyHouseList(r.houses, 'Прилежащие дома');
	}).catch(e => console.error('selectNode detail failed', e));
}

// House passport modal
function createHouseModal(){
	if(document.getElementById('house-passport')) return;
	const div = document.createElement('div'); div.id='house-passport';
	div.style.position='fixed'; div.style.right='20px'; div.style.top='84px'; div.style.width='360px'; div.style.maxHeight='80vh'; div.style.overflow='auto'; div.style.background='#091827'; div.style.border='1px solid #29445f'; div.style.padding='12px'; div.style.borderRadius='8px'; div.style.zIndex=99999; div.style.color='#e9f2fc';
	div.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><strong>Паспорт дома</strong><button id="hp-close" style="background:#16324d;color:#a8dbff;border:0;padding:6px;border-radius:6px">Закрыть</button></div><div id="hp-body">Загрузка...</div>`;
	document.body.appendChild(div);
	document.getElementById('hp-close').onclick=()=>div.remove();
}

function showHousePassport(id){
	createHouseModal();
	const body = document.getElementById('hp-body'); body.innerHTML='Загрузка...';
	api.get('passports/house/'+id).then(r=>{
		const h = r.house || {};
		const node = r.node || null;
		const outages = (r.outages||[]);
		const history = (r.history||[]);
		const rows = [];
		rows.push(`<div class="row"><b>Адрес:</b> ${h.street||''} ${h.house||''} ${h.block||''}</div>`);
		rows.push(`<div class="row"><b>ID:</b> ${h.id||'—'}</div>`);
		rows.push(`<div class="row"><b>TK:</b> ${h.tk||'—'}</div>`);
		rows.push(`<div class="row"><b>Узел:</b> ${node? (node.name+' ('+node.id+')') : '—'}</div>`);
		rows.push(`<div class="row"><b>Потребление (поля):</b> ${h.load||'—'}</div>`);
		rows.push(`<div class="row"><b>Год:</b> ${h.year || '—'}</div>`);
		rows.push(`<div class="row"><b>Владелец:</b> ${h.owner||'—'}</div>`);
		rows.push(`<div class="row"><b>Примечание:</b> ${h.note||'—'}</div>`);
		rows.push(`<div class="row"><b>История (порывы/дефекты):</b><div>${history.slice(0,8).map(x=>`<div style="margin-top:6px">${x.date_detected||x.date_observed||''} — ${x.defect_char||x.defect_type||x.address||''}</div>`).join('')}</div></div>`);
		body.innerHTML = rows.join('');
	}).catch(e=>{ body.innerHTML = 'Ошибка загрузки паспорта'; });
}

// Pipe passport modal
function createPipeModal(){
	if(document.getElementById('pipe-passport')) return;
	const div = document.createElement('div'); div.id='pipe-passport';
	div.style.position='fixed'; div.style.right='20px'; div.style.top='84px'; div.style.width='420px'; div.style.maxHeight='80vh'; div.style.overflow='auto'; div.style.background='#091827'; div.style.border='1px solid #29445f'; div.style.padding='12px'; div.style.borderRadius='8px'; div.style.zIndex=99999; div.style.color='#e9f2fc';
	div.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><strong>Паспорт участка</strong><button id="pp-close" style="background:#16324d;color:#a8dbff;border:0;padding:6px;border-radius:6px">Закрыть</button></div><div id="pp-body">Загрузка...</div>`;
	document.body.appendChild(div);
	document.getElementById('pp-close').onclick=()=>div.remove();
}

function showPipePassport(id){
	createPipeModal();
	const body = document.getElementById('pp-body'); body.innerHTML='Загрузка...';
	api.get('passports/pipe/'+id).then(r=>{
		const p = r.pipe || {};
		const from = r.fromNode, to = r.toNode;
		const bursts = r.bursts||[]; const defects = r.defects||[];
		const rows = [];
		rows.push(`<div class="row"><b>Участок:</b> ${p.name||p.id}</div>`);
		rows.push(`<div class="row"><b>ID:</b> ${p.id||'—'}</div>`);
		rows.push(`<div class="row"><b>Диаметр:</b> ${p.diameter_mm||'—'} мм</div>`);
		rows.push(`<div class="row"><b>Длина:</b> ${p.length_m||'—'} м</div>`);
		rows.push(`<div class="row"><b>От узла:</b> ${from? (from.name+' ('+from.id+')') : '—'}</div>`);
		rows.push(`<div class="row"><b>До узла:</b> ${to? (to.name+' ('+to.id+')') : '—'}</div>`);
		rows.push(`<div class="row"><b>Последние порывы:</b><div>${bursts.slice(0,6).map(x=>`<div style="margin-top:6px">${x.date_detected||''} — ${x.status||''} ${x.defect_char||x.address||''}</div>`).join('')}</div></div>`);
		rows.push(`<div class="row"><b>Последние дефекты:</b><div>${defects.slice(0,6).map(x=>`<div style="margin-top:6px">${x.date_observed||''} — P${x.priority||''} ${x.defect_type||''}</div>`).join('')}</div></div>`);
		body.innerHTML = rows.join('');
	}).catch(e=>{ body.innerHTML = 'Ошибка загрузки паспорта участка'; });
}

// Scenario panel and preview/save
function createScenarioPanel(){
	if(document.getElementById('scenario-panel')) return;
	const p = document.createElement('div'); p.id='scenario-panel';
	p.style.position='fixed'; p.style.left='20px'; p.style.top='84px'; p.style.width='300px'; p.style.background='#071a2b'; p.style.border='1px solid #29445f'; p.style.padding='10px'; p.style.borderRadius='8px'; p.style.zIndex=99999; p.style.color='#e9f2fc';
	p.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><strong>Сценарий ремонта</strong><button id="sc-clear" style="background:#16324d;color:#a8dbff;border:0;padding:6px;border-radius:6px">Очистить</button></div><div id="sc-selected">Выберите узел или участок (клик на карте)</div><input id="sc-title" placeholder="Название сценария" style="width:100%;margin-top:8px;padding:6px;background:#071827;color:#e9f2fc;border:1px solid #29445f;border-radius:6px"><textarea id="sc-note" placeholder="Примечание" style="width:100%;margin-top:6px;padding:6px;background:#071827;color:#e9f2fc;border:1px solid #29445f;border-radius:6px"></textarea><div style="display:flex;gap:6px;margin-top:8px"><button id="sc-preview">Просмотр</button><button id="sc-save">Сохранить</button></div>`;
	document.body.appendChild(p);
	document.getElementById('sc-clear').onclick = ()=>{ clearPreview(); document.getElementById('sc-selected').innerText='Выберите узел или участок (клик на карте)'; selectedTarget=null; };
	document.getElementById('sc-preview').onclick = ()=>{ if(!selectedTarget) return alert('Сначала выберите узел или участок на карте'); simulateScenario(); };
	document.getElementById('sc-save').onclick = ()=>{ if(!selectedTarget) return alert('Сначала выберите узел или участок на карте'); saveScenario(); };
}

function clearPreview(){ previewSelection.forEach(l=>map.removeLayer(l)); previewSelection=[]; }

function simulateScenario(){
	clearPreview();
	const body = selectedTarget.type==='node'? {nodeId:selectedTarget.id} : {pipeId:selectedTarget.id};
	api.post('outage-zone', body).then(z=>{
		// show preview layers (purple)
		const nodeLayer = L.geoJSON({type:'FeatureCollection', features: z.nodes.map(x => ({type: 'Feature', properties: x, geometry: {type: 'Point', coordinates: [x.lon, x.lat]}}))}, {pointToLayer: (f, ll) => L.circleMarker(ll, {radius: 7, color: '#8b5cf6', weight: 3, fillOpacity: .15})}).addTo(map);
		previewSelection.push(nodeLayer);
		try{
			const allPipes = layers.pipes && layers.pipes.toGeoJSON ? layers.pipes.toGeoJSON() : null;
			if(allPipes){
				const sel = {type:'FeatureCollection', features: allPipes.features.filter(f=> z.pipeIds.includes(f.properties.id))};
				const pipeLayer = L.geoJSON(sel, {style: ()=>({color:'#8b5cf6', weight:5, opacity:0.9})}).addTo(map);
				previewSelection.push(pipeLayer);
			}
		}catch(e){}
		const housesLayer = L.geoJSON({type:'FeatureCollection', features: z.houses.map(x => ({type: 'Feature', properties: x, geometry: {type: 'Point', coordinates: [x.lon, x.lat]}}))}, {pointToLayer: (f, ll) => L.circleMarker(ll, {radius: 4, color: '#60a5fa', fillOpacity: .6})}).addTo(map);
		previewSelection.push(housesLayer);
		document.getElementById('sc-selected').innerText = `Просмотр: ${selectedTarget.type} ${selectedTarget.name||selectedTarget.id} — ${z.houses.length} домов, ${z.nodeIds.length} узлов, ${z.pipeIds.length} участков`;
	}).catch(e=>alert('Ошибка расчёта зоны: '+(e.message||e)));
}

function saveScenario(){
	const title = (document.getElementById('sc-title').value||'Сценарий от '+new Date().toLocaleString());
	const note = document.getElementById('sc-note').value||'';
	const body = {title, note, createdBy:'Веб-UI'};
	if(selectedTarget.type==='node') body.nodeId=selectedTarget.id; else body.pipeId=selectedTarget.id;
	api.post('scenarios', body).then(r=>{ alert('Сценарий сохранён'); }).catch(e=>alert('Ошибка сохранения: '+(e.message||e)));
}
