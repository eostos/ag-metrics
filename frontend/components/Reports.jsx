// Reports Screen
function ReportsScreen() {
  const [dateFrom, setDateFrom] = React.useState("2026-04-14");
  const [dateTo, setDateTo]     = React.useState("2026-04-27");
  const [reportType, setReportType] = React.useState("daily");
  const [selectedLanes, setSelectedLanes] = React.useState(LANE_CONFIGS.map(l=>l.id));
  const chartRef = React.useRef(null);
  const chartInstance = React.useRef(null);

  // Filter daily summary
  const tableData = React.useMemo(() => {
    return DAILY_SUMMARY.filter(r =>
      r.date >= dateFrom && r.date <= dateTo && selectedLanes.includes(r.lane)
    );
  }, [dateFrom, dateTo, selectedLanes]);

  const discrepancyData = React.useMemo(() => {
    return tableData.filter(r => r.avcOnly > 0 || r.satOnly > 0);
  }, [tableData]);

  function toggleLane(id) {
    setSelectedLanes(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  }

  // Chart — match rate per lane over date range
  React.useEffect(() => {
    if (!chartRef.current) return;
    if (chartInstance.current) chartInstance.current.destroy();

    // Unique dates
    const dates = [...new Set(tableData.map(r=>r.date))].sort();
    const datasets = selectedLanes.slice(0,8).map((lid, i) => {
      const colors = ["#4d7fe0","#22c97b","#5b9cf6","#ff7e3f","#f5d433","#ff4c6a","#a78bfa","#fb923c"];
      const data = dates.map(d => {
        const row = tableData.find(r=>r.lane===lid && r.date===d);
        return row ? row.matchRate : null;
      });
      return { label: lid, data, borderColor: colors[i%colors.length], backgroundColor: `${colors[i%colors.length]}20`, tension:0.3, fill:true, pointRadius:3 };
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
          y:{ min:80, max:100, ticks:{color:"#8a9ab5",font:{size:10},callback:v=>`${v}%`}, grid:{color:"#1e2535"} },
        },
      },
    });
  }, [tableData, selectedLanes]);

  const displayRows = reportType === "daily" ? tableData : discrepancyData;

  // Aggregate KPIs
  const kpiTotal = tableData.reduce((s,r)=>s+r.total,0);
  const kpiMatched = tableData.reduce((s,r)=>s+r.matched,0);
  const kpiAvcOnly = tableData.reduce((s,r)=>s+r.avcOnly,0);
  const kpiSatOnly = tableData.reduce((s,r)=>s+r.satOnly,0);
  const kpiRate = kpiTotal > 0 ? Math.round(kpiMatched/kpiTotal*1000)/10 : 0;

  return (
    <div>
      {/* Controls */}
      <div style={{display:"flex", gap:16, alignItems:"flex-end", flexWrap:"wrap", marginBottom:20}}>
        <div style={rptStyles.fieldWrap}>
          <label style={rptStyles.label}>Desde</label>
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={rptStyles.input}/>
        </div>
        <div style={rptStyles.fieldWrap}>
          <label style={rptStyles.label}>Hasta</label>
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={rptStyles.input}/>
        </div>
        <div style={rptStyles.fieldWrap}>
          <label style={rptStyles.label}>Tipo de Reporte</label>
          <div style={{display:"flex", gap:6}}>
            {[{id:"daily",label:"Resumen Diario"},{id:"discrepancy",label:"Discrepancias"}].map(t => (
              <button key={t.id} onClick={()=>setReportType(t.id)} style={{
                background: reportType===t.id?"rgba(0,212,170,0.15)":"#1e2535",
                color: reportType===t.id?"#4d7fe0":"#7a8aaa",
                border:`1px solid ${reportType===t.id?"#4d7fe0":"#1c2b46"}`,
                borderRadius:7, padding:"7px 14px", fontSize:12, cursor:"pointer", fontFamily:"inherit",
              }}>{t.label}</button>
            ))}
          </div>
        </div>
        <div style={{display:"flex", gap:6, marginLeft:"auto"}}>
          <button style={rptStyles.exportBtn}>↓ CSV</button>
          <button style={rptStyles.exportBtn}>↓ Excel</button>
        </div>
      </div>

      {/* Lane selector */}
      <div style={{marginBottom:20}}>
        <label style={{...rptStyles.label, marginBottom:8}}>Carriles</label>
        <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
          <button onClick={()=>setSelectedLanes(LANE_CONFIGS.map(l=>l.id))} style={rptStyles.chipBtn}>Todos</button>
          <button onClick={()=>setSelectedLanes([])} style={rptStyles.chipBtn}>Ninguno</button>
          {LANE_CONFIGS.map(l => (
            <button key={l.id} onClick={()=>toggleLane(l.id)} style={{
              ...rptStyles.chipBtn,
              background: selectedLanes.includes(l.id)?"rgba(0,212,170,0.15)":"#1e2535",
              color: selectedLanes.includes(l.id)?"#4d7fe0":"#7a8aaa",
              border:`1px solid ${selectedLanes.includes(l.id)?"rgba(0,212,170,0.4)":"#1c2b46"}`,
            }}>{l.id}</button>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <div style={{display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:12, marginBottom:24}}>
        {[
          {label:"Total Eventos", value:kpiTotal.toLocaleString(), color:"#e8edf5"},
          {label:"Coincidencias", value:kpiMatched.toLocaleString(), color:"#22c97b"},
          {label:"AVC sin SAT",   value:kpiAvcOnly.toLocaleString(), color:"#ff7e3f"},
          {label:"SAT sin AVC",   value:kpiSatOnly.toLocaleString(), color:"#5b9cf6"},
          {label:"Tasa Promedio", value:`${kpiRate}%`, color:kpiRate>=97?"#22c97b":kpiRate>=93?"#f5d433":"#ff4c6a"},
        ].map(k => (
          <div key={k.label} style={{background:"#0d1525", border:"1px solid #2a3045", borderRadius:10, padding:"12px 16px"}}>
            <div style={{fontSize:11, color:"#5b6a8a", marginBottom:4}}>{k.label}</div>
            <div style={{fontSize:20, fontWeight:800, color:k.color}}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div style={{background:"#0d1525", border:"1px solid #2a3045", borderRadius:12, padding:"18px 20px", marginBottom:24}}>
        <div style={{fontSize:13, fontWeight:600, color:"#e8edf5", marginBottom:16}}>
          Tasa de coincidencia por carril — período seleccionado
        </div>
        <div style={{height:200}}>
          <canvas ref={chartRef}/>
        </div>
      </div>

      {/* Table */}
      <div style={{background:"#0d1525", border:"1px solid #2a3045", borderRadius:12, overflow:"hidden"}}>
        <div style={{padding:"14px 18px", borderBottom:"1px solid #1e2535", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <div style={{fontSize:13, fontWeight:600, color:"#e8edf5"}}>
            {reportType==="daily"?"Resumen Diario por Carril":"Reporte de Discrepancias"}
          </div>
          <div style={{fontSize:11, color:"#5b6a8a"}}>{displayRows.length} registros</div>
        </div>
        <div style={{overflowX:"auto", maxHeight:380, overflowY:"auto"}}>
          <table style={{width:"100%", borderCollapse:"collapse", fontSize:12}}>
            <thead>
              <tr style={{background:"#070c18", position:"sticky", top:0}}>
                {["Fecha","Carril","Total AVC","Total SAT","Coincidencias","AVC sin SAT","SAT sin AVC","% Coincidencia","Err. Ejes"].map(h => (
                  <th key={h} style={rptStyles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r,i) => (
                <tr key={`${r.date}-${r.lane}`} style={{background: i%2===0?"#0d1525":"#0f1219", borderBottom:"1px solid #1a1e2e"}}>
                  <td style={{...rptStyles.td, fontFamily:"monospace", color:"#8a9ab5"}}>{r.date}</td>
                  <td style={rptStyles.td}><span style={{color:"#4d7fe0", fontWeight:600}}>{r.lane}</span></td>
                  <td style={rptStyles.td}>{r.total.toLocaleString()}</td>
                  <td style={rptStyles.td}>{(r.matched + r.satOnly).toLocaleString()}</td>
                  <td style={{...rptStyles.td, color:"#22c97b"}}>{r.matched.toLocaleString()}</td>
                  <td style={{...rptStyles.td, color: r.avcOnly>20?"#ff4c6a":r.avcOnly>5?"#ff7e3f":"#8a9ab5"}}>{r.avcOnly}</td>
                  <td style={{...rptStyles.td, color: r.satOnly>10?"#ff4c6a":r.satOnly>3?"#5b9cf6":"#8a9ab5"}}>{r.satOnly}</td>
                  <td style={rptStyles.td}>
                    <div style={{display:"flex", alignItems:"center", gap:8}}>
                      <div style={{flex:1, height:4, background:"#1e2535", borderRadius:2, overflow:"hidden"}}>
                        <div style={{width:`${r.matchRate}%`, height:"100%", background: r.matchRate>=97?"#22c97b":r.matchRate>=93?"#f5d433":"#ff4c6a", borderRadius:2}}/>
                      </div>
                      <span style={{color: r.matchRate>=97?"#22c97b":r.matchRate>=93?"#f5d433":"#ff4c6a", fontWeight:600, fontSize:11, minWidth:40}}>{r.matchRate}%</span>
                    </div>
                  </td>
                  <td style={{...rptStyles.td, color:"#f5d433"}}>{r.axleErr}</td>
                </tr>
              ))}
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
  th: { padding:"9px 12px", textAlign:"left", fontSize:11, color:"#5b6a8a", fontWeight:600, letterSpacing:0.4, borderBottom:"1px solid #1e2535", whiteSpace:"nowrap" },
  td: { padding:"8px 12px", color:"#c8d4e8", verticalAlign:"middle" },
};

Object.assign(window, { ReportsScreen });
