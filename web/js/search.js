(function(){
  const css = `
    :root{--bg:#071522;--panel:#0d1f34;--panel2:#112b45;--line:#22466a;--muted:#8fb5d8;--text:#edf7ff;--accent:#60a5fa;--mint:#34d399;--amber:#fbbf24;--rose:#f87171;--shadow:0 18px 40px rgba(4,10,18,.32)}
    #searchBox{position:fixed;right:20px;top:84px;z-index:9999;width:340px;background:linear-gradient(180deg, rgba(13,31,52,.96), rgba(9,21,35,.96));border:1px solid var(--line);box-shadow:var(--shadow);border-radius:16px;padding:12px;color:var(--text);font:13px/1.3 Inter,system-ui;cursor:move;user-select:none}
    #searchBox input, #searchBox select, #searchBox button{font:inherit}
    #searchBox input, #searchBox select{width:100%;padding:9px 10px;border-radius:10px;border:1px solid rgba(148,163,184,.2);background:rgba(10,18,28,.8);color:var(--text);margin-top:6px;outline:none}
    #searchBox button{margin-top:8px;padding:9px 12px;border:0;border-radius:10px;background:linear-gradient(90deg,#3b82f6,#60a5fa);color:#fff;font-weight:700;cursor:pointer}
    #searchResults{max-height:360px;overflow:auto;margin-top:10px;padding-right:4px}
    #searchResults .item{padding:10px 8px;border:1px solid rgba(96,165,250,.12);border-radius:10px;margin-top:6px;background:rgba(15,34,52,.64);cursor:pointer;transition:.2s ease}
    #searchResults .item:hover{background:rgba(29,55,80,.9);transform:translateY(-1px)}
    #searchResults .item .title{font-weight:700;color:#eff8ff}
    #searchResults .item .sub{font-size:12px;color:var(--muted);margin-top:4px}
    #searchResults .muted{color:var(--muted);padding:8px 4px}
  `;
  const style=document.createElement('style');style.innerHTML=css;document.head.appendChild(style);
  const box=document.createElement('div');box.id='searchBox';box.innerHTML=`
    <input id="searchInput" placeholder="Поиск: адрес, дом, ТК, участок...">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
      <select id="searchType"><option value="all">Все</option><option value="house">Дома</option><option value="node">Узлы</option><option value="pipe">Участки</option></select>
      <button id="searchBtn">Найти</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
      <select id="filterType"><option value="all">Все типы</option><option value="node">Узлы</option><option value="pipe">Участки</option><option value="house">Дома</option><option value="social">Соц. объекты</option><option value="source">Источники</option></select>
      <select id="filterStatus"><option value="all">Все статусы</option><option value="normal">Норма</option><option value="monitored">На контроле</option><option value="emergency">Авария</option><option value="repair">Ремонт</option><option value="data_missing">Нет данных</option><option value="high_risk">Высокий риск</option></select>
    </div>
    <select id="filterDistrict" style="margin-top:8px"><option value="all">Все районы</option></select>
    <div id="searchResults"></div>
  `;
  document.body.appendChild(box);

  const inp=document.getElementById('searchInput');
  const btn=document.getElementById('searchBtn');
  const typeSel=document.getElementById('searchType');
  const resDiv=document.getElementById('searchResults');
  const filterType=document.getElementById('filterType');
  const filterStatus=document.getElementById('filterStatus');
  const filterDistrict=document.getElementById('filterDistrict');

  function normalizeText(value){
    return String(value ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zа-яё0-9\s]/gi,' ').replace(/\s+/g,' ').trim();
  }
  function scoreMatch(text, query){
    const normalized = normalizeText(text);
    const q = normalizeText(query);
    if(!q) return 0;
    if(!normalized) return -1;
    if(normalized === q) return 100;
    if(normalized.startsWith(q)) return 90;
    if(normalized.includes(q)) return 80;
    const tokens = q.split(' ').filter(Boolean);
    const matchedTokens = tokens.filter(t => normalized.includes(t)).length;
    if(tokens.length && matchedTokens === tokens.length) return 60;
    return -1;
  }

  function refreshDistrictOptions(){
    const districts = new Set();
    const layers = window.layers || {};
    Object.values(layers).forEach(layer => {
      if(!layer || !layer.eachLayer) return;
      layer.eachLayer(item => {
        const props = item.feature && item.feature.properties ? item.feature.properties : {};
        const district = props.district || props.folder || props.area || '';
        if(district) districts.add(String(district));
      });
    });
    const list = [...districts].sort();
    const current = filterDistrict.value;
    filterDistrict.innerHTML = '<option value="all">Все районы</option>' + list.map(v => `<option value="${v}">${v}</option>`).join('');
    if(list.includes(current)) filterDistrict.value = current;
  }

  function applyUiFilters(){
    if(window.setFilterState){
      window.setFilterState({
        type: filterType.value,
        status: filterStatus.value,
        district: filterDistrict.value
      });
    }
  }

  [filterType, filterStatus, filterDistrict].forEach(el => el && el.addEventListener('change', applyUiFilters));

  function renderResults(items){
    resDiv.innerHTML='';
    if(!items.length){
      resDiv.innerHTML='<div class="muted">Ничего не найдено</div>';
      return;
    }
    items.slice(0,200).forEach(it => {
      const el=document.createElement('div');
      el.className='item';
      el.innerHTML=`<div class="title">${it.title}</div><div class="sub">${it.sub}</div>`;
      el.onclick=()=>handleSelect(it);
      resDiv.appendChild(el);
    });
  }

  function sortByQuery(items, q){
    const query = normalizeText(q);
    return items
      .map(item => {
        const hay = `${item.title || ''} ${item.sub || ''}`;
        const score = scoreMatch(hay, query);
        return { item, score };
      })
      .filter(entry => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map(entry => entry.item);
  }

  function doSearch(){
    const q=inp.value.trim();
    if(!q){ resDiv.innerHTML=''; return; }
    fetch(`/api/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(typeSel.value)}`)
      .then(r => r.json())
      .then(j => {
        const out=[];
        if(j.houses && j.houses.length){
          j.houses.forEach(h => out.push({kind:'house',title:`Дом ${h.street||''} ${h.house||''}`.trim() + (h.year ? ` · ${h.year}` : ''),sub:`TK: ${h.tk||''} · Узел: ${h.node ? h.node.id : '—'}${h.year ? ` · Год: ${h.year}` : ''}`,data:h}));
        }
        if(j.nodes && j.nodes.length){
          j.nodes.forEach(n => out.push({kind:'node',title:`Узел ${n.name||n.id}`,sub:`${n.type||''} · ${n.id}`,data:n}));
        }
        if(j.pipes && j.pipes.length){
          j.pipes.forEach(p => out.push({kind:'pipe',title:`Участок ${p.name||p.id}`,sub:`${p.id}`,data:p}));
        }
        if(j.socialObjects && j.socialObjects.length){
          j.socialObjects.forEach(s => out.push({kind:'social',title:`Соц. объект ${s.name||s.id}`,sub:`${s.type||''} · ${s.address||'—'}`,data:s}));
        }
        renderResults(sortByQuery(out, q));
      })
      .catch(() => { resDiv.innerHTML='<div class="muted">Ошибка поиска</div>'; });
  }

  function highlightNode(nodeId){
    fetch('/api/passports/node/' + encodeURIComponent(nodeId))
      .then(r => r.json())
      .then(j => {
        const n = j.node;
        if(!n || !n.lat || !n.lon) return;
        const marker = L.circleMarker([n.lat,n.lon], {radius:10,color:'#fbbf24',weight:3,fillOpacity:0.8}).addTo(map);
        setTimeout(()=>map.removeLayer(marker), 5000);
      })
      .catch(console.error);
  }

  function handleSelect(item){
    if(item.kind === 'house'){
      const h = item.data;
      const coords = h.geometry && h.geometry.coordinates ? h.geometry.coordinates : null;
      const node = h.node || null;
      const lat = node && node.lat ? node.lat : (coords ? coords[1] : null);
      const lon = node && node.lon ? node.lon : (coords ? coords[0] : null);
      if(lat && lon){
        map.flyTo([lat, lon], 17);
        if(h.node && h.node.id) highlightNode(h.node.id);
        if(typeof showHousePassport === 'function' && h.id) showHousePassport(h.id);
      } else alert('Координаты дома не найдены');
    }
    else if(item.kind === 'node'){
      const n = item.data;
      if(n.lat && n.lon){
        map.flyTo([n.lat, n.lon], 17);
        highlightNode(n.id);
      }
    }
    else if(item.kind === 'pipe'){
      const p = item.data;
      try {
        const coords = JSON.parse(p.coordinates || '[]');
        if(!coords.length) return;
        const geo = L.polyline(coords.map(c => [c[1], c[0]]), {color:'#ff5722', weight:6, opacity:0.9}).addTo(map);
        map.fitBounds(geo.getBounds(), {padding:[40,40]});
        setTimeout(()=>map.removeLayer(geo), 8000);
      } catch(e) { console.error(e); }
    }
    else if(item.kind === 'social'){
      const s = item.data;
      if(s.lat && s.lon){
        map.flyTo([s.lat, s.lon], 16);
      }
    }
  }

  let dragState = null;
  box.addEventListener('pointerdown', (event) => {
    if (event.target.closest('input, select, button')) return;
    dragState = {x: event.clientX - box.offsetLeft, y: event.clientY - box.offsetTop};
    box.setPointerCapture(event.pointerId);
  });
  box.addEventListener('pointermove', (event) => {
    if (!dragState) return;
    const left = Math.min(window.innerWidth - box.offsetWidth - 12, Math.max(12, event.clientX - dragState.x));
    const top = Math.min(window.innerHeight - box.offsetHeight - 12, Math.max(12, event.clientY - dragState.y));
    box.style.left = `${left}px`;
    box.style.right = 'auto';
    box.style.top = `${top}px`;
  });
  box.addEventListener('pointerup', () => { dragState = null; });
  box.addEventListener('pointerleave', () => { dragState = null; });

  inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(doSearch, 300); });
  btn.addEventListener('click', doSearch);
  typeSel.addEventListener('change', doSearch);
  refreshDistrictOptions();
  setInterval(refreshDistrictOptions, 5000);
})();
