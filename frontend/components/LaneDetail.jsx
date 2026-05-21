// Lane Detail — fetches real events + real images from API

// Catálogo SAT — mismo que engine.py
const SAT_CODE = {
  0:"-", 1:"A", 2:"C2", 3:"C3", 4:"C4", 5:"C5",
  6:"C6", 7:"C7", 8:"C8", 9:"C9+", 10:"AR1",
  11:"AR2", 12:"B2", 13:"B3", 14:"B4", 15:"M",
};
const SAT_DESC_SHORT = {
  0:"Sin clase", 1:"Auto 2 ejes", 2:"Camión 2 ejes", 3:"Camión 3 ejes",
  4:"Camión 4 ejes", 5:"Camión 5 ejes", 6:"Camión 6 ejes", 7:"Camión 7 ejes",
  8:"Camión 8 ejes", 9:"Camión 9+ ejes", 10:"Auto + remolque 1", 11:"Auto + remolque 2",
  12:"Autobús 2 ejes", 13:"Autobús 3 ejes", 14:"Autobús 4 ejes", 15:"Motocicleta",
};
function satClaseLabel(raw) {
  const n = parseInt(raw, 10);
  if (isNaN(n) || raw === "" || raw === null || raw === undefined) return "—";
  const code = SAT_CODE[n] || `cls${n}`;
  const desc = SAT_DESC_SHORT[n] || "";
  return `${n} · ${code}${desc ? "  ("+desc+")" : ""}`;
}
function rawClassValue(raw) {
  if (raw === null || raw === undefined || raw === "" || raw === "nan" || raw === "None") return "—";
  return String(raw);
}
function satClassCode(raw) {
  const n = parseInt(raw, 10);
  if (isNaN(n) || raw === "" || raw === null || raw === undefined) return "—";
  return SAT_CODE[n] || `cls${n}`;
}

const STATUS_META = {
  matched:    {label:"Coincidencia", color:"#22c97b", bg:"rgba(34,201,123,0.08)", icon:"✓"},
  avc_only:   {label:"AVC sin SAT",  color:"#ff7e3f", bg:"rgba(255,126,63,0.08)", icon:"◎"},
  sat_only:   {label:"SAT sin AVC",  color:"#5b9cf6", bg:"rgba(91,156,246,0.08)", icon:"◎"},
  axle_error: {label:"Error de Ejes",color:"#f5d433", bg:"rgba(245,212,51,0.08)", icon:"⚠"},
  MATCH:      {label:"Coincidencia", color:"#22c97b", bg:"rgba(34,201,123,0.08)", icon:"✓"},
  AVC:        {label:"AVC sin SAT",  color:"#ff7e3f", bg:"rgba(255,126,63,0.08)", icon:"◎"},
  SAT:        {label:"SAT sin AVC",  color:"#5b9cf6", bg:"rgba(91,156,246,0.08)", icon:"◎"},
};

const LANE_TABS = [
  {id:"all",label:"Todos"},{id:"MATCH",label:"Coincidencias"},
  {id:"AVC",label:"AVC sin SAT"},{id:"SAT",label:"SAT sin AVC"},
  {id:"axle_error",label:"Error Ejes"},
];

