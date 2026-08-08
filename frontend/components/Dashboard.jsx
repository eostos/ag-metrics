// Dashboard — multi-carril con polling automático
function Sparkline({ data, color="#4d7fe0", width=80, height=28 }) {
  const vals = (data||[0]).filter(v=>!isNaN(v));
  if (!vals.length) return null;
  const max=Math.max(...vals), min=Math.min(...vals), range=max-min||1;
  const pts = vals.map((v,i)=>{
    const x=(i/(vals.length-1))*width;
    const y=height-((v-min)/range)*(height-4)-2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{display:"block"}}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
      <polyline points={`0,${height} ${pts} ${width},${height}`} fill={`url(#sg${color.replace(/[^a-z0-9]/gi,"")})`} stroke="none"/>
      <defs>
        <linearGradient id={`sg${color.replace(/[^a-z0-9]/gi,"")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
    </svg>
  );
}

function MatchRing({ pct, size=52 }) {
  const r=20, c=size/2, circ=2*Math.PI*r, dash=(pct/100)*circ;
  const color = pct>=97?"#22c97b":pct>=93?"#f5d433":pct>0?"#ff4c6a":"#1c2b46";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="#162036" strokeWidth="5"/>
      <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${c} ${c})`}/>
      <text x={c} y={c+1} textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize="10" fontWeight="700" fontFamily="Inter,sans-serif">
        {pct>0?`${pct}%`:"—"}
      </text>
    </svg>
  );
}

// Δt — desfase temporal SP→AVC del carril. Deriva con el reloj de los equipos:
// si alcanza la ventana de conciliación, el SP correcto queda fuera de alcance
// y el carril empieza a emparejar con la transacción del vehículo anterior.
function DeltaT({ off }) {
  if (!off || off.offset_s == null) return null;
  const color = off.status==="fuera_de_ventana" ? "#ff4c6a"
              : off.status==="cerca_del_limite" ? "#ff7e3f"
              : off.status==="derivando"        ? "#f5d433"
              : "#22c97b";
  const label = {fuera_de_ventana:"fuera de ventana", cerca_del_limite:"cerca del límite",
                 derivando:"derivando", estable:"estable", sin_datos:"sin datos"}[off.status]
                || off.status;
  const drift = off.drift_s_per_day;
  const tip = `Desfase SP→AVC medido el ${off.measured_on}.`
    + ` Nitidez ${off.sharpness ?? "—"}, cobertura ${off.coverage ?? "—"}%.`
    + (off.days_to_limit != null
        ? ` Alcanza la ventana de ${off.window_s}s en ~${off.days_to_limit} días.` : "");
  return (
    <div style={{borderTop:"1px solid #1c2b46",marginTop:10,paddingTop:9}} title={tip}>
      <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between"}}>
        <span style={{fontSize:9,color:"#5b6a8a",textTransform:"uppercase",letterSpacing:"0.7px"}}>
          Δt SP→AVC
        </span>
        <span style={{fontSize:15,fontWeight:800,color,lineHeight:1}}>
          {off.offset_s}s
          {drift!=null && (
            <span style={{fontSize:10,fontWeight:600,color:"#5b6a8a",marginLeft:5}}>
              {drift>0?"▲":drift<0?"▼":""}{Math.abs(drift).toFixed(1)}s/día
            </span>
          )}
        </span>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:5,marginTop:4}}>
        <span style={{width:5,height:5,borderRadius:5,background:color,flexShrink:0}}/>
        <span style={{fontSize:10,color:"#5b6a8a"}}>{label}</span>
        {off.margin_s!=null && (
          <span style={{fontSize:10,color:"#5b6a8a",marginLeft:"auto"}}>margen {off.margin_s}s</span>
        )}
      </div>
      {off.trusted===false && (
        <div style={{fontSize:9,color:"#8a6a3f",marginTop:3}}>medición poco fiable</div>
      )}
      {/* Valor operativo: medido hoy, o heredado del último día fiable */}
      {off.operating && (
        <div style={{fontSize:9,color:"#5b6a8a",marginTop:4,display:"flex",justifyContent:"space-between"}}
          title={off.operating.resolved==="medido"
            ? `Δt medido hoy (${off.operating.measured_on}). Ventana derivada: ${off.operating.window_s}s.`
            : `Sin medición fiable hoy: se hereda el Δt del ${off.operating.measured_on}`
              + ` (${off.operating.age_days} día(s)). La ventana se ensancha a ${off.operating.window_s}s`
              + ` para compensar la incertidumbre.`}>
          <span>
            {off.operating.resolved==="medido"   ? "medido hoy"
             : off.operating.resolved==="heredado" ? `heredado · ${off.operating.age_days}d`
             : "medición dudosa"}
          </span>
          <span>ventana {off.operating.window_s}s</span>
        </div>
      )}
    </div>
  );
}

// Curva de correlación: coincidencias SP↔AVC según cuánto se desplaza el SP.
// Es la prueba visual de por qué el Δt es ese y no otro — un pico estrecho muy
// por encima del fondo de azar.
function OffsetCurve({ curve, offset, windowS, W=620, H=170 }) {
  if (!curve || !curve.length) return null;
  const pad = {l:38, r:12, t:12, b:22};
  const iw = W-pad.l-pad.r, ih = H-pad.t-pad.b;
  const maxH = Math.max(...curve.map(p=>p.hits)) || 1;
  const maxL = Math.max(...curve.map(p=>p.lag)) || 1;
  const X = l => pad.l + (l/maxL)*iw;
  const Y = h => pad.t + ih - (h/maxH)*ih;
  const pts = curve.map(p=>`${X(p.lag).toFixed(1)},${Y(p.hits).toFixed(1)}`).join(" ");
  const fuera = windowS < offset;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
      <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="#0a1220" stroke="#1c2b46"/>
      {/* zona alcanzable por la ventana actual */}
      <rect x={X(0)} y={pad.t} width={Math.max(X(windowS)-X(0),0)} height={ih}
        fill="rgba(34,201,123,0.06)"/>
      <polyline points={pts} fill="none" stroke="#4d7fe0" strokeWidth="1.4"/>
      {/* límite de ventana */}
      <line x1={X(windowS)} y1={pad.t} x2={X(windowS)} y2={pad.t+ih}
        stroke="#f5d433" strokeWidth="1.2" strokeDasharray="4 3"/>
      <text x={X(windowS)+4} y={pad.t+11} fill="#f5d433" fontSize="9">ventana {windowS}s</text>
      {/* pico */}
      <line x1={X(offset)} y1={pad.t} x2={X(offset)} y2={pad.t+ih}
        stroke={fuera?"#ff4c6a":"#22c97b"} strokeWidth="1.2"/>
      <text x={X(offset)+4} y={pad.t+ih-6} fill={fuera?"#ff4c6a":"#22c97b"} fontSize="10" fontWeight="700">
        Δt {offset}s
      </text>
      <text x={4} y={pad.t+8} fill="#5b6a8a" fontSize="9">{maxH}</text>
      <text x={4} y={pad.t+ih} fill="#5b6a8a" fontSize="9">0</text>
      <text x={pad.l} y={H-6} fill="#5b6a8a" fontSize="9">0s</text>
      <text x={W-pad.r-26} y={H-6} fill="#5b6a8a" fontSize="9">{maxL}s</text>
      <text x={pad.l+iw/2-58} y={H-6} fill="#5b6a8a" fontSize="9">desplazamiento aplicado al SP</text>
    </svg>
  );
}

