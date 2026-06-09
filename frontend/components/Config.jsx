// Configuration Screen — Admin only
function Toggle({ checked, onChange, label }) {
  return (
    <label style={{display:"flex", alignItems:"center", gap:10, cursor:"pointer"}}>
      <div onClick={() => onChange(!checked)} style={{
        width:38, height:22, borderRadius:11,
        background: checked ? "#4d7fe0" : "#162036",
        border: `1px solid ${checked ? "#4d7fe0" : "#1c2b46"}`,
        position:"relative", transition:"background 0.2s",
        flexShrink:0,
      }}>
        <div style={{
          position:"absolute", top:2, left: checked ? 17 : 2,
          width:16, height:16, borderRadius:"50%", background:"#fff",
          transition:"left 0.2s", boxShadow:"0 1px 4px rgba(0,0,0,0.4)",
        }}/>
      </div>
      {label && <span style={{fontSize:13, color:"#c8d4e8"}}>{label}</span>}
    </label>
  );
}

function FormField({ label, type="text", value, onChange, placeholder, masked, hint }) {
  const [show, setShow] = React.useState(false);
  return (
    <div style={{marginBottom:18}}>
      <label style={cfgStyles.label}>{label}</label>
      {hint && <div style={{fontSize:11, color:"#5b6a8a", marginBottom:5}}>{hint}</div>}
      <div style={{position:"relative"}}>
        <input
          type={masked && !show ? "password" : type}
          value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={cfgStyles.input}
        />
        {masked && (
          <button type="button" onClick={() => setShow(s=>!s)} style={{
            position:"absolute", right:10, top:"50%", transform:"translateY(-50%)",
            background:"none", border:"none", color:"#5b6a8a", cursor:"pointer", fontSize:11,
          }}>{show ? "Ocultar" : "Mostrar"}</button>
        )}
      </div>
    </div>
  );
}

function ConnectionStatus({ connected, lastSync }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:14, padding:"12px 16px",
      background: connected ? "rgba(34,201,123,0.08)" : "rgba(255,76,106,0.08)",
      border: `1px solid ${connected ? "rgba(34,201,123,0.25)" : "rgba(255,76,106,0.25)"}`,
      borderRadius:10, marginBottom:24,
    }}>
      <div style={{
        width:10, height:10, borderRadius:"50%",
        background: connected ? "#22c97b" : "#ff4c6a",
        boxShadow: `0 0 8px ${connected ? "#22c97b" : "#ff4c6a"}`,
      }}/>
      <div>
        <div style={{fontSize:13, fontWeight:600, color: connected ? "#22c97b" : "#ff4c6a"}}>
          {connected ? "Conectado" : "Desconectado"}
        </div>
        <div style={{fontSize:11, color:"#5b6a8a"}}>Última sincronización: {lastSync}</div>
      </div>
    </div>
  );
}

function TestButton({ onClick, status }) {
  const colors = { idle:"#1c2b46", testing:"#5b9cf6", ok:"#22c97b", error:"#ff4c6a" };
  const labels = { idle:"Probar Conexión", testing:"Probando…", ok:"✓ Conectado", error:"✗ Error" };
  return (
    <button onClick={onClick} style={{
      background:"none", border:`1px solid ${colors[status]}`,
      borderRadius:7, padding:"8px 16px", color:colors[status],
      fontSize:12, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s",
    }}>
      {labels[status]}
    </button>
  );
}

// Componente unificado: plaza + todas las fuentes AVC
function AVCSourcesConfig() {
  const [plaza,      setPlaza]     = React.useState("");
  const [plazaMsg,   setPlazaMsg]  = React.useState("");
  const [sources,    setSources]   = React.useState([]);
  const [editing,    setEditing]   = React.useState(null);
  const [testing,    setTesting]   = React.useState({});
  const [syncing,    setSyncing]   = React.useState({});
  const [syncAll,    setSyncAll]   = React.useState(false);
  const [syncDate,   setSyncDate]  = React.useState(()=>{ try{return new Date().toLocaleDateString("en-CA",{timeZone:"America/Mexico_City"});}catch(e){return new Date().toISOString().slice(0,10);} });
  const [syncAllMsg, setSyncAllMsg]= React.useState("");

  function reload() {
    window.API.get("/api/sources").then(d=>setSources(Array.isArray(d)?d:[])).catch(()=>{});
  }
  React.useEffect(()=>{
    reload();
    window.API.get("/api/config").then(cfg=>{ if(cfg.plaza_name) setPlaza(cfg.plaza_name); }).catch(()=>{});
  },[]);

  function savePlaza() {
    window.API.get("/api/config")
      .then(cfg => window.API.post("/api/config",{...cfg, plaza_name:plaza}))
      .then(()=>{ setPlazaMsg("✓ Guardado"); setTimeout(()=>setPlazaMsg(""),2000); })
      .catch(()=>setPlazaMsg("Error"));
  }

  function testSource(id) {
    setTesting(p=>({...p,[id]:"testing"}));
    window.API.post(`/api/sources/${id}/test`,{})
      .then(r=>setTesting(p=>({...p,[id]:r.ok?"ok":"error"})))
      .catch(()=>setTesting(p=>({...p,[id]:"error"})));
  }

  function syncSource(id) {
    setSyncing(p=>({...p,[id]:true}));
    window.API.post(`/api/sources/${id}/sync`,{date:syncDate})
      .then(()=>reload()).finally(()=>setSyncing(p=>({...p,[id]:false})));
  }

  function syncAllSources() {
    setSyncAll(true); setSyncAllMsg("");
    const enabled = sources.filter(s=>s.enabled);
    if (!enabled.length) { setSyncAll(false); setSyncAllMsg("Sin fuentes activas"); return; }
    Promise.all(enabled.map(s=>
      window.API.post(`/api/sources/${s.id}/sync`,{date:syncDate}).catch(e=>({ok:false,error:e.message}))
    )).then(results=>{
      const total = results.reduce((s,r)=>s+(r.records||0),0);
      const errs  = results.filter(r=>!r.ok).length;
      setSyncAllMsg(`✓ ${total} eventos de ${results.length} fuente(s)${errs?` · ${errs} error(es)`:""}` );
      reload();
    }).finally(()=>setSyncAll(false));
  }

  function toggleEnabled(src) {
    window.API.put(`/api/sources/${src.id}`,{enabled:src.enabled?0:1}).then(reload);
  }

  function deleteSource(id) {
    if(!confirm("¿Eliminar esta fuente AVC?")) return;
    fetch(`/api/sources/${id}`,{method:"DELETE",headers:window.API.headers()}).then(reload);
  }

  const TC = {idle:"#1c2b46",testing:"#5b9cf6",ok:"#22c97b",error:"#ff4c6a"};
  const TL = {idle:"Probar",testing:"Probando…",ok:"✓ OK",error:"✗ Error"};

  return (
    <div>
      {/* Plaza y fecha de sync */}
      <div style={{background:"#080d1a",border:"1px solid #1e2535",borderRadius:10,padding:"16px 20px",marginBottom:20}}>
        <div style={{display:"flex",gap:12,alignItems:"flex-end",flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:180}}>
            <label style={cfgStyles.label}>Nombre de la Plaza</label>
            <input value={plaza} onChange={e=>setPlaza(e.target.value)} placeholder="Ej. Plaza Texcoco"
              style={cfgStyles.input}/>
          </div>
          <button onClick={savePlaza} style={{...cfgStyles.saveBtn,marginBottom:0}}>Guardar</button>
          {plazaMsg && <span style={{fontSize:12,color:"#22c97b",paddingBottom:2}}>{plazaMsg}</span>}
          <div style={{flex:1,minWidth:160}}>
            <label style={cfgStyles.label}>Fecha de sincronización</label>
            <input type="date" value={syncDate} onChange={e=>setSyncDate(e.target.value)} style={cfgStyles.input}/>
          </div>
          <button onClick={syncAllSources} disabled={syncAll}
            style={{...cfgStyles.saveBtn,background:"transparent",border:"1px solid rgba(77,127,224,0.4)",color:"#4d7fe0",marginBottom:0,opacity:syncAll?0.6:1}}>
            {syncAll?"Sincronizando…":"↺ Sync todos"}
          </button>
        </div>
        {syncAllMsg && <div style={{marginTop:8,fontSize:12,color:syncAllMsg.startsWith("✓")?"#22c97b":"#ff4c6a"}}>{syncAllMsg}</div>}
      </div>

      {/* Cabecera con contador y botón nuevo */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div>
          <span style={{fontSize:14,fontWeight:600,color:"#e8edf5"}}>{sources.length} sistema(s) AVC</span>
          <span style={{fontSize:12,color:"#5b6a8a",marginLeft:8}}>— haz clic en + para agregar otro</span>
        </div>
        <button onClick={()=>setEditing({name:"",type:"database",config:{}})} style={cfgStyles.saveBtn}>
          + Nuevo AVC
        </button>
      </div>

      {/* Lista de fuentes */}
      {sources.length===0 && (
        <div style={{textAlign:"center",padding:"32px 0",color:"#5b6a8a",fontSize:13}}>
          Sin sistemas AVC. Agrega uno con "+ Nuevo AVC".
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {sources.map(src=>(
          <div key={src.id} style={{background:"#080d1a",border:"1px solid #1e2535",borderRadius:10,
            padding:"14px 18px",opacity:src.enabled?1:0.55}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:22}}>{src.type==="api"?"🔌":"🗄️"}</span>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:"#e8edf5"}}>{src.name}</div>
                  <div style={{display:"flex",gap:6,marginTop:3,alignItems:"center",flexWrap:"wrap"}}>
                    <span style={{
                      fontSize:10,fontWeight:600,padding:"1px 7px",borderRadius:4,
                      background:src.type==="api"?"rgba(91,156,246,0.15)":"rgba(77,127,224,0.1)",
                      color:src.type==="api"?"#5b9cf6":"#4d7fe0",
                    }}>{src.type==="api"?"API REST":"PostgreSQL + SSH"}</span>
                    {src.last_sync
                      ? <span style={{fontSize:11,color:"#22c97b"}}>· Sync: {src.last_sync.slice(0,16)}</span>
                      : <span style={{fontSize:11,color:"#5b6a8a"}}>· Sin sincronizar</span>}
                  </div>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:7,height:7,borderRadius:"50%",
                  background:src.enabled?"#22c97b":"#5b6a8a",
                  boxShadow:src.enabled?"0 0 5px #22c97b":"none"}}/>
                <span style={{fontSize:11,color:src.enabled?"#22c97b":"#5b6a8a"}}>
                  {src.enabled?"Activo":"Inactivo"}
                </span>
              </div>
            </div>

            <div style={{display:"flex",gap:6,marginTop:12,flexWrap:"wrap"}}>
              <button onClick={()=>testSource(src.id)}
                style={{...cfgStyles.actionBtn,border:`1px solid ${TC[testing[src.id]||"idle"]}`,color:TC[testing[src.id]||"idle"]}}>
                {TL[testing[src.id]||"idle"]}
              </button>
              <button onClick={()=>syncSource(src.id)} disabled={!!syncing[src.id]}
                style={{...cfgStyles.actionBtn,color:"#5b9cf6",borderColor:"rgba(91,156,246,0.35)",opacity:syncing[src.id]?0.6:1}}>
                {syncing[src.id]?`Sync ${syncDate}…`:`↺ Sync ${syncDate}`}
              </button>
              <button onClick={()=>window.API.get(`/api/sources/${src.id}`).then(d=>setEditing(d)).catch(()=>{})}
                style={cfgStyles.actionBtn}>Editar</button>
              <button onClick={()=>toggleEnabled(src)}
                style={{...cfgStyles.actionBtn,color:src.enabled?"#ff7e3f":"#22c97b",
                  borderColor:src.enabled?"rgba(255,126,63,0.35)":"rgba(34,201,123,0.35)"}}>
                {src.enabled?"Desactivar":"Activar"}
              </button>
              <button onClick={()=>deleteSource(src.id)}
                style={{...cfgStyles.actionBtn,color:"#ff4c6a",borderColor:"rgba(255,76,106,0.25)"}}>
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <SourceModal
          source={editing}
          onSave={()=>{ setEditing(null); reload(); }}
          onClose={()=>setEditing(null)}
        />
      )}
    </div>
  );
}

