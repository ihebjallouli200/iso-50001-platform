import { FormEvent, useEffect, useState } from "react";
import Dashboard from "./Dashboard";
import MachineDetail from "./MachineDetail";
import DataPipelineMonitor from "./DataPipelineMonitor";
import ConfigurationPanel from "./ConfigurationPanel";
import PDCAManagement from "./PDCAManagement";
import ApprovalsManagement from "./ApprovalsManagement";
import AuditCenter from "./AuditCenter";
import {
  getRoleLandingPage,
  ROLE_LABELS,
  ROLE_ICONS,
  getInitials,
  type SessionUser,
} from "./auth_rbac";
import {
  loginWithApi,
  logoutWithApi,
  resolveSessionUser,
  SESSION_TOKEN_KEY,
} from "./api";

type View = "dashboard" | "machine" | "pipeline" | "config" | "pdca" | "approvals" | "audit";

const SESSION_KEY = "enms-local-session";

const NAV_ITEMS: {
  id: View;
  icon: string;
  label: string;
  roles?: string[];
  section?: string;
}[] = [
  { id: "dashboard", icon: "📊", label: "Dashboard", section: "Monitoring" },
  { id: "pipeline", icon: "🔄", label: "Pipeline Données" },
  { id: "pdca", icon: "♻️", label: "Cycles PDCA", section: "Management" },
  {
    id: "approvals",
    icon: "✅",
    label: "Approbations",
    roles: ["ADMIN_ENERGIE", "RESPONSABLE_SITE"],
  },
  {
    id: "audit",
    icon: "📋",
    label: "Centre Audit",
    roles: ["ADMIN_ENERGIE", "AUDITEUR"],
    section: "Conformité",
  },
  {
    id: "config",
    icon: "⚙️",
    label: "Configuration",
    roles: ["ADMIN_ENERGIE"],
    section: "Administration",
  },
];

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [selectedMachineId, setSelectedMachineId] = useState<number>(0);

  function openMachineDetail(machineId: number) {
    setSelectedMachineId(machineId);
    setView("machine");
  }
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("enms-sidebar") === "collapsed",
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem("enms-theme") as "dark" | "light") || "dark",
  );
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);

  /* Apply theme to document */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("enms-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  /* Clock for topbar */
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const token = localStorage.getItem(SESSION_TOKEN_KEY);

    try {
      const parsed = JSON.parse(raw) as SessionUser;
      if (token) {
        resolveSessionUser(token)
          .then((remoteUser) => {
            const activeUser = remoteUser || parsed;
            setSessionUser(activeUser);
            setView(getRoleLandingPage(activeUser.role));
          })
          .catch(() => {
            setSessionUser(parsed);
            setView(getRoleLandingPage(parsed.role));
          });
      } else {
        setSessionUser(parsed);
        setView(getRoleLandingPage(parsed.role));
      }
    } catch {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_TOKEN_KEY);
    }
  }, []);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const authenticated = await loginWithApi(username.trim(), password);
    setLoading(false);

    if (!authenticated) {
      setError("Identifiants invalides. Vérifiez votre nom d'utilisateur et mot de passe.");
      return;
    }

    setSessionUser(authenticated.sessionUser);
    setView(getRoleLandingPage(authenticated.sessionUser.role));
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify(authenticated.sessionUser),
    );
    localStorage.setItem(SESSION_TOKEN_KEY, authenticated.sessionToken);
    setPassword("");
  };

  const handleDemoLogin = (user: string, pass: string) => {
    setUsername(user);
    setPassword(pass);
    // Auto-submit
    setTimeout(() => {
      const form = document.getElementById("login-form") as HTMLFormElement;
      if (form) form.requestSubmit();
    }, 50);
  };

  const handleLogout = async () => {
    const token = localStorage.getItem(SESSION_TOKEN_KEY);
    if (token) await logoutWithApi(token);

    setSessionUser(null);
    setUsername("");
    setPassword("");
    setView("dashboard");
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_TOKEN_KEY);
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("enms-sidebar", next ? "collapsed" : "expanded");
      return next;
    });
  };

  // ─── LOGIN PAGE ───

  if (!sessionUser) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">E</div>
          <h1 className="login-title">EnMS ISO 50001</h1>
          <p className="login-subtitle">
            Plateforme de Management Énergétique
          </p>

          <form
            id="login-form"
            className="login-form"
            onSubmit={handleLogin}
          >
            <div className="form-group">
              <label className="form-label" htmlFor="login-username">
                Nom d'utilisateur
              </label>
              <input
                id="login-username"
                className="form-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin.energie"
                required
                autoComplete="username"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="login-password">
                Mot de passe
              </label>
              <input
                id="login-password"
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>
            {error && <div className="login-error">{error}</div>}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="loading-spinner" /> Connexion…
                </>
              ) : (
                "Se connecter"
              )}
            </button>
          </form>

          <div className="login-demo">
            <h4>Comptes de démonstration</h4>
            <div className="demo-accounts">
              {[
                { user: "admin.energie", pass: "Admin50001!", role: "Admin Énergie", icon: "⚡" },
                { user: "resp.site", pass: "Site50001!", role: "Resp. Site", icon: "🏭" },
                {
                  user: "auditeur.interne",
                  pass: "Audit50001!",
                  role: "Auditeur",
                  icon: "📋",
                },
                { user: "operateur.l1", pass: "Oper50001!", role: "Opérateur", icon: "🔧" },
              ].map((a) => (
                <div
                  key={a.user}
                  className="demo-account"
                  onClick={() => handleDemoLogin(a.user, a.pass)}
                >
                  <div style={{ fontSize: 14, marginBottom: 2 }}>{a.icon}</div>
                  <div className="demo-account-user">{a.user}</div>
                  <div className="demo-account-role">{a.role}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── MAIN APP SHELL ───

  const visibleNav = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(sessionUser.role),
  );

  let currentSection = "";

  const viewTitle: Record<View, string> = {
    dashboard: "Dashboard",
    machine: "Vue Machine",
    pipeline: "Pipeline Ingestion & Données",
    config: "Configuration Plateforme",
    pdca: "Gestion PDCA",
    approvals: "Centre d'Approbations",
    audit: "Centre Pré-Audit ISO 50001",
  };

  const formattedTime = currentTime.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const formattedDate = currentTime.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <>
      {/* Sidebar */}
      <aside
        className={`sidebar${sidebarCollapsed ? " collapsed" : ""}${mobileOpen ? " mobile-open" : ""}`}
      >
        <div className="sidebar-header">
          <div
            className="sidebar-logo"
            onClick={() => sidebarCollapsed && setSidebarCollapsed(false)}
            style={sidebarCollapsed ? { cursor: "pointer", transition: "transform 0.2s" } : {}}
            title={sidebarCollapsed ? "Déplier la navigation" : ""}
          >
            E
          </div>
          <span className="sidebar-brand">EnMS 50001</span>
          {!sidebarCollapsed && (
            <button
              className="sidebar-toggle"
              onClick={toggleSidebar}
              title="Replier"
            >
              ◀
            </button>
          )}
        </div>

        <nav className="sidebar-nav">
          {visibleNav.map((item) => {
            let sectionLabel = null;
            if (item.section && item.section !== currentSection) {
              currentSection = item.section;
              sectionLabel = (
                <div className="nav-section-label" key={`s-${item.section}`}>
                  {item.section}
                </div>
              );
            }
            return (
              <div key={item.id}>
                {sectionLabel}
                <button
                  className={`nav-item${view === item.id ? " active" : ""}`}
                  onClick={() => {
                    setView(item.id);
                    setMobileOpen(false);
                  }}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                </button>
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">
              {getInitials(sessionUser.fullName)}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{sessionUser.fullName}</div>
              <div className="sidebar-user-role">
                {ROLE_ICONS[sessionUser.role]}{" "}
                {ROLE_LABELS[sessionUser.role]}
              </div>
            </div>
          </div>
          <button
            className="logout-btn"
            onClick={handleLogout}
            style={{ marginTop: 10 }}
          >
            🚪 <span>Se déconnecter</span>
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="animate-fade-in"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(4px)",
            zIndex: 150,
          }}
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Topbar */}
      <header
        className="topbar"
        style={{
          left: sidebarCollapsed
            ? "var(--sidebar-collapsed)"
            : "var(--sidebar-width)",
        }}
      >
        <div className="topbar-left">
          <button
            className="topbar-mobile-toggle"
            onClick={() => setMobileOpen(true)}
          >
            ☰
          </button>
          <span className="topbar-title">{viewTitle[view]}</span>
        </div>
        <div className="topbar-right">
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setThemeDropdownOpen(!themeDropdownOpen)}
              title="Changer le thème"
              style={{
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-xl)",
                cursor: "pointer",
                padding: "6px 14px",
                fontSize: 13,
                color: "var(--text-primary)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                transition: "all var(--transition-fast)",
              }}
            >
              {theme === "dark" ? "🌙" : "☀️"}
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                {theme === "dark" ? "Sombre" : "Clair"}
              </span>
              <span style={{ fontSize: 10, opacity: 0.5 }}>▼</span>
            </button>

            {themeDropdownOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: 8,
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: 6,
                  boxShadow: "var(--shadow-lg)",
                  zIndex: 200,
                  minWidth: 140,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <button
                  onClick={() => {
                    setTheme("light");
                    setThemeDropdownOpen(false);
                  }}
                  style={{
                    background: theme === "light" ? "var(--bg-tertiary)" : "transparent",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    padding: "8px 12px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    color: "var(--text-primary)",
                    textAlign: "left",
                  }}
                >
                  ☀️ Clair
                </button>
                <button
                  onClick={() => {
                    setTheme("dark");
                    setThemeDropdownOpen(false);
                  }}
                  style={{
                    background: theme === "dark" ? "var(--bg-tertiary)" : "transparent",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    padding: "8px 12px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    color: "var(--text-primary)",
                    textAlign: "left",
                  }}
                >
                  🌙 Sombre
                </button>
              </div>
            )}
          </div>

          <span
            style={{
              fontSize: 11,
              color: "var(--text-tertiary)",
              fontFamily: "'Space Mono', monospace",
            }}
          >
            {formattedDate} · {formattedTime}
          </span>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {ROLE_ICONS[sessionUser.role]}{" "}
            {ROLE_LABELS[sessionUser.role]}
          </span>
          <div className="topbar-avatar">
            {getInitials(sessionUser.fullName)}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main
        className="main-content"
        style={{
          marginLeft: sidebarCollapsed
            ? "var(--sidebar-collapsed)"
            : "var(--sidebar-width)",
        }}
      >
        {view === "dashboard" ? (
          <Dashboard sessionUser={sessionUser} onOpenMachine={openMachineDetail} />
        ) : view === "machine" ? (
          <MachineDetail
            sessionUser={sessionUser}
            machineId={selectedMachineId}
            onBack={() => setView("dashboard")}
          />
        ) : view === "pipeline" ? (
          <DataPipelineMonitor sessionUser={sessionUser} />
        ) : view === "config" ? (
          <ConfigurationPanel sessionUser={sessionUser} />
        ) : view === "pdca" ? (
          <PDCAManagement sessionUser={sessionUser} />
        ) : view === "approvals" ? (
          <ApprovalsManagement sessionUser={sessionUser} />
        ) : (
          <AuditCenter sessionUser={sessionUser} />
        )}
      </main>
    </>
  );
}

export default App;
