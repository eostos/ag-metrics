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

function reportMoney(value) {
  return "$" + Number(value || 0).toLocaleString("es-MX", {minimumFractionDigits:2, maximumFractionDigits:2});
}

function reportRateColor(rate) {
  const n = Number(rate || 0);
  return n >= 97 ? "#22c97b" : n >= 93 ? "#f5d433" : "#ff4c6a";
}

function motiveLabel(motivo) {
  const labels = {
    SAT_no_detecto: "AVC sin SP en ventana",
    clase_distinta: "Clase incompatible",
    error_conteo_avc: "Error conteo AVC",
    moto_detectada_solo_por_avc: "Moto solo AVC",
    AVC_no_detecto: "SP sin AVC",
    moto_SAT_sin_AVC: "Moto SP sin AVC",
    SAT_clase_indefinida: "SP clase indefinida",
    ERROR_DETECCION_EJES_AVC: "Error detección ejes",
  };
  return labels[motivo] || motivo || "Sin motivo";
}

const CLASS_NAMES = {
  1:"Auto", 2:"C2", 3:"C3", 4:"C4", 5:"C5",
  6:"C6", 7:"C7", 8:"C8", 9:"C9+", 10:"AR1",
  11:"AR2", 12:"B2", 13:"B3", 14:"B4", 15:"Moto",
};

function classLabel(cls_id) {
  const n = parseInt(cls_id, 10);
  return CLASS_NAMES[n] ? `C${n} – ${CLASS_NAMES[n]}` : `Clase ${cls_id}`;
}

function cleanExportValue(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s === "nan" || s === "None" || s === "undefined") return "";
  return s;
}

