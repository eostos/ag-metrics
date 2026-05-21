// Reports Screen — real data from reconciliation cache

function reportsToday() {
  try { return new Date().toLocaleDateString("en-CA", { timeZone:"America/Mexico_City" }); }
  catch(e) { return new Date().toISOString().slice(0, 10); }
}

function reportsDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  try { return d.toLocaleDateString("en-CA", { timeZone:"America/Mexico_City" }); }
  catch(e) { return d.toISOString().slice(0, 10); }
}

function reportNum(value) {
  return Number(value || 0).toLocaleString();
}

function reportRateColor(rate) {
  const n = Number(rate || 0);
  return n >= 97 ? "#22c97b" : n >= 93 ? "#f5d433" : "#ff4c6a";
}

function motiveLabel(motivo) {
  const labels = {
    SAT_no_detecto: "AVC sin SAT en ventana",
    clase_distinta: "Clase incompatible",
    error_conteo_avc: "Error conteo AVC",
    moto_detectada_solo_por_avc: "Moto solo AVC",
    AVC_no_detecto: "SAT sin AVC",
    moto_SAT_sin_AVC: "Moto SAT sin AVC",
    SAT_clase_indefinida: "SAT clase indefinida",
    ERROR_DETECCION_EJES_AVC: "Error detección ejes",
  };
  return labels[motivo] || motivo || "Sin motivo";
}

function escapeExcel(value) {
  if (value === null || value === undefined || value === "nan" || value === "None") return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadReportExcel(rows, filename) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11px; }
