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

/* ─────────────────────────────────────────────────────────────────────────
   Excel helpers shared across builders
   ───────────────────────────────────────────────────────────────────────── */
// bgcolor attribute + CSS background-color: garantiza colores en Excel/LibreOffice
function xlHeader(label, bg) {
  bg = bg || "#1e3a5f";
  return `<th bgcolor="${bg}" style="background:${bg};color:#fff;font-weight:bold;padding:6px 8px;border:1px solid #9aa4b2;white-space:nowrap;font-size:11px;">${excelEscape(label)}</th>`;
}
function xlGroupHeader(label, colspan, bg) {
  return `<th colspan="${colspan}" bgcolor="${bg}" style="background:${bg};color:#fff;font-weight:bold;padding:5px 8px;border:1px solid #9aa4b2;text-align:center;font-size:10px;letter-spacing:0.8px;text-transform:uppercase;">${excelEscape(label)}</th>`;
}
function xlCell(value, bg, fg, bold) {
  const b = bold ? "font-weight:bold;" : "";
  return `<td bgcolor="${bg}" style="background-color:${bg};color:${fg};padding:4px 8px;border:1px solid #d0d7e0;${b}white-space:nowrap;font-size:11px;">${excelEscape(value)}</td>`;
}
function xlNA() {
  // Celda marcada con "—" para campos que no aplican al tipo de evento
  return `<td bgcolor="#f0f0f0" style="background-color:#f0f0f0;color:#c0c0c0;padding:4px 8px;border:1px solid #d0d7e0;text-align:center;font-size:11px;">—</td>`;
}
function xlBadgeCell(value, badgeBg, badgeFg, cellBg) {
  cellBg = cellBg || "#f8f9fa";
  return `<td bgcolor="${cellBg}" style="background-color:${cellBg};padding:4px 6px;border:1px solid #d0d7e0;">
    <span style="background:${badgeBg};color:${badgeFg};border-radius:3px;padding:2px 8px;font-size:10px;font-weight:bold;white-space:nowrap;">${excelEscape(value)}</span></td>`;
}
function xlLegend(items) {
  return `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 16px;padding:10px 14px;background:#f8f9fa;border:1px solid #dde3ea;border-radius:4px;">
    <strong style="color:#162036;font-size:11px;margin-right:6px;align-self:center;">Leyenda:</strong>
    ${items.map(m => `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#333;">
      <span style="width:16px;height:16px;background:${m.bg};border:2px solid ${m.border};border-radius:3px;display:inline-block;flex-shrink:0;"></span>
      <strong style="color:${m.fg};">${excelEscape(m.badge)}</strong> — ${excelEscape(m.label)}</span>`).join("")}
  </div>`;
}
function xlStats(items) {
  // Fondo claro — compatible con Excel que tiene fondo blanco por defecto
  return `<div style="display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px;padding:10px 14px;background:#eef2f8;border:1px solid #c8d4e0;border-radius:6px;">
    ${items.map(s => {
      const fgCol = (s.color === "#e8edf5" || s.color === "#c8d4e8") ? "#162036" : s.color;
      return `<div style="text-align:center;padding:4px 12px;background:#fff;border:1px solid #d0d7e0;border-top:3px solid ${fgCol};border-radius:4px;">
        <div style="font-size:18px;font-weight:bold;color:${fgCol};">${excelEscape(String(s.value))}</div>
        <div style="font-size:10px;color:#555;margin-top:2px;">${excelEscape(s.label)}</div>
      </div>`;
    }).join("")}
  </div>`;
}
function xlBaseHtml(title, subtitle, statsHtml, legendHtml, tableHtml) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;font-size:11px;margin:20px;background:#fff;color:#162036;}
  h2{color:#162036;margin:0 0 4px;font-size:15px;}
  p.sub{color:#475569;margin:0 0 12px;font-size:12px;}
  table{border-collapse:collapse;width:100%;margin-top:4px;}
  th,td{vertical-align:middle;}
</style></head><body>
<h2>${excelEscape(title)}</h2>
<p class="sub">${subtitle}</p>
${statsHtml}${legendHtml}${tableHtml}
<p style="color:#aaa;font-size:10px;margin-top:18px;">Generado por AG-metrics · ${new Date().toLocaleString("es-MX")}</p>
</body></html>`;
}

/* ─── SP Completo ───────────────────────────────────────────────────────── */
// 27 columnas: 3 ID + 4 básicos + 6 clasificación + 6 trazabilidad + 4 financiero + 4 AVC ref
function buildSPExcel(events, dateFrom, dateTo) {
  const COLORS = {
    MATCH:       { bg:"#e2f0d9", fg:"#1a5c33", border:"#70ad47", badge:"✓ SP Conciliado",  badgeBg:"#70ad47", badgeFg:"#fff" },
    SAT:         { bg:"#ddeeff", fg:"#1f4e79", border:"#5b9cf6", badge:"◎ SP Sin AVC",    badgeBg:"#2f75b6", badgeFg:"#fff" },
    SP_EXCLUDED: { bg:"#ececec", fg:"#555555", border:"#aaaaaa", badge:"○ SP Excluido",    badgeBg:"#7f7f7f", badgeFg:"#fff" },
  };
  const spEvents = events.filter(ev => ["MATCH","SAT","SP_EXCLUDED"].includes(ev.tipo));
  const nMatch = spEvents.filter(e=>e.tipo==="MATCH").length;
  const nSat   = spEvents.filter(e=>e.tipo==="SAT").length;
  const nExcl  = spEvents.filter(e=>e.tipo==="SP_EXCLUDED").length;

  const statsHtml = xlStats([
    { label:"Total SP",        value:spEvents.length, color:"#162036" },
    { label:"SP Conciliados",  value:nMatch,          color:"#1a5c33" },
    { label:"SP Sin AVC",      value:nSat,            color:"#1f4e79" },
    { label:"SP Excluidos",    value:nExcl,           color:"#555555" },
    { label:"Período",         value:dateFrom + " – " + dateTo, color:"#475569" },
  ]);

  // grupos: 3 + 4 + 6 + 6 + 4 + 4 = 27
  const groupRow = `<tr>
    ${xlGroupHeader("IDENTIFICACIÓN",3,"#1e3a5f")}
    ${xlGroupHeader("DATOS BÁSICOS SP",4,"#1f4e79")}
    ${xlGroupHeader("CLASIFICACIÓN VEHICULAR",6,"#375623")}
    ${xlGroupHeader("TRAZABILIDAD SP",6,"#6b3000")}
    ${xlGroupHeader("FINANCIERO",4,"#1a3a1a")}
    ${xlGroupHeader("AVC REFERENCIA (solo MATCH)",4,"#1e5c28")}
  </tr>`;
  const headerRow = `<tr>
    ${xlHeader("Fecha","#1e3a5f")}${xlHeader("Carril","#1e3a5f")}${xlHeader("Estado","#1e3a5f")}
    ${xlHeader("SP Hora","#1f4e79")}${xlHeader("SP Voie","#1f4e79")}${xlHeader("SP ID Voie","#1f4e79")}${xlHeader("SP Número","#1f4e79")}
    ${xlHeader("SP ID Clase","#375623")}${xlHeader("SP Clase Desc","#375623")}${xlHeader("SP Tab Clase","#375623")}${xlHeader("SP Tab Desc","#375623")}${xlHeader("SP ID Ejes","#375623")}${xlHeader("SP Tab Ejes","#375623")}
    ${xlHeader("SP Day ID","#6b3000")}${xlHeader("SP ID Gare","#6b3000")}${xlHeader("SP Nro Poste","#6b3000")}${xlHeader("SP Matricule","#6b3000")}${xlHeader("SP Obs Seq","#6b3000")}${xlHeader("SP Obs Pasaje","#6b3000")}
    ${xlHeader("SP Obs MP","#1a3a1a")}${xlHeader("SP ID Pago","#1a3a1a")}${xlHeader("SP Modo Pago","#1a3a1a")}${xlHeader("SP Precio ($)","#1a3a1a")}
    ${xlHeader("AVC Hora","#1e5c28")}${xlHeader("AVC Ejes","#1e5c28")}${xlHeader("AVC Clase","#1e5c28")}${xlHeader("Delta (s)","#1e5c28")}
  </tr>`;

  const dataRows = spEvents.map(ev => {
    const c = COLORS[ev.tipo] || COLORS.SAT;
    const g = (v) => xlCell(v, c.bg, c.fg, false);
    const gAVC = (v) => ev.tipo === "MATCH" ? xlCell(v, "#eaf5ea", "#1a5c33", false) : xlNA();
    return `<tr>
      ${g(ev.fecha)}${g(ev.carril)}${xlBadgeCell(c.badge, c.badgeBg, c.badgeFg, c.bg)}
      ${g(ev.sat_hora)}${g(ev.sat_voie)}${g(ev.sat_id_voie_num)}${g(ev.sat_numero)}
      ${g(ev.sat_id_classe)}${g(ev.sat_id_classe_desc)}${g(ev.sat_tab_id_classe)}${g(ev.sat_tab_id_classe_desc)}${g(ev.sat_id_classe_ejes)}${g(ev.sat_tab_id_classe_ejes)}
      ${g(ev.sat_day_id)}${g(ev.sat_id_gare)}${g(ev.sat_numero_poste)}${g(ev.sat_matricule)}${g(ev.sat_id_obs_sequence)}${g(ev.sat_id_obs_passage)}
      ${g(ev.sat_id_obs_mp)}${g(ev.sat_id_paiement)}${g(ev.sat_mode_reglement)}${xlCell(ev.sat_precio || "", c.bg, c.fg, true)}
      ${gAVC(ev.avc_hora)}${gAVC(ev.avc_ejes)}${gAVC(ev.avc_clase)}${gAVC(ev.delta_segundos)}
    </tr>`;
  }).join("");

  const tableHtml = `<table><thead>${groupRow}${headerRow}</thead><tbody>${dataRows}</tbody></table>`;
  return xlBaseHtml(
    "Reporte SP — Transacciones Sistema de Peaje",
    `Período: ${dateFrom} al ${dateTo} · Total: ${spEvents.length} transacciones SP · Carriles: ${[...new Set(spEvents.map(e=>e.carril))].join(", ") || "todos"}`,
    statsHtml,
    xlLegend([
      { bg:"#e2f0d9", border:"#70ad47", fg:"#1a5c33", badge:"✓ SP Conciliado",  label:"Transacción SP con detección AVC correspondiente" },
      { bg:"#ddeeff", border:"#5b9cf6", fg:"#1f4e79", badge:"◎ SP Sin AVC",    label:"Transacción SP sin detección AVC en ventana de tiempo" },
      { bg:"#ececec", border:"#aaaaaa", fg:"#555555", badge:"○ SP Excluido",    label:"Evento SP no conciliable (obs_mp=30, clase=0, pago=0)" },
    ]),
    tableHtml
  );
}

/* ─── AVC Puro ──────────────────────────────────────────────────────────── */
// 20 columnas: 3 ID + 6 AVC + 7 SP (solo MATCH) + 4 auditoría
function buildAVCExcel(events, dateFrom, dateTo) {
  const COLORS = {
    MATCH: { bg:"#e2f0d9", fg:"#1a5c33", border:"#70ad47", badge:"✓ AVC Conciliado", badgeBg:"#70ad47", badgeFg:"#fff" },
    AVC:   { bg:"#fce4d6", fg:"#7b2b00", border:"#ff7e3f", badge:"◎ AVC Sin SP",    badgeBg:"#e05b1a", badgeFg:"#fff" },
  };
  const avcEvents = events.filter(ev => ["MATCH","AVC"].includes(ev.tipo));
  const nMatch = avcEvents.filter(e=>e.tipo==="MATCH").length;
  const nAvc   = avcEvents.filter(e=>e.tipo==="AVC").length;
  const detRate = avcEvents.length ? Math.round((avcEvents.length - nAvc) / avcEvents.length * 1000) / 10 : 0;

  const statsHtml = xlStats([
    { label:"Total AVC",       value:avcEvents.length, color:"#162036" },
    { label:"AVC Conciliados", value:nMatch,           color:"#1a5c33" },
    { label:"AVC Sin SP",      value:nAvc,             color:"#e05b1a" },
    { label:"Tasa Detección",  value:detRate + "%",    color: detRate>=97?"#1a5c33":detRate>=93?"#7a5d00":"#c0392b" },
    { label:"Período",         value:dateFrom + " – " + dateTo, color:"#475569" },
  ]);

  // grupos: 3 + 6 + 7 + 4 = 20
  const groupRow = `<tr>
    ${xlGroupHeader("IDENTIFICACIÓN",3,"#1e3a5f")}
    ${xlGroupHeader("DETECCIÓN AVC",6,"#1e5c28")}
    ${xlGroupHeader("SP COINCIDENTE (solo MATCH)",7,"#1f4e79")}
    ${xlGroupHeader("AUDITORÍA",4,"#6b3000")}
  </tr>`;
  const headerRow = `<tr>
    ${xlHeader("Fecha","#1e3a5f")}${xlHeader("Carril","#1e3a5f")}${xlHeader("Estado","#1e3a5f")}
    ${xlHeader("AVC ID","#1e5c28")}${xlHeader("AVC Device","#1e5c28")}${xlHeader("AVC Hora","#1e5c28")}${xlHeader("AVC Tipo Vehículo","#1e5c28")}${xlHeader("AVC Ejes","#1e5c28")}${xlHeader("AVC Clase","#1e5c28")}
    ${xlHeader("SP Voie","#1f4e79")}${xlHeader("SP Hora","#1f4e79")}${xlHeader("SP Número","#1f4e79")}${xlHeader("SP Precio ($)","#1f4e79")}${xlHeader("SP ID Clase","#1f4e79")}${xlHeader("SP Clase Desc","#1f4e79")}${xlHeader("SP Modo Pago","#1f4e79")}
    ${xlHeader("Delta (s)","#6b3000")}${xlHeader("Nota Ejes","#6b3000")}${xlHeader("Motivo No Match","#6b3000")}${xlHeader("Observación","#6b3000")}
  </tr>`;

  const dataRows = avcEvents.map(ev => {
    const c = COLORS[ev.tipo] || COLORS.AVC;
    const g  = (v) => xlCell(v, c.bg, c.fg, false);
    const gSP = (v) => ev.tipo === "MATCH" ? xlCell(v, "#eaf4ff", "#1f4e79", false) : xlNA();
    return `<tr>
      ${g(ev.fecha)}${g(ev.carril)}${xlBadgeCell(c.badge, c.badgeBg, c.badgeFg, c.bg)}
      ${g(ev.avc_id)}${g(ev.avc_device)}${g(ev.avc_hora)}${g(ev.avc_vehiculo)}${g(ev.avc_ejes)}${g(ev.avc_clase)}
      ${gSP(ev.sat_voie)}${gSP(ev.sat_hora)}${gSP(ev.sat_numero)}${gSP(ev.sat_precio)}${gSP(ev.sat_id_classe)}${gSP(ev.sat_id_classe_desc)}${gSP(ev.sat_mode_reglement)}
      ${g(ev.delta_segundos)}${g(ev.nota_ejes)}${g(ev.motivo_no_match)}${g(ev.observacion)}
    </tr>`;
  }).join("");

  const tableHtml = `<table><thead>${groupRow}${headerRow}</thead><tbody>${dataRows}</tbody></table>`;
  return xlBaseHtml(
    "Reporte AVC Puro — Detecciones del Sistema de Clasificación Vehicular",
    `Período: ${dateFrom} al ${dateTo} · Total: ${avcEvents.length} detecciones · Tasa: ${detRate}% · Carriles: ${[...new Set(avcEvents.map(e=>e.carril))].join(", ") || "todos"}`,
    statsHtml,
    xlLegend([
      { bg:"#e2f0d9", border:"#70ad47", fg:"#1a5c33", badge:"✓ AVC Conciliado", label:"Detección AVC con transacción SP correspondiente" },
      { bg:"#fce4d6", border:"#ff7e3f", fg:"#7b2b00", badge:"◎ AVC Sin SP",    label:"Detección AVC sin transacción SP — posible evasión o error de detección" },
    ]),
    tableHtml
  );
}

/* ─── Conciliación AVC vs SP ─────────────────────────────────────────────── */
// 25/26 columnas: 3 ID + 6 AVC + 12 SP + 3/4 conciliación (4 si showAxle)
function buildDetailExcel(events, dateFrom, dateTo, showAxle) {
  const COLORS = {
    MATCH_OK:    { bg:"#e2f0d9", fg:"#1a5c33", border:"#70ad47", badge:"✓ Coincidencia",    badgeBg:"#70ad47", badgeFg:"#fff" },
    MATCH_AXLE:  { bg:"#fff2cc", fg:"#7a5d00", border:"#d4a300", badge:"△ Match/Error Ejes", badgeBg:"#d4a300", badgeFg:"#fff" },
    AVC:         { bg:"#fce4d6", fg:"#7b2b00", border:"#ff7e3f", badge:"◎ Solo AVC",         badgeBg:"#e05b1a", badgeFg:"#fff" },
    SAT:         { bg:"#ddeeff", fg:"#1f4e79", border:"#5b9cf6", badge:"◎ Solo SP",          badgeBg:"#2f75b6", badgeFg:"#fff" },
    SP_EXCLUDED: { bg:"#ececec", fg:"#555555", border:"#aaaaaa", badge:"○ SP Excluido",       badgeBg:"#7f7f7f", badgeFg:"#fff" },
  };
  function getC(ev) {
    if (ev.tipo === "AVC")         return COLORS.AVC;
    if (ev.tipo === "SAT")         return COLORS.SAT;
    if (ev.tipo === "SP_EXCLUDED") return COLORS.SP_EXCLUDED;
    if (showAxle && String(ev.nota_ejes||"").startsWith("ERROR")) return COLORS.MATCH_AXLE;
    return COLORS.MATCH_OK;
  }
  const hasAVC = (ev) => ["MATCH","AVC"].includes(ev.tipo);
  const hasSP  = (ev) => ["MATCH","SAT","SP_EXCLUDED"].includes(ev.tipo);

  const nMatch = events.filter(e=>e.tipo==="MATCH").length;
  const nAvc   = events.filter(e=>e.tipo==="AVC").length;
  const nSat   = events.filter(e=>e.tipo==="SAT").length;
  const nExcl  = events.filter(e=>e.tipo==="SP_EXCLUDED").length;
  const conciliable = nMatch + nAvc + nSat;
  const detRate = conciliable ? Math.round((conciliable - nSat) / conciliable * 1000) / 10 : 0;

  const statsHtml = xlStats([
    { label:"Total conciliable", value:conciliable,    color:"#162036" },
    { label:"Coincidencias",     value:nMatch,         color:"#1a5c33" },
    { label:"AVC sin SP",        value:nAvc,           color:"#e05b1a" },
    { label:"SP sin AVC",        value:nSat,           color:"#1f4e79" },
    { label:"Tasa Detección",    value:detRate + "%",  color: detRate>=97?"#1a5c33":detRate>=93?"#7a5d00":"#c0392b" },
    { label:"SP Excluidos",      value:nExcl,          color:"#555555" },
  ]);

  const axleCols = showAxle ? 1 : 0;
  // grupos: 3 + 6 + 12 + (3+axleCols) = 24/25
  const groupRow = `<tr>
    ${xlGroupHeader("IDENTIFICACIÓN",3,"#1e3a5f")}
    ${xlGroupHeader("DETECCIÓN AVC",6,"#1e5c28")}
    ${xlGroupHeader("TRANSACCIÓN SP",12,"#1f4e79")}
    ${xlGroupHeader("CONCILIACIÓN",3 + axleCols,"#6b3000")}
  </tr>`;
  const headerRow = `<tr>
    ${xlHeader("Fecha","#1e3a5f")}${xlHeader("Carril","#1e3a5f")}${xlHeader("Estado","#1e3a5f")}
    ${xlHeader("AVC ID","#1e5c28")}${xlHeader("AVC Device","#1e5c28")}${xlHeader("AVC Hora","#1e5c28")}${xlHeader("AVC Tipo Vehículo","#1e5c28")}${xlHeader("AVC Ejes","#1e5c28")}${xlHeader("AVC Clase","#1e5c28")}
    ${xlHeader("SP Hora","#1f4e79")}${xlHeader("SP Voie","#1f4e79")}${xlHeader("SP Número","#1f4e79")}${xlHeader("SP Precio ($)","#1f4e79")}${xlHeader("SP ID Clase","#1f4e79")}${xlHeader("SP Clase Desc","#1f4e79")}${xlHeader("SP Tab Clase","#1f4e79")}${xlHeader("SP Tab Desc","#1f4e79")}${xlHeader("SP ID Ejes","#1f4e79")}${xlHeader("SP Tab Ejes","#1f4e79")}${xlHeader("SP Modo Pago","#1f4e79")}${xlHeader("SP Obs MP","#1f4e79")}
    ${xlHeader("Delta (s)","#6b3000")}${showAxle ? xlHeader("Nota Ejes","#6b3000") : ""}${xlHeader("Motivo No Match","#6b3000")}${xlHeader("Observación","#6b3000")}
  </tr>`;

  const dataRows = events.map(ev => {
    const c    = getC(ev);
    const g    = (v) => xlCell(v, c.bg, c.fg, false);
    const gAVC = (v) => hasAVC(ev) ? g(v) : xlNA();
    const gSP  = (v) => hasSP(ev)  ? g(v) : xlNA();
    return `<tr>
      ${g(ev.fecha)}${g(ev.carril)}${xlBadgeCell(c.badge, c.badgeBg, c.badgeFg, c.bg)}
      ${gAVC(ev.avc_id)}${gAVC(ev.avc_device)}${gAVC(ev.avc_hora)}${gAVC(ev.avc_vehiculo)}${gAVC(ev.avc_ejes)}${gAVC(ev.avc_clase)}
      ${gSP(ev.sat_hora)}${gSP(ev.sat_voie)}${gSP(ev.sat_numero)}${gSP(ev.sat_precio)}${gSP(ev.sat_id_classe)}${gSP(ev.sat_id_classe_desc)}${gSP(ev.sat_tab_id_classe)}${gSP(ev.sat_tab_id_classe_desc)}${gSP(ev.sat_id_classe_ejes)}${gSP(ev.sat_tab_id_classe_ejes)}${gSP(ev.sat_mode_reglement)}${gSP(ev.sat_id_obs_mp)}
      ${g(ev.delta_segundos)}${showAxle ? g(ev.nota_ejes) : ""}${g(ev.motivo_no_match)}${g(ev.observacion)}
    </tr>`;
  }).join("");

  const legendItems = [
    { bg:"#e2f0d9", border:"#70ad47", fg:"#1a5c33", badge:"✓ Coincidencia",    label:"AVC y SP conciliados correctamente" },
    ...(showAxle ? [{ bg:"#fff2cc", border:"#d4a300", fg:"#7a5d00", badge:"△ Match/Error Ejes", label:"Conciliado pero con discrepancia en ejes AVC" }] : []),
    { bg:"#fce4d6", border:"#ff7e3f", fg:"#7b2b00", badge:"◎ Solo AVC",        label:"AVC detectó vehículo pero SP no registró transacción" },
    { bg:"#ddeeff", border:"#5b9cf6", fg:"#1f4e79", badge:"◎ Solo SP",          label:"SP registró transacción pero AVC no detectó vehículo" },
    { bg:"#ececec", border:"#aaaaaa", fg:"#555555", badge:"○ SP Excluido",       label:"Transacción SP excluida de conciliación (obs_mp=30)" },
  ];

  const tableHtml = `<table><thead>${groupRow}${headerRow}</thead><tbody>${dataRows}</tbody></table>`;
  return xlBaseHtml(
    "Conciliación AVC vs SP — Detalle por evento",
    `Período: ${dateFrom} al ${dateTo} · Total: ${events.length} eventos · Carriles: ${[...new Set(events.map(e=>e.carril))].join(", ") || "todos"}`,
    statsHtml, xlLegend(legendItems), tableHtml
  );
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
  const [spLoading, setSpLoading]       = React.useState(false);
  const [avcLoading, setAvcLoading]     = React.useState(false);
  const [apiErr, setApiErr] = React.useState("");
  const [sendMsg, setSendMsg] = React.useState("");
  const [sendingEmail, setSendingEmail] = React.useState(false); // false | "daily" | "weekly" | "monthly"
  const [smtpSettings, setSmtpSettings] = React.useState(null);

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
    const filtered = rawRows.filter(r => selectedLanes.includes(r.lane));
    // Safety dedup: backend already deduplicates, but guard against regressions.
    // Prefer the row with the highest source_id (real source > 0 fallback).
    const seen = new Map();
    filtered.forEach(r => {
      const key = `${r.date}::${r.lane}`;
      const prev = seen.get(key);
      if (!prev || Number(r.source_id || 0) > Number(prev.source_id || 0)) seen.set(key, r);
    });
    return [...seen.values()];
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
    });
    return Object.entries(counts).map(([motivo,count]) => ({motivo,count})).sort((a,b)=>b.count-a.count);
  }, [tableData]);

  const classBreakdown = React.useMemo(() => {
    return (report?.class_breakdown || []).filter(() => true);
  }, [report, selectedLanes]);

  const worstRows = React.useMemo(() => {
    return [...discrepancyData]
      .sort((a,b) => ((b.discrepancyRate || 0) - (a.discrepancyRate || 0)) || ((b.discrepancyCount || 0) - (a.discrepancyCount || 0)))
      .slice(0, 8);
  }, [discrepancyData]);

  // Lane-level aggregates for the comparison panel
  const laneAggregates = React.useMemo(() => {
    return selectedLanes.map(lane => {
      const laneRows = tableData.filter(r => r.lane === lane);
      const t = laneRows.reduce((acc, r) => {
        acc.total   += Number(r.total   || 0);
        acc.matched += Number(r.matched || 0);
        acc.avcOnly += Number(r.avcOnly || 0);
        acc.satOnly += Number(r.satOnly || 0);
        return acc;
      }, {total:0, matched:0, avcOnly:0, satOnly:0});
      t.matchRate = Math.round((t.total - t.satOnly) / Math.max(t.total, 1) * 1000) / 10;
      return {lane, ...t};
    });
  }, [tableData, selectedLanes]);

  // Date-grouped rows for the main table
  const byDate = React.useMemo(() => {
    const dates = [...new Set(displayRows.map(r => r.date))].sort();
    return dates.map(date => {
      const dayRows = displayRows.filter(r => r.date === date);
      const dt = dayRows.reduce((acc, r) => {
        acc.total        += Number(r.total        || 0);
        acc.matched      += Number(r.matched      || 0);
        acc.avcOnly      += Number(r.avcOnly      || 0);
        acc.satOnly      += Number(r.satOnly      || 0);
        acc.classMismatch+= Number(r.classMismatch|| 0);
        acc.sat_money    += Number(r.sat_money    || 0);
        acc.avc_money    += Number(r.avc_money    || 0);
        return acc;
      }, {total:0,matched:0,avcOnly:0,satOnly:0,classMismatch:0,sat_money:0,avc_money:0});
      dt.matchRate = Math.round((dt.total - dt.satOnly) / Math.max(dt.total, 1) * 1000) / 10;
      dt.discrepancyCount = dt.avcOnly + dt.satOnly;
      dt.discrepancyRate  = Math.round(dt.discrepancyCount / Math.max(dt.total, 1) * 1000) / 10;
      return {date, rows: dayRows, totals: dt};
    });
  }, [displayRows]);

  // Day-over-day evolution (always from full tableData, not filtered by discrepancy)
  const dailyEvolution = React.useMemo(() => {
    const dates = [...new Set(tableData.map(r => r.date))].sort();
    const daily = dates.map(date => {
      const dayRows = tableData.filter(r => r.date === date);
      const t = dayRows.reduce((acc, r) => {
        acc.total   += Number(r.total   || 0);
        acc.avcOnly += Number(r.avcOnly || 0);
        acc.satOnly += Number(r.satOnly || 0);
        return acc;
      }, {total:0, avcOnly:0, satOnly:0});
      t.matchRate = Math.round((t.total - t.satOnly) / Math.max(t.total, 1) * 1000) / 10;
      return {date, ...t};
    });
    return daily.map((row, i) => {
      const prev = i > 0 ? daily[i - 1] : null;
      return {
        ...row,
        deltaRate: prev !== null ? Math.round((row.matchRate - prev.matchRate) * 10) / 10 : null,
        deltaAvc:  prev !== null ? row.avcOnly - prev.avcOnly : null,
        deltaSat:  prev !== null ? row.satOnly - prev.satOnly : null,
      };
    });
  }, [tableData]);

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
    const rows = displayRows.map(r => ({
      Fecha: r.date, Carril: r.lane, Total: r.total, Coincidencias: r.matched,
      "AVC sin SP": r.avcOnly, "SP sin AVC": r.satOnly,
      "Clase distinta": r.classMismatch, "Match rate": `${r.matchRate}%`,
      "Discrepancias": r.discrepancyCount, "% discrepancia": `${r.discrepancyRate}%`,
      "SP facturado": r.sat_money, "AVC estimado": r.avc_money,
    }));
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

  function exportSPExcel() {
    setSpLoading(true);
    const lanesParam = selectedLanes.length ? `&lanes=${encodeURIComponent(selectedLanes.join(","))}` : "";
    window.API.get(`/api/reports/events?date_from=${dateFrom}&date_to=${dateTo}${lanesParam}&limit=50000`)
      .then(data => {
        const html = buildSPExcel(data.events || [], dateFrom, dateTo);
        downloadBlob(html, `ag-metrics-sp-${dateFrom}-${dateTo}.xls`, "application/vnd.ms-excel;charset=utf-8;");
      })
      .catch(e => setSendMsg("Error al generar Excel SP: " + (e.message || "")))
      .finally(() => setSpLoading(false));
  }

  function exportAVCExcel() {
    setAvcLoading(true);
    const lanesParam = selectedLanes.length ? `&lanes=${encodeURIComponent(selectedLanes.join(","))}` : "";
    window.API.get(`/api/reports/events?date_from=${dateFrom}&date_to=${dateTo}${lanesParam}&limit=50000`)
      .then(data => {
        const html = buildAVCExcel(data.events || [], dateFrom, dateTo);
        downloadBlob(html, `ag-metrics-avc-${dateFrom}-${dateTo}.xls`, "application/vnd.ms-excel;charset=utf-8;");
      })
      .catch(e => setSendMsg("Error al generar Excel AVC: " + (e.message || "")))
      .finally(() => setAvcLoading(false));
  }

  function sendByType(type) {
    setSendingEmail(type); setSendMsg("");
    const today = new Date();
    const fmt = d => d.toISOString().slice(0, 10);
    let dateFrom, dateTo;
    if (type === "weekly") {
      const from = new Date(today); from.setDate(today.getDate() - 6);
      dateFrom = fmt(from); dateTo = fmt(today);
    } else if (type === "monthly") {
      const firstThis = new Date(today.getFullYear(), today.getMonth(), 1);
      const lastPrev  = new Date(firstThis); lastPrev.setDate(0);
      const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
      dateFrom = fmt(firstPrev); dateTo = fmt(lastPrev);
    } else {
      const yest = new Date(today); yest.setDate(today.getDate() - 1);
      dateFrom = dateTo = fmt(yest);
    }
    window.API.post("/api/report-email/send-now", {report_type: type, date_from: dateFrom, date_to: dateTo})
      .then(r => setSendMsg(`✓ Reporte ${type} enviado a ${r.sent} destinatario(s)  (${dateFrom}${dateFrom !== dateTo ? " – " + dateTo : ""})`))
      .catch(e => setSendMsg("Error: " + (e.message || "Revisa SMTP y destinatarios")))
      .finally(() => setSendingEmail(false));
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
        <div style={{display:"flex", gap:6, marginLeft:"auto", flexWrap:"wrap", alignItems:"flex-start"}}>
          <div style={{fontSize:10, color:"#5b6a8a", alignSelf:"center", marginRight:2, whiteSpace:"nowrap"}}>↓ Exportar Excel:</div>
          {[
            { label:"Resumen",      desc:"KPIs por fecha/carril",          accent:"#4d7fe0", onClick:exportBasicExcel,  loading:false,        disabled:!displayRows.length },
            { label:"Conciliación", desc:"AVC vs SP, evento por evento",   accent:"#22c97b", onClick:exportDetailExcel, loading:excelLoading, disabled:!displayRows.length||excelLoading },
            { label:"SP Completo",  desc:"Todos los campos del peaje SP",  accent:"#5b9cf6", onClick:exportSPExcel,     loading:spLoading,    disabled:!displayRows.length||spLoading },
            { label:"AVC Puro",     desc:"Solo detecciones AVC",           accent:"#ff7e3f", onClick:exportAVCExcel,    loading:avcLoading,   disabled:!displayRows.length||avcLoading },
          ].map(b => (
            <button key={b.label} onClick={b.onClick} disabled={b.disabled}
              style={{
                background: b.disabled ? "#0f1928" : "#1e2535",
                border:`1px solid ${b.disabled?"#1a2030":b.accent+"55"}`,
                borderTop:`2px solid ${b.disabled?"#1a2030":b.accent}`,
                borderRadius:7, padding:"7px 12px", cursor:b.disabled?"default":"pointer",
                fontFamily:"inherit", textAlign:"left", display:"flex", flexDirection:"column", gap:2,
                minWidth:110, transition:"all 0.15s",
              }}>
              <span style={{fontSize:12, fontWeight:700, color: b.disabled?"#3a4860":b.loading?"#5b6a8a":"#c8d4e8", whiteSpace:"nowrap"}}>
                {b.loading ? "Generando…" : `↓ ${b.label}`}
              </span>
              <span style={{fontSize:10, color: b.disabled?"#2a3548":"#5b6a8a", whiteSpace:"nowrap"}}>{b.desc}</span>
            </button>
          ))}
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
      <div style={{display:"grid", gridTemplateColumns:"repeat(5, minmax(120px,1fr))", gap:12, marginBottom:16}}>
        {[
          {label:"Total Eventos",  value:reportNum(filteredTotals.total),   color:"#e8edf5"},
          {label:"Coincidencias",  value:reportNum(filteredTotals.matched),  color:"#22c97b"},
          {label:"AVC sin SP",     value:reportNum(filteredTotals.avcOnly),  color:"#ff7e3f"},
          {label:"SP sin AVC",     value:reportNum(filteredTotals.satOnly),  color:"#5b9cf6"},
          {label:"Tasa Detección", value:`${filteredTotals.matchRate}%`,     color:reportRateColor(filteredTotals.matchRate)},
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

      {/* ── Comparativa de carriles ── */}
      {laneAggregates.length > 0 && (
        <div style={{...rptStyles.panel, marginBottom:24}}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16}}>
            <div style={rptStyles.panelTitle}>Estado por carril — período completo</div>
            <div style={{display:"flex", gap:14, fontSize:11, color:"#5b6a8a"}}>
              <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:2,background:"#22c97b",display:"inline-block"}}/> Coincidencia</span>
              <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:2,background:"#ff7e3f",display:"inline-block"}}/> AVC sin SP</span>
              <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:2,background:"#5b9cf6",display:"inline-block"}}/> SP sin AVC</span>
            </div>
          </div>
          <div style={{display:"grid", gridTemplateColumns:`repeat(${Math.max(laneAggregates.length,1)},1fr)`, gap:14}}>
            {laneAggregates.map(la => {
              const total = Math.max(la.total, 1);
              const pMatch = (la.matched / total * 100).toFixed(1);
              const pAvc   = (la.avcOnly / total * 100).toFixed(1);
              const pSat   = (la.satOnly / total * 100).toFixed(1);
              const rColor = reportRateColor(la.matchRate);
              return (
                <div key={la.lane} style={{background:"#080d1a", border:`1px solid ${rColor}40`, borderRadius:10, padding:"16px 18px"}}>
                  <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12}}>
                    <span style={{fontWeight:700, color:"#e8edf5", fontSize:15}}>{la.lane}</span>
                    <span style={{background:`${rColor}22`, color:rColor, borderRadius:6, padding:"4px 10px", fontSize:13, fontWeight:800}}>{la.matchRate}%</span>
                  </div>
                  {/* Stacked bar */}
                  <div style={{display:"flex", height:12, borderRadius:6, overflow:"hidden", marginBottom:14, background:"#1a2035"}}>
                    {la.matched > 0 && <div style={{width:`${pMatch}%`, background:"#22c97b", transition:"width 0.4s"}} title={`Coincidencia: ${la.matched} (${pMatch}%)`}/>}
                    {la.avcOnly > 0 && <div style={{width:`${pAvc}%`,   background:"#ff7e3f", transition:"width 0.4s"}} title={`AVC sin SP: ${la.avcOnly} (${pAvc}%)`}/>}
                    {la.satOnly > 0 && <div style={{width:`${pSat}%`,   background:"#5b9cf6", transition:"width 0.4s"}} title={`SP sin AVC: ${la.satOnly} (${pSat}%)`}/>}
                  </div>
                  <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px 10px", fontSize:11}}>
                    <div><span style={{color:"#5b6a8a"}}>Total </span><span style={{color:"#e8edf5", fontWeight:700}}>{reportNum(la.total)}</span></div>
                    <div><span style={{color:"#22c97b", fontWeight:700}}>{reportNum(la.matched)}</span><span style={{color:"#5b6a8a"}}> match</span></div>
                    <div><span style={{color:"#ff7e3f", fontWeight:700}}>{reportNum(la.avcOnly)}</span><span style={{color:"#5b6a8a"}}> AVC sin SP</span></div>
                    <div><span style={{color:"#5b9cf6", fontWeight:700}}>{reportNum(la.satOnly)}</span><span style={{color:"#5b6a8a"}}> SP sin AVC</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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

      {/* ── Evolución entre días ── */}
      {dailyEvolution.length > 0 && (
        <div style={{...rptStyles.panel, marginBottom:24}}>
          <div style={rptStyles.panelTitle}>Evolución entre días</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%", borderCollapse:"collapse", fontSize:12}}>
              <thead>
                <tr style={{background:"#070c18"}}>
                  {["Fecha","Total","Tasa detección","Δ vs día anterior","AVC sin SP","Δ AVC","SP sin AVC","Δ SP"].map(h => (
                    <th key={h} style={rptStyles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dailyEvolution.map((row, i) => (
                  <tr key={row.date} style={{background: i%2===0?"#0d1525":"#0f1219", borderBottom:"1px solid #1a1e2e"}}>
                    <td style={{...rptStyles.td, fontFamily:"monospace", color:"#8a9ab5"}}>{row.date}</td>
                    <td style={rptStyles.td}>{reportNum(row.total)}</td>
                    <td style={rptStyles.td}>
                      <span style={{color:reportRateColor(row.matchRate), fontWeight:700}}>{row.matchRate}%</span>
                    </td>
                    <td style={rptStyles.td}>
                      {row.deltaRate !== null ? (
                        <span style={{color: row.deltaRate > 0 ? "#22c97b" : row.deltaRate < 0 ? "#ff4c6a" : "#8a9ab5", fontWeight:600}}>
                          {row.deltaRate > 0 ? "↑ +" : row.deltaRate < 0 ? "↓ " : "— "}{Math.abs(row.deltaRate)}%
                        </span>
                      ) : <span style={{color:"#5b6a8a"}}>primer día</span>}
                    </td>
                    <td style={{...rptStyles.td, color: row.avcOnly > 0 ? "#ff7e3f" : "#8a9ab5"}}>{reportNum(row.avcOnly)}</td>
                    <td style={rptStyles.td}>
                      {row.deltaAvc !== null ? (
                        <span style={{color: row.deltaAvc > 0 ? "#ff4c6a" : row.deltaAvc < 0 ? "#22c97b" : "#8a9ab5", fontWeight:600}}>
                          {row.deltaAvc > 0 ? `↑ +${row.deltaAvc}` : row.deltaAvc < 0 ? `↓ ${row.deltaAvc}` : "—"}
                        </span>
                      ) : <span style={{color:"#5b6a8a"}}>—</span>}
                    </td>
                    <td style={{...rptStyles.td, color: row.satOnly > 0 ? "#5b9cf6" : "#8a9ab5"}}>{reportNum(row.satOnly)}</td>
                    <td style={rptStyles.td}>
                      {row.deltaSat !== null ? (
                        <span style={{color: row.deltaSat > 0 ? "#ff4c6a" : row.deltaSat < 0 ? "#22c97b" : "#8a9ab5", fontWeight:600}}>
                          {row.deltaSat > 0 ? `↑ +${row.deltaSat}` : row.deltaSat < 0 ? `↓ ${row.deltaSat}` : "—"}
                        </span>
                      ) : <span style={{color:"#5b6a8a"}}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tabla agrupada por fecha con sub-filas por carril ── */}
      <div style={{...rptStyles.tablePanel, marginBottom:24}}>
        <div style={rptStyles.tableHeader}>
          <div style={{fontSize:13, fontWeight:600, color:"#e8edf5"}}>
            {reportType==="daily" ? "Detalle por fecha y carril" : "Discrepancias por fecha y carril"}
          </div>
          <div style={{fontSize:11, color:"#5b6a8a"}}>{byDate.length} días · {displayRows.length} registros</div>
        </div>
        <div style={{overflowX:"auto", maxHeight:520, overflowY:"auto"}}>
          <table style={{width:"100%", borderCollapse:"collapse", fontSize:12}}>
            <thead>
              <tr style={{background:"#070c18", position:"sticky", top:0, zIndex:1}}>
                {["Fecha / Carril","Total","Coincidencias","AVC sin SP","SP sin AVC","Clase dist.","Detección","SP $","AVC $"].map(h => (
                  <th key={h} style={rptStyles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byDate.map(({date, rows:dayRows, totals:dt}) => [
                <tr key={`hdr-${date}`} style={{background:"#162036", borderTop:"2px solid #253050", borderBottom:"1px solid #1e2a40"}}>
                  <td style={{...rptStyles.td, color:"#7eb0f5", fontWeight:700, fontFamily:"monospace", fontSize:12}}>
                    {date}
                    <span style={{marginLeft:10, fontSize:10, color:"#5b6a8a", fontWeight:400}}>
                      {dayRows.length} carril{dayRows.length!==1?"es":""}
                    </span>
                  </td>
                  <td style={{...rptStyles.td, fontWeight:700, color:"#e8edf5"}}>{reportNum(dt.total)}</td>
                  <td style={{...rptStyles.td, color:"#22c97b", fontWeight:700}}>{reportNum(dt.matched)}</td>
                  <td style={{...rptStyles.td, color: dt.avcOnly>0?"#ff7e3f":"#5b6a8a", fontWeight:700}}>{reportNum(dt.avcOnly)}</td>
                  <td style={{...rptStyles.td, color: dt.satOnly>0?"#5b9cf6":"#5b6a8a", fontWeight:700}}>{reportNum(dt.satOnly)}</td>
                  <td style={{...rptStyles.td, color: dt.classMismatch>0?"#ff4c6a":"#5b6a8a", fontWeight:700}}>{reportNum(dt.classMismatch)}</td>
                  <td style={rptStyles.td}>
                    <span style={{color:reportRateColor(dt.matchRate), fontWeight:800, fontSize:13}}>{dt.matchRate}%</span>
                  </td>
                  <td style={{...rptStyles.td, color:"#5b9cf6", fontWeight:700, fontSize:11}}>{dt.sat_money ? reportMoney(dt.sat_money) : "—"}</td>
                  <td style={{...rptStyles.td, color:"#ff7e3f", fontWeight:700, fontSize:11}}>{dt.avc_money ? reportMoney(dt.avc_money) : "—"}</td>
                </tr>,
                ...dayRows.map((r, j) => (
                  <tr key={`${date}-${r.lane}-${r.source_id}`} style={{background: j%2===0?"#090e1d":"#070b18", borderBottom:"1px solid #111827"}}>
                    <td style={{...rptStyles.td, paddingLeft:28}}>
                      <span style={{color:"#2a3a5a", marginRight:6, fontSize:11}}>↳</span>
                      <span style={{color:"#c8d4e8", fontWeight:600}}>{r.lane}</span>
                    </td>
                    <td style={rptStyles.td}>{reportNum(r.total)}</td>
                    <td style={{...rptStyles.td, color:"#22c97b"}}>{reportNum(r.matched)}</td>
                    <td style={{...rptStyles.td, color:r.avcOnly>0?"#ff7e3f":"#5b6a8a"}}>{reportNum(r.avcOnly)}</td>
                    <td style={{...rptStyles.td, color:r.satOnly>0?"#5b9cf6":"#5b6a8a"}}>{reportNum(r.satOnly)}</td>
                    <td style={{...rptStyles.td, color:r.classMismatch>0?"#ff4c6a":"#5b6a8a"}}>{reportNum(r.classMismatch)}</td>
                    <td style={rptStyles.td}>
                      <span style={{color:reportRateColor(r.matchRate), fontWeight:700}}>{r.matchRate}%</span>
                    </td>
                    <td style={{...rptStyles.td, color:"#5b9cf6", fontSize:11}}>{r.sat_money ? reportMoney(r.sat_money) : "—"}</td>
                    <td style={{...rptStyles.td, color:"#ff7e3f", fontSize:11}}>{r.avc_money ? reportMoney(r.avc_money) : "—"}</td>
                  </tr>
                )),
              ])}
              {!byDate.length && (
                <tr><td colSpan="9" style={{...rptStyles.td,textAlign:"center",padding:30,color:"#5b6a8a"}}>
                  {loading ? "Cargando..." : "Sin datos. Reconciliar carriles para poblar reportes reales."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Envío por email ── */}
      <div style={{...rptStyles.panel, marginBottom:8}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14}}>
          <div style={rptStyles.panelTitle}>Enviar reporte por email</div>
          {smtpOk
            ? <span style={{fontSize:11, color:"#22c97b"}}>● SMTP activo ({smtpSettings.smtp.host})</span>
            : <span style={{fontSize:11, color:"#f5d433"}}>⚠ SMTP no configurado — ve a Configuración → Email</span>
          }
        </div>

        {/* Destinatarios configurados */}
        {(() => {
          const recips = smtpSettings
            ? (smtpSettings.recipients || []).map(r => typeof r === "object" ? (r.email||"") : r).filter(Boolean)
            : [];
          return recips.length > 0 ? (
            <div style={{marginBottom:16}}>
              <div style={{fontSize:11, color:"#5b6a8a", textTransform:"uppercase", letterSpacing:0.5, marginBottom:6}}>Destinatarios</div>
              <div style={{display:"flex", flexWrap:"wrap", gap:6}}>
                {recips.map(e => (
                  <span key={e} style={{background:"rgba(77,127,224,0.10)", border:"1px solid rgba(77,127,224,0.22)",
                    borderRadius:20, padding:"3px 10px", fontSize:11, color:"#7eb0f5"}}>{e}</span>
                ))}
              </div>
            </div>
          ) : smtpOk ? (
            <div style={{marginBottom:16, fontSize:12, color:"#5b6a8a", padding:"8px 12px",
              background:"rgba(245,212,51,0.06)", border:"1px solid rgba(245,212,51,0.15)", borderRadius:7}}>
              Sin destinatarios configurados — ve a Reportes → Configuración para agregarlos
            </div>
          ) : null;
        })()}

        {/* Botones de prueba: Diario / Semanal / Mensual */}
        <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12}}>
          {[
            {type:"daily",   label:"Probar Diario",   sub:"Reporte del día anterior"},
            {type:"weekly",  label:"Probar Semanal",  sub:"Últimos 7 días"},
            {type:"monthly", label:"Probar Mensual",  sub:"Mes anterior completo"},
          ].map(({type, label, sub}) => {
            const active = sendingEmail === type;
            const canSend = !sendingEmail && smtpOk;
            return (
              <button key={type} onClick={()=>sendByType(type)}
                disabled={!canSend}
                style={{
                  background: active ? "rgba(77,127,224,0.18)" : "rgba(77,127,224,0.07)",
                  border:`1px solid ${active?"rgba(77,127,224,0.55)":"rgba(77,127,224,0.2)"}`,
                  borderRadius:10, padding:"14px 16px", cursor:canSend?"pointer":"not-allowed",
                  opacity:canSend?1:0.5, fontFamily:"inherit", textAlign:"left", transition:"all 0.15s",
                }}>
                <div style={{fontSize:12, fontWeight:700, color:"#e8edf5", marginBottom:4}}>
                  {active ? "Enviando…" : label}
                </div>
                <div style={{fontSize:11, color:"#5b6a8a"}}>{sub}</div>
              </button>
            );
          })}
        </div>

        {sendMsg && (
          <div style={{...rptStyles.errorBox, marginTop:12,
            color:sendMsg.startsWith("✓")?"#22c97b":"#ff4c6a",
            borderColor:sendMsg.startsWith("✓")?"rgba(34,201,123,0.25)":"rgba(255,76,106,0.25)",
            background:sendMsg.startsWith("✓")?"rgba(34,201,123,0.08)":"rgba(255,76,106,0.08)"}}>
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