function VehicleImage({ imageRef, avcId }) {
  const [src, setSrc] = React.useState(null);
  const [err, setErr] = React.useState(false);

  React.useEffect(() => {
    if (!imageRef) return;
    // First try as direct URL
    if (imageRef.startsWith("http") && !imageRef.includes("localhost") && !imageRef.includes("127.0.0.1")) {
      setSrc(imageRef); return;
    }
    // Proxy through backend
    const url = `/api/image?ref=${encodeURIComponent(imageRef)}`;
    fetch(url, {headers:{Authorization:`Bearer ${window.API.token()}`}})
      .then(r => { if (r.ok) return r.blob(); throw new Error(); })
      .then(blob => setSrc(URL.createObjectURL(blob)))
      .catch(() => setErr(true));
  }, [imageRef]);

  if (!imageRef || err) return (
    <div style={{background:"#080d1a",borderRadius:8,height:160,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,border:"1px dashed #2a3045"}}>
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
        <rect width="36" height="36" rx="8" fill="#162036"/>
        <path d="M8 26l4-8 4 5 3-4 5 7H8Z" stroke="#5b6a8a" strokeWidth="1.5" strokeLinejoin="round"/>
        <circle cx="24" cy="13" r="3" stroke="#5b6a8a" strokeWidth="1.5"/>
        <rect x="3" y="3" width="30" height="30" rx="6" stroke="#1c2b46" strokeWidth="1.5"/>
      </svg>
      <span style={{fontSize:11,color:"#5b6a8a"}}>Sin imagen disponible</span>
    </div>
  );
  if (!src) return (
    <div style={{background:"#080d1a",borderRadius:8,height:160,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid #2a3045"}}>
      <span style={{fontSize:12,color:"#5b6a8a"}}>Cargando imagen…</span>
    </div>
  );
  return <img src={src} alt={`AVC ${avcId}`} style={{width:"100%",borderRadius:8,maxHeight:200,objectFit:"cover",border:"1px solid #2a3045"}}/>;
}

function EvidencePanel({ event }) {
  if (!event) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:12,color:"#5b6a8a"}}>
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="20" r="19" stroke="#1c2b46" strokeWidth="1.5"/>
        <path d="M20 12v9M20 26v2" stroke="#5b6a8a" strokeWidth="2" strokeLinecap="round"/>
      </svg>
      <div style={{fontSize:13}}>Haz clic en un evento para ver evidencia</div>
    </div>
  );

  const statusKey = event.tipo || event.status || "matched";
  const meta = STATUS_META[statusKey] || STATUS_META.matched;
  const imageRef = event.vehicle_image_url || event.avc_image_url || event.vehicle_image_path || event.avc_image_path || "";
  const satFile = satMergedFileName(event);
  const hasSat = statusKey==="MATCH" || statusKey==="matched" || statusKey==="axle_error" || statusKey==="SAT" || statusKey==="sat_only" || !!event.sat_date;

  return (
    <div style={{padding:"0 0 0 20px",overflowY:"auto",height:"100%"}}>
      <div style={{fontSize:12,fontWeight:600,color:"#5b6a8a",letterSpacing:0.5,textTransform:"uppercase",marginBottom:14}}>Panel de Evidencia</div>
      <div style={{display:"inline-flex",alignItems:"center",gap:6,background:meta.bg,border:`1px solid ${meta.color}40`,borderRadius:6,padding:"4px 10px",marginBottom:16}}>
        <span style={{color:meta.color,fontSize:12}}>{meta.icon}</span>
        <span style={{fontSize:12,color:meta.color,fontWeight:600}}>{meta.label}</span>
      </div>

      <div style={{marginBottom:14}}>
        <VehicleImage imageRef={imageRef} avcId={event.id||event.avc_id||""}/>
      </div>

      <div style={evStyles.section}>
        <div style={evStyles.sectionTitle}>Datos AVC</div>
        {[
          ["ID Evento",    event.id||event.avc_id||"—"],
          ["Timestamp",    event.event_mexico||event.avc_date||event.avcTime||"—"],
          ["Carril",       event.lane_name||event.avc_device||event.lane||"—"],
          ["Tipo Vehículo",event.vehicle_type||event.Vehicle_type||event.vType||"—"],
          ["Ejes AVC",     event.axle_count||event.axles_avc||event.axlesAvc||"—"],
        ].map(([k,v])=>(
          <div key={k} style={evStyles.row}>
            <span style={evStyles.key}>{k}</span>
            <span style={evStyles.val}>{String(v)}</span>
          </div>
        ))}
      </div>

      {hasSat && (
        <div style={evStyles.section}>
          <div style={evStyles.sectionTitle}>Archivo SAT origen</div>
          {[
            ["Nombre", satFile ? satFile.name : "—"],
            ["Ruta",   satFile ? satFile.path : "—"],
          ].map(([k,v])=>(
            <div key={k} style={evStyles.row}>
              <span style={evStyles.key}>{k}</span>
              <span style={evStyles.val}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {hasSat && (
        <div style={evStyles.section}>
          <div style={evStyles.sectionTitle}>Transacción SAT</div>
          {[
            ["Voie / Carril",  event.sat_voie||"—"],
            ["Hora SAT",       event.sat_date||event.satTime||"—"],
            ["Número SAT",     event.sat_numero||"—"],
            ["Delta (s)",      event.delta_segundos||event.delta||"—"],
            ["id_classe",      rawClassValue(event.id_classe)],
            ["tab_id_classe",  rawClassValue(event.tab_id_classe)],
            ["Clase SAT",      event.sat_id_classe_desc||event.satClass||"—"],
            ["Ejes SAT",       event.sat_id_classe_ejes||event.axlesSat||"—"],
            ["Monto",          event.sat_prix||event.amount||"—"],
          ].map(([k,v])=>(
            <div key={k} style={evStyles.row}>
              <span style={evStyles.key}>{k}</span>
              <span style={{...evStyles.val,color:k==="Monto"?"#22c97b":evStyles.val.color}}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {(event.observacion_auditoria||event.notes) && (
        <div style={{background:"rgba(245,212,51,0.08)",border:"1px solid rgba(245,212,51,0.2)",borderRadius:8,padding:"10px 12px",fontSize:12,color:"#f5d433"}}>
          ⚠ {event.observacion_auditoria||event.notes}
        </div>
      )}
    </div>
  );
}

const evStyles = {
  section: {background:"#080d1a",borderRadius:8,padding:"12px 14px",marginBottom:12,border:"1px solid #1e2535"},
  sectionTitle: {fontSize:10,color:"#5b6a8a",letterSpacing:1,textTransform:"uppercase",marginBottom:10,fontWeight:600},
  row: {display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:"1px solid #1e2535"},
  key: {fontSize:12,color:"#5b6a8a"},
  val: {fontSize:12,color:"#e8edf5",fontWeight:500},
};

function satMergedFileName(event) {
  const raw = event.avc_date || event.sat_date || event.event_mexico || "";
  const day = raw.slice(0, 10).replace(/-/g, "");
  if (day.length !== 8) return null;
  return { name: `SAT-TEXCOCO-${day}-MERGED.json`, path: `~/sat_merged/SAT-TEXCOCO-${day}-MERGED.json` };
}

function cleanExportValue(value) {
  if (value === null || value === undefined || value === "nan" || value === "None") return "";
  return String(value);
}

function excelEscape(value) {
  return cleanExportValue(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function reconciliationExportRows(events) {
  return events.map((ev, idx) => {
    const statusKey = ev.tipo || ev.status || "";
    const meta = STATUS_META[statusKey] || STATUS_META.matched;
    return {
      "#": ev.id || ev.avc_id || idx + 1,
      "Estado": meta.label || statusKey,
      "Tipo fila": ev.tipo || "",
      "Match valido": ev.match_valido,
      "AVC ID": ev.avc_id || ev.id || "",
      "AVC carril": ev.avc_device || ev.lane_name || "",
      "AVC hora": ev.avc_date || ev.event_mexico || "",
      "AVC tipo vehiculo": ev.vehicle_type || ev.Vehicle_type || "",
      "AVC ejes": ev.axle_count || ev.axles_avc || "",
      "AVC clase mapeada": ev.clase_avc_mapeada || "",
      "SAT voie": ev.sat_voie || "",
      "SAT hora": ev.sat_date || "",
      "SAT numero": ev.sat_numero || "",
      "SAT id_classe": ev.id_classe || "",
      "SAT tab_id_classe": ev.tab_id_classe || "",
      "SAT clase id desc": ev.sat_id_classe_desc || "",
      "SAT clase tab desc": ev.sat_tab_id_classe_desc || "",
      "SAT precio": ev.sat_prix || "",
      "Delta segundos": ev.delta_segundos || "",
      "Direccion delta": ev.direccion_delta || "",
      "Nota ejes": ev.nota_ejes || "",
      "Comparacion ejes id": ev.comparacion_ejes_id || "",
      "Comparacion ejes tab": ev.comparacion_ejes_tab || "",
      "Motivo no match": ev.motivo_no_match || "",
      "Observacion auditoria": ev.observacion_auditoria || "",
      "Candidatos SAT": ev.candidatos_sat || "",
    };
  });
}

function excelStatusColors(row) {
  const tipo = cleanExportValue(row["Tipo fila"]);
  const nota = cleanExportValue(row["Nota ejes"]);
  if (tipo === "MATCH" && nota.startsWith("ERROR")) {
    return { bg:"#fff2cc", fg:"#7a5d00", border:"#f5d433" };
  }
  if (tipo === "AVC") return { bg:"#fce4d6", fg:"#9c4a14", border:"#ff7e3f" };
  if (tipo === "SAT") return { bg:"#ddebf7", fg:"#1f4e79", border:"#5b9cf6" };
  return { bg:"#e2f0d9", fg:"#276e3a", border:"#22c97b" };
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function EventModal({ event, onClose }) {
  if (!event) return null;

  const statusKey = event.tipo || event.status || "matched";
  const meta      = STATUS_META[statusKey] || STATUS_META.matched;
  const imageRef  = event.vehicle_image_url || event.avc_image_url || event.vehicle_image_path || event.avc_image_path || "";
  const satFile   = satMergedFileName(event);

  React.useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function handleBackdrop(e) { if (e.target === e.currentTarget) onClose(); }

  function Field({ label, value, highlight }) {
    if (value === null || value === undefined || value === "" || value === "nan" || value === "None") return null;
    return (
      <div style={mStyles.field}>
        <span style={mStyles.fieldKey}>{label}</span>
        <span style={{...mStyles.fieldVal, color: highlight || mStyles.fieldVal.color}}>{String(value)}</span>
      </div>
    );
  }

  return (
    <div style={mStyles.overlay} onClick={handleBackdrop}>
      <div style={mStyles.modal}>

        {/* Header */}
        <div style={mStyles.header}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{display:"inline-flex",alignItems:"center",gap:6,background:meta.bg,border:`1px solid ${meta.color}40`,borderRadius:6,padding:"4px 12px"}}>
              <span style={{color:meta.color,fontSize:13}}>{meta.icon}</span>
              <span style={{fontSize:13,color:meta.color,fontWeight:700}}>{meta.label}</span>
            </div>
            <span style={{fontSize:12,color:"#5b6a8a"}}>
              Evento #{event.id || event.avc_id || "—"}
            </span>
          </div>
          <button onClick={onClose} style={mStyles.closeBtn}>✕</button>
        </div>

        {/* Body — dos columnas */}
        <div style={mStyles.body}>

          {/* Columna izquierda: imagen + datos AVC */}
          <div style={mStyles.col}>
            <div style={mStyles.secTitle}>Imagen AVC</div>
            <div style={{marginBottom:16}}>
              <VehicleImage imageRef={imageRef} avcId={event.id || event.avc_id || ""} />
            </div>

            <div style={mStyles.secTitle}>Datos AVC</div>
            <div style={mStyles.card}>
              <Field label="ID Evento"     value={event.id || event.avc_id} />
              <Field label="Timestamp"     value={event.avc_date || event.event_mexico || event.avcTime} />
              <Field label="Carril AVC"    value={event.avc_device || event.lane_name || event.lane} />
              <Field label="Tipo Vehículo" value={event.vehicle_type || event.Vehicle_type || event.vType} />
              <Field label="Ejes AVC"      value={event.axle_count || event.axles_avc} />
              <Field label="Clase AVC"     value={event.clase_avc_mapeada} />
            </div>
          </div>

          {/* Columna derecha: archivo SAT + transacción + diagnóstico */}
          <div style={mStyles.col}>
            <div style={mStyles.secTitle}>Archivo SAT origen</div>
            <div style={mStyles.card}>
              <Field label="Nombre" value={satFile ? satFile.name : "—"} />
              <Field label="Ruta"   value={satFile ? satFile.path : "—"} />
            </div>

            <div style={{...mStyles.secTitle, marginTop:14}}>Transacción SAT</div>
            <div style={mStyles.card}>
              <Field label="Voie / Carril"  value={event.sat_voie} />
              <Field label="Hora SAT"       value={event.sat_date || event.satTime} />
              <Field label="Número SAT"     value={event.sat_numero} />
              <Field label="Delta (s)"      value={event.delta_segundos || event.delta} />
              <Field label="id_classe"      value={rawClassValue(event.id_classe)} />
              <Field label="tab_id_classe"  value={rawClassValue(event.tab_id_classe)} />
              <Field label="Clase SAT"      value={event.sat_id_classe_desc} />
              <Field label="Ejes SAT id"    value={event.sat_id_classe_ejes} />
              <Field label="Clase SAT tab"  value={event.sat_tab_id_classe_desc} />
              <Field label="Ejes SAT tab"   value={event.sat_tab_id_classe_ejes} />
              <Field label="Monto"          value={event.sat_prix || event.amount} highlight="#22c97b" />
            </div>

            <div style={{...mStyles.secTitle, marginTop:14}}>Diagnóstico de conciliación</div>
            <div style={mStyles.card}>
              <Field label="Match válido"    value={event.match_valido} />
              <Field label="Nota ejes"       value={event.nota_ejes} />
              <Field label="Comp. ejes id"   value={event.comparacion_ejes_id} />
              <Field label="Comp. ejes tab"  value={event.comparacion_ejes_tab} />
              <Field label="Motivo no match" value={event.motivo_no_match} />
            </div>

            {event.candidatos_sat && event.candidatos_sat !== "nan" && (
              <>
                <div style={{...mStyles.secTitle, marginTop:14}}>Candidatos SAT evaluados</div>
                <div style={{background:"#080d1a",borderRadius:8,padding:"10px 12px",border:"1px solid #1e2535",fontSize:11,color:"#5b6a8a",wordBreak:"break-all",lineHeight:1.7}}>
                  {event.candidatos_sat}
                </div>
              </>
            )}

            {(event.observacion_auditoria || event.notes) &&
              event.observacion_auditoria !== "nan" && (
              <div style={{background:"rgba(245,212,51,0.08)",border:"1px solid rgba(245,212,51,0.2)",borderRadius:8,padding:"10px 12px",fontSize:12,color:"#f5d433",marginTop:14}}>
                ⚠ {event.observacion_auditoria || event.notes}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

const mStyles = {
  overlay: {
    position:"fixed", inset:0, background:"rgba(4,8,20,0.88)",
    backdropFilter:"blur(4px)", zIndex:1000,
    display:"flex", alignItems:"center", justifyContent:"center", padding:20,
  },
  modal: {
    background:"#0d1525", border:"1px solid #1c2b46", borderRadius:16,
    width:"min(940px,95vw)", maxHeight:"90vh",
    display:"flex", flexDirection:"column",
    boxShadow:"0 32px 80px rgba(0,0,0,0.85)",
    overflow:"hidden",
  },
  header: {
    display:"flex", alignItems:"center", justifyContent:"space-between",
    padding:"14px 20px", borderBottom:"1px solid #1c2b46",
    background:"#080d1a", flexShrink:0,
  },
  closeBtn: {
    background:"#162036", border:"1px solid #2a3045", borderRadius:7,
    padding:"5px 11px", color:"#8a9ab5", fontSize:14, cursor:"pointer",
    fontFamily:"inherit", lineHeight:1,
  },
  body: {
    display:"flex", gap:20, padding:20, overflowY:"auto", flex:1,
  },
  col: { flex:1, display:"flex", flexDirection:"column", minWidth:0 },
  secTitle: {
    fontSize:10, color:"#5b6a8a", letterSpacing:1.2, textTransform:"uppercase",
    fontWeight:600, marginBottom:8,
  },
  card: {
    background:"#080d1a", borderRadius:8, padding:"10px 14px",
    border:"1px solid #1e2535", marginBottom:4,
  },
  field: {
    display:"flex", justifyContent:"space-between", alignItems:"flex-start",
    padding:"5px 0", borderBottom:"1px solid #111827", gap:12,
  },
  fieldKey: { fontSize:11, color:"#5b6a8a", flexShrink:0, paddingTop:1 },
  fieldVal: { fontSize:11, color:"#e8edf5", fontWeight:500, textAlign:"right", wordBreak:"break-all" },
};

function LaneDetail({ laneId, onBack }) {
  const lane = (window.LANE_CONFIGS||[]).find(l=>l.id===laneId)||{name:laneId};
  const today = (() => { try { return new Date().toLocaleDateString("en-CA",{timeZone:"America/Mexico_City"}); } catch(e){ return new Date().toISOString().slice(0,10); } })();

  const [allEvents,setAllEvents] = React.useState([]);
  const [loading,  setLoading]   = React.useState(true);
  const [apiErr,   setApiErr]    = React.useState("");
  const [activeTab,setActiveTab] = React.useState("all");
  const [selected, setSelected]  = React.useState(null);
  const [sortCol,  setSortCol]   = React.useState("id");
  const [sortDir,  setSortDir]   = React.useState(1);
  const [search,   setSearch]    = React.useState("");
  const [date,     setDate]      = React.useState(today);
  const [reconRunning, setReconRunning] = React.useState(false);
  const [modalEvent,   setModalEvent]   = React.useState(null);
  const [page,         setPage]         = React.useState(0);
  const [pageSize,     setPageSize]     = React.useState(100);

  const [satLanes,     setSatLanes]    = React.useState([]);
  const [satLane,      setSatLane]     = React.useState("");
  const [recoSource,   setRecoSource]  = React.useState("");
  const [laneMapping,  setLaneMapping] = React.useState({});
  const [mappingReady, setMappingReady]= React.useState(false); // true cuando config ha cargado

  // Resetear conciliación al cambiar carril o fecha
  const didAutoReconRef = React.useRef(false);
  React.useEffect(() => {
    didAutoReconRef.current = false;
    setRecoSource("");
    setAllEvents([]);
  }, [laneId, date]);

  function loadEvents(d) {
    setLoading(true); setApiErr("");
    window.API.get(`/api/lanes/${encodeURIComponent(laneId)}/events?query_date=${d}`)
      .then(data => {
        if (data.events && data.events.length > 0) {
          setAllEvents(data.events);
          if (data.source === "reconciled") {
            setRecoSource("reconciled");
            didAutoReconRef.current = true;
          }
        } else {
          setAllEvents([]);
          if (data.error) setApiErr(data.error);
        }
      })
      .catch(() => { setApiErr("Sin conexión AVC. Verifica la configuración de fuentes."); setAllEvents([]); })
      .finally(() => setLoading(false));
  }

  React.useEffect(() => { loadEvents(date); }, [laneId, date]);

  // Cargar mapeo desde configuración — una sola vez, marca mappingReady cuando termina
  React.useEffect(() => {
    window.API.get("/api/config").then(cfg => {
      try {
        const m = typeof cfg.lane_mapping==="string" ? JSON.parse(cfg.lane_mapping||"{}") : (cfg.lane_mapping||{});
        setLaneMapping(m);
      } catch(e) { setLaneMapping({}); }
      setMappingReady(true); // marcar aunque el mapeo esté vacío
    }).catch(() => setMappingReady(true)); // también marcar en error para no bloquear
  }, []);

  // Cargar voies SAT — espera a que el mapeo esté listo para elegir el correcto
  React.useEffect(() => {
    if (!mappingReady) return; // no ejecutar hasta tener el mapeo
    const dayStr = date.replace(/-/g,"");
    window.API.get(`/api/sat/lanes?day=${dayStr}`)
      .then(data => {
        if (data.lanes && data.lanes.length > 0) {
          setSatLanes(data.lanes);
          const mapped = laneMapping[laneId];
          const byName = data.lanes.find(v => v===laneId || v.includes(laneId) || laneId.includes(v));
          setSatLane(mapped || byName || data.lanes[0]);
        }
      })
      .catch(()=>{});
  }, [date, laneId, laneMapping, mappingReady]);

  function runReconcile(satLaneOverride) {
    const lane = satLaneOverride || satLane;
    if (!lane) { setApiErr("No hay voie SAT configurado para este carril"); return; }
    setReconRunning(true); setApiErr("");
    window.API.post("/api/reconcile", {
      avc_lane: laneId,
      sat_lane: lane,
      date,
      window_s: 120,
    })
      .then(data => {
        if (data.error) { setApiErr(data.error); return; }
        if (data.result && data.result.length > 0) {
          setAllEvents(data.result);
          setRecoSource("reconciled");
        }
      })
      .catch(() => setApiErr("Error en conciliación"))
      .finally(() => setReconRunning(false));
  }

  // ── Auto-conciliación: espera que el mapeo esté listo antes de disparar ──
  React.useEffect(() => {
    if (didAutoReconRef.current) return;
    if (reconRunning) return;
    if (!mappingReady || !satLane || allEvents.length === 0) return; // esperar mapeo
    if (recoSource === "reconciled") { didAutoReconRef.current = true; return; }
    didAutoReconRef.current = true;
    runReconcile(satLane);
  }, [satLane, allEvents.length, recoSource, mappingReady]); // eslint-disable-line

  const filtered = React.useMemo(() => {
    let evts = activeTab==="all" ? allEvents : allEvents.filter(e=>(e.tipo||e.status)===activeTab);
    if (search) evts=evts.filter(e=>JSON.stringify(e).toLowerCase().includes(search.toLowerCase()));
    return [...evts].sort((a,b)=>{
      const av=a[sortCol]||"", bv=b[sortCol]||"";
      return typeof av==="number"?(av-bv)*sortDir:String(av).localeCompare(String(bv))*sortDir;
    });
  },[allEvents,activeTab,sortCol,sortDir,search]);

  React.useEffect(() => { setPage(0); }, [activeTab, search, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated  = filtered.slice(page * pageSize, (page + 1) * pageSize);

  function toggleSort(col){if(sortCol===col)setSortDir(d=>-d);else{setSortCol(col);setSortDir(1);}}

  const getStatus = ev => ev.tipo||ev.status||"matched";

  const COLS = [
    {key:"id",label:"#",w:62,fixed:true,left:0},
    {key:"tipo",label:"Estado",w:136,fixed:true,left:62},
    {key:"avc_date",label:"Hora AVC",w:104,fixed:true,left:198},
    {key:"sat_date",label:"Hora SAT",w:104},
    {key:"delta_segundos",label:"Δ(s)",w:62},
    {key:"vehicle_type",label:"Tipo",w:116},
    {key:"axle_count",label:"Ejes AVC",w:78},
    {key:"clase_avc_mapeada",label:"Clase AVC",w:92},
    {key:"id_classe",label:"id_classe",w:100},
    {key:"tab_id_classe",label:"tab_id_classe",w:116},
    {key:"sat_prix",label:"Monto",w:80},
  ];
  const tableMinWidth = COLS.reduce((sum,c)=>sum+(c.w||180),64);
  const stickyCell = (col, bg, z=2) => col.fixed ? {
    position:"sticky",
    left:col.left,
    zIndex:z,
    background:bg,
    boxShadow:"1px 0 0 #1e2535",
  } : {};
  const stickyHeader = (col) => ({
    position:"sticky",
    top:45,
    zIndex:col.fixed ? 7 : 6,
    background:"#070c18",
    ...(col.fixed ? {left:col.left, boxShadow:"1px 0 0 #1e2535"} : {}),
  });
  const stickyActionHeader = {
    position:"sticky",
    top:45,
    right:0,
    zIndex:7,
    background:"#070c18",
    boxShadow:"-1px 0 0 #1e2535",
  };
  const stickyActionCell = (bg) => ({
    position:"sticky",
    right:0,
    zIndex:2,
    background:bg,
    boxShadow:"-1px 0 0 #1e2535",
  });

  function exportReconciliationExcel() {
    const rows = reconciliationExportRows(filtered);
    if (!rows.length) { setApiErr("No hay registros para exportar"); return; }
    const headers = Object.keys(rows[0]);
    const headerHtml = headers.map(h => `<th>${excelEscape(h)}</th>`).join("");
    const legendHtml = [
      { label: STATUS_META.MATCH.label, color: "#22c97b" },
      { label: STATUS_META.AVC.label, color: "#ff7e3f" },
      { label: STATUS_META.SAT.label, color: "#5b9cf6" },
      { label: STATUS_META.axle_error.label, color: "#f5d433" },
    ].map(m => (
      `<span class="legend-item"><span class="swatch" style="background-color:${m.color};"></span>${excelEscape(m.label)}</span>`
    )).join("");
    const bodyHtml = rows.map(row => {
      const colors = excelStatusColors(row);
      return `<tr>${headers.map((h, idx) => (
        `<td bgcolor="${colors.bg}" style="background-color:${colors.bg};color:${colors.fg};${idx === 0 ? `border-left:4px solid ${colors.border};` : ""}">${excelEscape(row[h])}</td>`
      )).join("")}</tr>`;
    }).join("");
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11px; }
    th { background: #162036; color: #ffffff; font-weight: bold; }
    th, td { border: 1px solid #9aa4b2; padding: 5px 7px; mso-number-format:"\\@"; }
    .legend { margin: 8px 0 12px 0; font-family: Arial, sans-serif; font-size: 11px; }
    .legend-item { display: inline-block; margin-right: 14px; }
    .swatch { display: inline-block; width: 10px; height: 10px; margin-right: 5px; vertical-align: -1px; }
  </style>
</head>
<body>
  <h3>Conciliacion AVC/SAT - ${excelEscape(laneId)} - ${excelEscape(date)}</h3>
  <div class="legend">${legendHtml}</div>
  <table>
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${bodyHtml}</tbody>
  </table>
</body>
</html>`;
    downloadBlob(
      html,
      `ag-metrics-${laneId}-${date}-conciliacion.xls`,
      "application/vnd.ms-excel;charset=utf-8;"
    );
  }

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap"}}>
        <button onClick={onBack} style={ldStyles.backBtn}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Dashboard
        </button>
        <div style={{flex:1}}>
          <div style={{fontSize:16,fontWeight:700,color:"#e8edf5"}}>{lane.name}</div>
          <div style={{fontSize:11,color:"#5b6a8a"}}>
            {date} — {allEvents.length} eventos
            {loading && " · Cargando…"}
            {reconRunning && !loading && " · Conciliando automáticamente…"}
            {apiErr ? ` · ⚠ ${apiErr}` : ""}
          </div>
        </div>
        <input type="date" value={date} onChange={e=>{ didAutoReconRef.current=false; setDate(e.target.value); }} style={{...ldStyles.searchInput,width:140}}/>
        {satLanes.length>0 && (
          <select value={satLane} onChange={e=>{ setSatLane(e.target.value); didAutoReconRef.current=false; }}
            style={{...ldStyles.searchInput,width:110,cursor:"pointer"}} title="Carril SAT (voie)">
            {satLanes.map(v=><option key={v} value={v}>{v}</option>)}
          </select>
        )}
        <button onClick={()=>{ didAutoReconRef.current=true; runReconcile(); }} disabled={reconRunning}
          style={{...ldStyles.exportBtn,background:"rgba(77,127,224,0.12)",color:"#4d7fe0",border:"1px solid rgba(77,127,224,0.3)",opacity:reconRunning?0.6:1}}>
          {reconRunning?"Conciliando…":"↺ Re-conciliar"}
        </button>
        {recoSource==="reconciled" && <span style={{fontSize:11,color:"#22c97b",fontWeight:600}}>✓ Conciliado</span>}
        <button onClick={exportReconciliationExcel} style={ldStyles.exportBtn}>Excel</button>
      </div>

      <div style={{display:"flex",gap:2,borderBottom:"1px solid #1e2535",marginBottom:16}}>
        {LANE_TABS.map(t=>{
          const count=t.id==="all"?allEvents.length:allEvents.filter(e=>(e.tipo||e.status)===t.id).length;
          const active=activeTab===t.id;
          const color=t.id==="all"?"#4d7fe0":(STATUS_META[t.id]?.color||"#8a9ab5");
          return (
            <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{...ldStyles.tab,color:active?color:"#7a8aaa",borderBottom:active?`2px solid ${color}`:"2px solid transparent",background:active?`${color}10`:"none"}}>
              {t.label}
              <span style={{marginLeft:6,fontSize:10,background:"#162036",borderRadius:10,padding:"1px 6px",color:active?color:"#5b6a8a"}}>{count}</span>
            </button>
          );
        })}
        <div style={{flex:1}}/>
        <input placeholder="Buscar…" value={search} onChange={e=>setSearch(e.target.value)} style={ldStyles.searchInput}/>
      </div>

      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        <div style={{flex:"0 0 60%",overflowY:"auto",overflowX:"auto"}}>
          {filtered.length > 0 && (
            <div style={{...ldStyles.pagBar,borderTop:"none",borderBottom:"1px solid #1e2535",position:"sticky",top:0,zIndex:8}}>
              <span style={{fontSize:11,color:"#5b6a8a"}}>
                {`${page * pageSize + 1}–${Math.min((page + 1) * pageSize, filtered.length)}`} de {filtered.length} registros
              </span>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <button onClick={()=>setPage(0)} disabled={page===0} style={ldStyles.pagBtn}>«</button>
                <button onClick={()=>setPage(p=>p-1)} disabled={page===0} style={ldStyles.pagBtn}>‹</button>
                <span style={{fontSize:11,color:"#e8edf5",minWidth:90,textAlign:"center"}}>
                  Pág {page+1} / {totalPages}
                </span>
                <button onClick={()=>setPage(p=>p+1)} disabled={page>=totalPages-1} style={ldStyles.pagBtn}>›</button>
                <button onClick={()=>setPage(totalPages-1)} disabled={page>=totalPages-1} style={ldStyles.pagBtn}>»</button>
              </div>
              <select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(0);}}
                style={{...ldStyles.searchInput,width:95,marginBottom:0}}>
                <option value={50}>50 / pág</option>
                <option value={100}>100 / pág</option>
                <option value={250}>250 / pág</option>
                <option value={500}>500 / pág</option>
              </select>
            </div>
          )}
          <table style={{width:"100%",minWidth:tableMinWidth,borderCollapse:"separate",borderSpacing:0,fontSize:12}}>
            <thead>
              <tr style={{background:"#070c18"}}>
                {COLS.map(c=>(
                  <th key={c.key} onClick={()=>toggleSort(c.key)} style={{...ldStyles.th,...stickyHeader(c),width:c.w||undefined,minWidth:c.w||undefined,cursor:"pointer"}}>
                    {c.label}{sortCol===c.key&&<span style={{marginLeft:4,color:"#4d7fe0"}}>{sortDir>0?"↑":"↓"}</span>}
                  </th>
                ))}
                <th style={{...ldStyles.th,...stickyActionHeader,width:72,minWidth:72,textAlign:"center"}}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((ev,i)=>{
                const sk=getStatus(ev);
                const meta=STATUS_META[sk]||STATUS_META.matched;
                const isSel=selected?.id===ev.id||selected?.avc_id===ev.avc_id;
                const rowBg=isSel?`${meta.color}18`:i%2===0?"#0d1525":"#0b1020";
                return (
                  <tr key={ev.id||ev.avc_id||i}
                    onClick={()=>setSelected(isSel?null:ev)}
                    onDoubleClick={()=>setModalEvent(ev)}
                    style={{background:rowBg,borderLeft:isSel?`3px solid ${meta.color}`:"3px solid transparent",cursor:"pointer",transition:"background 0.1s"}}>
                    <td style={{...ldStyles.td,...stickyCell(COLS[0],rowBg)}}>{ev.id||ev.avc_id||i+1}</td>
                    <td style={{...ldStyles.td,...stickyCell(COLS[1],rowBg)}}><span style={{color:meta.color,fontSize:11,fontWeight:600}}>{meta.icon} {meta.label}</span></td>
                    <td style={{...ldStyles.td,...stickyCell(COLS[2],rowBg),fontFamily:"monospace",fontSize:11}}>{(ev.avc_date||ev.event_mexico||ev.avcTime||"—").slice(11,19)||ev.avc_date||"—"}</td>
                    <td style={{...ldStyles.td,fontFamily:"monospace",fontSize:11,color:!ev.sat_date?"#243358":"inherit"}}>{ev.sat_date?"" + ev.sat_date.slice(11,19):"—"}</td>
                    <td style={{...ldStyles.td,color:"#5b6a8a"}}>{ev.delta_segundos||"—"}</td>
                    <td style={ldStyles.td}>{ev.vehicle_type||ev.Vehicle_type||ev.vType||"—"}</td>
                    <td style={{...ldStyles.td,textAlign:"center"}}>{ev.axle_count||ev.axles_avc||"—"}</td>
                    <td style={ldStyles.td}>{satClassCode(ev.clase_avc_mapeada)}</td>
                    <td style={ldStyles.td}>{satClassCode(ev.id_classe)}</td>
                    <td style={ldStyles.td}>{satClassCode(ev.tab_id_classe)}</td>
                    <td style={{...ldStyles.td,color:"#22c97b"}}>{ev.sat_prix||ev.amount||"—"}</td>
                    <td style={{...ldStyles.td,...stickyActionCell(rowBg),textAlign:"center",whiteSpace:"nowrap"}}>
                      {(ev.vehicle_image_url||ev.avc_image_url||ev.vehicle_image_path) && (
                        <button onClick={e=>{e.stopPropagation();setSelected(ev);}} style={ldStyles.camBtn} title="Ver imagen">📷</button>
                      )}
                      <button onClick={e=>{e.stopPropagation();setModalEvent(ev);}} style={ldStyles.infoBtn} title="Más información">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <circle cx="7" cy="7" r="6.25" stroke="currentColor" strokeWidth="1.25"/>
                          <path d="M7 6.5v3.5M7 4v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
              {paginated.length===0 && (
                <tr><td colSpan={COLS.length+1} style={{...ldStyles.td,textAlign:"center",padding:32,color:"#5b6a8a"}}>
                  {loading?"Cargando eventos…":"Sin eventos en esta vista"}
                </td></tr>
              )}
            </tbody>
          </table>
          {filtered.length > 0 && (
            <div style={ldStyles.pagBar}>
              <span style={{fontSize:11,color:"#5b6a8a"}}>
                {filtered.length === 0 ? "0" : `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, filtered.length)}`} de {filtered.length} registros
              </span>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <button onClick={()=>setPage(0)} disabled={page===0} style={ldStyles.pagBtn}>«</button>
                <button onClick={()=>setPage(p=>p-1)} disabled={page===0} style={ldStyles.pagBtn}>‹</button>
                <span style={{fontSize:11,color:"#e8edf5",minWidth:90,textAlign:"center"}}>
                  Pág {page+1} / {totalPages}
                </span>
                <button onClick={()=>setPage(p=>p+1)} disabled={page>=totalPages-1} style={ldStyles.pagBtn}>›</button>
                <button onClick={()=>setPage(totalPages-1)} disabled={page>=totalPages-1} style={ldStyles.pagBtn}>»</button>
              </div>
              <select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(0);}}
                style={{...ldStyles.searchInput,width:95,marginBottom:0}}>
                <option value={50}>50 / pág</option>
                <option value={100}>100 / pág</option>
                <option value={250}>250 / pág</option>
                <option value={500}>500 / pág</option>
              </select>
            </div>
          )}
        </div>

        <div style={{flex:"0 0 40%",borderLeft:"1px solid #1e2535",overflowY:"auto"}}>
          <EvidencePanel event={selected}/>
        </div>
      </div>

      {modalEvent && <EventModal event={modalEvent} onClose={()=>setModalEvent(null)}/>}
    </div>
  );
}

const ldStyles = {
  backBtn: {display:"flex",alignItems:"center",gap:6,background:"none",border:"1px solid #2a3045",borderRadius:7,padding:"6px 12px",color:"#8a9ab5",fontSize:12,cursor:"pointer",fontFamily:"inherit"},
  exportBtn: {background:"#162036",border:"1px solid #2a3045",borderRadius:6,padding:"6px 14px",color:"#8a9ab5",fontSize:12,cursor:"pointer",fontFamily:"inherit"},
  tab: {background:"none",border:"none",padding:"8px 14px",fontSize:12,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",transition:"all 0.15s"},
  th: {padding:"9px 10px",textAlign:"left",fontSize:11,color:"#5b6a8a",fontWeight:600,letterSpacing:0.4,borderBottom:"1px solid #1e2535",whiteSpace:"nowrap"},
  td: {padding:"8px 10px",borderBottom:"1px solid #1a1e2e",color:"#c8d4e8",verticalAlign:"middle"},
  searchInput: {background:"#080d1a",border:"1px solid #2a3045",borderRadius:6,padding:"5px 10px",color:"#e8edf5",fontSize:11,fontFamily:"inherit",outline:"none",width:180,marginBottom:2},
  camBtn:  {background:"none",border:"none",cursor:"pointer",fontSize:14,padding:"2px 4px"},
  infoBtn: {background:"none",border:"none",cursor:"pointer",color:"#4d7fe0",padding:"2px 4px",verticalAlign:"middle",lineHeight:1},
  pagBar: {display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",borderTop:"1px solid #1e2535",background:"#070c18",position:"sticky",bottom:0},
  pagBtn: {background:"#162036",border:"1px solid #2a3045",borderRadius:5,padding:"4px 8px",color:"#8a9ab5",fontSize:12,cursor:"pointer",fontFamily:"inherit",minWidth:28,transition:"opacity 0.15s"},
};

Object.assign(window, { LaneDetail });