// Panel de análisis profundo del Δt de un carril en un día.
function DeepDeltaPanel({ lane, date, onClose }) {
  const [d, setD]     = React.useState(null);
  const [err, setErr] = React.useState("");
  React.useEffect(()=>{
    setD(null); setErr("");
    window.API.get(`/api/lane-offset-analysis?lane=${encodeURIComponent(lane)}&query_date=${date}`)
      .then(r=>{ if(r&&r.error) setErr(r.error); else setD(r); })
      .catch(e=>setErr(String(e&&e.message||e)));
  },[lane,date]);

  const VERD = {
    ventana_insuficiente:{c:"#ff4c6a",t:"Ventana insuficiente"},
    al_limite:           {c:"#ff7e3f",t:"Al límite"},
    correcto:            {c:"#22c97b",t:"Correcto"},
    sin_senal:           {c:"#8a9ab5",t:"Sin señal fiable"},
  };
  const v = d ? (VERD[d.verdict]||{c:"#8a9ab5",t:d.verdict}) : null;

  return (
    <div onClick={onClose}
      style={{position:"fixed",inset:0,background:"rgba(4,8,16,0.78)",zIndex:80,
              display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:"#0d1525",border:"1px solid #2a3045",borderRadius:14,
                padding:"20px 24px",maxWidth:760,width:"100%",maxHeight:"88vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
          <div>
            <div style={{fontSize:15,fontWeight:800,color:"#e8edf5"}}>Análisis profundo de Δt</div>
            <div style={{fontSize:11,color:"#5b6a8a",marginTop:2}}>{lane} · {date}</div>
          </div>
          <button onClick={onClose} style={{...dashStyles.secondaryBtn,padding:"4px 10px"}}>Cerrar</button>
        </div>

        {!d && !err && <div style={{color:"#8a9ab5",fontSize:12,padding:"28px 0",textAlign:"center"}}>
          Calculando… (dos pasadas de conciliación, ~4s)
        </div>}
        {err && <div style={{color:"#ff4c6a",fontSize:12,padding:"20px 0"}}>{err}</div>}

        {d && (<React.Fragment>
          <div style={{display:"flex",alignItems:"center",gap:8,margin:"12px 0 14px"}}>
            <span style={{...dashStyles.badge,background:`${v.c}22`,color:v.c,fontSize:11}}>{v.t}</span>
            <span style={{fontSize:22,fontWeight:800,color:"#e8edf5",lineHeight:1}}>Δt {d.offset_s}s</span>
            <span style={{fontSize:11,color:"#5b6a8a"}}>
              ventana {d.window_s}s · margen {d.margin_s}s · recomendada {d.recommended_window_s}s
            </span>
          </div>

          {/* Por qué el Δt es ese */}
          <div style={{fontSize:11,color:"#8a9ab5",lineHeight:1.65,marginBottom:12}}>
            El SP registra el cobro <b style={{color:"#e8edf5"}}>{d.offset_s} segundos antes</b> de que
            el AVC detecte el vehículo. Ese desfase se mide sin necesidad de emparejar nada: se desliza
            la serie del SP sobre la del AVC y se cuenta cuántos coinciden en cada desplazamiento.
            A {d.offset_s}s coinciden <b style={{color:"#e8edf5"}}>{d.peak}</b> eventos, frente
            a {d.background} que es lo máximo que logra cualquier otro desplazamiento por puro azar
            — un pico <b style={{color:"#e8edf5"}}>{d.sharpness}× </b>sobre el fondo, sobre
            {" "}{d.n_avc} eventos AVC y {d.n_sat} transacciones SP.
          </div>

          <OffsetCurve curve={d.curve} offset={d.offset_s} windowS={d.window_s}/>

          {d.verdict==="ventana_insuficiente" && (
            <div style={{background:"rgba(255,76,106,0.08)",border:"1px solid rgba(255,76,106,0.25)",
                         borderRadius:8,padding:"10px 12px",margin:"12px 0",fontSize:11,
                         color:"#e8b5c0",lineHeight:1.65}}>
              El pico cae <b>fuera</b> de la ventana de {d.window_s}s (zona verde). El SP correcto es
              inalcanzable, así que el algoritmo empareja cada AVC con el cobro del vehículo anterior,
              que sí entra en ventana. Por eso los matches existen pero son falsos.
            </div>
          )}

          {/* Comparativa */}
          {d.recommended && (
            <div style={{marginTop:14}}>
              <div style={{fontSize:11,fontWeight:700,color:"#e8edf5",marginBottom:7}}>
                Qué cambia con la ventana recomendada
              </div>
              <table style={{width:"100%",fontSize:11,borderCollapse:"collapse",color:"#8a9ab5"}}>
                <thead><tr style={{color:"#5b6a8a"}}>
                  <th style={{textAlign:"left",padding:"4px 0"}}></th>
                  <th style={{textAlign:"right"}}>Actual {d.actual.window_s}s</th>
                  <th style={{textAlign:"right"}}>Recomendada {d.recommended.window_s}s</th>
                </tr></thead>
                <tbody>
                  {[["MATCH","match"],["AVC sin SP","avcOnly"],["SP sin AVC","satOnly"],
                    ["Importe SP conciliado","importe"]].map(([lab,k])=>(
                    <tr key={k} style={{borderTop:"1px solid #1c2b46"}}>
                      <td style={{padding:"5px 0"}}>{lab}</td>
                      <td style={{textAlign:"right"}}>{(d.actual[k]||0).toLocaleString()}</td>
                      <td style={{textAlign:"right",color:"#22c97b",fontWeight:700}}>
                        {(d.recommended[k]||0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.delta && (
                <div style={{fontSize:11,color:"#8a9ab5",lineHeight:1.65,marginTop:10}}>
                  Se recuperan <b style={{color:"#e8edf5"}}>{d.delta.nuevos}</b> matches nuevos y
                  se pierden {d.delta.perdidos}. Pero lo importante es que
                  {" "}<b style={{color:"#ff7e3f"}}>{d.delta.repareados}</b> de
                  los {d.actual.match} matches actuales <b>cambian de pareja SP</b>: hoy están
                  emparejados con la transacción equivocada.
                  {d.delta.importe_extra>0 && <span> Quedan por conciliar
                    {" "}<b style={{color:"#e8edf5"}}>{d.delta.importe_extra.toLocaleString()}</b> de importe SP.</span>}
                </div>
              )}
            </div>
          )}

          {/* Segmentos */}
          {(d.recommended||d.actual).segmentos.length>0 && (
            <div style={{marginTop:16}}>
              <div style={{fontSize:11,fontWeight:700,color:"#e8edf5",marginBottom:7}}>
                Δt por tipo de vehículo
                <span style={{fontWeight:400,color:"#5b6a8a"}}> · con ventana {(d.recommended||d.actual).window_s}s</span>
              </div>
              <table style={{width:"100%",fontSize:11,borderCollapse:"collapse",color:"#8a9ab5"}}>
                <thead><tr style={{color:"#5b6a8a"}}>
                  <th style={{textAlign:"left",padding:"4px 0"}}>Segmento</th>
                  <th style={{textAlign:"right"}}>n</th><th style={{textAlign:"right"}}>Moda</th>
                  <th style={{textAlign:"right"}}>Mediana</th><th style={{textAlign:"right"}}>p25–p75</th>
                  <th style={{textAlign:"right"}}>Desv</th>
                </tr></thead>
                <tbody>
                  {(d.recommended||d.actual).segmentos.map(s=>(
                    <tr key={s.segmento} style={{borderTop:"1px solid #1c2b46"}}>
                      <td style={{padding:"5px 0"}}>{s.segmento}</td>
                      <td style={{textAlign:"right"}}>{s.n}</td>
                      <td style={{textAlign:"right",color:"#e8edf5",fontWeight:700}}>{s.moda}s</td>
                      <td style={{textAlign:"right"}}>{s.mediana}s</td>
                      <td style={{textAlign:"right"}}>{s.p25}–{s.p75}</td>
                      <td style={{textAlign:"right"}}>{s.desv}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{fontSize:10,color:"#5b6a8a",marginTop:7,lineHeight:1.6}}>
                Que los distintos tipos de vehículo coincidan en la misma moda confirma que el desfase
                es del carril y no del vehículo. Las motos van aparte: su elusión es masiva, así que
                la muestra conciliada es pequeña y poco representativa.
              </div>
            </div>
          )}
        </React.Fragment>)}
      </div>
    </div>
  );
}

function LaneCard({ lane, stats, offset, onDeepDelta, onClick }) {
  const [hov, setHov] = React.useState(false);
  const s = stats || {};
  // La elusión de motos es habitual (~95% en los carriles 7 y 8) y absorbe las
  // métricas de detección, así que se descuenta de ambos lados del cociente y
  // se reporta como métrica propia.
  const motoAvc     = s.motoAvc || 0;
  const motoSin     = s.motoSinCobro || 0;
  const motoMatched = Math.max(motoAvc - motoSin, 0);
  const hayMotos    = motoAvc > 0;
  const matchRate = (hayMotos && s.matchRateSinMotos!=null) ? s.matchRateSinMotos : (s.matchRate||0);
  const avcTotal  = (s.matched||0) + (s.avcOnly||0) - motoAvc;
  const spTotal   = (s.matched||0) + (s.satOnly||0) - motoMatched - (s.motoSat||0);
  const avcSpRate = spTotal > 0 ? Math.round(avcTotal / spTotal * 1000) / 10 : 0;
  const mColor    = matchRate>=97?"#22c97b":matchRate>=93?"#f5d433":matchRate>0?"#ff4c6a":"#3a4a6b";
  const asColor   = (avcSpRate>=95&&avcSpRate<=105)?"#22c97b"
                  :(avcSpRate>=85&&avcSpRate<=125)?"#f5d433"
                  :avcSpRate>0?"#ff4c6a":"#3a4a6b";
  return (
    <div onClick={onClick}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{...dashStyles.laneCard, borderColor:hov?"#4d7fe0":"#1c2b46", transform:hov?"translateY(-2px)":"none"}}>
      {/* Header */}
      <div style={{marginBottom:10}}>
        <div style={{fontSize:13,fontWeight:700,color:"#e8edf5"}}>{lane.name}</div>
        {lane.source_name && <div style={{fontSize:10,color:"#5b6a8a",marginTop:2}}>{lane.source_name}</div>}
      </div>
      {/* Badges */}
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
        <span style={{...dashStyles.badge,background:"rgba(34,201,123,0.12)",color:"#22c97b"}}>✓ {(s.matched||0).toLocaleString()}</span>
        <span style={{...dashStyles.badge,background:"rgba(255,126,63,0.12)",color:"#ff7e3f"}}>◎ {(s.avcOnly||0).toLocaleString()}</span>
        <span style={{...dashStyles.badge,background:"rgba(91,156,246,0.12)",color:"#5b9cf6"}}>◎ {(s.satOnly||0).toLocaleString()}</span>
        <span style={{...dashStyles.badge,background:"rgba(245,212,51,0.12)",color:"#f5d433"}}>⚠ {(s.axleErr||0).toLocaleString()}</span>
      </div>
      {/* Elusión de motos — normal en estos carriles, por eso va aparte */}
      {hayMotos && (
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                     background:"rgba(255,126,63,0.07)",border:"1px solid rgba(255,126,63,0.18)",
                     borderRadius:7,padding:"6px 9px",marginBottom:10}}
          title={`${motoSin} de ${motoAvc} motos detectadas por AVC no generaron cobro SP. `
                +`La elusión de motos es habitual en estos carriles, por eso se reporta aparte `
                +`y queda excluida de la tasa de detección y del ratio AVC/SP.`}>
          <span style={{fontSize:10,color:"#a0784f"}}>Elusión motos</span>
          <span style={{fontSize:12,fontWeight:800,color:"#ff7e3f"}}>
            {s.motoRate!=null?`${s.motoRate}%`:"—"}
            <span style={{fontSize:9,fontWeight:600,color:"#5b6a8a",marginLeft:4}}>
              {motoSin}/{motoAvc}
            </span>
          </span>
        </div>
      )}
      {/* Total + sparkline */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:12}}>
        <div>
          <div style={{fontSize:11,color:"#5b6a8a"}}>Total conciliable</div>
          <div style={{fontSize:18,fontWeight:700,color:"#e8edf5"}}>{(s.total||0).toLocaleString()}</div>
        </div>
        <Sparkline data={s.spark||[0]} color="#4d7fe0"/>
      </div>
      {/* Dual metric footer */}
      <div style={{display:"flex",borderTop:"1px solid #1c2b46",paddingTop:10}}>
        <div style={{flex:1,textAlign:"center",paddingRight:10,borderRight:"1px solid #1c2b46"}}
          title={"Tasa de detección: fracción de todos los eventos que cuentan con detección AVC."
                + (hayMotos ? " Excluye las motos, cuya elusión es habitual y distorsionaría la métrica." : "")}>
          <div style={{fontSize:22,fontWeight:800,letterSpacing:"-0.5px",lineHeight:1,color:mColor}}>
            {matchRate>0?`${matchRate}%`:"—"}
          </div>
          <div style={{fontSize:9,color:"#5b6a8a",textTransform:"uppercase",letterSpacing:"0.7px",marginTop:5}}>
            Detección{hayMotos && <span style={{textTransform:"none"}}> s/motos</span>}
          </div>
        </div>
        <div style={{flex:1,textAlign:"center",paddingLeft:10}}
          title={"Ratio AVC/SP: eventos detectados por AVC respecto a transacciones registradas por SP."
                + " >100% indica sobre-detección AVC."
                + (hayMotos ? " Excluye las motos por el mismo motivo que la tasa de detección." : "")}>
          <div style={{fontSize:22,fontWeight:800,letterSpacing:"-0.5px",lineHeight:1,color:asColor}}>
            {avcSpRate>0?`${avcSpRate}%`:"—"}
          </div>
          <div style={{fontSize:9,color:"#5b6a8a",textTransform:"uppercase",letterSpacing:"0.7px",marginTop:5}}>
            AVC / SP{hayMotos && <span style={{textTransform:"none"}}> s/motos</span>}
          </div>
        </div>
      </div>
      <DeltaT off={offset}/>
      <div onClick={e=>{e.stopPropagation(); onDeepDelta && onDeepDelta();}}
        style={{marginTop:8,textAlign:"center",fontSize:10,color:"#4d7fe0",cursor:"pointer"}}
        title="Por qué el Δt de este carril es el que es, y qué efecto tiene en la conciliación">
        Análisis profundo de Δt →
      </div>
    </div>
  );
}

function SummaryChart({ lanes, stats }) {
  const canvasRef=React.useRef(null), chartRef=React.useRef(null);
  React.useEffect(()=>{
    if (!canvasRef.current||!lanes.length) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current,{
      type:"bar",
      data:{
        labels: lanes.map(l=>l.id),
        datasets:[
          {label:"Match OK",   data:lanes.map(l=>{const s=stats[l.id]||{};return Math.max((s.matched||0)-(s.axleErr||0),0);}), backgroundColor:"#22c97b",borderRadius:3},
          {label:"Error Ejes", data:lanes.map(l=>(stats[l.id]||{}).axleErr||0), backgroundColor:"#f5d433",borderRadius:3},
          {label:"AVC sin SP",data:lanes.map(l=>(stats[l.id]||{}).avcOnly||0), backgroundColor:"#ff7e3f",borderRadius:3},
          {label:"SP sin AVC",data:lanes.map(l=>(stats[l.id]||{}).satOnly||0), backgroundColor:"#5b9cf6",borderRadius:3},
        ],
      },
      options:{
        responsive:true,maintainAspectRatio:false,
        plugins:{
          legend:{labels:{color:"#8a9ab5",font:{size:11,family:"Inter"},boxWidth:12,padding:16}},
          tooltip:{backgroundColor:"#162036",titleColor:"#e8edf5",bodyColor:"#8a9ab5",borderColor:"#1c2b46",borderWidth:1},
        },
        scales:{
          x:{stacked:true,ticks:{color:"#8a9ab5",font:{size:11}},grid:{color:"#162036"}},
          y:{stacked:true,ticks:{color:"#8a9ab5",font:{size:11}},grid:{color:"#162036"}},
        },
      },
    });
    return ()=>{ if(chartRef.current) chartRef.current.destroy(); };
  },[lanes,stats]);
  if (!lanes.length) return null;
  return (
    <div style={dashStyles.chartCard}>
      <div style={{fontSize:13,fontWeight:600,color:"#e8edf5",marginBottom:16}}>
        Comparativa — {lanes.length} carril(es)
      </div>
      <div style={{height:220}}><canvas ref={canvasRef}/></div>
    </div>
  );
}

// ─── Indicador en vivo (AVC | SAT | pendientes) ───
function shortDateTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString([], {month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit"});
  } catch(e) {
    return String(value).slice(5, 16).replace("T", " ");
  }
}

function LiveBar({ status, lastRefresh, bgSyncing }) {
  if (!status) return null;
  const avcEvts  = Number(status.avc_events)  || 0;
  const satMerged= Number(status.sat_merged)  || 0;
  const satPend  = Number(status.sat_pending) || 0;
  return (
    <div style={{display:"flex",gap:10,alignItems:"center",
      padding:"5px 10px",background:"#070c18",borderRadius:6,border:"1px solid #1e2535",fontSize:11}}>
      <span style={{color:"#5b6a8a"}}>AVC</span>
      <span style={{fontWeight:700,color:"#4d7fe0",fontFamily:"monospace"}}>{avcEvts.toLocaleString()}</span>
      <span title="Última actualización AVC" style={{color:"#5b6a8a"}}>act. {shortDateTime(status.avc_updated_at)}</span>
      <span style={{color:"#162036"}}>|</span>
      <span style={{color:"#5b6a8a"}}>SP</span>
      <span style={{fontWeight:700,color:"#5b9cf6",fontFamily:"monospace"}}>{satMerged.toLocaleString()}</span>
      <span title="Última actualización SP" style={{color:"#5b6a8a"}}>act. {shortDateTime(status.sat_updated_at)}</span>
      {satPend>0 && (
        <span style={{background:"rgba(245,212,51,0.15)",color:"#f5d433",
          padding:"1px 6px",borderRadius:4,fontWeight:600}}>
          ⚠ {satPend} pendiente(s)
        </span>
      )}
      {bgSyncing && (
        <span style={{color:"#5b6a8a",fontStyle:"italic"}}>sincronizando…</span>
      )}
      <span style={{color:"#243358"}}>· {lastRefresh||"—"}</span>
    </div>
  );
}

function BusyPill({ label, detail }) {
  if (!label) return null;
  return (
    <span style={dashStyles.busyPill}>
      <svg width="14" height="14" viewBox="0 0 14 14" style={{display:"block"}}>
        <circle cx="7" cy="7" r="5" fill="none" stroke="#243358" strokeWidth="2"/>
        <path d="M7 2a5 5 0 0 1 5 5" fill="none" stroke="#4d7fe0" strokeWidth="2" strokeLinecap="round">
          <animateTransform attributeName="transform" type="rotate" from="0 7 7" to="360 7 7" dur="0.85s" repeatCount="indefinite"/>
        </path>
      </svg>
      <span>{label}</span>
      {detail && <span style={{color:"#5b6a8a"}}>{detail}</span>}
    </span>
  );
}

function ProcessingRibbon({ activity }) {
  if (!activity || !activity.label) return null;
  return (
    <div style={dashStyles.processingRibbon}>
      <div style={dashStyles.processingGlow}/>
      <div style={dashStyles.processingContent}>
        <div style={dashStyles.processingPulse}>
          {[0, 0.18, 0.36].map(delay => (
            <span key={delay} style={{...dashStyles.processingDot, animationDelay:`${delay}s`}}/>
          ))}
        </div>
        <div>
          <div style={dashStyles.processingTitle}>{activity.label}</div>
          {activity.detail && <div style={dashStyles.processingDetail}>{activity.detail}</div>}
        </div>
      </div>
    </div>
  );
}

// Fecha de hoy en la zona horaria del sistema (evita usar UTC que puede ser un día diferente)
function localToday(tz) {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: tz || "America/Mexico_City" });
  } catch(e) {
    return new Date().toISOString().slice(0, 10);
  }
}

