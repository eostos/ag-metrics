// Mock Data — shared across all screens
const MOCK_USERS = [
  { id: 1, name: "Carlos Méndez", email: "carlos@auditec.mx", role: "Admin", status: "Active", lastLogin: "2026-04-27 08:14" },
  { id: 2, name: "Ana Ríos", email: "ana@auditec.mx", role: "Auditor", status: "Active", lastLogin: "2026-04-27 07:50" },
  { id: 3, name: "Luis Ortega", email: "luis@auditec.mx", role: "Operator", status: "Active", lastLogin: "2026-04-26 22:30" },
  { id: 4, name: "Patricia Vega", email: "pvega@auditec.mx", role: "Operator", status: "Active", lastLogin: "2026-04-25 14:10" },
  { id: 5, name: "Roberto Soto", email: "rsoto@auditec.mx", role: "Auditor", status: "Inactive", lastLogin: "2026-04-10 09:00" },
];

const DEMO_ACCOUNTS = [
  { email: "carlos@auditec.mx", password: "admin123", userId: 1 },
  { email: "ana@auditec.mx", password: "audit123", userId: 2 },
  { email: "luis@auditec.mx", password: "oper123", userId: 3 },
];

const PLAZAS = ["Plaza Tlalpan", "Plaza Insurgentes", "Plaza Periferico"];

const LANE_CONFIGS = [
  { id: "T01", name: "T01 — Carril 1", direction: "N→S" },
  { id: "T02", name: "T02 — Carril 2", direction: "N→S" },
  { id: "T03", name: "T03 — Carril 3", direction: "N→S" },
  { id: "T04", name: "T04 — Carril 4", direction: "S→N" },
  { id: "T05", name: "T05 — Carril 5", direction: "S→N" },
  { id: "T06", name: "T06 — Carril 6", direction: "S→N" },
  { id: "T07", name: "T07 — Carril 7 (Iave)", direction: "N→S" },
  { id: "T08", name: "T08 — Carril 8 (Iave)", direction: "S→N" },
];

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function generateLaneStats(seed) {
  const total = randInt(420, 890);
  const avcOnly = randInt(4, Math.floor(total * 0.08));
  const satOnly = randInt(2, Math.floor(total * 0.05));
  const axleErr = randInt(1, Math.floor(total * 0.04));
  const matched = total - avcOnly - satOnly - axleErr;
  const matchRate = Math.round((matched / total) * 1000) / 10;
  // sparkline: 12 hourly buckets
  const spark = Array.from({length:12}, () => randInt(20, Math.floor(total/8)));
  return { total, matched, avcOnly, satOnly, axleErr, matchRate, spark };
}

// Seeded stats per lane (stable during session)
const LANE_STATS = {};
LANE_CONFIGS.forEach((l, i) => { LANE_STATS[l.id] = generateLaneStats(i); });

// Vehicle types
const V_TYPES = ["Automóvil", "Autobús", "Camión 2E", "Camión 3E", "Motocicleta", "Pick-up"];
const SAT_CLASSES = ["Clase 1", "Clase 2", "Clase 3", "Clase 4", "Clase 0"];
const STATUS_TYPES = ["matched", "avc_only", "sat_only", "axle_error"];

function pad(n) { return String(n).padStart(2, "0"); }

