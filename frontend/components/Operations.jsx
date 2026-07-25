// Operations modules — reports, alarms, notifications, and global settings
const REPORT_TYPES = [
  {id:"daily", label:"Daily Toll Audit Report", help:"Resumen operativo diario por plaza y carriles seleccionados."},
  {id:"comparison", label:"SP vs AG-Metrics Comparison", help:"Compara transacciones SP contra detecciones AG-Metrics."},
  {id:"axle", label:"Axle Count Discrepancy Report", help:"Enfocado en diferencias de ejes entre AVC y SP."},
  {id:"class", label:"Vehicle Classification Mismatch Report", help:"Muestra diferencias entre clase detectada y clase cobrada."},
  {id:"evasion", label:"Possible Evasion Report", help:"Lista eventos con detección sin transacción SP asociada."},
];
const REPORT_PERIODS = [
  {id:"Previous hour", help:"Usa la última hora cerrada para revisión rápida."},
  {id:"Previous day", help:"Opción recomendada para reportes operativos diarios."},
  {id:"Previous week", help:"Agrupa los últimos 7 días cerrados."},
  {id:"Custom date range", help:"Permite definir el período al generar el reporte."},
];
const FREQUENCIES = [
  {id:"Manual only", help:"No se envía automáticamente; el usuario lo genera cuando lo necesite."},
  {id:"Hourly", help:"Útil para monitoreo frecuente de discrepancias."},
  {id:"Daily", help:"Recomendado para cierre diario de auditoría."},
  {id:"Weekly", help:"Resumen ejecutivo semanal."},
];
const ALARM_EVENTS = [
  "Axle count mismatch",
  "Vehicle classification mismatch",
  "Possible evasion",
  "Missing SP transaction",
  "Duplicate transaction",
  "Low confidence detection",
  "SP batch file not received",
  "Batch import failed",
  "High mismatch rate",
];
const TRIGGER_EXAMPLES = [
  "AG-Metrics axle count is different from SP axle count",
  "Axle count difference is greater than or equal to 1",
  "Vehicle detected but no SP transaction exists within +/- 10 seconds",
  "AG-Metrics vehicle class is different from SP vehicle class",
  "Detection confidence is below 75%",
  "No SP batch file received in the last 10 minutes",
  "Mismatch rate is greater than 5% during the last hour",
];

function opToday() {
  return new Date().toISOString().slice(0, 10);
}

function opFetchAll(loaders) {
  return Promise.all(loaders.map(([url, setter]) => window.API.get(url).then(setter).catch(() => setter([]))));
}

function OpField({ label, value, onChange, type = "text", options, placeholder, rows }) {
  const tr = window.t || (v => v);
  return (
    <div style={opStyles.field}>
      <label style={opStyles.label}>{tr(label)}</label>
      {options ? (
        <select value={value || ""} onChange={e => onChange(e.target.value)} style={opStyles.input}>
          {options.map(o => <option key={o} value={o}>{tr(o)}</option>)}
        </select>
      ) : rows ? (
        <textarea value={value || ""} onChange={e => onChange(e.target.value)} placeholder={tr(placeholder || "")} rows={rows} style={{...opStyles.input, resize:"vertical"}}/>
      ) : (
        <input type={type} value={value || ""} onChange={e => onChange(type === "checkbox" ? e.target.checked : e.target.value)}
          placeholder={tr(placeholder || "")} style={type === "checkbox" ? opStyles.checkbox : opStyles.input}/>
      )}
    </div>
  );
}

function optionIds(options) {
  return options.map(o => typeof o === "string" ? o : o.id);
}

function optionHelp(options, value) {
  const found = options.find(o => typeof o !== "string" && o.id === value);
  return found ? found.help : "";
}

function OpHint({ children }) {
  if (!children) return null;
  return <div style={opStyles.hint}>{children}</div>;
}

function LanePicker({ lanes, selected, onChange }) {
  const values = selected || [];
  function toggle(lane) {
    onChange(values.includes(lane) ? values.filter(x => x !== lane) : [...values, lane]);
  }
  if (!lanes.length) {
    return (
      <div style={opStyles.guideBox}>
        No hay carriles AVC sincronizados todavía. Sincroniza una fuente AVC o revisa el mapeo en System Configuration para poblar esta lista.
      </div>
    );
  }
  return (
    <div style={opStyles.laneBox}>
      <div style={{display:"flex", gap:6, marginBottom:8, flexWrap:"wrap"}}>
        <OpButton onClick={() => onChange(lanes)}>All lanes</OpButton>
        <OpButton onClick={() => onChange([])}>Clear</OpButton>
      </div>
      <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
        {lanes.map(lane => (
          <button key={lane} onClick={() => toggle(lane)} style={{
            ...opStyles.chip,
            background: values.includes(lane) ? "rgba(77,127,224,0.15)" : "#1e2535",
            color: values.includes(lane) ? "#4d7fe0" : "#8a9ab5",
            borderColor: values.includes(lane) ? "rgba(77,127,224,0.45)" : "#2a3045",
          }}>{lane}</button>
        ))}
      </div>
    </div>
  );
}

function OpButton({ children, onClick, tone = "neutral", disabled }) {
  const tr = window.t || (v => v);
  const colors = {
    primary: {bg:"#4d7fe0", color:"#080d1a", border:"#4d7fe0"},
    danger: {bg:"rgba(255,76,106,0.08)", color:"#ff4c6a", border:"rgba(255,76,106,0.35)"},
    success: {bg:"rgba(34,201,123,0.08)", color:"#22c97b", border:"rgba(34,201,123,0.35)"},
    neutral: {bg:"#1e2535", color:"#8a9ab5", border:"#2a3045"},
  }[tone];
  return <button disabled={disabled} onClick={onClick} style={{...opStyles.btn, background:colors.bg, color:colors.color, borderColor:colors.border, opacity:disabled?0.55:1}}>{typeof children === "string" ? tr(children) : children}</button>;
}

