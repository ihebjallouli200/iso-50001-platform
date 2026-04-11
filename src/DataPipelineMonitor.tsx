import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from "recharts";
import { type SessionUser } from "./auth_rbac";
import {
  fetchIngestionHealth,
  fetchImportJournal,
  fetchDataQualitySummary,
  type ImportJournalEntry,
  type DataQualityItem,
} from "./api";

type Props = { sessionUser: SessionUser };

const STATUS_COLORS: Record<string, string> = {
  healthy: "#34d399",
  good: "#34d399",
  success: "#34d399",
  completed: "#34d399",
  warning: "#f2cc8f",
  degraded: "#e07a5f",
  failed: "#f87171",
  error: "#f87171",
  not_ready: "#f87171",
};

const PIE_COLORS = ["#34d399", "#3d85c6", "#e07a5f", "#f2cc8f", "#a78bfa"];

function fmtDate(iso: string): string {
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

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || "var(--text-tertiary)";
  return (
    <span
      className="badge"
      style={{
        background: `${color}22`,
        color,
        border: `1px solid ${color}44`,
      }}
    >
      ● {status}
    </span>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function DataPipelineMonitor({ sessionUser }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [health, setHealth] = useState<any>(null);
  const [imports, setImports] = useState<ImportJournalEntry[]>([]);
  const [quality, setQuality] = useState<DataQualityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "imports" | "quality">("overview");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [h, imp, q] = await Promise.all([
        fetchIngestionHealth().catch(() => null),
        fetchImportJournal().catch(() => []),
        fetchDataQualitySummary().catch(() => []),
      ]);
      if (cancelled) return;
      setHealth(h);
      setImports(imp);
      setQuality(q);
      setLoading(false);
    }
    load();
    const interval = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (loading) {
    return (
      <div className="fade-in" style={{ padding: 32 }}>
        <div className="loading-skeleton" style={{ height: 400, borderRadius: 12 }} />
      </div>
    );
  }

  /* --- Derived data for charts --- */

  const importStatusPie = (() => {
    const counts: Record<string, number> = {};
    imports.forEach((i) => {
      counts[i.status] = (counts[i.status] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  })();

  const importsBySource = (() => {
    const map: Record<string, { source: string; rows: number; inserted: number; rejected: number }> = {};
    imports.forEach((i) => {
      if (!map[i.sourceType]) map[i.sourceType] = { source: i.sourceType, rows: 0, inserted: 0, rejected: 0 };
      map[i.sourceType].rows += Number(i.rowCount) || 0;
      map[i.sourceType].inserted += Number(i.insertedRows) || 0;
      map[i.sourceType].rejected += Number(i.rejectedRows) || 0;
    });
    return Object.values(map);
  })();

  const qualityChart = quality.map((q) => ({
    machine: q.machineName || q.machineCode,
    "Score Qualité": Number(q.qualityScore) || 0,
    "Taux Manquants (%)": Number(q.missingRatePct) || 0,
    "Erreurs Type (%)": Number(q.typeErrorRatePct) || 0,
    "Doublons (%)": Number(q.duplicateRatePct) || 0,
  }));

  const importTimeline = imports
    .slice(0, 20)
    .reverse()
    .map((i) => ({
      date: fmtDate(i.startedAt),
      "Lignes importées": Number(i.insertedRows) || 0,
      "Lignes rejetées": Number(i.rejectedRows) || 0,
    }));

  // Architecture data
  const pipelineSteps = [
    {
      icon: "📡",
      title: "Sources",
      items: [
        { label: "MQTT Broker", status: health?.broker?.url || "N/A", active: !!health?.activity?.lastMqttMessageAt },
        { label: "OPC-UA", status: "opc.tcp://localhost:4840", active: false },
        { label: "Modbus TCP", status: "127.0.0.1:502", active: false },
        { label: "CSV Batch", status: health?.activity?.lastBatchRunAt ? "Actif" : "Standby", active: !!health?.activity?.lastBatchRunAt },
      ],
    },
    {
      icon: "⚙️",
      title: "Processing",
      items: [
        { label: "Validation", status: "synthetic_guard", active: true },
        { label: "Anomaly Detection", status: "LSTM classifier", active: true },
        { label: "EnPI Calculation", status: "kWh/unit", active: true },
      ],
    },
    {
      icon: "🗄️",
      title: "Storage",
      items: [
        { label: "TimescaleDB", status: health?.components?.timescale?.status || "N/A", active: true },
        { label: "InfluxDB Mirror", status: health?.components?.influxMirror?.health?.status || "N/A", active: true },
        { label: "Runtime JSON", status: "Active", active: true },
      ],
    },
    {
      icon: "📊",
      title: "Output",
      items: [
        { label: "Dashboard Live", status: "WebSocket polling", active: true },
        { label: "Alertes", status: "Threshold engine", active: true },
        { label: "Recommandations IA", status: "ML pipeline", active: true },
      ],
    },
  ];

  const totalRows = imports.reduce((s, i) => s + (Number(i.rowCount) || 0), 0);
  const totalInserted = imports.reduce((s, i) => s + (Number(i.insertedRows) || 0), 0);
  const totalRejected = imports.reduce((s, i) => s + (Number(i.rejectedRows) || 0), 0);
  const successRate = totalRows > 0 ? ((totalInserted / totalRows) * 100).toFixed(1) : "—";

  return (
    <div className="fade-in" style={{ padding: "0 8px" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>
          🔄 Pipeline Ingestion & Qualité Données
        </h2>
        <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: 13 }}>
          Monitoring temps réel du pipeline de données — {sessionUser.fullName}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="card kpi-card">
          <div className="kpi-icon" style={{ borderColor: "var(--tunisian-blue)" }}>📡</div>
          <div className="kpi-label">STATUT PIPELINE</div>
          <div className="kpi-value">
            <StatusBadge status={health?.status || "unknown"} />
          </div>
          <div className="kpi-trend neutral">{health?.integrationMode || "—"}</div>
        </div>
        <div className="card kpi-card">
          <div className="kpi-icon" style={{ borderColor: "var(--tunisian-gold)" }}>📊</div>
          <div className="kpi-label">IMPORTS TOTAUX</div>
          <div className="kpi-value mono">{imports.length}</div>
          <div className="kpi-trend neutral">{totalRows.toLocaleString()} lignes</div>
        </div>
        <div className="card kpi-card">
          <div className="kpi-icon" style={{ borderColor: "var(--success)" }}>✅</div>
          <div className="kpi-label">TAUX DE SUCCÈS</div>
          <div className="kpi-value mono">{successRate}%</div>
          <div className="kpi-trend neutral">{totalInserted.toLocaleString()} insérées</div>
        </div>
        <div className="card kpi-card">
          <div className="kpi-icon" style={{ borderColor: "var(--error)" }}>⚠️</div>
          <div className="kpi-label">LIGNES REJETÉES</div>
          <div className="kpi-value mono">{totalRejected}</div>
          <div className="kpi-trend neutral">
            {quality.reduce((s, q) => s + (q.openIssues || 0), 0)} issues ouvertes
          </div>
        </div>
      </div>

      {/* Architecture Pipeline */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3 className="card-title">🏗️ Architecture du Pipeline</h3>
          <span className="badge badge-live">
            <span className="status-dot online" /> LIVE
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 12,
            padding: "12px 0",
          }}
        >
          {pipelineSteps.map((step, idx) => (
            <div key={idx} className="card-glass" style={{ padding: 14 }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>{step.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: "var(--tunisian-gold)" }}>
                {step.title}
              </div>
              {step.items.map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "5px 0",
                    borderBottom: i < step.items.length - 1 ? "1px solid var(--border)" : "none",
                    fontSize: 11,
                  }}
                >
                  <span style={{ color: "var(--text-primary)" }}>{item.label}</span>
                  <span
                    className="status-dot"
                    style={{
                      background: item.active ? "var(--success)" : "var(--text-tertiary)",
                      width: 8,
                      height: 8,
                      display: "inline-block",
                      borderRadius: "50%",
                    }}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
        {/* Flow arrows between steps */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 40,
            padding: "8px 0",
            color: "var(--tunisian-blue)",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <span>📡 Sources</span>
          <span style={{ color: "var(--text-tertiary)" }}>→</span>
          <span>⚙️ Processing</span>
          <span style={{ color: "var(--text-tertiary)" }}>→</span>
          <span>🗄️ Storage</span>
          <span style={{ color: "var(--text-tertiary)" }}>→</span>
          <span>📊 Output</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {([
          { key: "overview", label: `📊 Vue d'ensemble` },
          { key: "imports", label: `📥 Journal Imports (${imports.length})` },
          { key: "quality", label: `🔍 Qualité Données (${quality.length})` },
        ] as const).map((t) => (
          <button
            key={t.key}
            className={`btn btn-sm ${tab === t.key ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === "overview" && (
        <div className="grid-2">
          {/* Import Timeline Chart */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">📈 Timeline Ingestion</h3>
            </div>
            {importTimeline.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📥</div>
                <p className="empty-state-text">Aucun import récent</p>
              </div>
            ) : (
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={importTimeline} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <defs>
                      <linearGradient id="gradInserted" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-20} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--bg-card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        color: "var(--text-primary)",
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="Lignes importées" stroke="#34d399" fill="url(#gradInserted)" strokeWidth={2} />
                    <Area type="monotone" dataKey="Lignes rejetées" stroke="#f87171" fill="#f8717122" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Import Status Pie */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">🥧 Répartition par Statut</h3>
            </div>
            <div className="grid-2" style={{ gap: 0 }}>
              <div style={{ width: "100%", height: 240 }}>
                {importStatusPie.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-icon">📊</div>
                    <p className="empty-state-text">Aucune donnée</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={importStatusPie}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        innerRadius={40}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                        labelLine={{ stroke: "#94a3b8" }}
                      >
                        {importStatusPie.map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 16, justifyContent: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Sources de données</div>
                {importsBySource.map((s, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0" }}>
                    <span className="badge badge-blue" style={{ fontSize: 10 }}>{s.source}</span>
                    <span className="mono">{s.rows.toLocaleString()} lignes</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "imports" && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">📥 Journal des Imports</h3>
            <span className="badge badge-blue">{imports.length} imports</span>
          </div>
          {imports.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📥</div>
              <p className="empty-state-text">Aucun import enregistré</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Source</th>
                    <th>Type</th>
                    <th>Statut</th>
                    <th>Lignes</th>
                    <th>Insérées</th>
                    <th>Rejetées</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.slice(0, 30).map((imp) => (
                    <tr key={imp.id}>
                      <td className="mono" style={{ fontSize: 11 }}>#{imp.id}</td>
                      <td style={{ fontWeight: 600, fontSize: 12 }}>{imp.sourceName}</td>
                      <td>
                        <span className="badge badge-blue" style={{ fontSize: 10 }}>{imp.sourceType}</span>
                      </td>
                      <td><StatusBadge status={imp.status} /></td>
                      <td className="mono">{(Number(imp.rowCount) || 0).toLocaleString()}</td>
                      <td className="mono" style={{ color: "var(--success)" }}>
                        {(Number(imp.insertedRows) || 0).toLocaleString()}
                      </td>
                      <td className="mono" style={{ color: Number(imp.rejectedRows) > 0 ? "var(--error)" : "var(--text-tertiary)" }}>
                        {Number(imp.rejectedRows) || 0}
                      </td>
                      <td style={{ fontSize: 11, color: "var(--text-secondary)" }}>{fmtDate(imp.startedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "quality" && (
        <>
          {/* Quality Bar Chart */}
          {qualityChart.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <h3 className="card-title">📊 Score Qualité par Machine</h3>
              </div>
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={qualityChart} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="machine" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--bg-card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        color: "var(--text-primary)",
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Score Qualité" fill="#34d399" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Taux Manquants (%)" fill="#f2cc8f" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Erreurs Type (%)" fill="#f87171" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Doublons (%)" fill="#a78bfa" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Quality Table */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">🔍 Détail Qualité Données</h3>
              <span className="badge badge-blue">{quality.length} machines</span>
            </div>
            {quality.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">🔍</div>
                <p className="empty-state-text">Aucune donnée de qualité disponible</p>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Machine</th>
                      <th>Source</th>
                      <th>Score</th>
                      <th>Lignes</th>
                      <th>Manquants</th>
                      <th>Erreurs</th>
                      <th>Issues</th>
                      <th>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quality.map((q) => (
                      <tr key={q.machineId}>
                        <td style={{ fontWeight: 600 }}>{q.machineName}</td>
                        <td style={{ fontSize: 11 }}>{q.sourceName || "—"}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div className="progress-bar" style={{ width: 50 }}>
                              <div
                                className="progress-fill"
                                style={{
                                  width: `${Number(q.qualityScore) || 0}%`,
                                  background:
                                    (Number(q.qualityScore) || 0) >= 90
                                      ? "var(--success)"
                                      : (Number(q.qualityScore) || 0) >= 70
                                        ? "var(--warning)"
                                        : "var(--error)",
                                }}
                              />
                            </div>
                            <span className="mono" style={{ fontSize: 11 }}>
                              {(Number(q.qualityScore) || 0).toFixed(0)}%
                            </span>
                          </div>
                        </td>
                        <td className="mono">{(Number(q.rowCount) || 0).toLocaleString()}</td>
                        <td className="mono">{(Number(q.missingRatePct) || 0).toFixed(1)}%</td>
                        <td className="mono">{(Number(q.typeErrorRatePct) || 0).toFixed(1)}%</td>
                        <td>
                          <span
                            className={`badge ${q.openIssues > 0 ? "badge-red" : "badge-green"}`}
                          >
                            {q.openIssues || 0}
                          </span>
                        </td>
                        <td><StatusBadge status={q.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