function SATConfig() {
  const UPLOAD_DIR = "/home/sftpuser/uploads";
  const CLASS_OPTIONS = [
    [1,"A - Auto 2 Ejes"], [2,"C2"], [3,"C3"], [4,"C4"], [5,"C5"],
    [6,"C6"], [7,"C7"], [8,"C8"], [9,"C9+"], [10,"AR1"],
    [11,"AR2"], [12,"B2"], [13,"B3"], [14,"B4"], [15,"Moto"],
  ];
  const [dirInfo,  setDirInfo]  = React.useState(null);
  const [merging,  setMerging]  = React.useState({});
  const [mergeMsg, setMergeMsg] = React.useState({});
  const [tariffs,  setTariffs]  = React.useState({});
  const [satTariffs, setSatTariffs] = React.useState({by_class:{}});
  const [savingTariffs, setSavingTariffs] = React.useState(false);
  const [tariffMsg, setTariffMsg] = React.useState("");

  function loadDir() {
    window.API.get("/api/sat/directory").then(d=>setDirInfo(d)).catch(()=>{});
  }
  function loadSatTariffs() {
    window.API.get("/api/sat/tariffs").then(d=>setSatTariffs(d || {by_class:{}})).catch(()=>{});
  }
  React.useEffect(()=>{ loadDir(); }, []);
  React.useEffect(()=>{ loadSatTariffs(); }, []);
  React.useEffect(()=>{ const t=setInterval(loadDir,30000); return ()=>clearInterval(t); }, []);
  React.useEffect(()=>{
    window.API.get("/api/config").then(cfg=>{
      const raw = cfg.avc_tariffs || {};
      setTariffs(typeof raw === "string" ? JSON.parse(raw || "{}") : raw);
    }).catch(()=>{});
  }, []);

  function timeAgo(secs) {
    if (secs==null) return "—";
    if (secs<60)    return `hace ${secs}s`;
    if (secs<3600)  return `hace ${Math.floor(secs/60)} min`;
    if (secs<86400) return `hace ${Math.floor(secs/3600)} h`;
    return `hace ${Math.floor(secs/86400)} día(s)`;
  }

  function mergeDay(day) {
    setMerging(p=>({...p,[day]:true}));
    setMergeMsg(p=>({...p,[day]:""}));
    window.API.post("/api/merge-sat",{day})
      .then(r=>{
        setMergeMsg(p=>({...p,[day]:r.ok
          ? `✓ +${r.added} txns · total: ${r.total.toLocaleString()}`
          : `Error: ${r.error}`}));
        loadDir();
      })
      .catch(e=>setMergeMsg(p=>({...p,[day]:`Error: ${e.message||e}`})))
      .finally(()=>setMerging(p=>({...p,[day]:false})));
  }

  function setTariff(classId, value) {
    setTariffs(p=>({...p, [classId]: value}));
  }

  function copySatTariff(classId) {
    const sat = satTariffs?.by_class?.[classId]?.tariff;
    if (sat == null) return;
    setTariff(classId, sat);
  }

  function copyAllSatTariffs() {
    const next = {...tariffs};
    CLASS_OPTIONS.forEach(([id])=>{
      const sat = satTariffs?.by_class?.[id]?.tariff;
      if (sat != null) next[id] = sat;
    });
    setTariffs(next);
  }

  function saveTariffs() {
    setSavingTariffs(true); setTariffMsg("");
    const clean = {};
    CLASS_OPTIONS.forEach(([id])=>{
      const raw = String(tariffs[id] ?? "").replace(",", ".").trim();
      if (raw !== "" && !Number.isNaN(Number(raw))) clean[id] = Number(raw);
    });
    window.API.get("/api/config")
      .then(cfg=>window.API.post("/api/config",{...cfg, avc_tariffs: clean}))
      .then(()=>{
        setTariffs(clean);
        setTariffMsg("✓ Tarifas guardadas");
        setTimeout(()=>setTariffMsg(""),3000);
      })
      .catch(e=>setTariffMsg(`Error: ${e.message || e}`))
      .finally(()=>setSavingTariffs(false));
  }

  const totalPending = dirInfo?.total_pending || 0;
  const secsSince    = dirInfo?.seconds_since_last;
  const days         = dirInfo?.days || [];
  const moneyFmt = (value) => Number(value || 0).toLocaleString("es-MX", {
    style:"currency", currency:"MXN", maximumFractionDigits:2,
  });

  return (
    <div>
      <div style={{background:"#080d1a",border:"1px solid #1e2535",borderRadius:10,padding:"16px 20px",marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap",marginBottom:12}}>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:"#e8edf5",marginBottom:5}}>Tarifas AVC para Impacto Económico</div>
            <div style={{fontSize:12,color:"#5b6a8a",lineHeight:1.45}}>
              Estas tarifas estiman el monto AVC por clase en el Dashboard. SAT conserva su monto real desde sat_prix.
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <button onClick={copyAllSatTariffs} style={cfgStyles.actionBtn}>
              Copiar SAT a AVC
            </button>
            {tariffMsg && (
              <span style={{fontSize:11,color:tariffMsg.startsWith("✓")?"#22c97b":"#ff4c6a"}}>{tariffMsg}</span>
            )}
            <button onClick={saveTariffs} disabled={savingTariffs}
              style={{...cfgStyles.saveBtn,opacity:savingTariffs?0.7:1}}>
              {savingTariffs ? "Guardando…" : "Guardar tarifas"}
            </button>
          </div>
        </div>
        <div style={{fontSize:11,color:"#5b6a8a",marginBottom:12}}>
          SAT observado desde <span style={{color:"#8a9ab5",fontFamily:"monospace"}}>{satTariffs.source_file || "sin MERGED"}</span>
          {satTariffs.day ? ` · ${satTariffs.day}` : ""}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>
          {CLASS_OPTIONS.map(([id, label])=>{
            const sat = satTariffs?.by_class?.[id];
            const avcVal = Number(tariffs[id] || 0);
            const satVal = Number(sat?.tariff || 0);
            const same = avcVal > 0 && satVal > 0 && Math.abs(avcVal - satVal) < 0.01;
            const different = avcVal > 0 && satVal > 0 && !same;
            return (
            <div key={id} style={{background:"#0d1525",border:"1px solid #1c2b46",borderRadius:8,padding:10}}>
              <label style={cfgStyles.label}>Clase {id} · {label}</label>
              <input type="number" min="0" step="0.01"
                value={tariffs[id] ?? ""}
                onChange={e=>setTariff(id, e.target.value)}
                placeholder="0.00"
                style={{...cfgStyles.input,padding:"8px 10px"}}/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,alignItems:"start",marginTop:8}}>
                <div>
                  <div style={{fontSize:10,color:"#5b6a8a"}}>AVC configurada</div>
                  <div style={{fontSize:13,fontWeight:800,color:avcVal?"#ffb27d":"#5b6a8a"}}>
                    {avcVal ? moneyFmt(avcVal) : "—"}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:10,color:"#5b6a8a"}}>SAT automática</div>
                  <div style={{fontSize:13,fontWeight:800,color:satVal?"#8bbcff":"#5b6a8a"}}>
                    {satVal ? moneyFmt(satVal) : "—"}
                  </div>
                  {sat && (
                    <div style={{fontSize:9,color:"#5b6a8a",marginTop:1}}>
                      {sat.count?.toLocaleString()} de {sat.total?.toLocaleString()} txns
                    </div>
                  )}
                </div>
                <div style={{gridColumn:"1/-1",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                  <span style={{fontSize:10,fontWeight:800,borderRadius:4,padding:"2px 6px",
                    color:same?"#22c97b":different?"#ff7e3f":"#5b6a8a",
                    background:same?"rgba(34,201,123,0.12)":different?"rgba(255,126,63,0.12)":"#080d1a",
                    border:`1px solid ${same?"rgba(34,201,123,0.35)":different?"rgba(255,126,63,0.35)":"#1c2b46"}`}}>
                    {same ? "Igual" : different ? "Diferente" : "Sin comparar"}
                  </span>
                  {satVal > 0 && (
                    <button onClick={()=>copySatTariff(id)} style={{...cfgStyles.actionBtn,fontSize:10,padding:"4px 7px"}}>
                      Usar SAT
                    </button>
                  )}
                </div>
              </div>
            </div>
          );})}
        </div>
      </div>

      {/* Encabezado del directorio */}
      <div style={{background:"#080d1a",border:"1px solid #1e2535",borderRadius:10,padding:"16px 20px",marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:16}}>
          <div>
            <div style={{fontSize:11,color:"#5b6a8a",marginBottom:5}}>Directorio de recepción SFTP</div>
            <div style={{fontFamily:"monospace",fontSize:13,color:"#4d7fe0",marginBottom:4}}>{UPLOAD_DIR}</div>
            <div style={{fontSize:11,color:"#5b6a8a"}}>
              Directorio MERGED: <span style={{color:"#8a9ab5",fontFamily:"monospace"}}>~/sat_merged</span>
            </div>
          </div>
          <div style={{display:"flex",gap:24}}>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:11,color:"#5b6a8a",marginBottom:4}}>Archivos pendientes</div>
              <div style={{fontSize:28,fontWeight:800,lineHeight:1,
                color:totalPending>0?"#f5d433":"#22c97b"}}>{totalPending}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:11,color:"#5b6a8a",marginBottom:4}}>Último archivo</div>
              <div style={{fontSize:16,fontWeight:700,lineHeight:1,
                color:secsSince!=null&&secsSince<300?"#22c97b":secsSince!=null&&secsSince<3600?"#f5d433":"#8a9ab5"}}>
                {timeAgo(secsSince)}
              </div>
              {secsSince!=null && (
                <div style={{fontSize:10,color:"#243358",marginTop:2}}>{new Date(Date.now()-secsSince*1000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
              )}
            </div>
          </div>
        </div>

        {totalPending>0 && (
          <div style={{marginTop:12,padding:"8px 12px",background:"rgba(245,212,51,0.08)",
            border:"1px solid rgba(245,212,51,0.25)",borderRadius:7,fontSize:12,color:"#f5d433"}}>
            ⚠ {totalPending} archivo(s) nuevos sin fusionar — el Dashboard los procesa automáticamente cada 30s
          </div>
        )}
        {totalPending===0 && days.some(d=>d.merged) && (
          <div style={{marginTop:12,padding:"8px 12px",background:"rgba(34,201,123,0.08)",
            border:"1px solid rgba(34,201,123,0.25)",borderRadius:7,fontSize:12,color:"#22c97b"}}>
            ✓ Todos los archivos están fusionados
          </div>
        )}
      </div>

      {/* Tabla por día */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:13,fontWeight:600,color:"#e8edf5"}}>
          Archivos por día
          {days.length>0 && <span style={{fontSize:11,color:"#5b6a8a",fontWeight:400,marginLeft:8}}>({days.length} día(s))</span>}
        </div>
        <button onClick={loadDir} style={cfgStyles.actionBtn}>↺ Actualizar</button>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {days.length===0 && (
          <div style={{textAlign:"center",padding:"32px 0",color:"#5b6a8a",fontSize:13}}>
            {dirInfo ? "Sin archivos SAT en el directorio." : "Cargando…"}
          </div>
        )}

        {days.map(day=>(
          <div key={day.day} style={{
            background:"#080d1a",border:"1px solid #1e2535",borderRadius:10,padding:"14px 18px",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              {/* Indicador */}
              <div style={{
                width:10,height:10,borderRadius:"50%",flexShrink:0,
                background:day.merged?"#22c97b":day.pending>0?"#f5d433":"#5b6a8a",
                boxShadow:day.merged?"0 0 6px #22c97b":day.pending>0?"0 0 6px #f5d433":"none",
              }}/>
              {/* Fecha */}
              <div style={{minWidth:100}}>
                <div style={{fontSize:14,fontWeight:700,color:"#e8edf5"}}>{day.date_label}</div>
                <div style={{fontSize:10,color:"#243358",fontFamily:"monospace"}}>{day.day}</div>
              </div>
              {/* Pendientes */}
              <div style={{minWidth:80}}>
                <div style={{fontSize:10,color:"#5b6a8a",marginBottom:2}}>Pendientes</div>
                <div style={{fontSize:16,fontWeight:800,
                  color:day.pending>0?"#f5d433":"#243358"}}>{day.pending}</div>
              </div>
              {/* Estado fusión */}
              <div style={{minWidth:100}}>
                <div style={{fontSize:10,color:"#5b6a8a",marginBottom:2}}>Fusión</div>
                <div style={{fontSize:12,fontWeight:600,
                  color:day.merged?"#22c97b":"#5b6a8a"}}>
                  {day.merged?"✓ Fusionado":"Sin fusionar"}
                </div>
              </div>
              {/* Transacciones */}
              <div style={{minWidth:100}}>
                <div style={{fontSize:10,color:"#5b6a8a",marginBottom:2}}>Transacciones</div>
                <div style={{fontSize:16,fontWeight:800,
                  color:day.transactions>0?"#5b9cf6":"#243358"}}>
                  {day.transactions>0?day.transactions.toLocaleString():"—"}
                </div>
              </div>
              {/* Generado a */}
              {day.generated_at && (
                <div style={{minWidth:130,fontSize:11,color:"#5b6a8a"}}>
                  Generado:<br/>
                  <span style={{color:"#8a9ab5"}}>{day.generated_at.slice(0,16).replace("T"," ")}</span>
                </div>
              )}
              {/* Acciones */}
              <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                {mergeMsg[day.day] && (
                  <span style={{fontSize:11,
                    color:mergeMsg[day.day].startsWith("✓")?"#22c97b":"#ff4c6a"}}>
                    {mergeMsg[day.day]}
                  </span>
                )}
                {day.pending>0 ? (
                  <button onClick={()=>mergeDay(day.day)} disabled={!!merging[day.day]}
                    style={{...cfgStyles.saveBtn,fontSize:11,padding:"6px 14px",
                      opacity:merging[day.day]?0.7:1}}>
                    {merging[day.day]?"Fusionando…":"↺ Fusionar"}
                  </button>
                ) : (
                  <button onClick={()=>mergeDay(day.day)} disabled={!!merging[day.day]}
                    style={{...cfgStyles.actionBtn,opacity:merging[day.day]?0.7:1}}>
                    {merging[day.day]?"Re-fusionando…":"↺ Re-fusionar"}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsersConfig() {
  const [users, setUsers] = React.useState([]);
  const [showModal, setShowModal] = React.useState(false);
  const [newUser, setNewUser] = React.useState({name:"", email:"", role:"Auditor", password:""});
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    window.API.get("/api/users").then(data => setUsers(Array.isArray(data) ? data : [])).catch(()=>{});
  }, []);

  function addUser() {
    if (!newUser.name || !newUser.email) return;
    setSaving(true);
    window.API.post("/api/users", newUser)
      .then(() => window.API.get("/api/users"))
      .then(data => { setUsers(Array.isArray(data)?data:[]); setShowModal(false); setNewUser({name:"",email:"",role:"Auditor",password:""}); })
      .catch(e => alert("Error: " + e))
      .finally(() => setSaving(false));
  }

  function toggleStatus(id, currentStatus) {
    const newStatus = currentStatus==="Active" ? "Inactive" : "Active";
    window.API.put(`/api/users/${id}`, {status: newStatus})
      .then(() => setUsers(prev => prev.map(u => u.id===id ? {...u, status:newStatus} : u)))
      .catch(()=>{});
  }

  return (
    <div>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20}}>
        <div style={{fontSize:13, color:"#8a9ab5"}}>{users.filter(u=>u.status==="Active").length} usuarios activos</div>
        <button onClick={() => setShowModal(true)} style={cfgStyles.saveBtn}>+ Agregar Usuario</button>
      </div>

      <table style={{width:"100%", borderCollapse:"collapse", fontSize:13}}>
        <thead>
          <tr style={{background:"#070c18"}}>
            {["Nombre","Correo","Rol","Estado","Último Acceso","Acciones"].map(h => (
              <th key={h} style={cfgStyles.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((u,i) => (
            <tr key={u.id} style={{background: i%2===0?"#0d1525":"#0b1020", borderBottom:"1px solid #1a1e2e"}}>
              <td style={cfgStyles.td}>
                <div style={{display:"flex", alignItems:"center", gap:10}}>
                  <div style={{
                    width:28, height:28, borderRadius:"50%", background:`${ROLE_COLORS[u.role]}20`,
                    border:`1px solid ${ROLE_COLORS[u.role]}40`, color:ROLE_COLORS[u.role],
                    fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center",
                  }}>{u.name.split(" ").map(w=>w[0]).join("").slice(0,2)}</div>
                  {u.name}
                </div>
              </td>
              <td style={{...cfgStyles.td, color:"#7a8aaa"}}>{u.email}</td>
              <td style={cfgStyles.td}>
                <span style={{
                  background:`${ROLE_COLORS[u.role]}15`, color:ROLE_COLORS[u.role],
                  fontSize:11, borderRadius:5, padding:"2px 8px", fontWeight:600,
                }}>{u.role}</span>
              </td>
              <td style={cfgStyles.td}>
                <span style={{
                  color: u.status==="Active"?"#22c97b":"#5b6a8a", fontSize:11,
                  display:"flex", alignItems:"center", gap:5,
                }}>
                  <span style={{width:6, height:6, borderRadius:"50%", background: u.status==="Active"?"#22c97b":"#5b6a8a", display:"inline-block"}}/>
                  {u.status}
                </span>
              </td>
              <td style={{...cfgStyles.td, color:"#5b6a8a", fontSize:11, fontFamily:"monospace"}}>{u.lastLogin}</td>
              <td style={cfgStyles.td}>
                <div style={{display:"flex", gap:6}}>
                  <button onClick={() => toggleStatus(u.id, u.status)} style={{...cfgStyles.actionBtn, color: u.status==="Active"?"#ff4c6a":"#22c97b", borderColor: u.status==="Active"?"rgba(255,76,106,0.3)":"rgba(34,201,123,0.3)"}}>
                    {u.status==="Active"?"Desactivar":"Activar"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Add User Modal */}
      {showModal && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100}}>
          <div style={{background:"#0d1525", border:"1px solid #2a3045", borderRadius:14, padding:32, width:400, boxShadow:"0 24px 80px rgba(0,0,0,0.6)"}}>
            <div style={{fontSize:16, fontWeight:700, color:"#e8edf5", marginBottom:20}}>Agregar Usuario</div>
            {[
              {label:"Nombre completo", key:"name", placeholder:"Ej. Juan López"},
              {label:"Correo electrónico", key:"email", placeholder:"juan@empresa.mx"},
              {label:"Contraseña temporal", key:"password", placeholder:"••••••••", masked:true},
            ].map(field => (
              <FormField key={field.key} label={field.label} value={newUser[field.key]}
                onChange={v => setNewUser(p=>({...p,[field.key]:v}))}
                placeholder={field.placeholder} masked={field.masked}/>
            ))}
            <div style={{marginBottom:20}}>
              <label style={cfgStyles.label}>Rol</label>
              <select value={newUser.role} onChange={e=>setNewUser(p=>({...p,role:e.target.value}))} style={cfgStyles.select}>
                <option>Admin</option><option>Auditor</option><option>Operator</option>
              </select>
            </div>
            <div style={{display:"flex", gap:10, justifyContent:"flex-end"}}>
              <button onClick={()=>setShowModal(false)} style={cfgStyles.actionBtn}>Cancelar</button>
              <button onClick={addUser} style={cfgStyles.saveBtn}>Crear Usuario</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Multi-fuente AVC ───

function SourceModal({ source, onSave, onClose }) {
  const isNew = !source.id;
  const [form, setForm] = React.useState(source.config || {});
  const [name, setName] = React.useState(source.name || "");
  const [type, setType] = React.useState(source.type || "database");
  const [saving, setSaving] = React.useState(false);
  const [testTimestamp, setTestTimestamp] = React.useState("");
  const [testingEvidence, setTestingEvidence] = React.useState(false);
  const [evidenceMessage, setEvidenceMessage] = React.useState("");
  const [evidenceResult, setEvidenceResult] = React.useState(null);
  const [evidenceLanes, setEvidenceLanes] = React.useState([]);
  const [evidenceLane, setEvidenceLane] = React.useState("");
  const [evidenceRequest, setEvidenceRequest] = React.useState(null);
  const [observedCameraTime, setObservedCameraTime] = React.useState("");

  const f = k => v => setForm(p => ({...p, [k]:v}));

  React.useEffect(()=>{
    if (!source.id) return;
    window.API.get(`/api/avc-source-evidence/lanes?source_id=${source.id}`)
      .then(data=>{
        const lanes = data.lanes||[];
        setEvidenceLanes(lanes);
        if (lanes.length) setEvidenceLane(lanes[0].lane_name);
      })
      .catch(()=>setEvidenceLanes([]));
  },[source.id]);

  function handleSave() {
    setSaving(true);
    const payload = { name, type, config: form };
    const req = isNew
      ? window.API.post("/api/sources", payload)
      : window.API.put(`/api/sources/${source.id}`, payload);
    req.then(()=>onSave()).catch(()=>{}).finally(()=>setSaving(false));
  }

  function setRelativeTimestamp(secondsAgo) {
    setTestTimestamp(String(Math.floor(Date.now()/1000) - secondsAgo));
    setEvidenceMessage("");
    setEvidenceResult(null);
    setEvidenceRequest(null);
    setObservedCameraTime("");
  }

  function timestampMillis(value) {
    const raw = String(value||"").trim();
    if (!/^\d{10,13}$/.test(raw)) return null;
    const millis = raw.length >= 13 ? Number(raw) : Number(raw)*1000;
    return Number.isFinite(millis) ? millis : null;
  }

  function timestampLabel(value) {
    const millis = timestampMillis(value);
    if (millis==null) return "";
    try {
      return new Date(millis).toLocaleString("es-MX", {
        timeZone:"America/Mexico_City",
        year:"numeric",month:"2-digit",day:"2-digit",
        hour:"2-digit",minute:"2-digit",second:"2-digit",
      });
    } catch(e) {
      return new Date(millis).toLocaleString();
    }
  }

  function timeOnlyLabel(value) {
    const millis = timestampMillis(value);
    if (millis==null) return "";
    return new Date(millis).toLocaleTimeString("es-MX", {
      timeZone:"America/Mexico_City",
      hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23",
    });
  }

  function observedDriftSeconds() {
    if (!evidenceRequest || !/^\d{1,2}:\d{2}:\d{2}$/.test(observedCameraTime.trim())) return null;
    const expectedMillis = timestampMillis(evidenceRequest.timestamp);
    if (expectedMillis==null) return null;
    const [hours,minutes,seconds] = observedCameraTime.trim().split(":").map(Number);
    if (hours>23 || minutes>59 || seconds>59) return null;
    const expectedTime = timeOnlyLabel(evidenceRequest.timestamp).split(":").map(Number);
    let drift = (hours*3600+minutes*60+seconds) -
      (expectedTime[0]*3600+expectedTime[1]*60+expectedTime[2]);
    if (drift > 43200) drift -= 86400;
    if (drift < -43200) drift += 86400;
    return drift;
  }

  function testEvidence() {
    const requestTimestamp = String(testTimestamp||"").trim();
    const lane = evidenceLanes.find(item=>item.lane_name===evidenceLane);
    setTestingEvidence(true); setEvidenceMessage(""); setEvidenceResult(null);
    setEvidenceRequest(null); setObservedCameraTime("");
    window.API.post("/api/avc-source-evidence/test", {
      source_id:source.id||null,
      config:form,
      lane_name:evidenceLane,
      timestamp:requestTimestamp,
    })
      .then(data=>{
        setEvidenceRequest({
          timestamp:requestTimestamp,
          lane_name:evidenceLane,
          device_id:(lane&&lane.device_id)||data.device_id||"",
        });
        setEvidenceResult(data);
        setEvidenceMessage(data.photo_available
          ? "Conexión correcta y fotografía recuperada"
          : "Conexión correcta; no hay fotografía para ese momento");
      })
      .catch(error=>setEvidenceMessage(`Error: ${error.message||error}`))
      .finally(()=>setTestingEvidence(false));
  }

  const selectedTimestampLabel = timestampLabel(testTimestamp);
  const evidenceSuccess = evidenceMessage && !evidenceMessage.startsWith("Error");
  const observedDrift = observedDriftSeconds();

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
      <div style={{background:"#0d1525",border:"1px solid #2a3045",borderRadius:14,padding:32,width:520,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 24px 80px rgba(0,0,0,0.7)"}}>
        <div style={{fontSize:16,fontWeight:700,color:"#e8edf5",marginBottom:20}}>{isNew?"Nueva Fuente AVC":"Editar Fuente AVC"}</div>

        <FormField label="Nombre" value={name} onChange={setName} placeholder="Ej. Plaza Texcoco — AVC"/>
        <div style={{marginBottom:18}}>
          <label style={cfgStyles.label}>Tipo de integración</label>
          <div style={{display:"flex",gap:8}}>
            {[{id:"database",icon:"🗄️",label:"Base de Datos + SSH"},{id:"api",icon:"🔌",label:"Alice API REST"}].map(t=>(
              <button key={t.id} onClick={()=>setType(t.id)} style={{
                flex:1,background:type===t.id?"rgba(77,127,224,0.15)":"#162036",
                color:type===t.id?"#4d7fe0":"#7a8aaa",
                border:`1px solid ${type===t.id?"#4d7fe0":"#1c2b46"}`,
                borderRadius:8,padding:"10px 8px",fontSize:12,cursor:"pointer",fontFamily:"inherit",
              }}>{t.icon} {t.label}</button>
            ))}
          </div>
        </div>

        {type==="database" && (<>
          <div style={{fontSize:11,color:"#5b6a8a",marginBottom:16,padding:"8px 12px",background:"#080d1a",borderRadius:6}}>Conexión PostgreSQL via túnel SSH (igual que la app anterior)</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 20px"}}>
            <FormField label="SSH Host"     value={form.ssh_host||""}     onChange={f("ssh_host")}     placeholder="10.10.0.1"/>
            <FormField label="SSH Port"     value={form.ssh_port||"22"}   onChange={f("ssh_port")}     placeholder="22"/>
            <FormField label="SSH User"     value={form.ssh_user||""}     onChange={f("ssh_user")}     placeholder="ubuntu"/>
            <FormField label="SSH Password" value={form.ssh_password||""} onChange={f("ssh_password")} masked placeholder="••••••••"/>
            <FormField label="PG Host"      value={form.postgres_host||"127.0.0.1"} onChange={f("postgres_host")} placeholder="127.0.0.1"/>
            <FormField label="PG Port"      value={form.postgres_port||"5432"}      onChange={f("postgres_port")} placeholder="5432"/>
            <FormField label="Database"     value={form.postgres_database||""}      onChange={f("postgres_database")} placeholder="alice_guardian"/>
            <FormField label="PG User"      value={form.postgres_user||"postgres"}  onChange={f("postgres_user")}/>
            <FormField label="PG Password"  value={form.postgres_password||""}      onChange={f("postgres_password")} masked/>
            <FormField label="Media Root"   value={form.media_root||"/opt/alice-media"} onChange={f("media_root")} hint="Ruta SSH para imágenes"/>
          </div>
        </>)}

        {type==="api" && (<>
          <div style={{fontSize:11,color:"#5b6a8a",marginBottom:16,padding:"8px 12px",background:"#080d1a",borderRadius:6}}>Conexión directa a Alice Guardian REST API</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 20px"}}>
            <FormField label="API Base URL"  value={form.api_url||""}  onChange={f("api_url")}  placeholder="https://alice-server:8080"/>
            <div style={{marginBottom:18}}>
              <label style={cfgStyles.label}>Tipo de Auth</label>
              <select value={form.auth_type||"bearer"} onChange={e=>f("auth_type")(e.target.value)} style={cfgStyles.select}>
                <option value="bearer">Bearer Token</option>
                <option value="api-key">API Key (X-API-Key)</option>
                <option value="basic">Basic Auth</option>
              </select>
            </div>
            {(form.auth_type||"bearer")!=="basic"
              ? <FormField label="API Key / Token" value={form.api_key||""} onChange={f("api_key")} masked placeholder="sk-alice-…"/>
              : (<><FormField label="Usuario" value={form.api_user||""} onChange={f("api_user")}/><FormField label="Contraseña" value={form.api_password||""} onChange={f("api_password")} masked/></>)
            }
            <FormField label="Endpoint eventos" value={form.events_path||"/api/v1/events"} onChange={f("events_path")} hint="Path relativo del API"/>
            <FormField label="Media URL"         value={form.media_url||""}                 onChange={f("media_url")}   hint="URL base para imágenes" placeholder="https://media-server/axle/"/>
            <FormField label="Parámetro fecha inicio" value={form.date_param||"from"}   onChange={f("date_param")}/>
            <FormField label="Parámetro fecha fin"    value={form.date_end_param||"to"} onChange={f("date_end_param")}/>
          </div>
          <div style={{fontSize:11,color:"#5b6a8a",marginTop:4,marginBottom:18}}>
            Mapeo de campos de respuesta (dejar vacío para usar nombres por defecto):
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 20px"}}>
            <FormField label="Campo ID"        value={form.field_id||""}    onChange={f("field_id")}    placeholder="id"/>
            <FormField label="Campo carril"    value={form.field_lane||""}  onChange={f("field_lane")}  placeholder="lane_name"/>
            <FormField label="Campo tipo veh." value={form.field_type||""}  onChange={f("field_type")}  placeholder="vehicle_type"/>
            <FormField label="Campo ejes"      value={form.field_axles||""} onChange={f("field_axles")} placeholder="axle_count"/>
            <FormField label="Campo timestamp" value={form.field_timestamp||""} onChange={f("field_timestamp")} placeholder="created_at"/>
            <FormField label="Clave array JSON" value={form.events_key||""}  onChange={f("events_key")}  placeholder="data (vacío=raíz)"/>
          </div>
        </>)}

        <div style={{borderTop:"1px solid #2a3045",marginTop:8,paddingTop:20}}>
          <div style={{fontSize:13,fontWeight:700,color:"#e8edf5",marginBottom:5}}>Evidencia AVC / NVR</div>
          <div style={{fontSize:11,color:"#5b6a8a",lineHeight:1.45,marginBottom:16}}>
            Configuración propia de este AVC para solicitar fotografías por dispositivo y timestamp.
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 20px"}}>
            <FormField label="URL base Alice Guardian" value={form.evidence_base_url||""}
              onChange={f("evidence_base_url")} placeholder="http://host:9090"/>
            <FormField label="Client ID" value={form.evidence_client_id||""}
              onChange={f("evidence_client_id")} placeholder="Cliente autorizado"/>
            <FormField label="API key / Bearer token" value={form.evidence_api_key||""}
              onChange={f("evidence_api_key")} masked placeholder="Token de integración"/>
            <FormField label="Timeout (segundos)" type="number" value={form.evidence_timeout_seconds||"20"}
              onChange={f("evidence_timeout_seconds")} placeholder="20"/>
            <div style={{paddingTop:22}}>
              <Toggle checked={form.evidence_verify_ssl!==false}
                onChange={f("evidence_verify_ssl")} label="Verificar certificado SSL"/>
            </div>
          </div>

          <div style={{background:"#080d1a",border:"1px solid #1e2535",borderRadius:7,padding:"14px 16px",marginBottom:18}}>
            <div style={{fontSize:12,fontWeight:700,color:"#c8d4e8",marginBottom:12}}>Prueba de snapshot</div>
            <div style={{marginBottom:18}}>
              <label style={cfgStyles.label}>Carril AVC para prueba</label>
              {evidenceLanes.length ? (
                <select value={evidenceLane} onChange={e=>setEvidenceLane(e.target.value)} style={cfgStyles.select}>
                  {evidenceLanes.map(item=>(
                    <option key={item.lane_name} value={item.lane_name}>
                      {item.lane_name}{item.sat_lane?` → ${item.sat_lane}`:""} · {item.device_id}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{fontSize:11,color:"#ff7e3f",padding:"9px 10px",border:"1px solid rgba(255,126,63,0.25)",borderRadius:6}}>
                  {source.id
                    ? "Esta fuente todavía no tiene carriles con UUID sincronizados."
                    : "Guarda y sincroniza primero la fuente para descubrir sus carriles y UUID."}
                </div>
              )}
            </div>
            <FormField label="Timestamp Unix" value={testTimestamp} onChange={setTestTimestamp}
              placeholder="Segundos o milisegundos"/>
            {selectedTimestampLabel && (
              <div style={{fontSize:11,color:"#5b9cf6",marginTop:-12,marginBottom:14}}>
                {selectedTimestampLabel} · America/Mexico_City
              </div>
            )}
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
              {[
                {label:"Hace 20 segundos",seconds:20},
                {label:"Hace 30 minutos",seconds:30*60},
                {label:"Hace 1 hora",seconds:60*60},
                {label:"Hace 3 horas",seconds:3*60*60},
              ].map(option=>(
                <button key={option.seconds} onClick={()=>setRelativeTimestamp(option.seconds)}
                  style={{...cfgStyles.actionBtn,padding:"6px 10px"}}>
                  {option.label}
                </button>
              ))}
              <button onClick={testEvidence} disabled={testingEvidence||!evidenceLane}
                style={{...cfgStyles.actionBtn,marginLeft:"auto",padding:"6px 12px",color:"#5b9cf6",borderColor:"rgba(91,156,246,0.4)",opacity:testingEvidence?0.65:1}}>
                {testingEvidence?"Solicitando…":"Probar snapshot"}
              </button>
            </div>
            {evidenceMessage && (
              <div style={{fontSize:11,color:evidenceSuccess?"#22c97b":"#ff4c6a",marginBottom:evidenceResult?12:0}}>
                {evidenceMessage}
              </div>
            )}
            {evidenceResult && (
              <div>
                {evidenceRequest && (
                  <div style={{background:"#101a2d",border:"1px solid rgba(91,156,246,0.35)",borderRadius:7,padding:"12px 14px",marginBottom:10}}>
                    <div style={{fontSize:10,fontWeight:700,color:"#7f91af",textTransform:"uppercase",marginBottom:5}}>
                      Hora esperada en el OSD de la cámara
                    </div>
                    <div style={{fontSize:24,fontWeight:800,color:"#f3f7ff",lineHeight:1.1}}>
                      {timeOnlyLabel(evidenceRequest.timestamp)}
                    </div>
                    <div style={{fontSize:12,color:"#9db4d8",marginTop:5}}>
                      {timestampLabel(evidenceRequest.timestamp)} · America/Mexico_City
                    </div>
                    <div style={{fontSize:10,color:"#667998",marginTop:7,fontFamily:"monospace",wordBreak:"break-all"}}>
                      Unix enviado: {evidenceRequest.timestamp}
                      {evidenceResult.unix_timestamp!=null?` · Alice confirmó: ${evidenceResult.unix_timestamp}`:""}
                    </div>
                  </div>
                )}
                {evidenceResult.preview_data_url && (
                  <div style={{position:"relative",background:"#050914",border:"1px solid #1e2535",borderRadius:6,overflow:"hidden",marginBottom:10}}>
                    <img src={evidenceResult.preview_data_url} alt="Snapshot AVC"
                      style={{display:"block",width:"100%",maxHeight:320,objectFit:"contain"}}/>
                    <div style={{position:"absolute",left:8,bottom:8,background:"rgba(5,9,20,0.88)",border:"1px solid rgba(255,255,255,0.25)",borderRadius:5,padding:"6px 9px",color:"#fff",fontSize:12,fontWeight:800}}>
                      Solicitado: {timeOnlyLabel(evidenceRequest&&evidenceRequest.timestamp)}
                    </div>
                  </div>
                )}
                {evidenceResult.preview_data_url && evidenceRequest && (
                  <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,alignItems:"end",marginBottom:10}}>
                    <div>
                      <label style={cfgStyles.label}>Hora visible en la esquina de la foto</label>
                      <input value={observedCameraTime} onChange={e=>setObservedCameraTime(e.target.value)}
                        placeholder="HH:MM:SS" maxLength={8}
                        style={{...cfgStyles.input,fontFamily:"monospace",fontSize:14}}/>
                    </div>
                    <div style={{
                      minWidth:105,padding:"9px 10px",borderRadius:6,textAlign:"center",
                      background:observedDrift==null?"#121b2d":Math.abs(observedDrift)<=1?"rgba(34,201,123,0.12)":"rgba(255,76,106,0.12)",
                      border:`1px solid ${observedDrift==null?"#26334a":Math.abs(observedDrift)<=1?"rgba(34,201,123,0.4)":"rgba(255,76,106,0.4)"}`,
                    }}>
                      <div style={{fontSize:9,color:"#7788a6",textTransform:"uppercase"}}>Desfase OSD</div>
                      <div style={{fontSize:18,fontWeight:800,color:observedDrift==null?"#8a9ab5":Math.abs(observedDrift)<=1?"#22c97b":"#ff4c6a"}}>
                        {observedDrift==null?"—":`${observedDrift>0?"+":""}${observedDrift}s`}
                      </div>
                    </div>
                  </div>
                )}
                <div style={{fontSize:11,color:"#8a9ab5",lineHeight:1.6}}>
                  {evidenceResult.camera_name||"Cámara sin nombre"} · Foto {evidenceResult.photo_available?"disponible":"no disponible"}
                  {evidenceResult.expires_in_seconds!=null?` · Expira en ${evidenceResult.expires_in_seconds}s`:""}
                </div>
                {evidenceResult.preview_error && <div style={{fontSize:11,color:"#ff7e3f",marginTop:5}}>{evidenceResult.preview_error}</div>}
              </div>
            )}
          </div>
        </div>

        <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:8}}>
          <button onClick={onClose} style={cfgStyles.actionBtn}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{...cfgStyles.saveBtn,opacity:saving?0.7:1}}>
            {saving?"Guardando…":"Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}


function SistemaConfig() {
  const MEXICO_TZS = [
    {value:"America/Mexico_City", label:"Centro — CDMX, Jalisco, NL (UTC−6/−5)"},
    {value:"America/Monterrey",   label:"Monterrey (UTC−6/−5)"},
    {value:"America/Cancun",      label:"Sureste — Cancún (UTC−5, sin horario de verano)"},
    {value:"America/Chihuahua",   label:"Chihuahua / La Paz (UTC−7/−6)"},
    {value:"America/Hermosillo",  label:"Sonora (UTC−7, sin horario de verano)"},
    {value:"America/Mazatlan",    label:"Pacífico — Sinaloa (UTC−7/−6)"},
    {value:"America/Tijuana",     label:"Noroeste — Tijuana (UTC−8/−7)"},
    {value:"UTC",                 label:"UTC (Coordinated Universal Time)"},
  ];

  const [timezone,    setTimezone]    = React.useState("America/Mexico_City");
  const [uiLanguage,  setUiLanguage]  = React.useState(window.getUILanguage ? window.getUILanguage() : "es");
  const [laneMapping, setLaneMapping] = React.useState({});
  const [avcLanes,    setAvcLanes]    = React.useState([]);   // todos los carriles AVC conocidos
  const [satVoies,    setSatVoies]    = React.useState([]);   // todos los voies SAT de MERGED
  const [loaded,      setLoaded]      = React.useState(false);
  const [saving,      setSaving]      = React.useState(false);
  const [saveMsg,     setSaveMsg]     = React.useState("");
  // Fila nueva para agregar mapeo manual
  const [newAvc,      setNewAvc]      = React.useState("");
  const [newSat,      setNewSat]      = React.useState("");

  React.useEffect(()=>{
    // 1. Config guardada (timezone + lane_mapping)
    window.API.get("/api/config").then(cfg=>{
      if (cfg.timezone) setTimezone(cfg.timezone);
      if (cfg.ui_language) {
        setUiLanguage(cfg.ui_language);
        localStorage.setItem("agm_ui_language", cfg.ui_language);
      }
      try {
        const m = cfg.lane_mapping
          ? (typeof cfg.lane_mapping==="string" ? JSON.parse(cfg.lane_mapping) : cfg.lane_mapping)
          : {};
        setLaneMapping(m||{});
      } catch(e) { setLaneMapping({}); }
    }).catch(()=>{}).finally(()=>setLoaded(true));

    // 2. Carriles AVC de CUALQUIER fecha (no solo hoy)
    window.API.get("/api/avc/lanes").then(d=>{
      if (d.lanes && d.lanes.length>0) setAvcLanes(d.lanes);
    }).catch(()=>{});

    // 3. Voies SAT de todos los archivos MERGED
    window.API.get("/api/sat/voies").then(d=>{
      if (d.voies) setSatVoies(d.voies);
    }).catch(()=>{});
  },[]);

  // Filas a mostrar = unión de carriles AVC conocidos + claves del mapeo guardado
  const displayLanes = React.useMemo(()=>{
    const allKeys = new Set([...avcLanes, ...Object.keys(laneMapping)]);
    return [...allKeys].sort();
  }, [avcLanes, laneMapping]);

  function setMap(avcLane, satVoie) {
    setLaneMapping(p=>({...p, [avcLane]: satVoie}));
  }

  function removeRow(avcLane) {
    setLaneMapping(p=>{ const n={...p}; delete n[avcLane]; return n; });
  }

  function addRow() {
    const key = newAvc.trim();
    if (!key) return;
    setLaneMapping(p=>({...p, [key]: newSat.trim()}));
    setNewAvc(""); setNewSat("");
  }

  function save() {
    setSaving(true); setSaveMsg("");
    // Limpiar entradas vacías antes de guardar
    const cleanMapping = Object.fromEntries(
      Object.entries(laneMapping).filter(([k,v])=>k.trim())
    );
    window.API.get("/api/config")
      .then(cfg=>window.API.post("/api/config",{
        ...cfg, timezone, ui_language: uiLanguage,
        lane_mapping: JSON.stringify(cleanMapping),
      }))
      .then(()=>{
        localStorage.setItem("agm_ui_language", uiLanguage);
        window.dispatchEvent(new CustomEvent("agm-language-change", {detail:{language:uiLanguage}}));
        setSaveMsg("✓ Guardado"); setTimeout(()=>setSaveMsg(""),3000);
      })
      .catch(()=>setSaveMsg("Error al guardar"))
      .finally(()=>setSaving(false));
  }

  const VOI_INPUT = (avcLane) => satVoies.length>0 ? (
    <select value={laneMapping[avcLane]||""} onChange={e=>setMap(avcLane,e.target.value)}
      style={{...cfgStyles.select,padding:"7px 10px",
        borderColor:laneMapping[avcLane]?"rgba(77,127,224,0.5)":"#1c2b46",
        color:laneMapping[avcLane]?"#4d7fe0":"#7a8aaa"}}>
      <option value="">— Sin asignar —</option>
      {satVoies.map(v=><option key={v} value={v}>{v}</option>)}
    </select>
  ) : (
    <input value={laneMapping[avcLane]||""} onChange={e=>setMap(avcLane,e.target.value)}
      placeholder="Ej: 1, 02, VOIE9…"
      style={{...cfgStyles.input,padding:"7px 10px",
        borderColor:laneMapping[avcLane]?"rgba(77,127,224,0.5)":"#1c2b46",
        color:laneMapping[avcLane]?"#4d7fe0":"#e8edf5"}}/>
  );

  return (
    <div>
      {/* ── Zona horaria ── */}
      <div style={{background:"#080d1a",border:"1px solid #1e2535",borderRadius:10,padding:"16px 20px",marginBottom:20}}>
        <div style={{fontSize:13,fontWeight:600,color:"#e8edf5",marginBottom:6}}>Zona Horaria del Sistema</div>
        <div style={{fontSize:12,color:"#5b6a8a",marginBottom:14}}>
          Todos los timestamps AVC y SAT se normalizarán a esta zona horaria para comparación y visualización.
        </div>
        <div style={{maxWidth:440}}>
          <label style={cfgStyles.label}>Zona horaria</label>
          <select value={timezone} onChange={e=>setTimezone(e.target.value)} style={cfgStyles.select}>
            {MEXICO_TZS.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div style={{marginTop:8,fontSize:11,color:"#243358",fontFamily:"monospace"}}>{timezone}</div>
      </div>

      {/* ── Mapeo de carriles ── */}
      <div style={{background:"#080d1a",border:"1px solid #1e2535",borderRadius:10,padding:"16px 20px",marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
          <div style={{fontSize:13,fontWeight:600,color:"#e8edf5"}}>Mapeo de Carriles AVC ↔ SAT</div>
          {satVoies.length===0 && (
            <span style={{fontSize:10,color:"#5b6a8a",background:"#0d1525",padding:"3px 8px",borderRadius:4}}>
              💡 Escribe el voie SAT manualmente
            </span>
          )}
        </div>
        <div style={{fontSize:12,color:"#5b6a8a",marginBottom:16}}>
          Asocia cada carril AVC con su voie SAT correspondiente.
          Se aplica automáticamente al abrir un carril para conciliar.
        </div>

        {/* Cabecera */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 28px 1fr 32px",gap:8,
          padding:"6px 12px",background:"#0d1525",borderRadius:6,marginBottom:8,
          fontSize:10,color:"#5b6a8a",fontWeight:600,letterSpacing:0.5,textTransform:"uppercase"}}>
          <span>Carril AVC</span><span/><span>Voie SAT</span><span/>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {/* Filas existentes */}
          {displayLanes.map(avcLane=>(
            <div key={avcLane} style={{display:"grid",gridTemplateColumns:"1fr 28px 1fr 32px",gap:8,
              alignItems:"center",background:"#0d1525",borderRadius:8,padding:"8px 12px",
              border:`1px solid ${laneMapping[avcLane]?"rgba(77,127,224,0.25)":"#162036"}`}}>
              {/* AVC */}
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:6,height:6,borderRadius:"50%",flexShrink:0,
                  background:laneMapping[avcLane]?"#4d7fe0":"#243358"}}/>
                <span style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:"#e8edf5",wordBreak:"break-all"}}>
                  {avcLane}
                </span>
                {!avcLanes.includes(avcLane) && (
                  <span style={{fontSize:9,color:"#5b6a8a",background:"#080d1a",padding:"1px 5px",borderRadius:3}}>manual</span>
                )}
              </div>
              {/* Flecha */}
              <div style={{textAlign:"center",color:"#5b6a8a",fontWeight:700}}>→</div>
              {/* SAT voie */}
              {VOI_INPUT(avcLane)}
              {/* Eliminar */}
              <button onClick={()=>removeRow(avcLane)}
                style={{background:"none",border:"none",color:"#5b6a8a",cursor:"pointer",fontSize:16,lineHeight:1,padding:0,
                  display:"flex",alignItems:"center",justifyContent:"center"}}
                title="Eliminar mapeo">×</button>
            </div>
          ))}

          {/* Fila para agregar nuevo */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 28px 1fr 32px",gap:8,
            alignItems:"center",background:"rgba(77,127,224,0.04)",borderRadius:8,padding:"8px 12px",
            border:"1px dashed rgba(77,127,224,0.2)",marginTop:4}}>
            <input value={newAvc} onChange={e=>setNewAvc(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter") addRow(); }}
              placeholder="Carril AVC (ej: Axle-Carril9)"
              style={{...cfgStyles.input,padding:"7px 10px",fontSize:12}}/>
            <div style={{textAlign:"center",color:"#5b6a8a",fontWeight:700}}>→</div>
            {satVoies.length>0 ? (
              <select value={newSat} onChange={e=>setNewSat(e.target.value)} style={{...cfgStyles.select,padding:"7px 10px"}}>
                <option value="">— Seleccionar voie —</option>
                {satVoies.map(v=><option key={v} value={v}>{v}</option>)}
              </select>
            ) : (
              <input value={newSat} onChange={e=>setNewSat(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter") addRow(); }}
                placeholder="Voie SAT (ej: 9)"
                style={{...cfgStyles.input,padding:"7px 10px",fontSize:12}}/>
            )}
            <button onClick={addRow} disabled={!newAvc.trim()}
              style={{...cfgStyles.saveBtn,padding:"7px 10px",fontSize:16,lineHeight:1,
                opacity:newAvc.trim()?1:0.4}}>+</button>
          </div>

          {displayLanes.length===0 && !loaded && (
            <div style={{textAlign:"center",padding:"16px 0",color:"#5b6a8a",fontSize:12}}>Cargando…</div>
          )}
          {displayLanes.length===0 && loaded && (
            <div style={{padding:"8px 0",fontSize:12,color:"#5b6a8a"}}>
              No hay carriles AVC sincronizados aún. Usa la fila de arriba para agregar el mapeo manualmente.
            </div>
          )}
        </div>
      </div>

      {/* ── Botón guardar ── */}
      <div style={{display:"flex",gap:12,alignItems:"center"}}>
        <button onClick={save} disabled={saving} style={{...cfgStyles.saveBtn,opacity:saving?0.7:1}}>
          {saving?"Guardando…":"Guardar configuración del sistema"}
        </button>
        {saveMsg && <span style={{fontSize:12,color:saveMsg.startsWith("✓")?"#22c97b":"#ff4c6a"}}>{saveMsg}</span>}
      </div>
    </div>
  );
}

function ReportEmailSettings() {
  const emptySettings = {
    smtp: {host:"", port:587, security:"TLS", username:"", password:"", from_email:"", from_name:"AG-metrics"},
    recipients: [],
    schedule: {daily_enabled:false, daily_time:"07:00", weekly_enabled:false, weekly_day:"monday", weekly_time:"07:00", timezone:"America/Mexico_City"},
  };
  const [settings, setSettings] = React.useState(emptySettings);
  const [users, setUsers] = React.useState([]);
  const [newRecipient, setNewRecipient] = React.useState({email:"", name:"", report_types:["daily"], enabled:true});
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const [testTo, setTestTo] = React.useState("");
  const [sending, setSending] = React.useState("");

  React.useEffect(() => {
    window.API.get("/api/report-email/settings").then(d => setSettings({...emptySettings, ...d, smtp:{...emptySettings.smtp, ...(d.smtp||{})}, schedule:{...emptySettings.schedule, ...(d.schedule||{})}})).catch(()=>{});
    window.API.get("/api/users").then(d => setUsers(Array.isArray(d)?d:[])).catch(()=>{});
  }, []);

  const setSmtp = (k,v) => setSettings(p=>({...p, smtp:{...p.smtp, [k]:v}}));
  const setSchedule = (k,v) => setSettings(p=>({...p, schedule:{...p.schedule, [k]:v}}));

  function toggleType(rec, type) {
    const current = rec.report_types || [];
    return current.includes(type) ? current.filter(t=>t!==type) : [...current, type];
  }

  function addRecipient() {
    const email = newRecipient.email.trim();
    if (!email) return;
    setSettings(p=>({...p, recipients:[...(p.recipients||[]), {...newRecipient, email}]}));
    setNewRecipient({email:"", name:"", report_types:["daily"], enabled:true});
  }

  function updateRecipient(idx, patch) {
    setSettings(p=>({...p, recipients:(p.recipients||[]).map((r,i)=>i===idx?{...r,...patch}:r)}));
  }

  function removeRecipient(idx) {
    setSettings(p=>({...p, recipients:(p.recipients||[]).filter((_,i)=>i!==idx)}));
  }

  function save() {
    setSaving(true); setMsg("");
    window.API.post("/api/report-email/settings", settings)
      .then(()=>{ setMsg("Guardado"); setTimeout(()=>setMsg(""),2500); })
      .catch(e=>setMsg(e.message||"Error al guardar"))
      .finally(()=>setSaving(false));
  }

  function sendTest() {
    const email = testTo.trim();
    if (!email) { setMsg("Escribe un correo de destino"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setMsg("Correo inválido: " + email); return; }
    setSending("test"); setMsg("");
    const clientTimeout = new Promise((_,rej) =>
      setTimeout(() => rej(new Error("Sin respuesta del servidor (25s) — revisa tu SMTP")), 25000)
    );
    Promise.race([window.API.post("/api/report-email/test", {to: email}), clientTimeout])
      .then(r => setMsg("✓ Correo enviado a " + r.sent_to))
      .catch(e => setMsg(e.message || "Error enviando prueba"))
      .finally(() => setSending(""));
  }

  function sendNow(type) {
    setSending(type); setMsg("");
    window.API.post("/api/report-email/send-now", {report_type:type})
      .then(r=>setMsg(`Reporte ${type} enviado a ${r.sent} destinatario(s)`))
      .catch(e=>setMsg(e.message||"Error enviando reporte"))
      .finally(()=>setSending(""));
  }

  const reportTypes = [
    {id:"daily", label:"Diario"},
    {id:"weekly", label:"Semanal"},
    {id:"monthly", label:"Mensual"},
    {id:"critical", label:"Alarmas críticas"},
  ];
  const weekDays = [
    ["monday","Lunes"],["tuesday","Martes"],["wednesday","Miércoles"],["thursday","Jueves"],
    ["friday","Viernes"],["saturday","Sábado"],["sunday","Domingo"],
  ];

  return (
    <div>
      <div style={{background:"#080d1a",border:"1px solid #1e2535",borderRadius:10,padding:"16px 20px",marginBottom:20}}>
        <div style={{fontSize:13,fontWeight:700,color:"#e8edf5",marginBottom:14}}>SMTP</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 120px 150px",gap:"0 14px"}}>
          <FormField label="SMTP host" value={settings.smtp.host||""} onChange={v=>setSmtp("host",v)} placeholder="smtp.empresa.com"/>
          <FormField label="SMTP port" type="number" value={settings.smtp.port||""} onChange={v=>setSmtp("port",v)} placeholder="587"/>
          <div style={{marginBottom:18}}>
            <label style={cfgStyles.label}>Seguridad</label>
            <select value={settings.smtp.security||"TLS"} onChange={e=>setSmtp("security",e.target.value)} style={cfgStyles.select}>
              <option value="TLS">TLS</option><option value="SSL">SSL</option><option value="None">None</option>
          </select>
        </div>
      </div>

      <div style={{background:"#080d1a",border:"1px solid #1e2535",borderRadius:10,padding:"16px 20px",marginBottom:20}}>
        <div style={{fontSize:13,fontWeight:600,color:"#e8edf5",marginBottom:6}}>Idioma de la plataforma / Platform language</div>
        <div style={{fontSize:12,color:"#5b6a8a",marginBottom:14}}>
          Cambia las etiquetas principales de la plataforma entre español e inglés. No modifica datos, reportes ni lógica del sistema.
        </div>
        <div style={{maxWidth:300}}>
          <label style={cfgStyles.label}>Idioma / Language</label>
          <select value={uiLanguage} onChange={e=>setUiLanguage(e.target.value)} style={cfgStyles.select}>
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
          <FormField label="SMTP username" value={settings.smtp.username||""} onChange={v=>setSmtp("username",v)}/>
          <FormField label="SMTP password" value={settings.smtp.password||""} onChange={v=>setSmtp("password",v)} masked/>
          <FormField label="From email" value={settings.smtp.from_email||""} onChange={v=>setSmtp("from_email",v)} placeholder="reportes@empresa.com"/>
          <FormField label="From name" value={settings.smtp.from_name||""} onChange={v=>setSmtp("from_name",v)} placeholder="AG-metrics Reportes"/>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"flex-end",flexWrap:"wrap"}}>
          <div style={{width:280}}>
            <FormField label="Destinatario prueba" value={testTo} onChange={setTestTo} placeholder="correo@empresa.com"/>
          </div>
          <button onClick={sendTest} disabled={sending==="test"} style={{...cfgStyles.actionBtn,marginBottom:18,color:"#5b9cf6",borderColor:"rgba(91,156,246,0.35)"}}>
            {sending==="test"?"Enviando...":"Send Test Email"}
          </button>
        </div>
      </div>

      <div style={{background:"#080d1a",border:"1px solid #1e2535",borderRadius:10,padding:"16px 20px",marginBottom:20}}>
        <div style={{fontSize:13,fontWeight:700,color:"#e8edf5",marginBottom:14}}>Destinatarios</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <input value={newRecipient.name} onChange={e=>setNewRecipient(p=>({...p,name:e.target.value}))} placeholder="Nombre" style={cfgStyles.input}/>
          <input value={newRecipient.email} onChange={e=>setNewRecipient(p=>({...p,email:e.target.value}))} placeholder="correo@empresa.com" style={cfgStyles.input}/>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
          {users.map(u=>(
            <button key={u.id} onClick={()=>setNewRecipient(p=>({...p,email:u.email,name:u.name}))} style={cfgStyles.chipBtn}>{u.email}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:14}}>
          {reportTypes.map(t=>(
            <label key={t.id} style={{display:"flex",gap:6,alignItems:"center",fontSize:12,color:"#c8d4e8"}}>
              <input type="checkbox" checked={(newRecipient.report_types||[]).includes(t.id)}
                onChange={()=>setNewRecipient(p=>({...p,report_types:toggleType(p,t.id)}))}/>
              {t.label}
            </label>
          ))}
          <button onClick={addRecipient} style={cfgStyles.saveBtn}>Agregar destinatario</button>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {(settings.recipients||[]).map((r,idx)=>(
            <div key={`${r.email}-${idx}`} style={{display:"grid",gridTemplateColumns:"1.2fr 1.4fr 90px 32px",gap:8,alignItems:"center",background:"#0d1525",border:"1px solid #1e2535",borderRadius:8,padding:"9px 12px"}}>
              <div>
                <div style={{fontSize:13,color:"#e8edf5",fontWeight:600}}>{r.name||r.email}</div>
                <div style={{fontSize:11,color:"#5b6a8a"}}>{r.email}</div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {reportTypes.map(t=>(
                  <label key={t.id} style={{display:"flex",gap:4,alignItems:"center",fontSize:11,color:"#8a9ab5"}}>
                    <input type="checkbox" checked={(r.report_types||[]).includes(t.id)}
                      onChange={()=>updateRecipient(idx,{report_types:toggleType(r,t.id)})}/>
                    {t.label}
                  </label>
                ))}
              </div>
              <Toggle checked={r.enabled!==false} onChange={v=>updateRecipient(idx,{enabled:v})}/>
              <button onClick={()=>removeRecipient(idx)} style={{...cfgStyles.actionBtn,padding:"4px 8px",color:"#ff4c6a"}}>×</button>
            </div>
          ))}
        </div>
      </div>

      <div style={{background:"#080d1a",border:"1px solid #1e2535",borderRadius:10,padding:"16px 20px",marginBottom:20}}>
        <div style={{fontSize:13,fontWeight:700,color:"#e8edf5",marginBottom:14}}>Programación</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
          <div style={cfgStyles.scheduleBox}>
            <Toggle checked={!!settings.schedule.daily_enabled} onChange={v=>setSchedule("daily_enabled",v)} label="Reporte diario"/>
            <FormField label="Hora diaria" type="time" value={settings.schedule.daily_time||"07:00"} onChange={v=>setSchedule("daily_time",v)}/>
          </div>
          <div style={cfgStyles.scheduleBox}>
            <Toggle checked={!!settings.schedule.weekly_enabled} onChange={v=>setSchedule("weekly_enabled",v)} label="Reporte semanal"/>
            <div style={{marginBottom:18}}>
              <label style={cfgStyles.label}>Día de semana</label>
              <select value={settings.schedule.weekly_day||"monday"} onChange={e=>setSchedule("weekly_day",e.target.value)} style={cfgStyles.select}>
                {weekDays.map(([id,label])=><option key={id} value={id}>{label}</option>)}
              </select>
            </div>
            <FormField label="Hora semanal" type="time" value={settings.schedule.weekly_time||"07:00"} onChange={v=>setSchedule("weekly_time",v)}/>
          </div>
          <div style={cfgStyles.scheduleBox}>
            <FormField label="Timezone" value={settings.schedule.timezone||"America/Mexico_City"} onChange={v=>setSchedule("timezone",v)}/>
            <button onClick={()=>sendNow("daily")} disabled={!!sending} style={{...cfgStyles.saveBtn,width:"100%",marginBottom:8}}>
              {sending==="daily"?"Enviando...":"Generate Report Now"}
            </button>
            <button onClick={()=>sendNow("weekly")} disabled={!!sending} style={{...cfgStyles.actionBtn,width:"100%",color:"#5b9cf6",borderColor:"rgba(91,156,246,0.35)"}}>
              Enviar semanal ahora
            </button>
            <button onClick={()=>sendNow("monthly")} disabled={!!sending} style={{...cfgStyles.actionBtn,width:"100%",marginTop:8,color:"#a78bfa",borderColor:"rgba(167,139,250,0.35)"}}>
              Enviar mensual ahora
            </button>
            <button onClick={()=>sendNow("critical")} disabled={!!sending} style={{...cfgStyles.actionBtn,width:"100%",marginTop:8,color:"#ff4c6a",borderColor:"rgba(255,76,106,0.35)"}}>
              Enviar alarmas ahora
            </button>
          </div>
        </div>
      </div>

      <div style={{display:"flex",gap:12,alignItems:"center"}}>
        <button onClick={save} disabled={saving} style={{...cfgStyles.saveBtn,opacity:saving?0.7:1}}>
          {saving?"Guardando...":"Guardar configuración"}
        </button>
        {msg && <span style={{fontSize:12,color:msg.includes("Error")?"#ff4c6a":"#22c97b"}}>{msg}</span>}
      </div>
    </div>
  );
}

const CONFIG_TABS = [
  { id:"fuentes", label:"Fuentes AVC",          icon:"📡" },
  { id:"sat",     label:"Integración SAT",      icon:"💳" },
  { id:"sistema", label:"Sistema",              icon:"⚙️" },
  { id:"users",   label:"Usuarios y Permisos",  icon:"👥" },
];

function ConfigScreen() {
  const [activeTab, setActiveTab] = React.useState("fuentes");
  const tabContent = { fuentes:<AVCSourcesConfig/>, sat:<SATConfig/>, sistema:<SistemaConfig/>, users:<UsersConfig/> };
  const tr = window.t || (v => v);

  return (
    <div style={{display:"flex", gap:0, height:"100%"}}>
      {/* Left tab nav */}
      <div style={{width:220, background:"#070c18", borderRight:"1px solid #1e2535", flexShrink:0, padding:"8px 0"}}>
        {CONFIG_TABS.map(t => (
          <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{
            display:"flex", alignItems:"center", gap:10, width:"100%", background:"none",
            border:"none", padding:"12px 20px", cursor:"pointer", fontFamily:"inherit",
            color: activeTab===t.id?"#e8edf5":"#7a8aaa",
            background: activeTab===t.id?"rgba(77,127,224,0.08)":"none",
            borderLeft: activeTab===t.id?"3px solid #4d7fe0":"3px solid transparent",
            fontSize:13, textAlign:"left", transition:"all 0.15s",
          }}>
            <span>{t.icon}</span>
            {tr(t.label)}
          </button>
        ))}
      </div>
      {/* Content */}
      <div style={{flex:1, padding:"28px 32px", overflowY:"auto"}}>
        <div style={{fontSize:16, fontWeight:700, color:"#e8edf5", marginBottom:6}}>
          {tr(CONFIG_TABS.find(t=>t.id===activeTab)?.label || "")}
        </div>
        <div style={{fontSize:12, color:"#5b6a8a", marginBottom:24}}>
          {activeTab==="fuentes"&&"Sistemas AVC conectados — PostgreSQL/SSH o Alice API REST"}
          {activeTab==="sat"&&"Fuente de datos del Sistema de Administración de Tráfico"}
          {activeTab==="sistema"&&"Zona horaria, mapeo de carriles AVC ↔ SAT y parámetros globales"}
          {activeTab==="users"&&"Gestión de usuarios y niveles de acceso"}
        </div>
        {tabContent[activeTab]}
      </div>
    </div>
  );
}

const cfgStyles = {
  label: { display:"block", fontSize:11, color:"#8a9ab5", marginBottom:7, letterSpacing:0.5, fontWeight:500 },
  input: {
    width:"100%", background:"#080d1a", border:"1px solid #2a3045", borderRadius:7,
    padding:"9px 12px", color:"#e8edf5", fontSize:13, fontFamily:"inherit", outline:"none", boxSizing:"border-box",
  },
  select: {
    width:"100%", background:"#080d1a", border:"1px solid #2a3045", borderRadius:7,
    padding:"9px 12px", color:"#e8edf5", fontSize:13, fontFamily:"inherit", outline:"none",
  },
  saveBtn: {
    background:"#4d7fe0", border:"none", borderRadius:7, padding:"9px 18px",
    color:"#080d1a", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
  },
  typeTab: {
    borderRadius:7, padding:"7px 14px", fontSize:12, cursor:"pointer", fontFamily:"inherit", transition:"all 0.15s",
  },
  th: { padding:"10px 14px", textAlign:"left", fontSize:11, color:"#5b6a8a", fontWeight:600, letterSpacing:0.4, borderBottom:"1px solid #1e2535" },
  td: { padding:"10px 14px", color:"#c8d4e8", verticalAlign:"middle" },
  actionBtn: {
    background:"none", border:"1px solid #2a3045", borderRadius:5, padding:"4px 10px",
    color:"#7a8aaa", fontSize:11, cursor:"pointer", fontFamily:"inherit",
  },
  chipBtn: {
    background:"#1e2535", border:"1px solid #2a3045", borderRadius:6,
    padding:"4px 10px", color:"#7a8aaa", fontSize:11, cursor:"pointer", fontFamily:"inherit",
  },
  scheduleBox: {
    background:"#0d1525", border:"1px solid #1e2535", borderRadius:8, padding:"12px 14px",
  },
};

Object.assign(window, { ConfigScreen });