function OpTable({ columns, rows, empty, actions }) {
  const tr = window.t || (v => v);
  return (
    <div style={opStyles.tablePanel}>
      <div style={{overflowX:"auto"}}>
        <table style={opStyles.table}>
          <thead><tr>{columns.map(c => <th key={c.key} style={opStyles.th}>{tr(c.label)}</th>)}{actions && <th style={opStyles.th}>{tr("Actions")}</th>}</tr></thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.id || idx} style={{background:idx % 2 ? "#0f1219" : "#0d1525"}}>
                {columns.map(c => <td key={c.key} style={opStyles.td}>{c.render ? c.render(r) : (r[c.key] || "—")}</td>)}
                {actions && <td style={opStyles.td}><div style={opStyles.actions}>{actions(r)}</div></td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={columns.length + (actions ? 1 : 0)} style={{...opStyles.td, textAlign:"center", padding:28, color:"#5b6a8a"}}>{tr(empty)}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function emailList(value) {
  if (Array.isArray(value)) return value.join(", ");
  return value || "—";
}

function opNum(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function reportDateRange(period) {
  const today = new Date();
  const end = new Date(today);
  const start = new Date(end);
  if (period === "Previous hour") {
    return {date_from:today.toISOString().slice(0, 10), date_to:today.toISOString().slice(0, 10)};
  }
  end.setDate(today.getDate() - 1);
  start.setTime(end.getTime());
  if (period === "Previous week") start.setDate(end.getDate() - 6);
  return {date_from:start.toISOString().slice(0, 10), date_to:end.toISOString().slice(0, 10)};
}

function reportRowsForType(rows, reportType) {
  if (reportType === "Axle Count Discrepancy Report") return rows.filter(r => Number(r.axleErr || 0) > 0);
  if (reportType === "Vehicle Classification Mismatch Report") return rows.filter(r => Number(r.classMismatch || 0) > 0);
  if (reportType === "Possible Evasion Report") return rows.filter(r => Number(r.satOnly || 0) > 0 || Number(r.avcOnly || 0) > 0);
  return rows;
}

function reportPreviewRows(form, preview) {
  const selected = form.lanes || [];
  return reportRowsForType((preview?.rows || []).filter(r => !selected.length || selected.includes(r.lane)), form.type);
}

function reportPreviewTotals(rows) {
  const totals = rows.reduce((acc, r) => {
    acc.total += Number(r.total || 0);
    acc.matched += Number(r.matched || 0);
    acc.avcOnly += Number(r.avcOnly || 0);
    acc.satOnly += Number(r.satOnly || 0);
    acc.axleErr += Number(r.axleErr || 0);
    acc.classMismatch += Number(r.classMismatch || 0);
    return acc;
  }, {total:0, matched:0, avcOnly:0, satOnly:0, axleErr:0, classMismatch:0});
  totals.discrepancy = totals.avcOnly + totals.satOnly + totals.axleErr;
  totals.matchRate = Math.round((totals.total - totals.satOnly) / Math.max(totals.total, 1) * 1000) / 10;
  totals.discrepancyRate = Math.round(totals.discrepancy / Math.max(totals.total, 1) * 1000) / 10;
  return totals;
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function rptMoney(v) { return "$" + Number(v||0).toLocaleString("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function rptPct(v) { return Number(v||0).toFixed(1) + "%"; }
function rptRateColor(v) { const n=Number(v||0); return n>=97?"#14965a":n>=93?"#b88900":"#d92d53"; }

const CLASS_NAMES_MAP = {1:"Auto",2:"C2",3:"C3",4:"C4",5:"C5",6:"C6",7:"C7",8:"C8",9:"C9+",10:"AR1",11:"AR2",12:"B2",13:"B3",14:"B4",15:"Moto"};
const MOTIVE_LABELS_MAP = {
  SAT_no_detecto:"AVC sin SP en ventana", clase_distinta:"Clase incompatible",
  error_conteo_avc:"Error conteo AVC", moto_detectada_solo_por_avc:"Moto solo AVC",
  AVC_no_detecto:"SP sin AVC", moto_SAT_sin_AVC:"Moto SP sin AVC", SAT_clase_indefinida:"SP clase indefinida",
};

function openPrintableReport(form, preview, hourly, targetWin) {
  // Support old 3-arg call: openPrintableReport(form, preview, targetWin)
  if (hourly && !Array.isArray(hourly) && typeof hourly !== "object") { targetWin = hourly; hourly = null; }
  if (hourly && !Array.isArray(hourly) && hourly.document) { targetWin = hourly; hourly = null; }

  const rows = reportPreviewRows(form, preview);
  const totals = reportPreviewTotals(rows);
  const sat_money = rows.reduce((s,r) => s + Number(r.sat_money||0), 0);
  const avc_money = rows.reduce((s,r) => s + Number(r.avc_money||0), 0);
  const money_delta = avc_money - sat_money;
  const generatedAt = new Date().toLocaleString();

  const classBreakdown = (preview && preview.class_breakdown) || [];
  const motiveBreakdown = (preview && preview.motive_breakdown) || [];
  const worstRows = (preview && preview.worst_rows) || [];

  // ── CSS bar chart: detección por carril ──
  const maxTotal = Math.max(...rows.map(r => Number(r.total||0)), 1);
  const laneBarRows = rows.slice(0,14).map(r => {
    const tot = Math.max(Number(r.total||0),1);
    const rw = Math.max(6, Math.round(Number(r.total||0)/maxTotal*100));
    const seg = v => Math.max(v?3:0, Math.round(Number(v||0)/tot*100));
    const rc = rptRateColor(r.matchRate);
    return `<div class="bar-row">
      <div class="bar-label"><strong>${escapeHtml(r.lane)}</strong><span>${escapeHtml(r.date)}</span></div>
      <div class="bar-shell" style="width:${rw}%">
        <div class="seg matched" style="width:${seg(r.matched)}%"></div>
        <div class="seg avc" style="width:${seg(r.avcOnly)}%"></div>
        <div class="seg sat" style="width:${seg(r.satOnly)}%"></div>
      </div>
      <div class="bar-end"><strong>${opNum(r.total)}</strong><span style="color:${rc}">${rptPct(r.matchRate)}</span></div>
    </div>`;
  }).join("");

  // ── Motivos ──
  const motivesHtml = motiveBreakdown.slice(0,8).map(m =>
    `<div class="motive-row"><span>${escapeHtml(MOTIVE_LABELS_MAP[m.motivo]||m.motivo)}</span><strong>${opNum(m.count)}</strong></div>`
  ).join("") || '<p style="color:#64748b;font-size:11px">Sin discrepancias registradas</p>';

  // ── Peores carriles ──
  const worstHtml = worstRows.slice(0,6).map(r =>
    `<tr><td>${escapeHtml(r.date)}</td><td style="color:#2f5fb7;font-weight:600">${escapeHtml(r.lane)}</td><td style="color:#d92d53;font-weight:700">${rptPct(r.discrepancyRate)}</td><td>${opNum(r.discrepancyCount)} casos</td></tr>`
  ).join("") || `<tr><td colspan="4" style="color:#64748b">Sin datos</td></tr>`;

  // ── Tabla de clases ──
  const classHtml = classBreakdown.map(cb => {
    const name = CLASS_NAMES_MAP[parseInt(cb.class_id)] || `Cls ${cb.class_id}`;
    const d = Number(cb.delta||0);
    const md = Number(cb.money_delta||0);
    const dc = d>0?"#14965a":d<0?"#d92d53":"#475569";
    const mc = md>500?"#d92d53":md<-500?"#b88900":"#475569";
    return `<tr>
      <td style="color:#2f5fb7;font-weight:600">C${cb.class_id}–${escapeHtml(name)}</td>
      <td>${opNum(cb.avc)}</td><td>${opNum(cb.sat)}</td>
      <td style="color:${dc};font-weight:${d?"700":"400"}">${d>0?"+":""}${d}</td>
      <td style="color:#1d4ed8">${rptMoney(cb.sat_money)}</td>
      <td style="color:#c2410c">${rptMoney(cb.avc_money)}</td>
      <td style="color:${mc}">${md>=0?"+":""}${rptMoney(md)}</td>
    </tr>`;
  }).join("");
  const mdColor = money_delta > 0 ? "#d92d53" : "#14965a";
  const classTotalHtml = `<tr style="background:#f1f5f9;font-weight:700;border-top:2px solid #cbd5e1">
    <td>TOTAL</td>
    <td>${opNum(classBreakdown.reduce((s,cb)=>s+Number(cb.avc||0),0))}</td>
    <td>${opNum(classBreakdown.reduce((s,cb)=>s+Number(cb.sat||0),0))}</td>
    <td></td>
    <td style="color:#1d4ed8">${rptMoney(sat_money)}</td>
    <td style="color:#c2410c">${rptMoney(avc_money)}</td>
    <td style="color:${mdColor};font-weight:700">${money_delta>=0?"+":""}${rptMoney(money_delta)}</td>
  </tr>`;

  // ── Tabla detalle ──
  const tableRows = rows.slice(0,50).map(r => `<tr>
    <td style="font-family:monospace;color:#64748b">${escapeHtml(r.date)}</td>
    <td style="color:#2f5fb7;font-weight:600">${escapeHtml(r.lane)}</td>
    <td>${opNum(r.total)}</td>
    <td style="color:#14965a">${opNum(r.matched)}</td>
    <td style="color:${Number(r.avcOnly)>0?"#c2410c":"#64748b"}">${opNum(r.avcOnly)}</td>
    <td style="color:${Number(r.satOnly)>0?"#1d4ed8":"#64748b"}">${opNum(r.satOnly)}</td>
    <td style="color:${rptRateColor(r.matchRate)};font-weight:700">${rptPct(r.matchRate)}</td>
    <td style="color:${Number(r.discrepancyRate)>5?"#d92d53":"#64748b"}">${rptPct(r.discrepancyRate)}</td>
    <td style="color:#1d4ed8">${rptMoney(r.sat_money)}</td>
    <td style="color:#c2410c">${rptMoney(r.avc_money)}</td>
  </tr>`).join("");

  // ── Hourly data serialized for Chart.js in new window ──
  const hourlyJson = JSON.stringify(hourly || []);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>${escapeHtml(form.name || form.type || "Reporte AG-metrics")}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
body{font-family:Arial,Helvetica,sans-serif;color:#111827;margin:0;background:#f3f6fb;font-size:12px}
.page{max-width:1100px;margin:0 auto;background:#fff;padding:28px 32px 36px}
.toolbar{display:flex;justify-content:flex-end;margin-bottom:14px;gap:8px}
.print-btn{background:#4d7fe0;color:#fff;border:0;border-radius:7px;padding:9px 16px;font-weight:700;cursor:pointer;font-size:13px}
/* Header */
.header{display:grid;grid-template-columns:120px 1fr auto;gap:18px;align-items:center;border-bottom:3px solid #111827;padding-bottom:16px;margin-bottom:18px}
.logo-box{border:1px solid #dbe3ef;border-radius:8px;padding:8px;background:#fff;display:flex;align-items:center;justify-content:center;min-height:68px}
.logo{max-width:106px;max-height:52px;object-fit:contain}
.brand{font-size:9px;text-transform:uppercase;letter-spacing:1.2px;color:#64748b;font-weight:700}
h1{margin:3px 0 4px;font-size:22px;line-height:1.2}
.meta{color:#64748b;font-size:11px;line-height:1.5}
.badge{display:inline-block;background:#eaf1ff;color:#2f5fb7;border:1px solid #c7d8ff;border-radius:999px;padding:4px 10px;font-size:10px;font-weight:700}
/* KPI grids */
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:8px}
.kpis-money{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px}
.kpi{border:1px solid #dbe3ef;border-radius:8px;padding:10px 12px;background:#fff}
.kpi span{display:block;color:#64748b;font-size:9px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.kpi strong{display:block;font-size:20px;font-weight:700}
/* Sections */
.section{margin-bottom:16px;border:1px solid #dbe3ef;border-radius:8px;padding:13px 15px;background:#fff;break-inside:avoid}
.section h2{font-size:13px;font-weight:700;margin:0 0 12px;color:#111827}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
/* Legend */
.legend{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;font-size:10px;color:#475569}
.dot{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:3px;vertical-align:middle}
/* Bar chart CSS */
.bar-row{display:grid;grid-template-columns:120px 1fr 72px;gap:6px;align-items:center;margin:5px 0;font-size:10px}
.bar-label strong{display:block;color:#111827;font-size:10px}
.bar-label span{display:block;color:#64748b;font-size:9px}
.bar-shell{height:13px;background:#eef2f7;border-radius:999px;overflow:hidden;display:flex;min-width:20px}
.seg{height:13px}.matched{background:#22c97b}.avc{background:#ff7e3f}.sat{background:#5b9cf6}
.bar-end{text-align:right}.bar-end strong{font-size:11px}.bar-end span{display:block;font-size:9px}
/* Chart canvas */
.chart-wrap{position:relative;height:220px}
/* Motives */
.motive-row{display:flex;justify-content:space-between;background:#f8fafc;border:1px solid #e2e8f0;border-radius:5px;padding:5px 9px;margin:3px 0;font-size:11px}
.motive-row strong{color:#c2410c;font-weight:700}
/* Tables */
table{width:100%;border-collapse:collapse;font-size:10px}
th{background:#f1f5f9;color:#475569;font-size:9px;text-transform:uppercase;letter-spacing:.4px;padding:7px 8px;text-align:left;border-bottom:2px solid #e2e8f0}
td{padding:5px 8px;border-bottom:1px solid #e5eaf2;vertical-align:middle}
tr:last-child td{border-bottom:0}
/* Footer */
.footer{display:flex;justify-content:space-between;margin-top:18px;color:#64748b;font-size:9px;border-top:1px solid #dbe3ef;padding-top:10px}
@page{margin:10mm}
@media print{
  body{background:#fff}.page{padding:14px;max-width:none}
  .toolbar{display:none}.section{break-inside:avoid}.kpis,.kpis-money,.two-col{break-inside:avoid}
}
</style></head>
<body><div class="page">

<div class="toolbar">
  <button class="print-btn" onclick="window.print()">&#128438; Imprimir / Guardar PDF</button>
</div>

<!-- Header con logo -->
<div class="header">
  <div class="logo-box"><img class="logo" src="/logo.jpeg" onerror="this.style.display='none'" alt="AG-metrics"/></div>
  <div>
    <div class="brand">AG-metrics · Plataforma de Auditoría AVC/SP</div>
    <h1>${escapeHtml(form.name || form.type || "Reporte de Auditoría")}</h1>
    <div class="meta">
      ${escapeHtml(form.plaza || "")} &nbsp;·&nbsp;
      ${escapeHtml(preview?.date_from || "")} al ${escapeHtml(preview?.date_to || "")} &nbsp;·&nbsp;
      Carriles: ${escapeHtml((form.lanes||[]).join(", ") || "Todos los disponibles")} &nbsp;·&nbsp;
      Generado: ${escapeHtml(generatedAt)}
    </div>
  </div>
  <div><span class="badge">${escapeHtml(form.template || "Standard PDF")}</span></div>
</div>

<!-- KPIs operativos -->
<div class="kpis">
  <div class="kpi"><span>Total eventos</span><strong style="color:#111827">${opNum(totals.total)}</strong></div>
  <div class="kpi"><span>Coincidencias</span><strong style="color:#14965a">${opNum(totals.matched)}</strong></div>
  <div class="kpi"><span>AVC sin SP</span><strong style="color:#c2410c">${opNum(totals.avcOnly)}</strong></div>
  <div class="kpi"><span>SP sin AVC</span><strong style="color:#1d4ed8">${opNum(totals.satOnly)}</strong></div>
  <div class="kpi"><span>Tasa detección</span><strong style="color:${rptRateColor(totals.matchRate)}">${rptPct(totals.matchRate)}</strong></div>
</div>

<!-- KPIs económicos -->
<div class="kpis-money">
  <div class="kpi" style="border-color:#bfdbfe"><span>SP Facturado (real)</span><strong style="color:#1d4ed8">${rptMoney(sat_money)}</strong></div>
  <div class="kpi" style="border-color:#fed7aa"><span>AVC Estimado (tarifas config.)</span><strong style="color:#c2410c">${rptMoney(avc_money)}</strong></div>
  <div class="kpi" style="border-color:${money_delta>0?"#fecaca":"#bbf7d0"}">
    <span>Delta AVC − SP</span>
    <strong style="color:${mdColor}">${money_delta>=0?"+":""}${rptMoney(money_delta)}</strong>
  </div>
</div>

<!-- Gráficas: detección por carril + flujo horario -->
<div class="two-col">
  <div class="section">
    <h2>Detección por carril / día</h2>
    <div class="legend">
      <span><i class="dot" style="background:#22c97b"></i>Coincidencia</span>
      <span><i class="dot" style="background:#ff7e3f"></i>Solo AVC</span>
      <span><i class="dot" style="background:#5b9cf6"></i>Solo SP</span>
    </div>
    ${laneBarRows || '<p style="color:#64748b;font-size:11px">Sin datos de detección</p>'}
  </div>
  <div class="section">
    <h2>Flujo de eventos por hora del día</h2>
    <div class="legend">
      <span><i class="dot" style="background:#22c97b"></i>Match</span>
      <span><i class="dot" style="background:#ff7e3f"></i>AVC</span>
      <span><i class="dot" style="background:#5b9cf6"></i>SP</span>
    </div>
    <div class="chart-wrap"><canvas id="hourlyChart"></canvas></div>
  </div>
</div>

<!-- Motivos + Peores carriles -->
<div class="two-col">
  <div class="section">
    <h2>Motivos de discrepancia</h2>
    ${motivesHtml}
  </div>
  <div class="section">
    <h2>Carriles con mayor discrepancia</h2>
    <table><tbody>${worstHtml}</tbody></table>
  </div>
</div>

<!-- Comparativa por clase -->
<div class="section">
  <h2>Comparativa por clase — AVC vs SP</h2>
  <table>
    <thead><tr><th>Clase</th><th>AVC det.</th><th>SP trans.</th><th>Delta det.</th><th>SP Facturado</th><th>AVC Estimado</th><th>Delta ($)</th></tr></thead>
    <tbody>${classHtml}${classTotalHtml}</tbody>
  </table>
</div>

<!-- Tabla detalle por día/carril -->
<div class="section">
  <h2>Resumen por día y carril</h2>
  <table>
    <thead><tr><th>Fecha</th><th>Carril</th><th>Total</th><th>Coincidencias</th><th>AVC sin SP</th><th>SP sin AVC</th><th>Detección</th><th>% Disc.</th><th>SP $</th><th>AVC $</th></tr></thead>
    <tbody>${tableRows || '<tr><td colspan="10" style="color:#64748b;text-align:center;padding:16px">Sin datos</td></tr>'}</tbody>
  </table>
</div>

<div class="footer">
  <span>AG-metrics · Reporte de Auditoría AVC/SP</span>
  <span>${escapeHtml(form.template || "Standard PDF")} · ${escapeHtml(preview?.date_from || "")} – ${escapeHtml(preview?.date_to || "")}</span>
</div>
</div>

<script>
(function() {
  var hourly = ${hourlyJson};
  var canvas = document.getElementById("hourlyChart");
  if (!canvas || !window.Chart || !hourly || !hourly.length) return;
  var active = hourly.filter(function(h){ return h.total > 0; });
  var hStart = active.length ? active[0].hour : 0;
  var hEnd   = active.length ? active[active.length-1].hour : 23;
  var slice  = hourly.filter(function(h){ return h.hour >= hStart && h.hour <= hEnd; });
  var labels = slice.map(function(h){ return (h.hour < 10 ? "0" : "") + h.hour + ":00"; });
  new Chart(canvas, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        { label:"Coincidencia", data: slice.map(function(h){return h.matched;}),  backgroundColor:"rgba(34,201,123,0.8)",  stack:"s" },
        { label:"Solo AVC",     data: slice.map(function(h){return h.avcOnly;}),  backgroundColor:"rgba(255,126,63,0.8)",  stack:"s" },
        { label:"Solo SP",      data: slice.map(function(h){return h.satOnly;}),  backgroundColor:"rgba(91,156,246,0.8)",  stack:"s" },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color:"#475569", font:{ size:10 }, boxWidth:10, padding:10 } },
        tooltip: { backgroundColor:"#1e2535", titleColor:"#e8edf5", bodyColor:"#8a9ab5" }
      },
      scales: {
        x: { stacked:true, ticks:{ color:"#64748b", font:{size:8}, maxRotation:0 }, grid:{ color:"#f1f5f9" } },
        y: { stacked:true, ticks:{ color:"#64748b", font:{size:9} }, grid:{ color:"#e5eaf2" } }
      }
    }
  });
})();
</script>
</body></html>`;

  const win = targetWin || window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
}

function ReportBuilderPreview({ form, preview, loading, onRefresh }) {
  const tr = window.t || (v => v);
  const chartRef = React.useRef(null);
  const chartInstance = React.useRef(null);
  const selected = form.lanes || [];
  const rows = reportPreviewRows(form, preview);
  const totals = reportPreviewTotals(rows);

  React.useEffect(() => {
    if (!chartRef.current || !window.Chart) return;
    if (chartInstance.current) chartInstance.current.destroy();
    const labels = rows.map(r => `${r.date} ${r.lane}`).slice(0, 12);
    const data = rows.slice(0, 12);
    chartInstance.current = new Chart(chartRef.current, {
      type:"bar",
      data:{
        labels,
        datasets:[
          {label:tr("Matched"), data:data.map(r=>r.matched || 0), backgroundColor:"rgba(34,201,123,0.75)"},
          {label:tr("AVC only"), data:data.map(r=>r.avcOnly || 0), backgroundColor:"rgba(255,126,63,0.75)"},
          {label:tr("SP only"), data:data.map(r=>r.satOnly || 0), backgroundColor:"rgba(91,156,246,0.75)"},
          {label:tr("Axle errors"), data:data.map(r=>r.axleErr || 0), backgroundColor:"rgba(245,212,51,0.75)"},
        ],
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{legend:{labels:{color:"#8a9ab5", font:{size:11, family:"Inter"}}}},
        scales:{
          x:{ticks:{color:"#8a9ab5", font:{size:10}}, grid:{color:"#1e2535"}},
          y:{ticks:{color:"#8a9ab5", font:{size:10}}, grid:{color:"#1e2535"}},
        },
      },
    });
    return () => { if (chartInstance.current) chartInstance.current.destroy(); };
  }, [JSON.stringify(rows.map(r => [r.date, r.lane, r.total, r.matched, r.avcOnly, r.satOnly, r.axleErr])), form.type]);

  return (
    <div style={opStyles.previewPanel}>
      <div style={opStyles.previewHeader}>
        <div>
          <div style={{fontSize:16,fontWeight:800,color:"#e8edf5"}}>{tr("Report Preview")}</div>
          <div style={{fontSize:12,color:"#5b6a8a",marginTop:3}}>
            {form.type} · {form.period} · {selected.length ? `${selected.length} ${tr("lanes selected")}` : tr("All available lanes")}
          </div>
        </div>
        <OpButton onClick={onRefresh} disabled={loading}>{loading ? "Loading..." : "Refresh Preview"}</OpButton>
      </div>
      <div style={opStyles.kpiGrid}>
        {[
          ["Total events", opNum(totals.total), "#e8edf5"],
          ["Matched", opNum(totals.matched), "#22c97b"],
          ["Discrepancies", opNum(totals.discrepancy), "#ff4c6a"],
          ["Detection rate", `${totals.matchRate}%`, "#5b9cf6"],
          ["Axle errors", opNum(totals.axleErr), "#f5d433"],
          ["Class mismatch", opNum(totals.classMismatch), "#ff7e3f"],
        ].map(([label, value, color]) => (
          <div key={label} style={opStyles.kpiCard}>
            <div style={{fontSize:11,color:"#5b6a8a",marginBottom:4}}>{tr(label)}</div>
            <div style={{fontSize:20,fontWeight:800,color}}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1.1fr 0.9fr",gap:14,alignItems:"stretch"}}>
        <div style={opStyles.chartPanel}>
          <div style={opStyles.panelTitle}>{tr("Results by lane and day")}</div>
          <div style={{height:260}}>{rows.length ? <canvas ref={chartRef}/> : <div style={opStyles.emptyBox}>{loading ? tr("Loading...") : tr("No reconciliation data for this selection")}</div>}</div>
        </div>
        <div style={opStyles.chartPanel}>
          <div style={opStyles.panelTitle}>{tr("Report content")}</div>
          <div style={{display:"flex",flexDirection:"column",gap:8,fontSize:12,color:"#c8d4e8"}}>
            <div style={opStyles.contentLine}><span>{tr("Template")}</span><strong>{form.template}</strong></div>
            <div style={opStyles.contentLine}><span>{tr("Plaza")}</span><strong>{form.plaza || "—"}</strong></div>
            <div style={opStyles.contentLine}><span>{tr("Period")}</span><strong>{preview ? `${preview.date_from} → ${preview.date_to}` : "—"}</strong></div>
            <div style={opStyles.contentLine}><span>{tr("Tables")}</span><strong>{tr("Summary, discrepancies, lane detail")}</strong></div>
            <div style={opStyles.contentLine}><span>{tr("Charts")}</span><strong>{tr("KPI cards and lane/day bars")}</strong></div>
          </div>
        </div>
      </div>
      <OpTable columns={[
        {key:"date",label:"Date/time",render:r=>r.date},
        {key:"lane",label:"Lane"},
        {key:"total",label:"Total events",render:r=>opNum(r.total)},
        {key:"matched",label:"Matched",render:r=>opNum(r.matched)},
        {key:"avcOnly",label:"AVC only",render:r=>opNum(r.avcOnly)},
        {key:"satOnly",label:"SP only",render:r=>opNum(r.satOnly)},
        {key:"axleErr",label:"Axle errors",render:r=>opNum(r.axleErr)},
        {key:"discrepancyRate",label:"Discrepancy rate",render:r=>`${r.discrepancyRate || 0}%`},
      ]} rows={rows.slice(0, 20)} empty="No rows to include in the report"/>
    </div>
  );
}

function ReportsModule({ section }) {
  const [history, setHistory]   = React.useState([]);
  const [msg, setMsg]           = React.useState("");
  const [newEmail, setNewEmail] = React.useState("");
  const [settings, setSettings] = React.useState({
    recipients: [],
    language: "Spanish",
    schedule: {
      daily_enabled: false,   daily_time: "07:00",
      weekly_enabled: false,  weekly_day: "monday", weekly_time: "07:00",
      monthly_enabled: false, monthly_time: "07:00",
    },
  });

  React.useEffect(() => {
    opFetchAll([["/api/report-history", setHistory]]);
    window.API.get("/api/report-email/settings")
      .then(s => setSettings(prev => ({
        recipients: Array.isArray(s.recipients)
          ? s.recipients.map(r => typeof r === "object" ? (r.email || "") : r).filter(Boolean)
          : prev.recipients,
        language:   s.language || prev.language,
        schedule:   { ...prev.schedule, ...(s.schedule || {}) },
      })))
      .catch(()=>{});
  }, []);

  function setSched(key, val) {
    setSettings(prev => ({ ...prev, schedule: { ...prev.schedule, [key]: val } }));
  }

  function addRecipient() {
    const email = newEmail.trim().toLowerCase();
    if (!email || settings.recipients.includes(email)) { setNewEmail(""); return; }
    setSettings(prev => ({ ...prev, recipients: [...prev.recipients, email] }));
    setNewEmail("");
  }

  function removeRecipient(email) {
    setSettings(prev => ({ ...prev, recipients: prev.recipients.filter(e => e !== email) }));
  }

  function saveReportSettings() {
    // Merge into report_email_settings preserving SMTP fields
    window.API.get("/api/report-email/settings").then(current => {
      const payload = {
        ...current,
        recipients: settings.recipients,
        language:   settings.language,
        schedule:   { ...(current.schedule || {}), ...settings.schedule },
      };
      return window.API.post("/api/report-email/settings", payload);
    })
      .then(()=>setMsg("Configuración guardada"))
      .catch(e=>setMsg(e.message));
  }

  function resend(r) {
    setMsg("Enviando...");
    window.API.post("/api/report-email/send-now", {
      report_type: "daily",
      recipients: Array.isArray(r.recipients)
        ? r.recipients.map(x => typeof x === "object" ? (x.email || "") : x).filter(Boolean)
        : String(r.recipients||"").split(",").map(e=>e.trim()).filter(Boolean),
    })
      .then(res => setMsg(`Enviado a ${res.sent} destinatario(s)`))
      .catch(e => setMsg(e.message || "Error al reenviar"));
  }

  const sch = settings.schedule;
  const DAYS = [
    {id:"monday",label:"Lunes"},{id:"tuesday",label:"Martes"},{id:"wednesday",label:"Miércoles"},
    {id:"thursday",label:"Jueves"},{id:"friday",label:"Viernes"},{id:"saturday",label:"Sábado"},{id:"sunday",label:"Domingo"},
  ];

  const schedBlock = (label, enabledKey, timeKey, extra) => (
    <div style={{background:"#080d1a", border:`1px solid ${sch[enabledKey]?"rgba(77,127,224,0.4)":"#1e2535"}`, borderRadius:8, padding:"14px 16px"}}>
      <div style={{display:"flex", alignItems:"center", gap:10, marginBottom: sch[enabledKey] ? 12 : 0}}>
        <label style={{display:"flex", alignItems:"center", gap:8, cursor:"pointer", userSelect:"none"}}>
          <input type="checkbox" checked={!!sch[enabledKey]} onChange={e=>setSched(enabledKey, e.target.checked)}
            style={{width:15,height:15,accentColor:"#4d7fe0",cursor:"pointer"}}/>
          <span style={{fontSize:13, fontWeight:600, color: sch[enabledKey]?"#e8edf5":"#7a8aaa"}}>{label}</span>
        </label>
        {sch[enabledKey] && (
          <span style={{fontSize:11, color:"#5b6a8a", marginLeft:"auto"}}>
            {enabledKey==="daily_enabled"   && "Envía el reporte del día anterior"}
            {enabledKey==="weekly_enabled"  && "Envía el reporte de los últimos 7 días"}
            {enabledKey==="monthly_enabled" && "Envía el reporte del mes anterior el día 1"}
          </span>
        )}
      </div>
      {sch[enabledKey] && (
        <div style={{display:"flex", gap:10, flexWrap:"wrap", alignItems:"center"}}>
          {extra}
          <div style={{display:"flex", flexDirection:"column", gap:3}}>
            <label style={{fontSize:11, color:"#5b6a8a"}}>Hora de envío</label>
            <input type="time" value={sch[timeKey]} onChange={e=>setSched(timeKey, e.target.value)}
              style={{background:"#0d1525",border:"1px solid #2a3045",borderRadius:6,padding:"5px 8px",
                color:"#e8edf5",fontSize:12,fontFamily:"inherit",outline:"none",width:110}}/>
          </div>
        </div>
      )}
    </div>
  );

  if (section === "settings") return (
    <OpPage title="Configuración de Reportes" msg={msg}>

      {/* Destinatarios */}
      <div style={{marginBottom:24}}>
        <div style={{fontSize:13, fontWeight:600, color:"#e8edf5", marginBottom:12}}>Destinatarios</div>
        <div style={{display:"flex", flexWrap:"wrap", gap:8, marginBottom:10}}>
          {settings.recipients.length === 0 && (
            <span style={{fontSize:12,color:"#5b6a8a",padding:"6px 0"}}>Sin destinatarios configurados</span>
          )}
          {settings.recipients.map(email => (
            <div key={email} style={{display:"flex",alignItems:"center",gap:6,background:"rgba(77,127,224,0.12)",
              border:"1px solid rgba(77,127,224,0.3)",borderRadius:20,padding:"4px 10px 4px 12px",fontSize:12}}>
              <span style={{color:"#7eb0f5"}}>{email}</span>
              <button onClick={()=>removeRecipient(email)}
                style={{background:"none",border:"none",color:"#5b6a8a",cursor:"pointer",padding:"0 2px",
                  fontSize:14,lineHeight:1,display:"flex",alignItems:"center"}}
                title="Eliminar">✕</button>
            </div>
          ))}
        </div>
        <div style={{display:"flex", gap:8, alignItems:"center"}}>
          <input
            type="email"
            value={newEmail}
            onChange={e=>setNewEmail(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&addRecipient()}
            placeholder="nuevo@empresa.com"
            style={{background:"#0d1525",border:"1px solid #2a3045",borderRadius:7,padding:"7px 12px",
              color:"#e8edf5",fontSize:12,fontFamily:"inherit",outline:"none",flex:"1 1 220px",maxWidth:320}}
          />
          <button onClick={addRecipient}
            style={{background:"rgba(77,127,224,0.15)",border:"1px solid rgba(77,127,224,0.4)",borderRadius:7,
              padding:"7px 14px",color:"#4d7fe0",fontSize:12,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
            + Agregar
          </button>
        </div>
      </div>

      {/* Idioma */}
      <div style={{marginBottom:24}}>
        <div style={{fontSize:13, fontWeight:600, color:"#e8edf5", marginBottom:12}}>Idioma del reporte</div>
        <div style={{display:"flex", gap:8}}>
          {["Spanish","English"].map(lang => (
            <button key={lang} onClick={()=>setSettings(p=>({...p,language:lang}))}
              style={{background:settings.language===lang?"rgba(77,127,224,0.15)":"#1e2535",
                border:`1px solid ${settings.language===lang?"rgba(77,127,224,0.5)":"#2a3045"}`,
                borderRadius:7,padding:"7px 16px",color:settings.language===lang?"#4d7fe0":"#7a8aaa",
                fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
              {lang==="Spanish"?"Español":"English"}
            </button>
          ))}
        </div>
      </div>

      {/* Frecuencia */}
      <div style={{marginBottom:24}}>
        <div style={{fontSize:13, fontWeight:600, color:"#e8edf5", marginBottom:12}}>Frecuencia de envío automático</div>
        <div style={{display:"flex", flexDirection:"column", gap:10}}>
          {schedBlock("Reporte diario", "daily_enabled", "daily_time")}
          {schedBlock("Reporte semanal", "weekly_enabled", "weekly_time",
            <div style={{display:"flex", flexDirection:"column", gap:3}}>
              <label style={{fontSize:11, color:"#5b6a8a"}}>Día de envío</label>
              <select value={sch.weekly_day} onChange={e=>setSched("weekly_day",e.target.value)}
                style={{background:"#0d1525",border:"1px solid #2a3045",borderRadius:6,padding:"5px 8px",
                  color:"#e8edf5",fontSize:12,fontFamily:"inherit",outline:"none"}}>
                {DAYS.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
          )}
          {schedBlock("Reporte mensual", "monthly_enabled", "monthly_time")}
        </div>
      </div>

      <div style={opStyles.actions}>
        <OpButton tone="primary" onClick={saveReportSettings}>Guardar configuración</OpButton>
      </div>
    </OpPage>
  );

  const histCols = [
    {key:"date_time",   label:"Fecha / hora"},
    {key:"report_name", label:"Reporte"},
    {key:"period",      label:"Período"},
    {key:"recipients",  label:"Destinatarios", render:r=>emailList(r.recipients)},
    {key:"status",      label:"Estado"},
    {key:"error",       label:"Error"},
  ];

  if (section === "history") return (
    <OpPage title="Historial de Reportes" msg={msg}>
      <OpTable columns={histCols} rows={history} empty="Sin historial de reportes aún"
        actions={r => <OpButton onClick={()=>resend(r)}>Reenviar</OpButton>}/>
    </OpPage>
  );

  return (
    <OpPage title="Historial de Reportes" msg={msg}>
      <OpTable columns={histCols} rows={history} empty="Sin historial de reportes aún"
        actions={r => <OpButton onClick={()=>resend(r)}>Reenviar</OpButton>}/>
    </OpPage>
  );
}

function AlarmsModule({ section }) {
  const [rules, setRules] = React.useState([]);
  const [active, setActive] = React.useState([]);
  const [history, setHistory] = React.useState([]);
  const [groups, setGroups] = React.useState([]);
  const [msg, setMsg] = React.useState("");
  const [settings, setSettings] = React.useState({default_severity:"Warning", default_cooldown:10, emails_enabled:true, critical_group:"", history_days:90});
  const [form, setForm] = React.useState({name:"", description:"", event_type:ALARM_EVENTS[0], plaza:"", lanes:"", condition:TRIGGER_EXAMPLES[0], severity:"Warning", recipients:"", contact_group:"", send_mode:"Immediately", cooldown:10, status:"Draft"});
  function reload() {
    opFetchAll([
      ["/api/alarm-rules", setRules], ["/api/active-alarms", setActive],
      ["/api/alarm-history", setHistory], ["/api/contact-groups", setGroups],
    ]);
    window.API.get("/api/alarm-settings").then(setSettings).catch(()=>{});
  }
  React.useEffect(reload, []);
  function saveRule(status) {
    window.API.post("/api/alarm-rules", {...form, status, recipients:form.recipients.split(",").map(e=>e.trim()).filter(Boolean)})
      .then(()=>{ setMsg("Alarm rule saved"); reload(); }).catch(e=>setMsg(e.message));
  }
  function testRule(rule) {
    window.API.post("/api/alarm-email/test", {alarm_name:rule.name, event_type:rule.event_type, severity:rule.severity, plaza:rule.plaza, recipients:rule.recipients || []})
      .then(r=>setMsg(`Test alarm email sent to ${emailList(r.sent_to)}`)).catch(e=>setMsg(e.message));
  }
  function updateAlarm(alarm, status) {
    window.API.post("/api/active-alarms", {...alarm, status, resolved_at:status==="Resolved"?new Date().toISOString():""})
      .then(()=>{ setMsg(`Alarm marked ${status}`); reload(); }).catch(e=>setMsg(e.message));
  }
  if (section === "create") return (
    <OpPage title="Create Alarm Rule" msg={msg}>
      <div style={opStyles.formGrid}>
        <OpField label="Alarm rule name" value={form.name} onChange={v=>setForm({...form,name:v})}/>
        <OpField label="Description" value={form.description} onChange={v=>setForm({...form,description:v})}/>
        <OpField label="Event type" value={form.event_type} onChange={v=>setForm({...form,event_type:v})} options={ALARM_EVENTS}/>
        <OpField label="Plaza" value={form.plaza} onChange={v=>setForm({...form,plaza:v})}/>
        <OpField label="Lanes" value={form.lanes} onChange={v=>setForm({...form,lanes:v})}/>
        <OpField label="Trigger condition" value={form.condition} onChange={v=>setForm({...form,condition:v})} options={TRIGGER_EXAMPLES}/>
        <OpField label="Severity" value={form.severity} onChange={v=>setForm({...form,severity:v})} options={["Info","Warning","Critical"]}/>
        <OpField label="Recipients" value={form.recipients} onChange={v=>setForm({...form,recipients:v})} placeholder="ops@example.com"/>
        <OpField label="Recipients / Contact Group" value={form.contact_group} onChange={v=>setForm({...form,contact_group:v})} options={["", ...groups.map(g=>g.name)]}/>
        <OpField label="Send mode" value={form.send_mode} onChange={v=>setForm({...form,send_mode:v})} options={["Immediately","Every 15 minutes","Hourly digest","Do not email"]}/>
        <OpField label="Cooldown" type="number" value={form.cooldown} onChange={v=>setForm({...form,cooldown:v})}/>
        <OpField label="Status" value={form.status} onChange={v=>setForm({...form,status:v})} options={["Draft","Active","Disabled"]}/>
      </div>
      <div style={opStyles.actions}><OpButton onClick={()=>saveRule("Draft")}>Save as Draft</OpButton><OpButton tone="primary" onClick={()=>saveRule("Active")}>Activate Alarm</OpButton><OpButton onClick={()=>setMsg("Rule test completed")}>Test Rule</OpButton><OpButton tone="success" onClick={()=>testRule(form)}>Send Test Alarm Email</OpButton></div>
    </OpPage>
  );
  if (section === "settings") return (
    <OpPage title="Alarm Settings" msg={msg}>
      <div style={opStyles.formGrid}>
        <OpField label="Default severity" value={settings.default_severity} onChange={v=>setSettings({...settings,default_severity:v})} options={["Info","Warning","Critical"]}/>
        <OpField label="Default cooldown in minutes" type="number" value={settings.default_cooldown} onChange={v=>setSettings({...settings,default_cooldown:v})}/>
        <OpField label="Enable alarm emails by default" value={settings.emails_enabled ? "Yes" : "No"} onChange={v=>setSettings({...settings,emails_enabled:v==="Yes"})} options={["Yes","No"]}/>
        <OpField label="Default contact group for critical alarms" value={settings.critical_group} onChange={v=>setSettings({...settings,critical_group:v})} options={["", ...groups.map(g=>g.name)]}/>
        <OpField label="Keep alarm history for X days" type="number" value={settings.history_days} onChange={v=>setSettings({...settings,history_days:v})}/>
      </div>
      <OpButton tone="primary" onClick={()=>window.API.post("/api/alarm-settings", settings).then(()=>setMsg("Alarm settings saved")).catch(e=>setMsg(e.message))}>Save Settings</OpButton>
    </OpPage>
  );
  if (section === "history") return <OpPage title="Alarm History" msg={msg}><OpTable columns={[{key:"date_time",label:"Date/time"},{key:"alarm_name",label:"Alarm name"},{key:"event_type",label:"Event type"},{key:"plaza",label:"Plaza"},{key:"lane",label:"Lane"},{key:"severity",label:"Severity"},{key:"status",label:"Status"},{key:"notification_status",label:"Notification status"},{key:"resolved_at",label:"Resolved at"}]} rows={history} empty="No alarm history yet" actions={()=><><OpButton>View details</OpButton><OpButton>View related transaction</OpButton><OpButton>View notification log</OpButton></>}/></OpPage>;
  if (section === "rules") return <OpPage title="Alarm Rules" msg={msg}><OpTable columns={[{key:"name",label:"Rule name"},{key:"event_type",label:"Event type"},{key:"plaza",label:"Plaza"},{key:"lanes",label:"Lanes"},{key:"severity",label:"Severity"},{key:"send_mode",label:"Send mode"},{key:"cooldown",label:"Cooldown"},{key:"recipients",label:"Recipients",render:r=>emailList(r.recipients)},{key:"status",label:"Status"}]} rows={rules} empty="No alarm rules configured" actions={r=><><OpButton onClick={()=>setForm({...r, recipients:emailList(r.recipients)})}>Edit</OpButton><OpButton onClick={()=>testRule(r)}>Test</OpButton><OpButton onClick={()=>window.API.post('/api/alarm-rules',{...r,status:r.status==='Active'?'Disabled':'Active'}).then(reload)}>{r.status==="Active"?"Disable":"Enable"}</OpButton><OpButton>View alarm history</OpButton><OpButton>View notification history</OpButton></>}/></OpPage>;
  return <OpPage title="Active Alarms" msg={msg}><OpTable columns={[{key:"name",label:"Alarm name"},{key:"severity",label:"Severity"},{key:"plaza",label:"Plaza"},{key:"lane",label:"Lane"},{key:"event_type",label:"Event type"},{key:"triggered_at",label:"Triggered at"},{key:"status",label:"Status"}]} rows={active} empty="No open alarms" actions={r=><><OpButton>View details</OpButton><OpButton onClick={()=>updateAlarm(r,"Acknowledged")}>Acknowledge</OpButton><OpButton onClick={()=>updateAlarm(r,"In Review")}>Mark as in review</OpButton><OpButton tone="success" onClick={()=>updateAlarm(r,"Resolved")}>Resolve</OpButton><OpButton tone="danger" onClick={()=>updateAlarm(r,"Ignored")}>Ignore</OpButton></>}/></OpPage>;
}

function NotificationsModule({ section }) {
  const [history, setHistory] = React.useState([]);
  const [groups, setGroups] = React.useState([]);
  const [msg, setMsg] = React.useState("");
  const [group, setGroup] = React.useState({name:"", description:"", emails:"", status:"Active"});
  function reload() { opFetchAll([["/api/notification-history", setHistory], ["/api/contact-groups", setGroups]]); }
  React.useEffect(reload, []);
  function saveGroup() {
    window.API.post("/api/contact-groups", {...group, emails:group.emails.split(",").map(e=>e.trim()).filter(Boolean)})
      .then(()=>{ setMsg("Contact group saved"); setGroup({name:"", description:"", emails:"", status:"Active"}); reload(); }).catch(e=>setMsg(e.message));
  }
  if (section === "groups") return (
    <OpPage title="Contact Groups" msg={msg}>
      <div style={opStyles.formGrid}>
        <OpField label="Group name" value={group.name} onChange={v=>setGroup({...group,name:v})}/>
        <OpField label="Description" value={group.description} onChange={v=>setGroup({...group,description:v})}/>
        <OpField label="Emails" value={group.emails} onChange={v=>setGroup({...group,emails:v})} placeholder="audit@example.com, ops@example.com"/>
        <OpField label="Status" value={group.status} onChange={v=>setGroup({...group,status:v})} options={["Active","Inactive"]}/>
      </div>
      <div style={opStyles.actions}><OpButton tone="primary" onClick={saveGroup}>Create group</OpButton><OpButton onClick={saveGroup}>Edit group</OpButton><OpButton tone="danger" onClick={()=>setGroup({name:"", description:"", emails:"", status:"Active"})}>Delete group</OpButton><OpButton>Add recipient</OpButton><OpButton>Remove recipient</OpButton></div>
      <OpTable columns={[{key:"name",label:"Group name"},{key:"description",label:"Description"},{key:"emails",label:"Emails",render:r=>emailList(r.emails)},{key:"status",label:"Status"}]} rows={groups} empty="No contact groups" actions={r=><><OpButton onClick={()=>setGroup({...r, emails:emailList(r.emails)})}>Edit group</OpButton><OpButton tone="danger">Delete group</OpButton></>}/>
    </OpPage>
  );
  return <OpPage title="Notification History" msg={msg}><OpTable columns={[{key:"date_time",label:"Date/time"},{key:"type",label:"Notification type"},{key:"related",label:"Related report or alarm"},{key:"subject",label:"Subject"},{key:"recipients",label:"Recipients",render:r=>emailList(r.recipients)},{key:"status",label:"Status"},{key:"error",label:"Error message"}]} rows={history} empty="No notifications recorded yet" actions={()=><><OpButton>View details</OpButton><OpButton>Retry</OpButton><OpButton>View related report</OpButton><OpButton>View related alarm</OpButton></>}/></OpPage>;
}

function SettingsModule() {
  return (
    <OpPage title="Email / SMTP Configuration">
      <EmailSmtpConfiguration/>
    </OpPage>
  );
}

function EmailSmtpConfiguration() {
  const empty = {smtp:{host:"", port:587, security:"TLS", username:"", password:"", from_email:"", from_name:"AG-metrics", email_enabled:true}, recipients:[], schedule:{}};
  const [settings, setSettings] = React.useState(empty);
  const [testTo, setTestTo] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [busy, setBusy] = React.useState("");
  React.useEffect(() => {
    window.API.get("/api/report-email/settings")
      .then(d => setSettings({...empty, ...d, smtp:{...empty.smtp, ...(d.smtp || {})}}))
      .catch(e => setMsg(e.message || "Could not load SMTP settings"));
  }, []);
  const setSmtp = (key, value) => setSettings(p => ({...p, smtp:{...p.smtp, [key]:value}}));
  function save() {
    setBusy("save"); setMsg("");
    window.API.post("/api/report-email/settings", settings)
      .then(() => setMsg("Configuration saved"))
      .catch(e => setMsg(e.message || "Save failed"))
      .finally(() => setBusy(""));
  }
  function testConnection() {
    const email = (testTo.trim() || settings.smtp.from_email || settings.smtp.username || "").trim();
    if (!email) { setMsg("Enter a test recipient or configure From email"); return; }
    setBusy("test"); setMsg("");
    window.API.post("/api/report-email/test", {to: email})
      .then(r => setMsg("SMTP test email sent to " + r.sent_to))
      .catch(e => setMsg(e.message || "SMTP test failed"))
      .finally(() => setBusy(""));
  }
  return (
    <div>
      {msg && <div style={{...opStyles.notice, color:msg.toLowerCase().includes("fail") || msg.toLowerCase().includes("error") ? "#ff4c6a" : "#22c97b"}}>{msg}</div>}
      <div style={opStyles.formGrid}>
        <OpField label="SMTP host" value={settings.smtp.host} onChange={v=>setSmtp("host",v)} placeholder="smtp.company.com"/>
        <OpField label="SMTP port" type="number" value={settings.smtp.port} onChange={v=>setSmtp("port",v)} placeholder="587"/>
        <OpField label="Security type" value={settings.smtp.security} onChange={v=>setSmtp("security",v)} options={["TLS","SSL","None"]}/>
        <OpField label="SMTP username" value={settings.smtp.username} onChange={v=>setSmtp("username",v)}/>
        <OpField label="SMTP password hidden" type="password" value={settings.smtp.password} onChange={v=>setSmtp("password",v)}/>
        <OpField label="From email" value={settings.smtp.from_email} onChange={v=>setSmtp("from_email",v)} placeholder="reports@company.com"/>
        <OpField label="From name" value={settings.smtp.from_name} onChange={v=>setSmtp("from_name",v)} placeholder="AG-metrics Reports"/>
        <OpField label="Enable/disable email sending" value={settings.smtp.email_enabled === false ? "Disabled" : "Enabled"} onChange={v=>setSmtp("email_enabled",v==="Enabled")} options={["Enabled","Disabled"]}/>
        <OpField label="Test email recipient" value={testTo} onChange={setTestTo} placeholder="user@company.com"/>
      </div>
      <div style={opStyles.actions}>
        <OpButton onClick={testConnection} disabled={!!busy}>{busy==="test" ? "Testing..." : "Test SMTP Connection"}</OpButton>
        <OpButton onClick={testConnection} disabled={!!busy}>{busy==="test" ? "Sending..." : "Send Test Email"}</OpButton>
        <OpButton tone="primary" onClick={save} disabled={!!busy}>{busy==="save" ? "Saving..." : "Save Configuration"}</OpButton>
      </div>
    </div>
  );
}

function OpPage({ title, msg, children }) {
  const tr = window.t || (v => v);
  return (
    <div>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18}}>
        <div style={{fontSize:16, fontWeight:700, color:"#e8edf5"}}>{tr(title)}</div>
        {msg && <div style={{fontSize:12, color:msg.toLowerCase().includes("fail") || msg.toLowerCase().includes("error") ? "#ff4c6a" : "#22c97b"}}>{msg}</div>}
      </div>
      {children}
    </div>
  );
}

const opStyles = {
  formGrid: {display:"grid", gridTemplateColumns:"repeat(2, minmax(220px, 1fr))", gap:"14px 16px", marginBottom:18},
  field: {display:"flex", flexDirection:"column", gap:6},
  label: {fontSize:11, color:"#8a9ab5", fontWeight:500},
  input: {width:"100%", background:"#080d1a", border:"1px solid #2a3045", borderRadius:7, padding:"9px 12px", color:"#e8edf5", fontSize:13, fontFamily:"inherit", outline:"none"},
  checkbox: {width:18, height:18},
  btn: {border:"1px solid", borderRadius:7, padding:"7px 10px", fontSize:11, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap"},
  actions: {display:"flex", gap:7, flexWrap:"wrap", alignItems:"center"},
  tablePanel: {background:"#0d1525", border:"1px solid #2a3045", borderRadius:8, overflow:"hidden", marginTop:14},
  table: {width:"100%", borderCollapse:"collapse", fontSize:12},
  th: {padding:"10px 12px", textAlign:"left", fontSize:11, color:"#5b6a8a", borderBottom:"1px solid #1e2535", whiteSpace:"nowrap"},
  td: {padding:"10px 12px", color:"#c8d4e8", borderBottom:"1px solid #1a1e2e", verticalAlign:"top"},
  notice: {background:"#080d1a", border:"1px solid #2a3045", borderRadius:7, padding:"10px 12px", fontSize:12, marginBottom:14},
  hint: {fontSize:11, color:"#5b6a8a", marginTop:6, lineHeight:1.35},
  guideBox: {background:"#080d1a", border:"1px solid #2a3045", borderRadius:7, padding:"10px 12px", color:"#8a9ab5", fontSize:12, lineHeight:1.4, marginTop:6},
  laneBox: {background:"#080d1a", border:"1px solid #2a3045", borderRadius:7, padding:"10px 12px", marginTop:6},
  chip: {border:"1px solid", borderRadius:6, padding:"5px 10px", fontSize:11, cursor:"pointer", fontFamily:"inherit"},
  previewPanel: {background:"#0d1525", border:"1px solid #2a3045", borderRadius:8, padding:"16px 18px", marginBottom:22},
  previewHeader: {display:"flex", justifyContent:"space-between", gap:14, alignItems:"flex-start", marginBottom:14},
  kpiGrid: {display:"grid", gridTemplateColumns:"repeat(6, minmax(110px, 1fr))", gap:10, marginBottom:14},
  kpiCard: {background:"#080d1a", border:"1px solid #1e2535", borderRadius:7, padding:"11px 12px"},
  chartPanel: {background:"#080d1a", border:"1px solid #1e2535", borderRadius:7, padding:"13px 14px", minHeight:220},
  panelTitle: {fontSize:13, fontWeight:700, color:"#e8edf5", marginBottom:12},
  emptyBox: {height:"100%", minHeight:180, display:"flex", alignItems:"center", justifyContent:"center", color:"#5b6a8a", fontSize:12, textAlign:"center"},
  contentLine: {display:"flex", justifyContent:"space-between", gap:12, borderBottom:"1px solid #1e2535", padding:"8px 0"},
};

Object.assign(window, { ReportsModule, AlarmsModule, NotificationsModule, SettingsModule });