function excelEscape(value) {
  return cleanExportValue(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function excelEventColors(tipo, nota) {
  const t = cleanExportValue(tipo);
  const n = cleanExportValue(nota);
  if (t === "MATCH" && n.startsWith("ERROR")) return { bg:"#fff2cc", fg:"#7a5d00", border:"#f5d433" };
  if (t === "AVC")  return { bg:"#fce4d6", fg:"#9c4a14", border:"#ff7e3f" };
  if (t === "SAT")  return { bg:"#ddebf7", fg:"#1f4e79", border:"#5b9cf6" };
  return { bg:"#e2f0d9", fg:"#276e3a", border:"#22c97b" };
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function buildDetailExcel(events, dateFrom, dateTo, showAxle) {
  const headers = [
    "Fecha","Carril","Estado","AVC ID","AVC Hora","AVC Vehículo","AVC Ejes","AVC Clase",
    "SP Carril","SP Hora","SP Número","SP Id Clase","SP Tab Clase","SP Precio ($)",
    "Delta (s)","Motivo No Match",
    ...(showAxle ? ["Nota Ejes"] : []),
  ];
  const statusLabels = { MATCH:"Coincidencia", AVC:"Solo AVC", SAT:"Solo SP" };
  const legend = [
    {color:"#e2f0d9", label:"Coincidencia (MATCH)"},
    ...(showAxle ? [{color:"#fff2cc", label:"Error de ejes (MATCH con diferencia)"}] : []),
    {color:"#fce4d6", label:"Solo AVC — sin SP"},
    {color:"#ddebf7", label:"Solo SP — sin AVC"},
  ];
  const legendHtml = legend.map(m =>
    `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:14px;font-size:11px;">
      <span style="width:14px;height:14px;background:${m.color};border:1px solid #aaa;display:inline-block;"></span>${excelEscape(m.label)}
    </span>`
  ).join("");
  const headerRow = headers.map(h => `<th style="background:#162036;color:#fff;font-weight:bold;padding:5px 7px;border:1px solid #9aa4b2;">${excelEscape(h)}</th>`).join("");
  const dataRows = events.map(ev => {
    // For non-admin: treat axle-error MATCHes as plain MATCHes (green)
    const notaForColor = showAxle ? ev.nota_ejes : "";
    const colors = excelEventColors(ev.tipo, notaForColor);
    const cellStyle = `background-color:${colors.bg};color:${colors.fg};padding:4px 7px;border:1px solid #c8d0d8;`;
    const cells = [
      excelEscape(ev.fecha),
      excelEscape(ev.carril),
      excelEscape(statusLabels[ev.tipo] || ev.tipo),
      excelEscape(ev.avc_id),
      excelEscape(ev.avc_hora),
      excelEscape(ev.avc_vehiculo),
      excelEscape(ev.avc_ejes),
      excelEscape(ev.avc_clase),
      excelEscape(ev.sat_voie),
      excelEscape(ev.sat_hora),
      excelEscape(ev.sat_numero),
      excelEscape(ev.sat_id_classe),
      excelEscape(ev.sat_tab_id_classe),
      excelEscape(ev.sat_precio),
      excelEscape(ev.delta_segundos),
      excelEscape(ev.motivo_no_match),
      ...(showAxle ? [excelEscape(ev.nota_ejes)] : []),
    ].map(v => `<td style="${cellStyle}">${v}</td>`).join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
body{font-family:Arial,sans-serif;font-size:11px;}
table{border-collapse:collapse;width:100%;}
</style></head><body>
<h3 style="color:#162036;">Conciliación AVC/SP — Detalle por evento</h3>
<p style="color:#475569;">Período: ${excelEscape(dateFrom)} al ${excelEscape(dateTo)} &nbsp;|&nbsp; Total eventos: ${events.length}</p>
<div style="margin-bottom:10px;">${legendHtml}</div>
<table>
<thead><tr>${headerRow}</tr></thead>
<tbody>${dataRows}</tbody>
</table>
</body></html>`;
  return html;
}

function ReportsScreen() {
  const [dateFrom, setDateFrom] = React.useState(reportsDaysAgo(6));
  const [dateTo, setDateTo]     = React.useState(reportsToday());
  const [reportType, setReportType] = React.useState("daily");
  const [selectedLanes, setSelectedLanes] = React.useState([]);
  const [report, setReport] = React.useState(null);
  const [hourlyData, setHourlyData] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [hourlyLoading, setHourlyLoading] = React.useState(false);
  const [excelLoading, setExcelLoading] = React.useState(false);
  const [apiErr, setApiErr] = React.useState("");
  const [sendMsg, setSendMsg] = React.useState("");
  const [sendingEmail, setSendingEmail] = React.useState(false);
  const [smtpSettings, setSmtpSettings] = React.useState(null);
  const [emailTo, setEmailTo] = React.useState("");

  const isAdmin = window.isAdmin ? window.isAdmin() : false;

  const chartRef = React.useRef(null);
  const chartInstance = React.useRef(null);
  const hourlyChartRef = React.useRef(null);
  const hourlyChartInstance = React.useRef(null);

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

  function loadHourly() {
    setHourlyLoading(true);
    const lanesParam = selectedLanes.length ? `&lanes=${encodeURIComponent(selectedLanes.join(","))}` : "";
    window.API.get(`/api/reports/hourly?date_from=${dateFrom}&date_to=${dateTo}${lanesParam}`)
      .then(setHourlyData)
      .catch(() => setHourlyData(null))
      .finally(() => setHourlyLoading(false));
  }

  React.useEffect(() => {
    loadReport();
    window.API.get("/api/report-email/settings").then(s => setSmtpSettings(s)).catch(() => {});
  }, []);

  React.useEffect(() => {
    if (report) loadHourly();
  }, [report, selectedLanes.join(",")]);

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
      acc.sat_money += Number(r.sat_money || 0);
      acc.avc_money += Number(r.avc_money || 0);
      return acc;
    }, {total:0, matched:0, avcOnly:0, satOnly:0, axleErr:0, classMismatch:0, sat_money:0, avc_money:0});
    t.matchRate = Math.round((t.total - t.satOnly) / Math.max(t.total, 1) * 1000) / 10;
    t.discrepancyCount = t.avcOnly + t.satOnly + t.axleErr;
    t.discrepancyRate = Math.round(t.discrepancyCount / Math.max(t.total, 1) * 1000) / 10;
    t.money_delta = t.avc_money - t.sat_money;
    return t;
  }, [tableData]);

  const motiveBreakdown = React.useMemo(() => {
    const counts = {};
    tableData.forEach(r => {
      Object.entries(r.motives || {}).forEach(([k,v]) => { counts[k] = (counts[k] || 0) + Number(v || 0); });
      if (isAdmin && r.axleErr) counts.ERROR_DETECCION_EJES_AVC = (counts.ERROR_DETECCION_EJES_AVC || 0) + Number(r.axleErr || 0);
    });
    return Object.entries(counts).map(([motivo,count]) => ({motivo,count})).sort((a,b)=>b.count-a.count);
  }, [tableData]);

  const classBreakdown = React.useMemo(() => {
    return (report?.class_breakdown || []).filter(cb => {
      if (!selectedLanes.length) return true;
      return true; // class_breakdown is already filtered by selected date range
    });
  }, [report, selectedLanes]);

  const worstRows = React.useMemo(() => {
    return [...discrepancyData]
      .sort((a,b) => ((b.discrepancyRate || 0) - (a.discrepancyRate || 0)) || ((b.discrepancyCount || 0) - (a.discrepancyCount || 0)))
      .slice(0, 8);
  }, [discrepancyData]);

  function toggleLane(id) {
    setSelectedLanes(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  }

  // Detection rate chart
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

  // Hourly flow chart
  React.useEffect(() => {
    if (!hourlyChartRef.current || !hourlyData) return;
    if (hourlyChartInstance.current) hourlyChartInstance.current.destroy();
    const labels = hourlyData.hourly.map(h => `${String(h.hour).padStart(2,"0")}:00`);
    hourlyChartInstance.current = new Chart(hourlyChartRef.current, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label:"Coincidencia", data: hourlyData.hourly.map(h=>h.matched), backgroundColor:"rgba(34,201,123,0.75)", stack:"s" },
          { label:"Solo AVC",    data: hourlyData.hourly.map(h=>h.avcOnly),  backgroundColor:"rgba(255,126,63,0.75)", stack:"s" },
          { label:"Solo SP",     data: hourlyData.hourly.map(h=>h.satOnly),  backgroundColor:"rgba(91,156,246,0.75)", stack:"s" },
          ...(isAdmin ? [{ label:"Error ejes", data: hourlyData.hourly.map(h=>h.axleErr), backgroundColor:"rgba(245,212,51,0.75)", stack:"s" }] : []),
        ],
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{ labels:{ color:"#8a9ab5", font:{size:11}, boxWidth:12 } },
          tooltip:{ backgroundColor:"#1e2535", titleColor:"#e8edf5", bodyColor:"#8a9ab5", borderColor:"#1c2b46", borderWidth:1 },
        },
        scales:{
          x:{ stacked:true, ticks:{color:"#8a9ab5",font:{size:9},maxRotation:0}, grid:{color:"#1e2535"} },
          y:{ stacked:true, ticks:{color:"#8a9ab5",font:{size:10}}, grid:{color:"#1e2535"} },
        },
      },
    });
    return () => { if (hourlyChartInstance.current) hourlyChartInstance.current.destroy(); };
  }, [hourlyData]);

  function exportBasicExcel() {
    const rows = displayRows.map(r => {
      const row = {
        Fecha: r.date, Carril: r.lane, Total: r.total, Coincidencias: r.matched,
        "AVC sin SP": r.avcOnly, "SP sin AVC": r.satOnly,
        "Clase distinta": r.classMismatch, "Match rate": `${r.matchRate}%`,
        "Discrepancias": r.discrepancyCount, "% discrepancia": `${r.discrepancyRate}%`,
        "SP facturado": r.sat_money, "AVC estimado": r.avc_money,
      };
      if (isAdmin) row["Error ejes"] = r.axleErr;
      return row;
    });
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const html = `<!doctype html><html><head><meta charset="utf-8">
<style>table{border-collapse:collapse;font-family:Arial;font-size:11px;}
th{background:#162036;color:#fff;font-weight:bold;}th,td{border:1px solid #9aa4b2;padding:5px 7px;}</style>
</head><body><table>
<thead><tr>${headers.map(h=>`<th>${excelEscape(h)}</th>`).join("")}</tr></thead>
<tbody>${rows.map(r=>`<tr>${headers.map(h=>`<td>${excelEscape(r[h])}</td>`).join("")}</tr>`).join("")}</tbody>
</table></body></html>`;
    downloadBlob(html, `ag-metrics-resumen-${dateFrom}-${dateTo}.xls`, "application/vnd.ms-excel;charset=utf-8;");
  }

  function exportDetailExcel() {
    setExcelLoading(true);
    const lanesParam = selectedLanes.length ? `&lanes=${encodeURIComponent(selectedLanes.join(","))}` : "";
    window.API.get(`/api/reports/events?date_from=${dateFrom}&date_to=${dateTo}${lanesParam}&limit=15000`)
      .then(data => {
        const html = buildDetailExcel(data.events || [], dateFrom, dateTo, isAdmin);
        downloadBlob(html, `ag-metrics-detalle-${dateFrom}-${dateTo}.xls`, "application/vnd.ms-excel;charset=utf-8;");
      })
      .catch(e => setSendMsg("Error al generar Excel detallado: " + (e.message || "")))
      .finally(() => setExcelLoading(false));
  }

  function sendCurrentReport() {
    setSendingEmail(true); setSendMsg("");
    const recipients = (emailTo || "").split(",").map(e=>e.trim()).filter(Boolean);
    window.API.post("/api/report-email/send-now", {
      report_type: reportType === "discrepancy" ? "critical" : "daily",
      date_from: dateFrom,
      date_to: dateTo,
      ...(recipients.length ? {recipients} : {}),
    })
      .then(r=>setSendMsg(`PDF enviado a ${r.sent} destinatario(s)`))
      .catch(e=>setSendMsg(e.message || "Error enviando PDF"))
      .finally(()=>setSendingEmail(false));
  }

  const smtpOk = smtpSettings && smtpSettings.smtp && smtpSettings.smtp.host;

  return (
    <div>
      {/* ── Controles de fecha y vista ── */}
      <div style={{display:"flex", gap:16, alignItems:"flex-end", flexWrap:"wrap", marginBottom:20}}>
        <div style={rptStyles.fieldWrap}>
          <label style={rptStyles.label}>Desde</label>
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={rptStyles.input}/>
        </div>
        <div style={rptStyles.fieldWrap}>
          <label style={rptStyles.label}>Hasta</label>
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={rptStyles.input}/>
        </div>
        <button onClick={()=>{loadReport();}} disabled={loading} style={{...rptStyles.exportBtn, opacity:loading?0.6:1}}>
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
        <div style={{display:"flex", gap:6, marginLeft:"auto", flexWrap:"wrap"}}>
          <button onClick={exportBasicExcel} disabled={!displayRows.length} style={{...rptStyles.exportBtn, opacity:displayRows.length?1:0.5}}>
            Excel resumen
          </button>
          <button onClick={exportDetailExcel} disabled={!displayRows.length || excelLoading} style={{...rptStyles.exportBtn, opacity:displayRows.length&&!excelLoading?1:0.5}}>
            {excelLoading ? "Generando..." : "Excel detallado ▼"}
          </button>
        </div>
      </div>

      {apiErr && <div style={rptStyles.errorBox}>{apiErr}</div>}

      {/* ── Selector de carriles ── */}
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

      {/* ── KPIs operativos ── */}
      <div style={{display:"grid", gridTemplateColumns:"repeat(6, minmax(120px,1fr))", gap:12, marginBottom:16}}>
        {[
          {label:"Total Eventos",     value:reportNum(filteredTotals.total),        color:"#e8edf5"},
          {label:"Coincidencias",     value:reportNum(filteredTotals.matched),       color:"#22c97b"},
          {label:"AVC sin SP",        value:reportNum(filteredTotals.avcOnly),       color:"#ff7e3f"},
          {label:"SP sin AVC",        value:reportNum(filteredTotals.satOnly),       color:"#5b9cf6"},
          ...(isAdmin ? [{label:"Error Ejes", value:reportNum(filteredTotals.axleErr), color:"#f5d433"}] : []),
          {label:"Tasa Detección",    value:`${filteredTotals.matchRate}%`,          color:reportRateColor(filteredTotals.matchRate)},
        ].map(k => (
          <div key={k.label} style={rptStyles.kpiCard}>
            <div style={{fontSize:11, color:"#5b6a8a", marginBottom:4}}>{k.label}</div>
            <div style={{fontSize:20, fontWeight:800, color:k.color}}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* ── KPIs económicos ── */}
      <div style={{display:"grid", gridTemplateColumns:"repeat(3, minmax(160px,1fr))", gap:12, marginBottom:24}}>
        <div style={{...rptStyles.kpiCard, borderColor:"rgba(91,156,246,0.35)"}}>
          <div style={{fontSize:11, color:"#5b6a8a", marginBottom:4}}>SP Facturado (real)</div>
          <div style={{fontSize:22, fontWeight:800, color:"#5b9cf6"}}>{reportMoney(filteredTotals.sat_money)}</div>
          <div style={{fontSize:10, color:"#5b6a8a", marginTop:3}}>Suma de sat_prix en transacciones coincidentes y SP</div>
        </div>
        <div style={{...rptStyles.kpiCard, borderColor:"rgba(255,126,63,0.35)"}}>
          <div style={{fontSize:11, color:"#5b6a8a", marginBottom:4}}>AVC Estimado (tarifas config.)</div>
          <div style={{fontSize:22, fontWeight:800, color:"#ff7e3f"}}>{reportMoney(filteredTotals.avc_money)}</div>
          <div style={{fontSize:10, color:"#5b6a8a", marginTop:3}}>Conteos AVC × tarifas configuradas en Sistema</div>
        </div>
        <div style={{...rptStyles.kpiCard, borderColor: filteredTotals.money_delta > 0 ? "rgba(255,76,106,0.35)" : "rgba(34,201,123,0.35)"}}>
          <div style={{fontSize:11, color:"#5b6a8a", marginBottom:4}}>Delta AVC − SP</div>
          <div style={{fontSize:22, fontWeight:800, color: filteredTotals.money_delta > 0 ? "#ff4c6a" : "#22c97b"}}>
            {filteredTotals.money_delta >= 0 ? "+" : ""}{reportMoney(filteredTotals.money_delta)}
          </div>
          <div style={{fontSize:10, color:"#5b6a8a", marginTop:3}}>
            {filteredTotals.money_delta > 0 ? "AVC detectó más de lo facturado por SP" : filteredTotals.money_delta < 0 ? "SP facturó más de lo detectado por AVC" : "Sin diferencia"}
          </div>
        </div>
      </div>

      {/* ── Gráficas: detección + flujo horario ── */}
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:24}}>
        <div style={rptStyles.panel}>
          <div style={rptStyles.panelTitle}>Tasa de detección por carril</div>
          <div style={{height:220}}>{tableData.length ? <canvas ref={chartRef}/> : <div style={rptStyles.empty}>Sin datos reconciliados en el período</div>}</div>
        </div>
        <div style={rptStyles.panel}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14}}>
            <div style={rptStyles.panelTitle}>Flujo de eventos por hora del día</div>
            {hourlyLoading && <span style={{fontSize:11, color:"#5b6a8a"}}>Cargando...</span>}
          </div>
          <div style={{height:220}}>
            {hourlyData && hourlyData.hourly.some(h=>h.total>0)
              ? <canvas ref={hourlyChartRef}/>
              : <div style={rptStyles.empty}>{hourlyLoading ? "Cargando..." : "Sin datos de flujo horario"}</div>
            }
          </div>
        </div>
      </div>

      {/* ── Motivos de discrepancia + peores carriles ── */}
      <div style={{display:"grid", gridTemplateColumns:"1.2fr 0.8fr", gap:16, marginBottom:24}}>
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
      </div>

      {/* ── Comparativa por clase: AVC vs SP con dinero ── */}
      {classBreakdown.length > 0 && (
        <div style={{...rptStyles.panel, marginBottom:24}}>
          <div style={rptStyles.panelTitle}>Comparativa por clase — AVC vs SP</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%", borderCollapse:"collapse", fontSize:12}}>
              <thead>
                <tr style={{background:"#070c18"}}>
                  {["Clase","AVC det.","SP trans.","Delta det.","SP Facturado","AVC Estimado","Delta ($)"].map(h => (
                    <th key={h} style={rptStyles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {classBreakdown.map((cb, i) => {
                  const delta = cb.delta || 0;
                  const mdelta = cb.money_delta || 0;
                  return (
                    <tr key={cb.class_id} style={{background: i%2===0?"#0d1525":"#0f1219", borderBottom:"1px solid #1a1e2e"}}>
                      <td style={{...rptStyles.td,color:"#4d7fe0",fontWeight:600}}>{classLabel(cb.class_id)}</td>
                      <td style={rptStyles.td}>{reportNum(cb.avc)}</td>
                      <td style={rptStyles.td}>{reportNum(cb.sat)}</td>
                      <td style={{...rptStyles.td, color: delta > 0 ? "#22c97b" : delta < 0 ? "#ff4c6a" : "#8a9ab5", fontWeight:delta!==0?700:400}}>
                        {delta > 0 ? "+" : ""}{delta}
                      </td>
                      <td style={{...rptStyles.td, color:"#5b9cf6"}}>{reportMoney(cb.sat_money)}</td>
                      <td style={{...rptStyles.td, color:"#ff7e3f"}}>{reportMoney(cb.avc_money)}</td>
                      <td style={{...rptStyles.td, color: mdelta > 500 ? "#ff4c6a" : mdelta < -500 ? "#f5d433" : "#8a9ab5", fontWeight:Math.abs(mdelta)>500?700:400}}>
                        {mdelta >= 0 ? "+" : ""}{reportMoney(mdelta)}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{background:"#162036", borderTop:"2px solid #2a3045", fontWeight:700}}>
                  <td style={{...rptStyles.td,color:"#e8edf5"}}>TOTAL</td>
                  <td style={rptStyles.td}>{reportNum(classBreakdown.reduce((s,cb)=>s+cb.avc,0))}</td>
                  <td style={rptStyles.td}>{reportNum(classBreakdown.reduce((s,cb)=>s+cb.sat,0))}</td>
                  <td style={rptStyles.td}></td>
                  <td style={{...rptStyles.td,color:"#5b9cf6"}}>{reportMoney(filteredTotals.sat_money)}</td>
                  <td style={{...rptStyles.td,color:"#ff7e3f"}}>{reportMoney(filteredTotals.avc_money)}</td>
                  <td style={{...rptStyles.td,color: filteredTotals.money_delta > 0 ? "#ff4c6a" : "#22c97b"}}>
                    {filteredTotals.money_delta >= 0 ? "+" : ""}{reportMoney(filteredTotals.money_delta)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tabla principal por día/carril ── */}
      <div style={{...rptStyles.tablePanel, marginBottom:24}}>
        <div style={rptStyles.tableHeader}>
          <div style={{fontSize:13, fontWeight:600, color:"#e8edf5"}}>
            {reportType==="daily" ? "Resumen real por día/carril" : "Detalle de discrepancias"}
          </div>
          <div style={{fontSize:11, color:"#5b6a8a"}}>{displayRows.length} registros desde recon_cache</div>
        </div>
        <div style={{overflowX:"auto", maxHeight:420, overflowY:"auto"}}>
          <table style={{width:"100%", borderCollapse:"collapse", fontSize:12}}>
            <thead>
              <tr style={{background:"#070c18", position:"sticky", top:0}}>
                {["Fecha","Carril","Total","Coincidencias","AVC sin SP","SP sin AVC",...(isAdmin?["Err. Ejes"]:[]),"Clase dist.","Detección","% Disc.","SP $","AVC $"].map(h => (
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
                  {isAdmin && <td style={{...rptStyles.td, color:r.axleErr>0?"#f5d433":"#8a9ab5"}}>{reportNum(r.axleErr)}</td>}
                  <td style={{...rptStyles.td, color:r.classMismatch>0?"#ff4c6a":"#8a9ab5"}}>{reportNum(r.classMismatch)}</td>
                  <td style={rptStyles.td}><span style={{color:reportRateColor(r.matchRate),fontWeight:700}}>{r.matchRate}%</span></td>
                  <td style={{...rptStyles.td, color:r.discrepancyRate>5?"#ff4c6a":"#8a9ab5"}}>{r.discrepancyRate}%</td>
                  <td style={{...rptStyles.td, color:"#5b9cf6", fontSize:11}}>{r.sat_money ? reportMoney(r.sat_money) : "—"}</td>
                  <td style={{...rptStyles.td, color:"#ff7e3f", fontSize:11}}>{r.avc_money ? reportMoney(r.avc_money) : "—"}</td>
                </tr>
              ))}
              {!displayRows.length && (
                <tr><td colSpan="12" style={{...rptStyles.td,textAlign:"center",padding:30,color:"#5b6a8a"}}>
                  {loading ? "Cargando..." : "Sin datos. Reconciliar carriles para poblar reportes reales."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Envío por email ── */}
      <div style={{...rptStyles.panel, marginBottom:8}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12}}>
          <div style={rptStyles.panelTitle}>Enviar reporte por email</div>
          {smtpOk
            ? <span style={{fontSize:11, color:"#22c97b"}}>SMTP configurado ({smtpSettings.smtp.host})</span>
            : <span style={{fontSize:11, color:"#f5d433"}}>SMTP no configurado — ve a Configuración → Email</span>
          }
        </div>
        <div style={{display:"flex", gap:10, alignItems:"center", flexWrap:"wrap"}}>
          <input
            type="text"
            value={emailTo}
            onChange={e=>setEmailTo(e.target.value)}
            placeholder="destinatario@empresa.com, otro@empresa.com (vacío = destinatarios SMTP)"
            style={{...rptStyles.input, flex:"1 1 300px", fontSize:12}}
          />
          <button
            onClick={sendCurrentReport}
            disabled={!displayRows.length || sendingEmail || !smtpOk}
            style={{...rptStyles.exportBtn, opacity:displayRows.length&&!sendingEmail&&smtpOk?1:0.5}}
          >
            {sendingEmail ? "Enviando PDF..." : "Enviar PDF por email"}
          </button>
        </div>
        {sendMsg && (
          <div style={{...rptStyles.errorBox, marginTop:10,
            color:sendMsg.startsWith("PDF")||sendMsg.startsWith("enviado")?"#22c97b":"#ff4c6a",
            borderColor:sendMsg.startsWith("PDF")||sendMsg.startsWith("enviado")?"rgba(34,201,123,0.25)":"rgba(255,76,106,0.25)",
            background:sendMsg.startsWith("PDF")||sendMsg.startsWith("enviado")?"rgba(34,201,123,0.08)":"rgba(255,76,106,0.08)"}}>
            {sendMsg}
          </div>
        )}
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
  tablePanel: {background:"#0d1525", border:"1px solid #2a3045", borderRadius:8, overflow:"hidden"},
  tableHeader: {padding:"14px 18px", borderBottom:"1px solid #1e2535", display:"flex", justifyContent:"space-between", alignItems:"center"},
  errorBox: {background:"rgba(255,76,106,0.08)", border:"1px solid rgba(255,76,106,0.25)", color:"#ff4c6a", borderRadius:7, padding:"10px 12px", fontSize:12, marginBottom:16},
  th: { padding:"9px 12px", textAlign:"left", fontSize:11, color:"#5b6a8a", fontWeight:600, letterSpacing:0.4, borderBottom:"1px solid #1e2535", whiteSpace:"nowrap" },
  td: { padding:"8px 12px", color:"#c8d4e8", verticalAlign:"middle" },
};

Object.assign(window, { ReportsScreen });
