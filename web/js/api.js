const api={get:p=>fetch('/api/'+p).then(r=>r.json()),post:(p,b)=>fetch('/api/'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json())};
