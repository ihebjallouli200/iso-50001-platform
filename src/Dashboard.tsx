import { useEffect, useState } from "react";
import { ROLE_LABELS, ROLE_ICONS, type SessionUser } from "./auth_rbac";
import {
  fetchMachinesLive,
  fetchUnreadAlerts,
  fetchAnomalies,
  fetchRecommendations,
  fetchSiteComparison,
  acknowledgeAnomaly,
  decideRecommendation,
  markAlertRead,
  type MachineLive,
  type Alert,
  type Anomaly,
  type Recommendation,
  type SiteComparison,
} from "./api";

type Props = { sessionUser: SessionUser; onOpenMachine?: (machineId: number) => void };

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function Dashboard({ sessionUser, onOpenMachine }: Props) {
  const [machines, setMachines] = useState<MachineLive[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [sites, setSites] = useState<SiteComparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [ackingAnomaly, setAckingAnomaly] = useState<number | null>(null);
  const [ackNote, setAckNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [m, al, an, rec, s] = await Promise.all([
        fetchMachinesLive(),
        fetchUnreadAlerts(),
        fetchAnomalies(),
        fetchRecommendations(),
        fetchSiteComparison(),
      ]);
      if (cancelled) return;
      setMachines(m);
      setAlerts(al);
      setAnomalies(an);
      setRecommendations(rec);
      setSites(s);
      setLoading(false);
    }
    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const openAnomalies = anomalies.filter((a) => a.status === "open");
  const pendingRecs = recommendations.filter((r) => r.status === "pending");
  const avgEnpi =
    machines.length > 0
      ? (machines.reduce((s, m) => s + (Number(m.enpi) || 0), 0) / machines.length).toFixed(2)
      : "—";
  const totalPower = machines.reduce((s, m) => s + (Number(m.powerKw) || 0), 0).toFixed(0);

  async function handleAckAnomaly(id: number) {
    if (ackNote.length < 2) return;
    await acknowledgeAnomaly(id, ackNote);
    setAckingAnomaly(null);
    setAckNote("");
    // Refresh
    const an = await fetchAnomalies();
    setAnomalies(an);
  }

  async function handleDismissAlert(id: number) {
    await markAlertRead(id);
    const al = await fetchUnreadAlerts();
    setAlerts(al);
  }

  async function handleAcceptRec(id: number) {
    await decideRecommendation(id, "accepted", "Accepté depuis le dashboard");
    const rec = await fetchRecommendations();
    setRecommendations(rec);
  }

  /* ── Role-specific header ── */
  const roleHeaders: Record<string, { title: string; desc: string }> = {
    ADMIN_ENERGIE: {
      title: "Vue Gouvernance Énergie",
      desc: "Supervision globale des indicateurs ISO 50001",
    },
    RESPONSABLE_SITE: {
      title: "Vue Pilotage Site",
      desc: "Suivi opérationnel de votre périmètre",
    },
    AUDITEUR: {
      title: "Vue Audit Interne",
      desc: "Contrôle conformité et preuves",
    },
    OPERATEUR: {
      title: "Vue Opérations Terrain",
      desc: "Monitoring machines et interventions",
    },
  };

  const header = roleHeaders[sessionUser.role] ?? roleHeaders.OPERATEUR;

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1>{header.title}</h1>
          <p className="muted">Chargement des données…</p>
        </div>
        <div className="kpi-grid">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="kpi-card"
              style={{ height: 120 }}
            >
              <div
                className="skeleton"
                style={{ width: "60%", height: 14, marginBottom: 10 }}
              />
              <div
                className="skeleton"
                style={{ width: "40%", height: 28 }}
              />
            </div>
          ))}
        </div>
        <div className="grid-2" style={{ marginBottom: 16 }}>
          <div className="card" style={{ height: 200 }}>
            <div
              className="skeleton"
              style={{ width: "50%", height: 16, marginBottom: 16 }}
            />
            <div
              className="skeleton"
              style={{ width: "100%", height: 120 }}
            />
          </div>
          <div className="card" style={{ height: 200 }}>
            <div
              className="skeleton"
              style={{ width: "50%", height: 16, marginBottom: 16 }}
            />
            <div
              className="skeleton"
              style={{ width: "100%", height: 120 }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1>
          <span style={{ marginRight: 8 }}>
            {ROLE_ICONS[sessionUser.role]}
          </span>
          {header.title}
        </h1>
        <p className="muted">
          {header.desc} — {sessionUser.fullName},{" "}
          {ROLE_LABELS[sessionUser.role]}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi-card kpi-blue">
          <div className="kpi-icon">⚡</div>
          <div className="kpi-label">EnPI moyen</div>
          <div className="kpi-value">{avgEnpi}</div>
          <div className="kpi-trend neutral">kWh/unité</div>
        </div>

        <div className="kpi-card kpi-terracotta">
          <div className="kpi-icon">🔔</div>
          <div className="kpi-label">Anomalies ouvertes</div>
          <div className="kpi-value">{openAnomalies.length}</div>
          <div
            className={`kpi-trend ${openAnomalies.length > 2 ? "down" : "up"}`}
          >
            {openAnomalies.length > 2 ? "▲ Attention" : "✓ Contrôlé"}
          </div>
        </div>

        <div className="kpi-card kpi-gold">
          <div className="kpi-icon">💡</div>
          <div className="kpi-label">Recommandations IA</div>
          <div className="kpi-value">{pendingRecs.length}</div>
          <div className="kpi-trend neutral">en attente</div>
        </div>

        <div className="kpi-card kpi-olive">
          <div className="kpi-icon">🏭</div>
          <div className="kpi-label">Puissance totale</div>
          <div className="kpi-value">{totalPower}</div>
          <div className="kpi-trend neutral">kW</div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid-2" style={{ marginBottom: 16 }}>
        {/* Machine Live */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Machines en temps réel</h3>
            <span className="badge badge-live">
              <span className="status-dot online" /> LIVE
            </span>
          </div>
          {machines.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🏭</div>
              <p className="empty-state-text">Aucune machine connectée</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Machine</th>
                  <th>EnPI</th>
                  <th>Puissance</th>
                  <th>Charge</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {machines.map((m) => (
                  <tr
                    key={m.id}
                    style={{ cursor: onOpenMachine ? "pointer" : undefined }}
                    onClick={() => onOpenMachine?.(Number(m.machineId))}
                    className="hover-lift"
                  >
                    <td style={{ fontWeight: 600 }}>
                      {m.machineName || `Machine #${m.machineId}`}
                      {onOpenMachine && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--tunisian-blue)' }}>→ détail</span>}
                    </td>
                    <td>
                      <span
                        className="mono"
                        style={{ color: "var(--tunisian-gold)" }}
                      >
                        {(Number(m.enpi) || 0).toFixed(2)}
                      </span>
                    </td>
                    <td>{(Number(m.powerKw) || 0).toFixed(0)} kW</td>
                    <td>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <div className="progress-bar" style={{ width: 60 }}>
                          <div
                            className="progress-fill"
                            style={{ width: `${Number(m.loadPct) || 0}%` }}
                          />
                        </div>
                        <span className="mono" style={{ fontSize: 12 }}>
                          {Number(m.loadPct) || 0}%
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-green">
                        <span className="status-dot online" /> {m.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Alerts & Anomalies */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Alertes & Anomalies</h3>
            {(alerts.length + openAnomalies.length) > 0 && (
              <span className="badge badge-red">
                {alerts.length + openAnomalies.length}
              </span>
            )}
          </div>

          {alerts.length === 0 && openAnomalies.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">✅</div>
              <p className="empty-state-text">Aucune alerte active</p>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                maxHeight: 340,
                overflowY: "auto",
              }}
            >
              {alerts.map((a) => (
                <div
                  key={`alert-${a.id}`}
                  className="list-item animate-fade-in-up"
                  style={{
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border)",
                    padding: "10px 14px",
                  }}
                >
                  <span style={{ fontSize: 18 }}>🔔</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {a.title}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-secondary)",
                      }}
                    >
                      {a.message}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleDismissAlert(a.id)}
                    title="Marquer comme lue"
                  >
                    ✓
                  </button>
                </div>
              ))}
              {openAnomalies.map((a) => (
                <div
                  key={`ano-${a.id}`}
                  className="list-item animate-fade-in-up"
                  style={{
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border)",
                    flexDirection: "column",
                    alignItems: "stretch",
                    padding: "10px 14px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <span style={{ fontSize: 18 }}>⚠️</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {a.title}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-secondary)",
                        }}
                      >
                        {a.message}
                      </div>
                    </div>
                    <span
                      className={`badge ${a.severity === "major" ? "badge-red" : "badge-gold"}`}
                    >
                      {a.severity}
                    </span>
                  </div>
                  {ackingAnomaly === a.id ? (
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        marginTop: 8,
                        alignItems: "center",
                      }}
                    >
                      <input
                        className="form-input"
                        placeholder="Note d'acquittement…"
                        value={ackNote}
                        onChange={(e) => setAckNote(e.target.value)}
                        style={{ flex: 1, padding: "5px 10px", fontSize: 12 }}
                      />
                      <button
                        className="btn btn-success btn-sm"
                        onClick={() => handleAckAnomaly(a.id)}
                        disabled={ackNote.length < 2}
                      >
                        ✓
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setAckingAnomaly(null);
                          setAckNote("");
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginTop: 6, alignSelf: "flex-start" }}
                      onClick={() => setAckingAnomaly(a.id)}
                    >
                      Acquitter
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recommendations + Sites */}
      <div className="grid-2">
        {/* AI Recommendations */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Recommandations IA</h3>
            <span className="badge badge-blue">
              {pendingRecs.length} en attente
            </span>
          </div>
          {pendingRecs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🤖</div>
              <p className="empty-state-text">
                Aucune recommandation en attente
              </p>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                maxHeight: 340,
                overflowY: "auto",
              }}
            >
              {pendingRecs.slice(0, 8).map((r) => (
                <div
                  key={r.id}
                  className="card-glass hover-lift"
                  style={{ padding: 16 }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      marginBottom: 4,
                    }}
                  >
                    {r.title}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-secondary)",
                      marginBottom: 10,
                    }}
                  >
                    {r.justification}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      fontSize: 11,
                      marginBottom: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ color: "var(--success)" }}>
                      💰 -{r.estimatedImpact?.energySavingPct ?? 0}% énergie
                    </span>
                    <span style={{ color: "var(--tunisian-olive)" }}>
                      🌿 -{r.estimatedImpact?.co2SavingKgMonth ?? 0} kg CO₂/mois
                    </span>
                    <span style={{ color: "var(--tunisian-blue)" }}>
                      🎯 {((r.confidenceScore ?? 0) * 100).toFixed(0)}% conf.
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="btn btn-success btn-sm"
                      onClick={() => handleAcceptRec(r.id)}
                    >
                      Accepter
                    </button>
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--text-tertiary)",
                        alignSelf: "center",
                      }}
                    >
                      {formatDate(r.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Site Comparison */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Comparaison Sites</h3>
            <span className="badge badge-blue">{sites.length} sites</span>
          </div>
          {sites.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🏢</div>
              <p className="empty-state-text">Données indisponibles</p>
            </div>
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th>EnPI Moy.</th>
                    <th>Puissance</th>
                    <th>Machines</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((s) => (
                    <tr key={s.siteId}>
                      <td style={{ fontWeight: 600 }}>{s.siteName}</td>
                      <td>
                        <span
                          className="mono"
                          style={{ color: "var(--tunisian-gold)" }}
                        >
                          {(Number(s.avgEnpi) || 0).toFixed(2)}
                        </span>
                      </td>
                      <td>{(Number(s.totalPowerKw) || 0).toFixed(0)} kW</td>
                      <td>
                        <span className="badge badge-blue">
                          {s.machineCount}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Site comparison visual bar */}
              <div style={{ marginTop: 16 }}>
                {sites.map((s) => {
                  const maxEnpi = Math.max(...sites.map((x) => x.avgEnpi), 1);
                  const pct = (s.avgEnpi / maxEnpi) * 100;
                  return (
                    <div
                      key={`bar-${s.siteId}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--text-secondary)",
                          width: 80,
                          flexShrink: 0,
                          textAlign: "right",
                        }}
                      >
                        {s.siteName}
                      </span>
                      <div className="progress-bar" style={{ flex: 1 }}>
                        <div
                          className="progress-fill"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span
                        className="mono"
                        style={{ fontSize: 11, color: "var(--tunisian-gold)" }}
                      >
                        {(Number(s.avgEnpi) || 0).toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