function resolveSatLane(avcLane, satLanes, mapping) {
  const mapped = String((mapping||{})[avcLane] || "").trim();
  if (satLanes.includes(mapped)) return mapped;
  const byName = satLanes.find(v=>v===avcLane||v.includes(avcLane)||avcLane.includes(v));
  if (byName) return byName;
  const laneMatch = String(avcLane||"").match(/carril[\s_-]*(\d+)/i);
  if (!laneMatch) return "";
  const laneNumber = Number(laneMatch[1]);
  return satLanes.find(v=>{
    const satMatch = String(v||"").match(/^T0*(\d+)$/i);
    return satMatch && Number(satMatch[1]) === laneNumber;
  }) || "";
}

// ─── Dashboard principal ───
function Dashboard({ onOpenLane, user }) {
  const [plaza,       setPlaza]      = React.useState("");
  const [date,        setDate]       = React.useState(() => localToday("America/Mexico_City"));
  const dateLockedRef  = React.useRef(false);  // true tras cambio manual de fecha
  const bgSyncedRef    = React.useRef(false);  // evita doble auto-sync por fecha
  const prevAvcRef     = React.useRef(-1);     // detecta aumento de eventos AVC

  const [configs,     setConfigs]    = React.useState([]);
  const [stats,       setStats]      = React.useState({});
  const [loading,     setLoading]    = React.useState(false);
  const [apiErr,      setApiErr]     = React.useState("");
  const [syncing,     setSyncing]    = React.useState(false);  // sync manual visible
  const [bgSyncing,   setBgSyncing]  = React.useState(false);  // sync silencioso en fondo
  const [syncMsg,     setSyncMsg]    = React.useState("");
  const [liveStatus,  setLiveStatus] = React.useState(null);
  const [lastRefresh, setLastRefresh]= React.useState("");
  const [activity,    setActivity]   = React.useState({label:"",detail:""});

  const configsRef = React.useRef(configs);
  React.useEffect(()=>{ configsRef.current = configs; }, [configs]);

  const refreshInProgressRef = React.useRef(false);
  const lastStatusSigRef     = React.useRef("");
  const bgReconDoneRef       = React.useRef(false); // marca que ya se intentó una vez
  const bgReconInProgressRef = React.useRef(false); // marca que está corriendo ahora

  // Cuando cambia la fecha, resetear todos los flags
  React.useEffect(()=>{
    bgSyncedRef.current         = false;
    prevAvcRef.current          = -1;
    lastStatusSigRef.current    = "";
    bgReconDoneRef.current      = false;
    bgReconInProgressRef.current= false;
  }, [date]);

  React.useEffect(()=>{
    window.API.get("/api/config")
      .then(cfg=>{ if(cfg&&cfg.plaza_name) setPlaza(cfg.plaza_name); })
      .catch(()=>{});
  },[]);

  // Δt por carril — vigilancia de deriva de reloj SP↔AVC
  const [offsets,  setOffsets]  = React.useState({});
  const [deepLane, setDeepLane] = React.useState(null);  // carril con panel de análisis abierto
  React.useEffect(()=>{
    window.API.get("/api/lane-offsets?days=30")
      .then(d=>{
        const map = {};
        (d&&d.lanes||[]).forEach(l=>{ map[l.lane] = {...l, window_s:d.window_s}; });
        setOffsets(map);
      })
      .catch(()=>{});
  },[date]);

  // fetchData — carga carriles desde SQLite local (sin spinner si silent=true)
  function fetchData(d, silent) {
    if (refreshInProgressRef.current && silent) return Promise.resolve(null);
    refreshInProgressRef.current = true;
    if (!silent) setLoading(true);
    return window.API.get(`/api/lanes?query_date=${d}`)
      .then(data=>{
        setApiErr("");
        if (data && data.lanes && data.lanes.length > 0) {
          setConfigs(data.lanes);
          setStats(data.stats||{});
        } else if (!silent) {
          // Cambio de fecha explícito a un día sin datos: limpiar el tablero
          setConfigs([]);
          setStats({});
        }
        return data;
      })
      .catch(err=>{
        if (silent) return;
        const status = err&&err.status;
        if (status===401) setApiErr("Sesión expirada. Vuelve a iniciar sesión.");
        else if (status===500) setApiErr("Error interno del servidor.");
        else setApiErr("No se pudo conectar al servidor.");
      })
      .finally(()=>{
        refreshInProgressRef.current = false;
        if (!silent) setLoading(false);
      });
  }

  React.useEffect(()=>{ fetchData(date); },[date]);

  // Conciliación en fondo para todas las pistas — rellena el caché para el Dashboard
  function bgReconcileAll(lanes, d) {
    if (bgReconInProgressRef.current) return; // ya está corriendo, no duplicar
    bgReconInProgressRef.current = true;
    bgReconDoneRef.current = true;
    setActivity({label:"Conciliando",detail:`0/${lanes.length} carriles`});

    Promise.all([
      window.API.get("/api/config").catch(()=>({})),
      window.API.get(`/api/sat/lanes?day=${d.replace(/-/g,"")}`).catch(()=>({lanes:[]})),
    ]).then(([cfg, satData]) => {
      let mapping = {};
      try { mapping = typeof cfg.lane_mapping==="string" ? JSON.parse(cfg.lane_mapping||"{}") : (cfg.lane_mapping||{}); } catch(e) {}
      const satLanes = satData.lanes || [];
      if (!satLanes.length) {
        bgReconInProgressRef.current = false;
        setActivity({label:"",detail:""});
        return;
      }

      const queue = [...lanes];
      let done = 0;
      function next() {
        const lane = queue.shift();
        if (!lane) {
          bgReconInProgressRef.current = false;
          setActivity({label:"Actualizando",detail:"resumen"});
          fetchData(d, true).finally(()=>setActivity({label:"",detail:""})); // actualizar stats al terminar
          return;
        }
        const laneId = lane.id;
        setActivity({label:"Conciliando",detail:`${done + 1}/${lanes.length} · ${laneId}`});
        const satLane = resolveSatLane(laneId, satLanes, mapping);
        if (!satLane) { next(); return; }

        // Sin window_s: la ventana la deriva el backend del Δt del carril.
        window.API.post("/api/reconcile",{avc_lane:laneId,sat_lane:satLane,date:d})
          .then(()=>{})
          .catch(()=>{})
          .finally(()=>{ done += 1; next(); });
      }
      next();
    }).catch(()=>{ bgReconInProgressRef.current = false; setActivity({label:"",detail:""}); });
  }

  // Sync silencioso en fondo — sin spinner ni mensaje prominente
  function bgSync(d) {
    if (bgSyncedRef.current || bgSyncing) return;
    bgSyncedRef.current = true;
    setBgSyncing(true);
    setActivity({label:"Sincronizando AVC",detail:"en segundo plano"});
    window.API.get("/api/sources")
      .then(sources=>{
        const enabled = (Array.isArray(sources)?sources:[]).filter(s=>s.enabled);
        if (!enabled.length) return;
        return Promise.all(
          enabled.map(src=>
            window.API.post(`/api/sources/${src.id}/sync`,{date:d})
              .catch(()=>({ok:false,records:0}))
          )
        ).then(results=>{
          const total = results.reduce((s,r)=>s+(r.records||0),0);
          if (total > 0) {
            setSyncMsg(`↺ ${total} eventos sincronizados`);
            setTimeout(()=>setSyncMsg(""), 4000);
            return fetchData(d, true); // actualizar carriles sin spinner
          }
        });
      })
      .catch(()=>{})
      .finally(()=>{ setBgSyncing(false); if (!bgReconInProgressRef.current) setActivity({label:"",detail:""}); });
  }

  // Polling cada 30s
  React.useEffect(()=>{
    let cancelled = false;
    function poll() {
      const qDate = dateLockedRef.current ? `?query_date=${date}` : "";
      window.API.get(`/api/status${qDate}`)
        .then(s=>{
          if (cancelled) return;
          setLiveStatus(s);
          setLastRefresh(new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}));

          // Primera vez: sincronizar fecha desde el servidor (zona horaria correcta)
          if (!dateLockedRef.current && s.date) {
            dateLockedRef.current = true;
            if (s.date !== date) {
              setDate(s.date);
              return; // fetchData se dispara por el cambio de date
            }
          }

          const avcCount = s.avc_events || 0;
          const processing = s.processing || {};
          if (processing.state && !["ready", "error"].includes(processing.state)) {
            const labels = {
              merging_sat: "Fusionando SP",
              reconciling: "Conciliando",
              syncing_avc: "Sincronizando AVC",
            };
            setActivity({label:labels[processing.state] || "Actualizando", detail:processing.detail || "en segundo plano"});
            return;
          }

          const statusSig = [
            s.date || date,
            s.avc_events || 0,
            s.sat_merged || 0,
            s.sat_pending || 0,
            (s.avc_lanes||[]).join(","),
            (s.sat_lanes||[]).join(","),
          ].join("|");

          // Auto-merge SAT pendientes (silencioso)
          if ((s.sat_pending||0) > 0) {
            setActivity({label:"Fusionando SP",detail:`${s.sat_pending} pendiente(s)`});
            window.API.post("/api/merge-sat",{day:(s.date||date).replace(/-/g,"")})
              .then(r=>{ if(r&&r.ok&&r.added>0) setSyncMsg(`↺ ${r.added} registros SP fusionados automáticamente`); setTimeout(()=>setSyncMsg(""),4000); })
              .catch(()=>{})
              .finally(()=>{ if (!bgReconInProgressRef.current && !syncing && !bgSyncing) setActivity({label:"",detail:""}); });
            return;
          }

          // Si no hay datos locales → auto-sync en fondo (dinámico, invisible)
          if (avcCount === 0 && configsRef.current.length === 0) {
            bgSync(s.date||date);
            return;
          }

          prevAvcRef.current = avcCount;
          if (statusSig !== lastStatusSigRef.current) {
            lastStatusSigRef.current = statusSig;
            fetchData(s.date||date, true);
          }
        })
        .catch(()=>{});
    }
    poll();
    const timer = setInterval(poll, 30000);
    return ()=>{ cancelled=true; clearInterval(timer); };
  },[date]);

  // Sync manual explícito (botón "Sincronizar")
  function syncFromDashboard() {
    if (syncing || bgSyncing || bgReconInProgressRef.current) return;
    setSyncing(true); setSyncMsg(""); setApiErr("");
    setActivity({label:"Sincronizando AVC",detail:"preparando fuentes"});
    bgSyncedRef.current = true; // marcar como hecho para no duplicar
    window.API.get("/api/sources")
      .then(sources=>{
        const enabled=(Array.isArray(sources)?sources:[]).filter(s=>s.enabled);
        if (!enabled.length) throw new Error("Sin fuentes AVC activas. Ve a Configuración → Fuentes AVC.");
        setActivity({label:"Sincronizando AVC",detail:`${enabled.length} fuente(s)`});
        return Promise.all(enabled.map(src=>
          window.API.post(`/api/sources/${src.id}/sync`,{date})
            .catch(e=>({ok:false,error:e&&e.message||"Error",records:0}))
        ));
      })
      .then(results=>{
        const total=results.reduce((s,r)=>s+(r.records||0),0);
        const ok=results.filter(r=>r.ok).length;
        const errs=results.filter(r=>!r.ok);
        if (total>0) {
          setSyncMsg(`✓ ${total} eventos de ${ok} fuente(s)`);
          setActivity({label:"Actualizando",detail:"carriles"});
          bgReconDoneRef.current = false;
          return window.API.get(`/api/status?query_date=${date}`)
            .then(s=>{ setLiveStatus(s); lastStatusSigRef.current = ""; })
            .catch(()=>{})
            .then(()=>fetchData(date, true));
        }
        else if (errs.length) setSyncMsg(`Error: ${errs[0].error}`);
        else setSyncMsg("Sin eventos nuevos para esta fecha");
      })
      .catch(e=>setSyncMsg(e&&e.message||String(e)))
      .finally(()=>{ setSyncing(false); if (!bgReconInProgressRef.current) setActivity({label:"",detail:""}); });
  }

  const totalEvents  = configs.reduce((s,l)=>s+(stats[l.id]?.total||0),0);
  const totalMatched = configs.reduce((s,l)=>s+(stats[l.id]?.matched||0),0);
  const totalAvcOnly = configs.reduce((s,l)=>s+(stats[l.id]?.avcOnly||0),0);
  const totalSatOnly = configs.reduce((s,l)=>s+(stats[l.id]?.satOnly||0),0);
  // avcBase = eventos AVC (matched + AVC-only); totalEvents incluye también SAT-solo
  const avcBase = totalEvents - totalSatOnly;
  // Tasa global = AVC detectados / (AVC detectados + SP sin AVC)
  // = qué fracción del total real de vehículos capturó el AVC
  const overallRate = totalEvents > 0 ? Math.round(avcBase/totalEvents*1000)/10 : 0;

  return (
    <div>
      <style>{`
        @keyframes auditec-flow {
          0% { transform: translateX(-35%); opacity: 0; }
          18% { opacity: 0.8; }
          82% { opacity: 0.8; }
          100% { transform: translateX(135%); opacity: 0; }
        }
        @keyframes auditec-pulse {
          0%, 100% { transform: scale(0.72); opacity: 0.35; }
          50% { transform: scale(1); opacity: 1; }
        }
        @keyframes auditec-soft-breathe {
          0%, 100% { box-shadow: 0 0 0 rgba(77,127,224,0); }
          50% { box-shadow: 0 0 22px rgba(77,127,224,0.18); }
        }
      `}</style>
      {/* Toolbar */}
      <div style={dashStyles.toolbar}>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          {plaza && <div style={{fontSize:15,fontWeight:700,color:"#4d7fe0",letterSpacing:0.5}}>{plaza}</div>}
          <div style={dashStyles.fieldWrap}>
            <label style={dashStyles.fieldLabel}>Fecha</label>
            <input type="date" value={date} onChange={e=>{ dateLockedRef.current=true; setDate(e.target.value); }} style={dashStyles.select}/>
          </div>
          <BusyPill label={loading?"Cargando":activity.label} detail={loading?"datos":activity.detail}/>
          <LiveBar status={liveStatus} lastRefresh={lastRefresh} bgSyncing={bgSyncing}/>
        </div>

        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={syncFromDashboard} disabled={syncing||bgSyncing||bgReconInProgressRef.current}
            style={{...dashStyles.secondaryBtn,opacity:(syncing||bgSyncing||bgReconInProgressRef.current)?0.6:1}}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7a5 5 0 1 0 1-3M2 4V1M2 4H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {(syncing||bgSyncing)?"Sincronizando…":bgReconInProgressRef.current?"Conciliando…":"Sincronizar"}
          </button>
          <button onClick={()=>fetchData(date)} disabled={loading}
            style={{...dashStyles.primaryBtn,opacity:loading?0.7:1}}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v5M7 6l2.5-2.5M7 6L4.5 3.5M1 9.5v2A1.5 1.5 0 002.5 13h9a1.5 1.5 0 001.5-1.5v-2"
                stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Actualizar
          </button>
        </div>
      </div>
      <ProcessingRibbon activity={activity}/>

      {/* Mensajes */}
      {(apiErr||syncMsg) && (
        <div style={{marginBottom:14,padding:"10px 14px",borderRadius:8,fontSize:13,
          background:apiErr?"rgba(255,76,106,0.08)":"rgba(34,201,123,0.08)",
          border:`1px solid ${apiErr?"rgba(255,76,106,0.25)":"rgba(34,201,123,0.25)"}`,
          color:apiErr?"#ff4c6a":"#22c97b"}}>
          {apiErr||syncMsg}
        </div>
      )}

      {/* KPI strip */}
      <div style={dashStyles.kpiStrip}>
        {[
          {label:"Total Eventos",  value:totalEvents.toLocaleString(),  color:"#e8edf5",icon:"📷"},
          {label:"Coincidencias", value:totalMatched.toLocaleString(), color:"#22c97b",icon:"✅"},
          {label:"AVC sin SP",    value:totalAvcOnly.toLocaleString(), color:"#ff7e3f",icon:"🔶"},
          {label:"SP sin AVC",    value:totalSatOnly.toLocaleString(), color:"#5b9cf6",icon:"🚧"},
          {label:"Detección AVC",
           value:totalEvents>0?`${overallRate}%`:"—",
           color:overallRate>=97?"#22c97b":overallRate>=93?"#f5d433":totalEvents>0?"#ff4c6a":"#5b6a8a",
           icon:"📊"},
        ].map(k=>(
          <div key={k.label} style={dashStyles.kpiCard}>
            <div style={{fontSize:18}}>{k.icon}</div>
            <div>
              <div style={{fontSize:11,color:"#5b6a8a",marginBottom:3}}>{k.label}</div>
              <div style={{fontSize:22,fontWeight:800,color:k.color}}>{k.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Etiqueta carriles */}
      <div style={{fontSize:11,color:"#5b6a8a",marginBottom:12,letterSpacing:0.5,textTransform:"uppercase",
        display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span>
          {configs.length} carril(es) AVC
          {liveStatus?.sat_lanes?.length?` · ${liveStatus.sat_lanes.length} SP`:""}
          {plaza?` — ${plaza}`:""} — {date}
        </span>
        {configs.length>0 && <span style={{color:"#243358"}}>Haz clic en un carril para conciliar</span>}
      </div>

      {/* Grid de carriles */}
      <div style={dashStyles.laneGrid}>
        {configs.map(lane=>(
          <LaneCard key={lane.id} lane={lane}
            stats={stats[lane.id]||{total:0,matched:0,avcOnly:0,satOnly:0,axleErr:0,matchRate:0,spark:[0]}}
            offset={offsets[lane.id]}
            onDeepDelta={()=>setDeepLane(lane.id)}
            onClick={()=>onOpenLane(lane.id, null, date)}/>
        ))}
        {configs.length===0 && !loading && (
          <div style={{gridColumn:"1/-1",textAlign:"center",padding:"40px 20px",color:"#5b6a8a"}}>
            <div style={{fontSize:32,marginBottom:12}}>📭</div>
            <div style={{fontWeight:600,color:"#8a9ab5",marginBottom:8}}>Sin datos para {date}</div>
            <div style={{fontSize:12,marginBottom:16}}>
              {apiErr||"No hay eventos AVC sincronizados para esta fecha."}
            </div>
            {!apiErr && (
              <button onClick={syncFromDashboard} disabled={syncing||bgSyncing||bgReconInProgressRef.current}
                style={{...dashStyles.primaryBtn,margin:"0 auto",opacity:(syncing||bgSyncing||bgReconInProgressRef.current)?0.6:1}}>
                {(syncing||bgSyncing)?"Sincronizando…":bgReconInProgressRef.current?"Conciliando…":"↺ Sincronizar esta fecha"}
              </button>
            )}
          </div>
        )}
      </div>

      <SummaryChart lanes={configs} stats={stats}/>
      <ClassBreakdown date={date} onOpenLane={onOpenLane}/>
      {deepLane && (
        <DeepDeltaPanel lane={deepLane} date={date} onClose={()=>setDeepLane(null)}/>
      )}
    </div>
  );
}

// ─── Comparativa de clases AVC vs SP ───
function ClassBreakdown({ date, onOpenLane }) {
  const [data, setData] = React.useState(null);

  React.useEffect(()=>{
    if (!date) return;
    setData(null);
    window.API.get(`/api/class-summary?query_date=${date}`)
      .then(d=>setData(d)).catch(()=>{});
  }, [date]);

  if (!data || !data.breakdown || data.breakdown.length === 0) return null;

  const bd = data.breakdown;
  const maxVal = Math.max(...bd.flatMap(b=>[b.avc, b.sat]), 1);
  const money = data.money || {avc_amount:0, sat_amount:0, amount_delta:0, currency:"MXN"};
  const moneyFmt = (value) => Number(value || 0).toLocaleString("es-MX", {
    style:"currency", currency:money.currency || "MXN", maximumFractionDigits:0,
  });

  // Separar motos del resto
  const motos = bd.filter(b => b.class_id === 15);
  const others = bd.filter(b => b.class_id !== 15);

  function ClassCard({ b }) {
    const delta = b.avc - b.sat;
    const avcPct = Math.round((b.avc / maxVal) * 100);
    const satPct = Math.round((b.sat / maxVal) * 100);
    const isMoto = b.class_id === 15;
    const deltaColor = delta > 0 ? "#ff7e3f" : delta < 0 ? "#5b9cf6" : "#22c97b";
    const amountDelta = Number(b.amount_delta || 0);
    const amountColor = amountDelta < 0 ? "#ff4c6a" : amountDelta > 0 ? "#22c97b" : "#22c97b";
    return (
      <div style={{
        background: isMoto ? "rgba(91,156,246,0.07)" : "#0f1928",
        border: `1px solid ${isMoto ? "rgba(91,156,246,0.3)" : "#162036"}`,
        borderRadius:8, padding:"10px 12px",
      }}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <span style={{fontSize:13,fontWeight:700,color:isMoto?"#5b9cf6":"#e8edf5"}}>{b.name}</span>
          <span style={{fontSize:11,fontWeight:700,color:deltaColor,
            background:`${deltaColor}18`,padding:"1px 7px",borderRadius:4}}>
            {delta > 0 ? `+${delta}` : delta === 0 ? "=" : delta}
          </span>
        </div>
        {/* AVC row */}
        <div style={{marginBottom:5}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
            <span style={{fontSize:10,color:"#5b6a8a",letterSpacing:0.3}}>AVC</span>
            <span style={{fontSize:12,fontWeight:700,color:"#ff7e3f"}}>{b.avc.toLocaleString()}</span>
          </div>
          <div style={{height:5,background:"#162036",borderRadius:3}}>
            <div style={{height:"100%",width:`${avcPct}%`,background:"#ff7e3f",borderRadius:3,
              transition:"width 0.4s ease"}}/>
          </div>
        </div>
        {/* SAT row */}
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
            <span style={{fontSize:10,color:"#5b6a8a",letterSpacing:0.3}}>SP</span>
            <span style={{fontSize:12,fontWeight:700,color:"#5b9cf6"}}>{b.sat.toLocaleString()}</span>
          </div>
          <div style={{height:5,background:"#162036",borderRadius:3}}>
            <div style={{height:"100%",width:`${satPct}%`,background:"#5b9cf6",borderRadius:3,
            transition:"width 0.4s ease"}}/>
          </div>
        </div>
        <div style={{marginTop:9,paddingTop:8,borderTop:"1px solid #162036",
          display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div>
            <div style={{fontSize:9,color:"#5b6a8a",letterSpacing:0.4,textTransform:"uppercase"}}>AVC est.</div>
            <div style={{fontSize:12,fontWeight:800,color:"#ffb27d",marginTop:2}}>
              {moneyFmt(b.avc_amount)}
            </div>
          </div>
          <div>
            <div style={{fontSize:9,color:"#5b6a8a",letterSpacing:0.4,textTransform:"uppercase"}}>SP real</div>
            <div style={{fontSize:12,fontWeight:800,color:"#8bbcff",marginTop:2}}>
              {moneyFmt(b.sat_amount)}
            </div>
          </div>
          <div style={{gridColumn:"1/-1",display:"flex",justifyContent:"space-between",gap:8,
            alignItems:"center",background:`${amountColor}10`,border:`1px solid ${amountColor}30`,
            borderRadius:5,padding:"5px 7px"}}>
            <span style={{fontSize:10,color:"#8a9ab5"}}>Diferencia $</span>
            <span style={{fontSize:12,fontWeight:800,color:amountColor}}>
              {amountDelta > 0 ? "+" : ""}{moneyFmt(amountDelta)}
            </span>
          </div>
          <div style={{gridColumn:"1/-1",fontSize:9,color:"#5b6a8a"}}>
            Tarifa {b.tariff_source || "ref."} · {moneyFmt(b.tariff)}
          </div>
        </div>
        {b.lanes && b.lanes.length > 0 && (
          <div style={{marginTop:10,paddingTop:8,borderTop:"1px solid #162036"}}>
            <div style={{fontSize:10,color:"#5b6a8a",letterSpacing:0.6,textTransform:"uppercase",marginBottom:6}}>
              Diferencias por carril
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {b.lanes.slice(0, 4).map(l => {
                const laneDeltaColor = l.delta > 0 ? "#ff7e3f" : "#5b9cf6";
                return (
                  <button key={l.lane} onClick={() => onOpenLane && onOpenLane(l.lane, {
                      type: "class_diff",
                      class_id: b.class_id,
                      class_name: b.name,
                    }, date)}
                    style={{
                      background:`${laneDeltaColor}14`,border:`1px solid ${laneDeltaColor}40`,
                      color:laneDeltaColor,borderRadius:5,padding:"4px 7px",fontSize:10,
                      fontWeight:700,cursor:"pointer",fontFamily:"inherit",lineHeight:1.2,
                    }}
                    title={`Abrir ${l.lane} para revisar diferencias de ${b.name}. Impacto ${moneyFmt(l.amount_delta)}`}>
                    {l.lane} {l.delta > 0 ? `+${l.delta}` : l.delta}
                  </button>
                );
              })}
              {b.lanes.length > 4 && (
                <span style={{fontSize:10,color:"#5b6a8a",alignSelf:"center"}}>+{b.lanes.length - 4} más</span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{background:"#0d1525",border:"1px solid #1c2b46",borderRadius:12,
      padding:"18px 20px",marginTop:16}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:"#e8edf5"}}>Comparativa por Clase — AVC vs SP</div>
          <div style={{fontSize:11,color:"#5b6a8a",marginTop:2}}>
            Clasificación vehicular · sin ejes · {data.date}
          </div>
        </div>
        <div style={{display:"flex",gap:16,fontSize:11}}>
          <span style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{width:10,height:10,borderRadius:"50%",background:"#ff7e3f",display:"inline-block"}}/>
            <span style={{color:"#8a9ab5"}}>AVC</span>
          </span>
          <span style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{width:10,height:10,borderRadius:"50%",background:"#5b9cf6",display:"inline-block"}}/>
            <span style={{color:"#8a9ab5"}}>SP</span>
          </span>
          <span style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{width:10,height:10,borderRadius:2,background:"rgba(255,126,63,0.25)",display:"inline-block"}}/>
            <span style={{color:"#8a9ab5"}}>+AVC · −SP</span>
          </span>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,marginBottom:16}}>
        <div style={{background:"#0f1928",border:"1px solid #162036",borderRadius:8,padding:"12px 14px"}}>
          <div style={{fontSize:10,color:"#5b6a8a",letterSpacing:0.7,textTransform:"uppercase"}}>SP registrado</div>
          <div style={{fontSize:20,fontWeight:800,color:"#8bbcff",marginTop:4}}>{moneyFmt(money.sat_amount)}</div>
        </div>
        <div style={{background:"#0f1928",border:"1px solid #162036",borderRadius:8,padding:"12px 14px"}}>
          <div style={{fontSize:10,color:"#5b6a8a",letterSpacing:0.7,textTransform:"uppercase"}}>AVC estimado</div>
          <div style={{fontSize:20,fontWeight:800,color:"#ffb27d",marginTop:4}}>{moneyFmt(money.avc_amount)}</div>
        </div>
        <div style={{background:"#0f1928",border:"1px solid #162036",borderRadius:8,padding:"12px 14px"}}>
          <div style={{fontSize:10,color:"#5b6a8a",letterSpacing:0.7,textTransform:"uppercase"}}>Diferencia neta</div>
          <div style={{fontSize:20,fontWeight:800,color:money.amount_delta < 0 ? "#ff4c6a" : "#22c97b",marginTop:4}}>
            {money.amount_delta > 0 ? "+" : ""}{moneyFmt(money.amount_delta)}
          </div>
        </div>
        <div style={{background:"#0f1928",border:"1px solid #162036",borderRadius:8,padding:"12px 14px"}}>
          <div style={{fontSize:10,color:"#5b6a8a",letterSpacing:0.7,textTransform:"uppercase"}}>Base de cálculo</div>
          <div style={{fontSize:11,fontWeight:600,color:"#8a9ab5",lineHeight:1.35,marginTop:5}}>
            SP real por cobro · AVC por tarifa configurada
          </div>
        </div>
      </div>

      {/* Motos destacadas */}
      {motos.length > 0 && (
        <div style={{marginBottom:14}}>
          <div style={{fontSize:10,color:"#5b9cf6",letterSpacing:1,
            textTransform:"uppercase",fontWeight:600,marginBottom:8}}>
            Motocicletas
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:8}}>
            {motos.map(b=><ClassCard key={b.class_id} b={b}/>)}
          </div>
        </div>
      )}

      {/* Resto de clases */}
      {others.length > 0 && (
        <div>
          {motos.length > 0 && (
            <div style={{fontSize:10,color:"#5b6a8a",letterSpacing:1,
              textTransform:"uppercase",fontWeight:600,marginBottom:8}}>
              Vehículos
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:8}}>
            {others.map(b=><ClassCard key={b.class_id} b={b}/>)}
          </div>
        </div>
      )}
    </div>
  );
}

const dashStyles = {
  toolbar:      {display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:16,gap:12,flexWrap:"wrap"},
  fieldWrap:    {display:"flex",flexDirection:"column",gap:4},
  fieldLabel:   {fontSize:11,color:"#5b6a8a",letterSpacing:0.5},
  select:       {background:"#0d1525",border:"1px solid #2a3045",borderRadius:7,padding:"7px 12px",color:"#e8edf5",fontSize:13,fontFamily:"inherit",outline:"none"},
  primaryBtn:   {display:"flex",alignItems:"center",gap:7,background:"#4d7fe0",border:"none",borderRadius:8,padding:"9px 16px",color:"#080d1a",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",flexShrink:0},
  secondaryBtn: {display:"flex",alignItems:"center",gap:7,background:"transparent",border:"1px solid #2a3045",borderRadius:8,padding:"8px 14px",color:"#8a9ab5",fontSize:13,cursor:"pointer",fontFamily:"inherit",flexShrink:0},
  busyPill:     {display:"inline-flex",alignItems:"center",gap:7,background:"rgba(77,127,224,0.08)",border:"1px solid rgba(77,127,224,0.25)",borderRadius:7,padding:"5px 9px",color:"#8a9ab5",fontSize:11,whiteSpace:"nowrap",animation:"auditec-soft-breathe 2.6s ease-in-out infinite"},
  processingRibbon: {position:"relative",overflow:"hidden",border:"1px solid rgba(77,127,224,0.24)",background:"linear-gradient(90deg,rgba(77,127,224,0.08),rgba(34,201,123,0.06),rgba(91,156,246,0.08))",borderRadius:8,margin:"-4px 0 14px",minHeight:42},
  processingGlow: {position:"absolute",inset:0,width:"42%",background:"linear-gradient(90deg,transparent,rgba(77,127,224,0.22),transparent)",animation:"auditec-flow 2.8s ease-in-out infinite"},
  processingContent: {position:"relative",display:"flex",alignItems:"center",gap:12,padding:"9px 13px"},
  processingPulse: {display:"flex",gap:4,alignItems:"center",flexShrink:0},
  processingDot: {width:6,height:6,borderRadius:6,background:"#4d7fe0",display:"block",animation:"auditec-pulse 1.2s ease-in-out infinite"},
  processingTitle: {fontSize:12,color:"#e8edf5",fontWeight:700},
  processingDetail: {fontSize:11,color:"#8a9ab5",marginTop:2},
  kpiStrip:     {display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:24},
  kpiCard:      {background:"#0d1525",border:"1px solid #2a3045",borderRadius:10,padding:"14px 18px",display:"flex",alignItems:"center",gap:12},
  laneGrid:     {display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:14,marginBottom:24},
  laneCard:     {background:"#0d1525",border:"1px solid #2a3045",borderRadius:12,padding:"16px 18px",cursor:"pointer",transition:"border-color 0.2s,transform 0.15s"},
  badge:        {fontSize:11,fontWeight:600,borderRadius:5,padding:"2px 7px",whiteSpace:"nowrap"},
  chartCard:    {background:"#0d1525",border:"1px solid #2a3045",borderRadius:12,padding:"18px 20px"},
};

Object.assign(window, { Dashboard });