th { background: #162036; color: #fff; font-weight: bold; }
th, td { border: 1px solid #9aa4b2; padding: 5px 7px; mso-number-format:"\\@"; }
</style></head><body>
<table>
<thead><tr>${headers.map(h=>`<th>${escapeExcel(h)}</th>`).join("")}</tr></thead>
<tbody>${rows.map(r=>`<tr>${headers.map(h=>`<td>${escapeExcel(r[h])}</td>`).join("")}</tr>`).join("")}</tbody>
</table>
</body></html>`;
  const blob = new Blob([html], {type:"application/vnd.ms-excel;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ReportsScreen() {
  const [dateFrom, setDateFrom] = React.useState(reportsDaysAgo(13));
  const [dateTo, setDateTo]     = React.useState(reportsToday());
  const [reportType, setReportType] = React.useState("daily");
  const [selectedLanes, setSelectedLanes] = React.useState([]);
  const [report, setReport] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [apiErr, setApiErr] = React.useState("");
  const [sendMsg, setSendMsg] = React.useState("");
  const [sendingEmail, setSendingEmail] = React.useState(false);
  const chartRef = React.useRef(null);
  const chartInstance = React.useRef(null);

  function loadReport() {
    setLoading(true); setApiErr("");
    window.API.get(`/api/reports/summary?date_from=${dateFrom}&date_to=${dateTo}`)
      .then(data => {
        setReport(data);
        setSelectedLanes(prev => {
          const lanes = data.lanes || [];
          if (!prev.length) return lanes;
          const valid = prev.filter(l => lanes.includes(l));
          return valid.length ? valid : lanes;
        });
      })
      .catch(err => setApiErr(err && err.message ? err.message : "No se pudo cargar el reporte"))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => { loadReport(); }, []);

  const lanes = report?.lanes || [];
  const rawRows = report?.rows || [];
  const tableData = React.useMemo(() => {
    return rawRows.filter(r => selectedLanes.includes(r.lane));
  }, [rawRows, selectedLanes]);
  const discrepancyData = React.useMemo(() => {
    return tableData.filter(r => (r.avcOnly || 0) > 0 || (r.satOnly || 0) > 0 || (r.axleErr || 0) > 0);
  }, [tableData]);
  const displayRows = reportType === "daily" ? tableData : discrepancyData;

  const filteredTotals = React.useMemo(() => {
    const t = tableData.reduce((acc, r) => {
      acc.total += Number(r.total || 0);
      acc.matched += Number(r.matched || 0);
      acc.avcOnly += Number(r.avcOnly || 0);
      acc.satOnly += Number(r.satOnly || 0);
      acc.axleErr += Number(r.axleErr || 0);
      acc.classMismatch += Number(r.classMismatch || 0);
      return acc;
    }, {total:0, matched:0, avcOnly:0, satOnly:0, axleErr:0, classMismatch:0});
    t.matchRate = Math.round((t.total - t.satOnly) / Math.max(t.total, 1) * 1000) / 10;
    t.discrepancyCount = t.avcOnly + t.satOnly + t.axleErr;
    t.discrepancyRate = Math.round(t.discrepancyCount / Math.max(t.total, 1) * 1000) / 10;
    return t;
  }, [tableData]);

  const motiveBreakdown = React.useMemo(() => {
    const counts = {};
    tableData.forEach(r => {
      Object.entries(r.motives || {}).forEach(([k,v]) => { counts[k] = (counts[k] || 0) + Number(v || 0); });
      if (r.axleErr) counts.ERROR_DETECCION_EJES_AVC = (counts.ERROR_DETECCION_EJES_AVC || 0) + Number(r.axleErr || 0);
    });
    return Object.entries(counts).map(([motivo,count]) => ({motivo,count})).sort((a,b)=>b.count-a.count);
  }, [tableData]);

  const worstRows = React.useMemo(() => {
    return [...discrepancyData]
      .sort((a,b) => ((b.discrepancyRate || 0) - (a.discrepancyRate || 0)) || ((b.discrepancyCount || 0) - (a.discrepancyCount || 0)))
      .slice(0, 8);
  }, [discrepancyData]);

  function toggleLane(id) {
    setSelectedLanes(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  }

  React.useEffect(() => {
    if (!chartRef.current) return;
    if (chartInstance.current) chartInstance.current.destroy();

    const dates = [...new Set(tableData.map(r=>r.date))].sort();
    const datasets = selectedLanes.slice(0,8).map((lid, i) => {
      const colors = ["#4d7fe0","#22c97b","#5b9cf6","#ff7e3f","#f5d433","#ff4c6a","#a78bfa","#fb923c"];
      const data = dates.map(d => {
        const row = tableData.find(r=>r.lane===lid && r.date===d);
        return row ? row.matchRate : null;
      });
      return { label: lid, data, borderColor: colors[i%colors.length], backgroundColor: `${colors[i%colors.length]}20`, tension:0.25, fill:false, pointRadius:3 };
    });

    chartInstance.current = new Chart(chartRef.current, {
      type:"line",
      data: { labels: dates.map(d=>d.slice(5)), datasets },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{ labels:{ color:"#8a9ab5", font:{size:11,family:"Inter"}, boxWidth:12, padding:14 } },
          tooltip:{ backgroundColor:"#1e2535", titleColor:"#e8edf5", bodyColor:"#8a9ab5", borderColor:"#1c2b46", borderWidth:1,
            callbacks:{ label: ctx => ` ${ctx.dataset.label}: ${ctx.raw}%` } },
        },
        scales:{
          x:{ ticks:{color:"#8a9ab5",font:{size:10}}, grid:{color:"#1e2535"} },
          y:{ min:0, max:100, ticks:{color:"#8a9ab5",font:{size:10},callback:v=>`${v}%`}, grid:{color:"#1e2535"} },
        },
      },
    });
  }, [tableData, selectedLanes]);

  function exportExcel() {
    const rows = displayRows.map(r => ({
      Fecha: r.date,
      Carril: r.lane,
      Total: r.total,
      Coincidencias: r.matched,
      "AVC sin SAT": r.avcOnly,
      "SAT sin AVC": r.satOnly,
      "Error ejes": r.axleErr,
      "Clase distinta": r.classMismatch,
      "Match rate": `${r.matchRate}%`,
      "Discrepancias": r.discrepancyCount,
      "% discrepancia": `${r.discrepancyRate}%`,
      "Actualizado": r.created_at,
    }));
    downloadReportExcel(rows, `ag-metrics-reporte-${dateFrom}-${dateTo}.xls`);
  }

  function sendCurrentReport() {
    setSendingEmail(true); setSendMsg("");
    window.API.post("/api/report-email/send-now", {
      report_type: reportType === "discrepancy" ? "critical" : "daily",
      date_from: dateFrom,
      date_to: dateTo,
    })
      .then(r=>setSendMsg(`PDF enviado a ${r.sent} destinatario(s)`))
      .catch(e=>setSendMsg(e.message || "Error enviando PDF"))
      .finally(()=>setSendingEmail(false));
  }

  return (
    <div>
      <div style={{display:"flex", gap:16, alignItems:"flex-end", flexWrap:"wrap", marginBottom:20}}>
        <div style={rptStyles.fieldWrap}>
          <label style={rptStyles.label}>Desde</label>
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={rptStyles.input}/>
        </div>
        <div style={rptStyles.fieldWrap}>
          <label style={rptStyles.label}>Hasta</label>
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={rptStyles.input}/>
        </div>
        <button onClick={loadReport} disabled={loading} style={{...rptStyles.exportBtn, opacity:loading?0.6:1}}>
          {loading ? "Cargando..." : "Actualizar"}
        </button>
        <div style={rptStyles.fieldWrap}>
          <label style={rptStyles.label}>Vista</label>
          <div style={{display:"flex", gap:6}}>
            {[{id:"daily",label:"Resumen"},{id:"discrepancy",label:"Discrepancias"}].map(t => (
              <button key={t.id} onClick={()=>setReportType(t.id)} style={{
                background: reportType===t.id?"rgba(77,127,224,0.15)":"#1e2535",
                color: reportType===t.id?"#4d7fe0":"#7a8aaa",
                border:`1px solid ${reportType===t.id?"#4d7fe0":"#1c2b46"}`,
                borderRadius:7, padding:"7px 14px", fontSize:12, cursor:"pointer", fontFamily:"inherit",
              }}>{t.label}</button>
            ))}
          </div>
        </div>
        <div style={{display:"flex", gap:6, marginLeft:"auto"}}>
          <button onClick={sendCurrentReport} disabled={!displayRows.length || sendingEmail} style={{...rptStyles.exportBtn, opacity:displayRows.length && !sendingEmail?1:0.5}}>
            {sendingEmail ? "Enviando PDF..." : "Enviar PDF"}
          </button>
          <button onClick={exportExcel} disabled={!displayRows.length} style={{...rptStyles.exportBtn, opacity:displayRows.length?1:0.5}}>Excel</button>
        </div>
      </div>

      {apiErr && <div style={rptStyles.errorBox}>{apiErr}</div>}
      {sendMsg && <div style={{...rptStyles.errorBox,color:sendMsg.startsWith("PDF")?"#22c97b":"#ff4c6a",borderColor:sendMsg.startsWith("PDF")?"rgba(34,201,123,0.25)":"rgba(255,76,106,0.25)",background:sendMsg.startsWith("PDF")?"rgba(34,201,123,0.08)":"rgba(255,76,106,0.08)"}}>{sendMsg}</div>}

      <div style={{marginBottom:20}}>
        <label style={{...rptStyles.label, marginBottom:8}}>Carriles reconciliados</label>
        <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
          <button onClick={()=>setSelectedLanes(lanes)} style={rptStyles.chipBtn}>Todos</button>
          <button onClick={()=>setSelectedLanes([])} style={rptStyles.chipBtn}>Ninguno</button>
          {lanes.map(l => (
            <button key={l} onClick={()=>toggleLane(l)} style={{
              ...rptStyles.chipBtn,
              background: selectedLanes.includes(l)?"rgba(77,127,224,0.15)":"#1e2535",
              color: selectedLanes.includes(l)?"#4d7fe0":"#7a8aaa",
              border:`1px solid ${selectedLanes.includes(l)?"rgba(77,127,224,0.4)":"#1c2b46"}`,
            }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{display:"grid", gridTemplateColumns:"repeat(6, minmax(120px,1fr))", gap:12, marginBottom:24}}>
        {[
          {label:"Total Eventos", value:reportNum(filteredTotals.total), color:"#e8edf5"},
          {label:"Coincidencias", value:reportNum(filteredTotals.matched), color:"#22c97b"},
          {label:"AVC sin SAT", value:reportNum(filteredTotals.avcOnly), color:"#ff7e3f"},
          {label:"SAT sin AVC", value:reportNum(filteredTotals.satOnly), color:"#5b9cf6"},
          {label:"Error Ejes", value:reportNum(filteredTotals.axleErr), color:"#f5d433"},
          {label:"Tasa Detección", value:`${filteredTotals.matchRate}%`, color:reportRateColor(filteredTotals.matchRate)},
        ].map(k => (
          <div key={k.label} style={rptStyles.kpiCard}>
            <div style={{fontSize:11, color:"#5b6a8a", marginBottom:4}}>{k.label}</div>
            <div style={{fontSize:20, fontWeight:800, color:k.color}}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid", gridTemplateColumns:"1.2fr 0.8fr", gap:16, marginBottom:24}}>
        <div style={rptStyles.panel}>
          <div style={rptStyles.panelTitle}>Tasa de detección por carril</div>
          <div style={{height:220}}>{tableData.length ? <canvas ref={chartRef}/> : <div style={rptStyles.empty}>Sin datos reconciliados en el período</div>}</div>
        </div>
        <div style={rptStyles.panel}>
          <div style={rptStyles.panelTitle}>Motivos de discrepancia</div>
          <div style={{display:"flex", flexDirection:"column", gap:8}}>
            {motiveBreakdown.slice(0,7).map(m => (
              <div key={m.motivo} style={rptStyles.reasonRow}>
                <span style={{color:"#c8d4e8"}}>{motiveLabel(m.motivo)}</span>
                <span style={{color:"#ff7e3f",fontWeight:700}}>{reportNum(m.count)}</span>
              </div>
            ))}
            {!motiveBreakdown.length && <div style={rptStyles.empty}>Sin discrepancias registradas</div>}
          </div>
        </div>
      </div>

      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:24}}>
        <div style={rptStyles.panel}>
          <div style={rptStyles.panelTitle}>Carriles/días con mayor discrepancia</div>
          <table style={rptStyles.miniTable}>
            <tbody>
              {worstRows.map(r => (
                <tr key={`${r.date}-${r.lane}`}>
                  <td style={rptStyles.miniTd}>{r.date}</td>
                  <td style={{...rptStyles.miniTd,color:"#4d7fe0",fontWeight:600}}>{r.lane}</td>
                  <td style={{...rptStyles.miniTd,color:"#ff4c6a"}}>{r.discrepancyRate}%</td>
                  <td style={rptStyles.miniTd}>{reportNum(r.discrepancyCount)} casos</td>
                </tr>
              ))}
              {!worstRows.length && <tr><td style={rptStyles.miniTd}>Sin datos</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={rptStyles.panel}>
          <div style={rptStyles.panelTitle}>Balance global</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={rptStyles.balanceBox}><span>Discrepancias</span><strong>{reportNum(filteredTotals.discrepancyCount)}</strong></div>
            <div style={rptStyles.balanceBox}><span>% discrepancia</span><strong style={{color:"#ff4c6a"}}>{filteredTotals.discrepancyRate}%</strong></div>
            <div style={rptStyles.balanceBox}><span>Clase distinta</span><strong>{reportNum(filteredTotals.classMismatch)}</strong></div>
            <div style={rptStyles.balanceBox}><span>Carriles</span><strong>{selectedLanes.length}</strong></div>
          </div>
        </div>
      </div>

      <div style={rptStyles.tablePanel}>
        <div style={rptStyles.tableHeader}>
          <div style={{fontSize:13, fontWeight:600, color:"#e8edf5"}}>
            {reportType==="daily" ? "Resumen real por día/carril" : "Detalle de discrepancias"}
          </div>
          <div style={{fontSize:11, color:"#5b6a8a"}}>{displayRows.length} registros desde `recon_cache`</div>
        </div>
        <div style={{overflowX:"auto", maxHeight:420, overflowY:"auto"}}>
          <table style={{width:"100%", borderCollapse:"collapse", fontSize:12}}>
            <thead>
              <tr style={{background:"#070c18", position:"sticky", top:0}}>
                {["Fecha","Carril","Total","Coincidencias","AVC sin SAT","SAT sin AVC","Err. Ejes","Clase distinta","Detección","% Disc."].map(h => (
                  <th key={h} style={rptStyles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r,i) => (
                <tr key={`${r.date}-${r.lane}-${r.source_id}`} style={{background: i%2===0?"#0d1525":"#0f1219", borderBottom:"1px solid #1a1e2e"}}>
                  <td style={{...rptStyles.td, fontFamily:"monospace", color:"#8a9ab5"}}>{r.date}</td>
                  <td style={rptStyles.td}><span style={{color:"#4d7fe0", fontWeight:600}}>{r.lane}</span></td>
                  <td style={rptStyles.td}>{reportNum(r.total)}</td>
                  <td style={{...rptStyles.td, color:"#22c97b"}}>{reportNum(r.matched)}</td>
                  <td style={{...rptStyles.td, color:r.avcOnly>0?"#ff7e3f":"#8a9ab5"}}>{reportNum(r.avcOnly)}</td>
                  <td style={{...rptStyles.td, color:r.satOnly>0?"#5b9cf6":"#8a9ab5"}}>{reportNum(r.satOnly)}</td>
                  <td style={{...rptStyles.td, color:r.axleErr>0?"#f5d433":"#8a9ab5"}}>{reportNum(r.axleErr)}</td>
                  <td style={{...rptStyles.td, color:r.classMismatch>0?"#ff4c6a":"#8a9ab5"}}>{reportNum(r.classMismatch)}</td>
                  <td style={rptStyles.td}>
                    <span style={{color:reportRateColor(r.matchRate),fontWeight:700}}>{r.matchRate}%</span>
                  </td>
                  <td style={{...rptStyles.td, color:r.discrepancyRate>5?"#ff4c6a":"#8a9ab5"}}>{r.discrepancyRate}%</td>
                </tr>
              ))}
              {!displayRows.length && (
                <tr><td colSpan="10" style={{...rptStyles.td,textAlign:"center",padding:30,color:"#5b6a8a"}}>
                  {loading ? "Cargando..." : "Sin datos. Reconciliar carriles para poblar reportes reales."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const rptStyles = {
  fieldWrap: { display:"flex", flexDirection:"column", gap:4 },
  label: { fontSize:11, color:"#5b6a8a", letterSpacing:0.5 },
  input: {
    background:"#0d1525", border:"1px solid #2a3045", borderRadius:7,
    padding:"7px 12px", color:"#e8edf5", fontSize:13, fontFamily:"inherit", outline:"none",
  },
  exportBtn: {
    background:"#1e2535", border:"1px solid #2a3045", borderRadius:7,
    padding:"7px 14px", color:"#8a9ab5", fontSize:12, cursor:"pointer", fontFamily:"inherit",
  },
  chipBtn: {
    background:"#1e2535", border:"1px solid #2a3045", borderRadius:6,
    padding:"4px 10px", color:"#7a8aaa", fontSize:11, cursor:"pointer", fontFamily:"inherit",
  },
  kpiCard: {background:"#0d1525", border:"1px solid #2a3045", borderRadius:8, padding:"12px 16px"},
  panel: {background:"#0d1525", border:"1px solid #2a3045", borderRadius:8, padding:"16px 18px"},
  panelTitle: {fontSize:13, fontWeight:600, color:"#e8edf5", marginBottom:14},
  reasonRow: {display:"flex", justifyContent:"space-between", gap:12, background:"#080d1a", border:"1px solid #1e2535", borderRadius:6, padding:"8px 10px", fontSize:12},
  empty: {height:"100%", display:"flex", alignItems:"center", justifyContent:"center", color:"#5b6a8a", fontSize:12},
  miniTable: {width:"100%", borderCollapse:"collapse", fontSize:12},
  miniTd: {padding:"7px 8px", borderBottom:"1px solid #1a1e2e", color:"#c8d4e8"},
  balanceBox: {background:"#080d1a",border:"1px solid #1e2535",borderRadius:6,padding:"10px 12px",display:"flex",justifyContent:"space-between",color:"#8a9ab5",fontSize:12},
  tablePanel: {background:"#0d1525", border:"1px solid #2a3045", borderRadius:8, overflow:"hidden"},
  tableHeader: {padding:"14px 18px", borderBottom:"1px solid #1e2535", display:"flex", justifyContent:"space-between", alignItems:"center"},
  errorBox: {background:"rgba(255,76,106,0.08)", border:"1px solid rgba(255,76,106,0.25)", color:"#ff4c6a", borderRadius:7, padding:"10px 12px", fontSize:12, marginBottom:16},
  th: { padding:"9px 12px", textAlign:"left", fontSize:11, color:"#5b6a8a", fontWeight:600, letterSpacing:0.4, borderBottom:"1px solid #1e2535", whiteSpace:"nowrap" },
  td: { padding:"8px 12px", color:"#c8d4e8", verticalAlign:"middle" },
};

Object.assign(window, { ReportsScreen });
