// Layout — Sidebar + Top Nav shell
const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1" y="1" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="10" y="1" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="1" y="10" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="10" y="10" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )},
  { id: "reports", label: "Reportes", icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="2" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M5 9h8M5 6h5M5 12h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )},
  { id: "config", label: "Configuración", adminOnly: true, icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.22 3.22l1.42 1.42M13.36 13.36l1.42 1.42M3.22 14.78l1.42-1.42M13.36 4.64l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )},
];

// AG mark — chevron stripes inspired by the AG Holdings logo
function AGMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" fill="none">
      <rect width="44" height="44" rx="9" fill="rgba(77,127,224,0.18)"/>
      <path d="M7 36L22 9l15 27H30L22 15 14 36H7Z" fill="#4d7fe0" opacity="0.9"/>
      <path d="M12 36L22 14l10 22H27L22 19 17 36H12Z" fill="#4d7fe0" opacity="0.55"/>
      <path d="M17 36L22 20l5 16H20l-2-5-1 5H17Z" fill="#4d7fe0" opacity="0.25"/>
    </svg>
  );
}

function Sidebar({ currentView, onNavigate, user, collapsed, setCollapsed }) {
  const items = NAV_ITEMS.filter(i => !i.adminOnly || user.role === "Admin");

  return (
    <div style={{...layoutStyles.sidebar, width: collapsed ? 64 : 230, transition: "width 0.25s ease"}}>

      {/* ── Logo area ── */}
      <div style={{...layoutStyles.sidebarLogo, justifyContent: collapsed ? "center" : "flex-start"}}>
        {collapsed ? (
          <AGMark size={32}/>
        ) : (
          <div style={{display:"flex", flexDirection:"column", gap:10, width:"100%"}}>
            {/* AG Holdings brand badge */}
            <div style={{
              background:"#fff", borderRadius:8, padding:"7px 10px",
              display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow:"0 2px 8px rgba(0,0,0,0.3)",
            }}>
              <img src="/logo.jpeg" alt="AG Holdings"
                style={{height:40, display:"block", objectFit:"contain"}}/>
            </div>
            {/* Platform name */}
            <div style={{display:"flex", alignItems:"center", gap:8, paddingLeft:2}}>
              <AGMark size={22}/>
              <div>
                <div style={layoutStyles.sidebarLogoText}>AG-metrics</div>
                <div style={{fontSize:9, color:"#4a5d7a", letterSpacing:1.5,
                  textTransform:"uppercase", marginTop:2, whiteSpace:"nowrap"}}>
                  Plataforma AVC / SAT
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Nav items ── */}
      <nav style={{flex:1, padding:"8px 0"}}>
        {items.map(item => {
          const active = currentView === item.id;
          return (
            <button key={item.id} onClick={() => onNavigate(item.id)}
              title={collapsed ? item.label : ""}
              style={{
                ...layoutStyles.navItem,
                background: active ? "rgba(77,127,224,0.12)" : "transparent",
                color:      active ? "#4d7fe0" : "#7a8aaa",
                borderLeft: active ? "3px solid #4d7fe0" : "3px solid transparent",
                justifyContent: collapsed ? "center" : "flex-start",
                padding:    collapsed ? "11px 0" : "11px 20px",
              }}>
              <span style={{flexShrink:0}}>{item.icon}</span>
              {!collapsed && (
                <span style={{marginLeft:12, fontSize:13, fontWeight: active ? 600 : 400}}>
                  {item.label}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Collapse toggle ── */}
      <button onClick={() => setCollapsed(!collapsed)} style={layoutStyles.collapseBtn}
        title={collapsed ? "Expandir" : "Colapsar"}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
          style={{transform: collapsed ? "rotate(180deg)" : "none", transition:"transform 0.25s"}}>
          <path d="M10 12L6 8l4-4" stroke="#5b6a8a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {!collapsed && <span style={{fontSize:11, color:"#5b6a8a", marginLeft:8}}>Colapsar</span>}
      </button>
    </div>
  );
}

const ROLE_COLORS = { Admin: "#4d7fe0", Auditor: "#5b9cf6", Operator: "#f5d433" };

function TopBar({ user, onLogout, title, subtitle }) {
  return (
    <div style={layoutStyles.topbar}>
      <div>
        <div style={layoutStyles.pageTitle}>{title}</div>
        {subtitle && <div style={layoutStyles.pageSubtitle}>{subtitle}</div>}
      </div>
      <div style={{display:"flex", alignItems:"center", gap:16}}>
        <div style={layoutStyles.userInfo}>
          <div style={layoutStyles.userAvatar}>
            {user.name.split(" ").map(w=>w[0]).join("").slice(0,2)}
          </div>
          <div>
            <div style={{fontSize:13, color:"#e8edf5", fontWeight:600, lineHeight:1.2}}>{user.name}</div>
            <div style={{fontSize:11, color: ROLE_COLORS[user.role] || "#8a9ab5", marginTop:2}}>{user.role}</div>
          </div>
        </div>
        <button onClick={onLogout} style={layoutStyles.logoutBtn}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M6 1H2a1 1 0 00-1 1v11a1 1 0 001 1h4M10 11l4-4-4-4M14 7.5H6"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Salir
        </button>
      </div>
    </div>
  );
}

function AppLayout({ user, onLogout, currentView, onNavigate, title, subtitle, children }) {
  const [collapsed, setCollapsed] = React.useState(false);
  return (
    <div style={layoutStyles.appShell}>
      <Sidebar currentView={currentView} onNavigate={onNavigate} user={user}
        collapsed={collapsed} setCollapsed={setCollapsed}/>
      <div style={layoutStyles.mainArea}>
        <TopBar user={user} onLogout={onLogout} title={title} subtitle={subtitle}/>
        <div style={layoutStyles.content}>{children}</div>
      </div>
    </div>
  );
}

const layoutStyles = {
  appShell:  { display:"flex", height:"100vh", background:"#080d1a", overflow:"hidden" },
  sidebar: {
    background:"#070c18", borderRight:"1px solid #0f1928",
    display:"flex", flexDirection:"column", flexShrink:0, overflow:"hidden",
  },
  sidebarLogo: {
    display:"flex", alignItems:"flex-start", gap:10,
    padding:"16px 14px 18px", borderBottom:"1px solid #0f1928",
  },
  sidebarLogoText: { fontSize:15, fontWeight:800, color:"#e8edf5", letterSpacing:2, whiteSpace:"nowrap", lineHeight:1 },
  navItem: {
    display:"flex", alignItems:"center", width:"100%", border:"none",
    cursor:"pointer", transition:"all 0.15s", fontFamily:"inherit", whiteSpace:"nowrap",
  },
  collapseBtn: {
    display:"flex", alignItems:"center", background:"none", border:"none",
    cursor:"pointer", padding:"14px 16px", borderTop:"1px solid #0f1928", fontFamily:"inherit",
  },
  topbar: {
    background:"#070c18", borderBottom:"1px solid #0f1928",
    padding:"14px 28px", display:"flex", justifyContent:"space-between", alignItems:"center",
    flexShrink:0,
  },
  pageTitle:    { fontSize:18, fontWeight:700, color:"#e8edf5" },
  pageSubtitle: { fontSize:12, color:"#5b6a8a", marginTop:2 },
  userInfo:     { display:"flex", alignItems:"center", gap:10 },
  userAvatar: {
    width:34, height:34, borderRadius:"50%", background:"rgba(77,127,224,0.15)",
    border:"1px solid rgba(77,127,224,0.3)", color:"#4d7fe0", fontSize:12, fontWeight:700,
    display:"flex", alignItems:"center", justifyContent:"center",
  },
  logoutBtn: {
    display:"flex", alignItems:"center", gap:6, background:"none",
    border:"1px solid #1c2b46", borderRadius:7, padding:"7px 13px",
    color:"#7a8aaa", fontSize:12, cursor:"pointer", fontFamily:"inherit", transition:"all 0.15s",
  },
  mainArea: { flex:1, display:"flex", flexDirection:"column", overflow:"hidden" },
  content:  { flex:1, overflow:"auto", padding:"24px 28px" },
};

Object.assign(window, { AppLayout, ROLE_COLORS });