function generateEvents(laneId, count = 120) {
  const events = [];
  let baseHour = 6;
  let baseMin = 0;
  let baseSec = 0;
  const stats = LANE_STATS[laneId];
  // distribute statuses proportionally
  const statusPool = [];
  const mCount = Math.floor(count * (stats.matchRate / 100));
  const aCount = Math.floor(count * (stats.avcOnly / stats.total));
  const sCount = Math.floor(count * (stats.satOnly / stats.total));
  const eCount = count - mCount - aCount - sCount;
  for (let i = 0; i < mCount; i++) statusPool.push("matched");
  for (let i = 0; i < aCount; i++) statusPool.push("avc_only");
  for (let i = 0; i < sCount; i++) statusPool.push("sat_only");
  for (let i = 0; i < eCount; i++) statusPool.push("axle_error");
  // shuffle
  statusPool.sort(() => Math.random() - 0.5);

  for (let i = 0; i < count; i++) {
    baseSec += randInt(8, 60);
    if (baseSec >= 60) { baseMin += Math.floor(baseSec / 60); baseSec = baseSec % 60; }
    if (baseMin >= 60) { baseHour += Math.floor(baseMin / 60); baseMin = baseMin % 60; }
    const avcTime = `${pad(baseHour)}:${pad(baseMin)}:${pad(baseSec)}`;
    const delta = randInt(-3, 8);
    const satSec = baseSec + delta;
    const satTime = `${pad(baseHour)}:${pad(baseMin)}:${pad(Math.max(0, Math.min(59, satSec)))}`;
    const status = statusPool[i] || "matched";
    const vType = V_TYPES[randInt(0, V_TYPES.length - 1)];
    const axlesAvc = randInt(2, 5);
    const axlesSat = status === "axle_error" ? axlesAvc + (Math.random() > 0.5 ? 1 : -1) : axlesAvc;
    const satClass = SAT_CLASSES[randInt(0, SAT_CLASSES.length - 1)];
    const amount = [0, 42, 52, 78, 104, 156][randInt(0, 5)];
    const hasPhoto = Math.random() > 0.25;
    events.push({
      id: i + 1,
      avcId: `AVC-${laneId}-${String(i + 1001).padStart(5,"0")}`,
      status,
      avcTime,
      satTime: (status === "avc_only") ? "—" : satTime,
      delta: (status === "avc_only" || status === "sat_only") ? "—" : `+${delta}s`,
      vType,
      axlesAvc,
      axlesSat: (status === "sat_only") ? "—" : axlesSat,
      satClass: (status === "avc_only") ? "—" : satClass,
      lane: laneId,
      amount: (status === "avc_only") ? "—" : `$${amount}`,
      notes: status === "axle_error" ? "Diferencia de ejes" : status === "avc_only" ? "Sin cobro SP" : status === "sat_only" ? "Sin evento AVC" : "",
      hasPhoto,
      plate: hasPhoto ? `${["ABC","XYZ","MNO","PQR"][randInt(0,3)]}-${randInt(100,999)}-${["B","C","D","F"][randInt(0,3)]}` : null,
    });
  }
  return events;
}

// Pre-generate events for each lane
const LANE_EVENTS = {};
LANE_CONFIGS.forEach(l => { LANE_EVENTS[l.id] = generateEvents(l.id, 120); });

// Reports data: daily summary for last 14 days
function generateDailySummary() {
  const rows = [];
  for (let d = 13; d >= 0; d--) {
    const date = new Date(2026, 3, 27 - d);
    const ds = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
    LANE_CONFIGS.forEach(l => {
      const s = LANE_STATS[l.id];
      const factor = 0.8 + Math.random() * 0.4;
      const total = Math.floor(s.total * factor);
      const avcOnly = Math.floor(s.avcOnly * factor);
      const satOnly = Math.floor(s.satOnly * factor);
      const axleErr = Math.floor(s.axleErr * factor);
      const matched = total - avcOnly - satOnly - axleErr;
      rows.push({ date: ds, lane: l.id, laneName: l.name, total, matched, avcOnly, satOnly, axleErr, matchRate: Math.round(matched/total*1000)/10 });
    });
  }
  return rows;
}

const DAILY_SUMMARY = generateDailySummary();

Object.assign(window, {
  MOCK_USERS, DEMO_ACCOUNTS, PLAZAS, LANE_CONFIGS, LANE_STATS, LANE_EVENTS, DAILY_SUMMARY,
  randInt, pad, generateEvents,
});
