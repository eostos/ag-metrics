// Auth — Login screen
function LoginScreen({ onLogin }) {
  const [email,    setEmail]    = React.useState("admin@auditec.mx");
  const [password, setPassword] = React.useState("admin123");
  const [error,    setError]    = React.useState("");
  const [loading,  setLoading]  = React.useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    .then(async r => {
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail || "Error de autenticación");
      }
      return r.json();
    })
    .then(({ token, user }) => {
      localStorage.setItem("auditec_token", token);
      onLogin(user);
    })
    .catch(e => { setError(e.message); setLoading(false); });
  }

  return (
    <div style={authStyles.bg}>
      {/* Subtle dot grid */}
      <div style={authStyles.gridOverlay}/>

      {/* Decorative navy glow */}
      <div style={{
        position:"absolute", width:600, height:600, borderRadius:"50%",
        background:"radial-gradient(circle, rgba(15,29,64,0.6) 0%, transparent 70%)",
        top:"50%", left:"50%", transform:"translate(-50%,-50%)", pointerEvents:"none",
      }}/>

      <div style={authStyles.card}>
        {/* AG Holdings logo at top */}
        <div style={authStyles.brandBadge}>
          <img src="/logo.jpeg" alt="AG Holdings" style={{height:56, display:"block", objectFit:"contain"}}/>
        </div>

        {/* Platform name + tagline */}
        <div style={authStyles.logoWrap}>
          <div style={authStyles.logoTitle}>AG-metrics</div>
          <div style={authStyles.logoSub}>Plataforma de Auditoría AVC / SAT</div>
        </div>

        <h2 style={authStyles.heading}>Iniciar sesión</h2>
        <p style={authStyles.subheading}>Accede a tu cuenta para continuar</p>

        <form onSubmit={handleSubmit} style={{width:"100%"}}>
          <div style={authStyles.fieldGroup}>
            <label style={authStyles.label}>Correo electrónico</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
              style={authStyles.input} placeholder="usuario@empresa.mx" autoComplete="email"/>
          </div>
          <div style={authStyles.fieldGroup}>
            <label style={authStyles.label}>Contraseña</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
              style={authStyles.input} placeholder="••••••••" autoComplete="current-password"/>
          </div>
          {error && (
            <div style={authStyles.errorBox}><span>⚠</span> {error}</div>
          )}
          <button type="submit" style={{...authStyles.btn, opacity:loading?0.7:1}} disabled={loading}>
            {loading ? "Verificando…" : "Entrar"}
          </button>
        </form>

        <div style={authStyles.demoHint}>
          <span style={{color:"#4a5d7a",fontSize:11}}>Cuenta por defecto: admin@auditec.mx / admin123</span>
        </div>
      </div>
    </div>
  );
}

const authStyles = {
  bg: {
    minHeight:"100vh", background:"#080d1a",
    display:"flex", alignItems:"center", justifyContent:"center",
    position:"relative", overflow:"hidden",
  },
  gridOverlay: {
    position:"absolute", inset:0,
    backgroundImage:"linear-gradient(rgba(77,127,224,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(77,127,224,0.04) 1px,transparent 1px)",
    backgroundSize:"40px 40px", pointerEvents:"none",
  },
  card: {
    background:"#0d1525", border:"1px solid #1c2b46", borderRadius:18, padding:"36px 44px",
    width:420, display:"flex", flexDirection:"column", alignItems:"center",
    position:"relative", zIndex:1,
    boxShadow:"0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(77,127,224,0.1)",
  },
  brandBadge: {
    background:"#fff", borderRadius:12, padding:"12px 20px",
    display:"flex", alignItems:"center", justifyContent:"center",
    marginBottom:20, boxShadow:"0 4px 16px rgba(0,0,0,0.4)",
  },
  logoWrap: { textAlign:"center", marginBottom:24 },
  logoTitle: { fontSize:22, fontWeight:800, color:"#e8edf5", letterSpacing:3, lineHeight:1 },
  logoSub:   { fontSize:11, color:"#4a5d7a", letterSpacing:1, marginTop:4 },
  heading:    { fontSize:20, fontWeight:700, color:"#e8edf5", margin:"0 0 6px", alignSelf:"flex-start" },
  subheading: { fontSize:13, color:"#5b6a8a", margin:"0 0 28px", alignSelf:"flex-start" },
  fieldGroup: { marginBottom:18, width:"100%" },
  label: { display:"block", fontSize:12, color:"#8a9ab5", marginBottom:7, letterSpacing:0.5, fontWeight:500 },
  input: {
    width:"100%", background:"#080d1a", border:"1px solid #1c2b46", borderRadius:8,
    padding:"10px 14px", color:"#e8edf5", fontSize:14, outline:"none",
    boxSizing:"border-box", fontFamily:"inherit",
  },
  errorBox: {
    background:"rgba(255,76,106,0.1)", border:"1px solid rgba(255,76,106,0.3)",
    borderRadius:8, padding:"10px 14px", color:"#ff4c6a", fontSize:13,
    marginBottom:18, display:"flex", alignItems:"center", gap:8, width:"100%", boxSizing:"border-box",
  },
  btn: {
    width:"100%", background:"#4d7fe0", border:"none", borderRadius:8,
    padding:"12px 0", color:"#fff", fontSize:15, fontWeight:700,
    cursor:"pointer", marginTop:4, letterSpacing:0.3, fontFamily:"inherit",
    boxShadow:"0 4px 20px rgba(77,127,224,0.4)",
  },
  demoHint: { marginTop:22, borderTop:"1px solid #162036", paddingTop:18, width:"100%", textAlign:"center" },
};

Object.assign(window, { LoginScreen });
