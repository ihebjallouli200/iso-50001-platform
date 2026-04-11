import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Area,
  AreaChart,
} from "recharts";
import { type SessionUser } from "./auth_rbac";
import {
  fetchMachinesLive,
  fetchEnergyTimeline,
  fetchCauseActionCorrelations,
  fetchAnomalies,
  acknowledgeAnomaly,
  type MachineLive,
  type EnergyTimelinePoint,
  type CauseActionCorrelation,
  type Anomaly,
} from "./api";

type Props = {
  sessionUser: SessionUser;
  machineId: number;
  onBack: () => void;
};

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

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

const CHART_COLORS = {
  enpi: "#e07a5f",
  powerKw: "#3d85c6",
  loadPct: "#81b29a",
  kva: "#f2cc8f",
  cosPhi: "#a78bfa",
  thdVoltage: "#f87171",
  oee: "#34d399",
};

export default function MachineDetail({ sessionUser, machineId, onBack }: Props) {
  const [machine, setMachine] = useState<MachineLive | null>(null);
  const [timeline, setTimeline] = useState<EnergyTimelinePoint[]>([]);
  const [correlations, setCorrelations] = useState<CauseActionCorrelation[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartTab, setChartTab] = useState<"energy" | "quality" | "production">("energy");
  const [ackingId, setAckingId] = useState<number | null>(null);
  const [ackNote, setAckNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [machines, tl, corr, ano] = await Promise.all([
        fetchMachinesLive(),
        fetchEnergyTimeline(machineId, 48),
        fetchCauseActionCorrelations(machineId),
        fetchAnomalies({ status: "open" }),
      ]);
      if (cancelled) return;
      const found = machines.find((m) => Number(m.machineId) === machineId);
      setMachine(found || null);
      setTimeline(tl);
      setCorrelations(corr);
      setAnomalies(ano.filter((a) => Number(a.machineId) === machineId));
      setLoading(false);
    }
    load();
    const interval = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [machineId]);

  async function handleAck(id: number) {
    if (ackNote.length < 2) return;
    await acknowledgeAnomaly(id, ackNote);
    setAckingId(null);
    setAckNote("");
    const ano = await fetchAnomalies({ status: "open" });
    setAnomalies(ano.filter((a) => Number(a.machineId) === machineId));
  }

  if (loading) {
    return (
      <div className="fade-in" style={{ padding: 32 }}>
        <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 16 }}>
          ← Retour au Dashboard
        </button>
        <div className="loading-skeleton" style={{ height: 400, borderRadius: 12 }} />
      </div>
    );
  }

  const timelineData = timeline.map((p) => ({
    time: fmtTime(p.timestamp),
    EnPI: Number(p.enpi) || 0,
    "Puissance (kW)": Number(p.powerKw) || 0,
    "Charge (%)": Number(p.loadPct) || 0,
    "kVA": Number(p.kva) || 0,
    "cos φ": Number(p.cosPhi) || 0,
    "THD (%)": Number(p.thdVoltage) || 0,
    "OEE (%)": Number(p.oee) || 0,
  }));

  const correlationRadar = correlations.flatMap((c) =>
    (c.variables || []).map((v) => ({
      variable: v.variable,
      contribution: Math.round((Number(v.contribution) || 0) * 100),
      fullMark: 100,
    })),
  );

  // Deduplicate radar by variable name
  const radarMap = new Map<string, { variable: string; contribution: number; fullMark: number }>();
  correlationRadar.forEach((r) => {
    const existing = radarMap.get(r.variable);
    if (!existing || r.contribution > existing.contribution) {
      radarMap.set(r.variable, r);
    }
  });
  const radarData = [...radarMap.values()];

  const correlationBars = correlations.map((c) => ({
    cause: c.cause?.length > 25 ? c.cause.substring(0, 22) + "…" : c.cause,
    "Score corrélation": Math.round((Number(c.correlationScore) || 0) * 100),
    "Gain estimé (%)": Number(c.expectedGainPct) || 0,
  }));

  const statusColor =
    machine?.status === "running"
      ? "var(--success)"
      : machine?.status === "idle"
        ? "var(--text-tertiary)"
        : "var(--warning)";

  return (
    <div className="fade-in" style={{ padding: "0 8px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <button className="btn btn-ghost" onClick={onBack}>
          ← Retour
        </button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>
            🏭 {machine?.machineName || `Machine #${machineId}`}
          </h2>
          <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: 13 }}>
            {machine?.siteName || "Site inconnu"} · {machine?.machineCode || ""} · Vue détaillée ISO 50001
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div className="card-glass" style={{ padding: "10px 18px", textAlign: "center", minWidth: 90 }}>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--tunisian-gold)" }}>
              {(Number(machine?.enpi) || 0).toFixed(2)}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-tertiary)", textTransform: "uppercase" }}>EnPI</div>
          </div>
          <div className="card-glass" style={{ padding: "10px 18px", textAlign: "center", minWidth: 90 }}>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--tunisian-blue)" }}>
              {(Number(machine?.powerKw) || 0).toFixed(0)}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-tertiary)", textTransform: "uppercase" }}>kW</div>
          </div>
          <div className="card-glass" style={{ padding: "10px 18px", textAlign: "center", minWidth: 90 }}>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--tunisian-olive)" }}>
              {Number(machine?.loadPct) || 0}%
            </div>
            <div style={{ fontSize: 10, color: "var(--text-tertiary)", textTransform: "uppercase" }}>Charge</div>
          </div>
          <div className="card-glass" style={{ padding: "10px 18px", textAlign: "center", minWidth: 90 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: statusColor }}>
              ● {machine?.status || "—"}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-tertiary)", textTransform: "uppercase" }}>Statut</div>
          </div>
        </div>
      </div>

      {/* Chart Tabs */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div style={{ display: "flex", gap: 4 }}>
            {(
              [
                { key: "energy", label: "⚡ Énergie & Charge" },
                { key: "quality", label: "📐 Qualité (cosφ, THD)" },
                { key: "production", label: "🏭 Production (OEE)" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                className={`btn btn-sm ${chartTab === tab.key ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setChartTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <span className="badge badge-live">
            <span className="status-dot online" /> LIVE 30s
          </span>
        </div>

        <div style={{ width: "100%", height: 320, marginTop: 8 }}>
          {timelineData.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📈</div>
              <p className="empty-state-text">Aucune donnée timeline disponible</p>
            </div>
          ) : chartTab === "energy" ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timelineData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="gradEnpi" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.enpi} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS.enpi} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradPower" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.powerKw} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS.powerKw} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: "#94a3b8", fontSize: 11 }} />
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
                <Area yAxisId="left" type="monotone" dataKey="EnPI" stroke={CHART_COLORS.enpi} fill="url(#gradEnpi)" strokeWidth={2} />
                <Area yAxisId="right" type="monotone" dataKey="Puissance (kW)" stroke={CHART_COLORS.powerKw} fill="url(#gradPower)" strokeWidth={2} />
                <Line yAxisId="left" type="monotone" dataKey="Charge (%)" stroke={CHART_COLORS.loadPct} strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : chartTab === "quality" ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timelineData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" tick={{ fill: "#94a3b8", fontSize: 11 }} />
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
                <Line type="monotone" dataKey="cos φ" stroke={CHART_COLORS.cosPhi} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="THD (%)" stroke={CHART_COLORS.thdVoltage} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="kVA" stroke={CHART_COLORS.kva} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timelineData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="gradOee" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.oee} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS.oee} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: "#94a3b8", fontSize: 11 }} />
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
                <Area yAxisId="left" type="monotone" dataKey="OEE (%)" stroke={CHART_COLORS.oee} fill="url(#gradOee)" strokeWidth={2} />
                <Line yAxisId="right" type="monotone" dataKey="EnPI" stroke={CHART_COLORS.enpi} strokeWidth={1.5} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="Puissance (kW)" stroke={CHART_COLORS.powerKw} strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Bottom Grid: Correlations + Anomalies */}
      <div className="grid-2">
        {/* Correlations */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">🔗 Corrélations Cause-Action</h3>
            <span className="badge badge-blue">{correlations.length}</span>
          </div>
          {correlations.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📊</div>
              <p className="empty-state-text">Aucune corrélation pour cette machine</p>
            </div>
          ) : (
            <>
              {/* Radar */}
              {radarData.length > 0 && (
                <div style={{ width: "100%", height: 220, marginBottom: 8 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="rgba(255,255,255,0.1)" />
                      <PolarAngleAxis dataKey="variable" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                      <PolarRadiusAxis tick={{ fill: "#94a3b8", fontSize: 9 }} domain={[0, 100]} />
                      <Radar
                        name="Contribution (%)"
                        dataKey="contribution"
                        stroke={CHART_COLORS.enpi}
                        fill={CHART_COLORS.enpi}
                        fillOpacity={0.25}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {/* Bar chart */}
              {correlationBars.length > 0 && (
                <div style={{ width: "100%", height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={correlationBars} layout="vertical" margin={{ left: 10, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                      <YAxis dataKey="cause" type="category" width={120} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{
                          background: "var(--bg-card)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          color: "var(--text-primary)",
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="Score corrélation" fill={CHART_COLORS.powerKw} radius={[0, 4, 4, 0]} />
                      <Bar dataKey="Gain estimé (%)" fill={CHART_COLORS.oee} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </div>

        {/* Anomalies */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">⚠️ Anomalies Ouvertes</h3>
            <span className={`badge ${anomalies.length > 0 ? "badge-red" : "badge-green"}`}>
              {anomalies.length}
            </span>
          </div>
          {anomalies.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">✅</div>
              <p className="empty-state-text">Aucune anomalie ouverte</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflowY: "auto" }}>
              {anomalies.map((a) => (
                <div key={a.id} className="card-glass hover-lift" style={{ padding: 14 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "start" }}>
                    <span style={{ fontSize: 18 }}>⚠️</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{a.title}</div>
                      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{a.message}</div>
                      <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 4 }}>
                        {fmtDate(a.detectedAt)}
                      </div>
                    </div>
                    <span className={`badge ${a.severity === "major" ? "badge-red" : "badge-gold"}`}>
                      {a.severity}
                    </span>
                  </div>
                  {ackingId === a.id ? (
                    <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                      <input
                        className="input"
                        placeholder="Note d'acquittement…"
                        value={ackNote}
                        onChange={(e) => setAckNote(e.target.value)}
                        style={{ flex: 1, fontSize: 12, padding: "6px 10px" }}
                      />
                      <button className="btn btn-success btn-sm" onClick={() => handleAck(a.id)}>
                        ✓
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setAckingId(null); setAckNote(""); }}>
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginTop: 8, fontSize: 11 }}
                      onClick={() => setAckingId(a.id)}
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
    </div>
  );
}
