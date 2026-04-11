import { useEffect, useState } from "react";
import {
  canWriteSensitiveAction,
  ROLE_LABELS,
  type SessionUser,
} from "./auth_rbac";
import {
  fetchPdcaCycles,
  fetchMachines,
  createPdcaCycle as apiCreatePdcaCycle,
  transitionPdcaCycle as apiTransition,
  closePdcaCycle as apiClosePdca,
  type PdcaCycle,
  type Machine,
} from "./api";

type Props = { sessionUser: SessionUser };

const PHASES = ["Plan", "Do", "Check", "Act"];
const PHASE_COLORS: Record<string, string> = {
  Plan: "var(--tunisian-blue)",
  Do: "var(--tunisian-gold)",
  Check: "var(--tunisian-olive)",
  Act: "var(--tunisian-terracotta)",
};

function PhaseIndicator({ current }: { current: string }) {
  const idx = PHASES.indexOf(current);
  return (
    <div className="phase-stepper">
      {PHASES.map((p, i) => (
        <div key={p} style={{ display: "flex", alignItems: "center" }}>
          {i > 0 && (
            <div
              className={`phase-connector${i <= idx ? " completed" : ""}`}
            />
          )}
          <div
            className={`phase-step${i === idx ? " active" : i < idx ? " completed" : ""}`}
            style={
              i === idx
                ? {
                    borderColor: PHASE_COLORS[p],
                    color: PHASE_COLORS[p],
                    background: `${PHASE_COLORS[p]}18`,
                  }
                : undefined
            }
          >
            {i < idx ? "✓ " : ""}
            {p}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function PDCAManagement({ sessionUser }: Props) {
  const [cycles, setCycles] = useState<PdcaCycle[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "closed">("all");
  const [form, setForm] = useState({
    title: "",
    objective: "",
    machineId: 0,
    targetEnpi: 0,
  });
  const [transitioning, setTransitioning] = useState<number | null>(null);
  const [transitionReason, setTransitionReason] = useState("");
  const [showCloseModal, setShowCloseModal] = useState<number | null>(null);
  const [closeReason, setCloseReason] = useState("");

  const canClose = canWriteSensitiveAction(sessionUser.role, "CLOSE_PDCA");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [c, m] = await Promise.all([fetchPdcaCycles(), fetchMachines()]);
    setCycles(c ?? []);
    setMachines(m ?? []);
    setLoading(false);
  }

  async function handleCreate() {
    if (
      !form.title ||
      !form.objective ||
      !form.machineId ||
      !form.targetEnpi
    )
      return;
    await apiCreatePdcaCycle(form);
    setShowCreate(false);
    setForm({ title: "", objective: "", machineId: 0, targetEnpi: 0 });
    loadData();
  }

  async function handleTransition(cycleId: number, toPhase: string) {
    if (transitionReason.length < 3) return;
    await apiTransition(cycleId, toPhase, transitionReason);
    setTransitioning(null);
    setTransitionReason("");
    loadData();
  }

  async function handleClose(cycleId: number) {
    if (closeReason.length < 5) return;
    await apiClosePdca(cycleId, closeReason);
    setShowCloseModal(null);
    setCloseReason("");
    loadData();
  }

  function getMachineName(id: number) {
    return machines.find((m) => m.id === id)?.machineName ?? `Machine #${id}`;
  }

  function getNextPhase(current: string): string | null {
    const idx = PHASES.indexOf(current);
    return idx >= 0 && idx < PHASES.length - 1 ? PHASES[idx + 1] : null;
  }

  /* Progress calc */
  function getCycleProgress(cycle: PdcaCycle): number {
    if (cycle.closedAt) return 100;
    const idx = PHASES.indexOf(cycle.phase);
    return Math.max(0, ((idx + 1) / PHASES.length) * 100);
  }

  const activeCycles = cycles.filter((c) => !c.closedAt);
  const closedCycles = cycles.filter((c) => c.closedAt);
  const filtered =
    filter === "active"
      ? activeCycles
      : filter === "closed"
        ? closedCycles
        : cycles;

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1>Gestion PDCA</h1>
          <p className="muted">Chargement…</p>
        </div>
        {[1, 2].map((i) => (
          <div
            key={i}
            className="card"
            style={{ marginBottom: 12, height: 120 }}
          >
            <div
              className="skeleton"
              style={{ width: "50%", height: 16, marginBottom: 12 }}
            />
            <div
              className="skeleton"
              style={{ width: "80%", height: 12 }}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div className="section-header">
          <div>
            <h1>🔄 Gestion PDCA</h1>
            <p className="muted">
              Cycles Plan-Do-Check-Act — {ROLE_LABELS[sessionUser.role]}
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreate(true)}
          >
            + Nouveau cycle
          </button>
        </div>
      </div>

      {/* KPI summary */}
      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <div className="kpi-card kpi-blue">
          <div className="kpi-icon">📋</div>
          <div className="kpi-label">Total cycles</div>
          <div className="kpi-value">{cycles.length}</div>
        </div>
        <div className="kpi-card kpi-gold">
          <div className="kpi-icon">⏳</div>
          <div className="kpi-label">En cours</div>
          <div className="kpi-value">{activeCycles.length}</div>
        </div>
        <div className="kpi-card kpi-olive">
          <div className="kpi-icon">✅</div>
          <div className="kpi-label">Clôturés</div>
          <div className="kpi-value">{closedCycles.length}</div>
        </div>
        <div className="kpi-card kpi-terracotta">
          <div className="kpi-icon">🔍</div>
          <div className="kpi-label">Phase Check/Act</div>
          <div className="kpi-value">
            {
              cycles.filter(
                (c) => c.phase === "Check" || c.phase === "Act",
              ).length
            }
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="tabs">
        {(["all", "active", "closed"] as const).map((f) => (
          <button
            key={f}
            className={`tab${filter === f ? " active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all"
              ? `Tous (${cycles.length})`
              : f === "active"
                ? `En cours (${activeCycles.length})`
                : `Clôturés (${closedCycles.length})`}
          </button>
        ))}
      </div>

      {/* Cycles */}
      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🔄</div>
            <p className="empty-state-text">
              {filter === "all"
                ? "Aucun cycle PDCA créé"
                : filter === "active"
                  ? "Aucun cycle actif"
                  : "Aucun cycle clôturé"}
            </p>
            {filter === "all" && (
              <button
                className="btn btn-primary"
                onClick={() => setShowCreate(true)}
              >
                Créer un cycle
              </button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((cycle) => {
            const nextPhase = getNextPhase(cycle.phase);
            const isClosed = !!cycle.closedAt;
            const progress = getCycleProgress(cycle);
            return (
              <div className="card animate-fade-in-up" key={cycle.id}>
                <div className="card-header">
                  <div>
                    <h3 className="card-title">
                      <span
                        className="mono"
                        style={{
                          color: "var(--tunisian-gold)",
                          marginRight: 6,
                        }}
                      >
                        #{cycle.id}
                      </span>
                      {cycle.title}
                    </h3>
                    <div className="card-subtitle">
                      {getMachineName(cycle.machineId)} · Créé le{" "}
                      {formatDate(cycle.createdAt)}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                    }}
                  >
                    <span
                      className={`badge ${isClosed ? "badge-green" : "badge-blue"}`}
                    >
                      {isClosed ? "✓ Clôturé" : cycle.status}
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <div className="progress-bar" style={{ flex: 1 }}>
                    <div
                      className="progress-fill"
                      style={{
                        width: `${progress}%`,
                        background: isClosed
                          ? "var(--success)"
                          : undefined,
                      }}
                    />
                  </div>
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {progress.toFixed(0)}%
                  </span>
                </div>

                <PhaseIndicator current={cycle.phase} />

                <div
                  className="grid-3"
                  style={{ marginTop: 14, fontSize: 13 }}
                >
                  <div>
                    <span style={{ color: "var(--text-secondary)" }}>
                      Objectif :{" "}
                    </span>
                    {cycle.objective}
                  </div>
                  <div>
                    <span style={{ color: "var(--text-secondary)" }}>
                      EnPI cible :{" "}
                    </span>
                    <span
                      className="mono"
                      style={{ color: "var(--tunisian-gold)" }}
                    >
                      {cycle.targetEnpi}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-secondary)" }}>
                      Actions :{" "}
                    </span>
                    <span className="badge badge-blue">
                      {cycle.actions?.length ?? 0}
                    </span>
                  </div>
                </div>

                {/* Close reason if closed */}
                {isClosed && cycle.closeReason && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: "8px 12px",
                      background: "var(--success-dim)",
                      borderRadius: "var(--radius-md)",
                      fontSize: 12,
                      color: "var(--success)",
                    }}
                  >
                    ✓ Clôturé : {cycle.closeReason}
                  </div>
                )}

                {/* Transition controls */}
                {!isClosed && (
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginTop: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    {nextPhase && transitioning !== cycle.id && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setTransitioning(cycle.id)}
                      >
                        ▶ Passer en {nextPhase}
                      </button>
                    )}
                    {transitioning === cycle.id && nextPhase && (
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          alignItems: "center",
                          flex: 1,
                        }}
                      >
                        <input
                          className="form-input"
                          placeholder="Motif de transition (min 3 car.)"
                          value={transitionReason}
                          onChange={(e) =>
                            setTransitionReason(e.target.value)
                          }
                          style={{
                            flex: 1,
                            padding: "6px 10px",
                            fontSize: 12,
                          }}
                        />
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() =>
                            handleTransition(cycle.id, nextPhase)
                          }
                          disabled={transitionReason.length < 3}
                        >
                          Confirmer
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setTransitioning(null);
                            setTransitionReason("");
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    )}
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => setShowCloseModal(cycle.id)}
                      disabled={!canClose}
                      title={
                        !canClose
                          ? "Action sensible non autorisée pour ce rôle"
                          : ""
                      }
                    >
                      Clôturer
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div
          className="modal-overlay"
          onClick={() => setShowCreate(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">🔄 Nouveau cycle PDCA</h3>
            <div className="form-group">
              <label className="form-label">Titre</label>
              <input
                className="form-input"
                value={form.title}
                onChange={(e) =>
                  setForm({ ...form, title: e.target.value })
                }
                placeholder="Ex: Réduire la consommation Four C"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Objectif</label>
              <input
                className="form-input"
                value={form.objective}
                onChange={(e) =>
                  setForm({ ...form, objective: e.target.value })
                }
                placeholder="Ex: Réduire 5% kWh/unité sur 30 jours"
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Machine</label>
                <select
                  className="form-select"
                  value={form.machineId}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      machineId: Number(e.target.value),
                    })
                  }
                >
                  <option value={0}>Sélectionner…</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.machineName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">EnPI cible</label>
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
                  value={form.targetEnpi || ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      targetEnpi: Number(e.target.value),
                    })
                  }
                  placeholder="Ex: 1.95"
                />
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowCreate(false)}
              >
                Annuler
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={
                  !form.title ||
                  !form.objective ||
                  !form.machineId ||
                  !form.targetEnpi
                }
              >
                Créer le cycle
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close Modal */}
      {showCloseModal !== null && (
        <div
          className="modal-overlay"
          onClick={() => {
            setShowCloseModal(null);
            setCloseReason("");
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Clôturer le cycle PDCA</h3>
            <p
              style={{
                fontSize: 13,
                color: "var(--text-secondary)",
                marginBottom: 16,
              }}
            >
              Vous êtes sur le point de clôturer le cycle{" "}
              <span className="mono" style={{ color: "var(--tunisian-gold)" }}>
                #{showCloseModal}
              </span>
              . Cette action est irréversible.
            </p>
            <div className="form-group">
              <label className="form-label">
                Motif de clôture (min 5 caractères)
              </label>
              <textarea
                className="form-textarea"
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                placeholder="Ex: Objectif atteint, EnPI réduit de 7% sur la période"
              />
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowCloseModal(null);
                  setCloseReason("");
                }}
              >
                Annuler
              </button>
              <button
                className="btn btn-danger"
                onClick={() => handleClose(showCloseModal)}
                disabled={closeReason.length < 5}
              >
                Clôturer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
