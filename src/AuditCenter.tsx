import { useEffect, useState } from "react";
import { canWriteEndpoint, ROLE_LABELS, ROLE_ICONS, type SessionUser } from "./auth_rbac";
import {
  fetchAuditMatrix,
  fetchAuditEvidence,
  fetchNonConformities,
  exportPreAudit,
  createNonConformity,
  type AuditMatrixItem,
  type AuditEvidence,
  type NonConformity,
} from "./api";

type Props = { sessionUser: SessionUser };
type Tab = "matrix" | "ncs";

export default function AuditCenter({ sessionUser }: Props) {
  const [matrix, setMatrix] = useState<AuditMatrixItem[]>([]);
  const [ncs, setNcs] = useState<NonConformity[]>([]);
  const [selectedClause, setSelectedClause] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<AuditEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [tab, setTab] = useState<Tab>("matrix");
  const [showNcModal, setShowNcModal] = useState(false);
  const [ncForm, setNcForm] = useState({
    clause: "",
    title: "",
    description: "",
    correctiveAction: "",
    owner: "",
    dueDate: "",
  });

  const canExport = canWriteEndpoint(sessionUser.role, "EXPORT_AUDIT_REPORT");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [m, n] = await Promise.all([
      fetchAuditMatrix(),
      fetchNonConformities(),
    ]);
    setMatrix(m ?? []);
    setNcs(n ?? []);
    setLoading(false);
  }

  async function loadEvidence(clause: string) {
    setSelectedClause(clause);
    const data = await fetchAuditEvidence(clause);
    setEvidence(data ?? []);
  }

  async function handleExport() {
    setExporting(true);
    await exportPreAudit();
    setExporting(false);
    setExported(true);
    setTimeout(() => setExported(false), 3000);
  }

  async function handleCreateNc() {
    if (
      !ncForm.clause ||
      !ncForm.title ||
      !ncForm.description ||
      !ncForm.correctiveAction ||
      !ncForm.owner ||
      !ncForm.dueDate
    )
      return;
    await createNonConformity(ncForm);
    setShowNcModal(false);
    setNcForm({
      clause: "",
      title: "",
      description: "",
      correctiveAction: "",
      owner: "",
      dueDate: "",
    });
    loadData();
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case "covered":
        return <span className="badge badge-green">✓ Couvert</span>;
      case "partial":
        return <span className="badge badge-gold">◐ Partiel</span>;
      case "missing":
        return <span className="badge badge-red">✕ Manquant</span>;
      default:
        return <span className="badge badge-blue">{status}</span>;
    }
  }

  function getEvidenceStatusColor(status: string): string {
    switch (status) {
      case "valid":
        return "var(--success)";
      case "warning":
        return "var(--warning)";
      case "missing":
        return "var(--error)";
      default:
        return "var(--text-secondary)";
    }
  }

  function getStatusIcon(status: string): string {
    switch (status) {
      case "covered":
        return "✅";
      case "partial":
        return "🟡";
      case "missing":
        return "🔴";
      default:
        return "⚪";
    }
  }

  const covered = matrix.filter((m) => m.status === "covered").length;
  const partial = matrix.filter((m) => m.status === "partial").length;
  const missing = matrix.filter((m) => m.status === "missing").length;
  const coveragePct =
    matrix.length > 0
      ? Math.round(((covered + partial * 0.5) / matrix.length) * 100)
      : 0;
  const openNcs = ncs.filter((n) => n.status === "open").length;

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1>Centre Pré-Audit ISO 50001</h1>
          <p className="muted">Chargement…</p>
        </div>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="card"
            style={{ marginBottom: 12, height: 80 }}
          >
            <div
              className="skeleton"
              style={{ width: "60%", height: 14 }}
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
            <h1>📋 Centre Pré-Audit ISO 50001</h1>
            <p className="muted">
              {ROLE_ICONS[sessionUser.role]} {sessionUser.fullName} —{" "}
              {ROLE_LABELS[sessionUser.role]}. Suivi des preuves par clause et
              export audit.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-secondary"
              onClick={() => setShowNcModal(true)}
            >
              + Non-conformité
            </button>
            <button
              className="btn btn-primary"
              disabled={!canExport || exporting}
              onClick={handleExport}
              title={!canExport ? "Action non autorisée" : ""}
            >
              {exporting ? (
                <>
                  <span className="loading-spinner" /> Export…
                </>
              ) : exported ? (
                "✓ Exporté !"
              ) : (
                "📑 Exporter rapport"
              )}
            </button>
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <div className="kpi-card kpi-olive">
          <div className="kpi-icon">📊</div>
          <div className="kpi-label">Couverture</div>
          <div className="kpi-value">{coveragePct}%</div>
          <div className="progress-bar" style={{ marginTop: 8 }}>
            <div
              className="progress-fill"
              style={{
                width: `${coveragePct}%`,
                background:
                  coveragePct >= 80
                    ? "var(--success)"
                    : coveragePct >= 60
                      ? "linear-gradient(90deg, var(--warning), var(--tunisian-gold))"
                      : "var(--error)",
              }}
            />
          </div>
        </div>
        <div className="kpi-card kpi-blue">
          <div className="kpi-icon">✅</div>
          <div className="kpi-label">Clauses couvertes</div>
          <div className="kpi-value">
            {covered}
            <span
              style={{
                fontSize: 14,
                color: "var(--text-secondary)",
                fontWeight: 400,
              }}
            >
              /{matrix.length}
            </span>
          </div>
        </div>
        <div className="kpi-card kpi-gold">
          <div className="kpi-icon">🟡</div>
          <div className="kpi-label">Partiellement couvertes</div>
          <div className="kpi-value">{partial}</div>
        </div>
        <div className="kpi-card kpi-terracotta">
          <div className="kpi-icon">⚠️</div>
          <div className="kpi-label">Non-conformités ouvertes</div>
          <div className="kpi-value">{openNcs}</div>
        </div>
      </div>

      {/* Coverage visual summary */}
      <div
        className="card"
        style={{
          marginBottom: 16,
          padding: "14px 20px",
          display: "flex",
          gap: 16,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
          Répartition :
        </span>
        <div style={{ display: "flex", gap: 4, flex: 1, height: 8, borderRadius: "var(--radius-full)", overflow: "hidden" }}>
          {covered > 0 && (
            <div
              style={{
                flex: covered,
                background: "var(--success)",
                borderRadius: "var(--radius-full) 0 0 var(--radius-full)",
              }}
            />
          )}
          {partial > 0 && (
            <div style={{ flex: partial, background: "var(--warning)" }} />
          )}
          {missing > 0 && (
            <div
              style={{
                flex: missing,
                background: "var(--error)",
                borderRadius: "0 var(--radius-full) var(--radius-full) 0",
              }}
            />
          )}
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 11 }}>
          <span style={{ color: "var(--success)" }}>● {covered} couvertes</span>
          <span style={{ color: "var(--warning)" }}>● {partial} partielles</span>
          <span style={{ color: "var(--error)" }}>● {missing} manquantes</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab${tab === "matrix" ? " active" : ""}`}
          onClick={() => setTab("matrix")}
        >
          Matrice Exigences ({matrix.length})
        </button>
        <button
          className={`tab${tab === "ncs" ? " active" : ""}`}
          onClick={() => setTab("ncs")}
        >
          Non-conformités ({ncs.length})
        </button>
      </div>

      {tab === "matrix" && (
        <div className="grid-2-1" style={{ gap: 16 }}>
          {/* Audit Matrix */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Matrice Exigences → Preuves</h3>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Clause</th>
                  <th>Exigence</th>
                  <th>Statut</th>
                  <th>Preuves</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((item) => (
                  <tr
                    key={item.clause}
                    style={{
                      cursor: "pointer",
                      background:
                        selectedClause === item.clause
                          ? "var(--bg-tertiary)"
                          : undefined,
                    }}
                    onClick={() => loadEvidence(item.clause)}
                  >
                    <td>
                      <span
                        className="mono"
                        style={{
                          fontWeight: 700,
                          color: "var(--tunisian-gold)",
                        }}
                      >
                        {item.clause}
                      </span>
                    </td>
                    <td style={{ fontWeight: 500 }}>{item.title}</td>
                    <td>{getStatusBadge(item.status)}</td>
                    <td>
                      <span className="badge badge-blue">
                        {item.evidenceIds.length}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm">→</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Evidence Panel */}
          <div>
            {selectedClause ? (
              <div className="card animate-slide-right">
                <div className="card-header">
                  <h3 className="card-title">
                    {getStatusIcon(
                      matrix.find((m) => m.clause === selectedClause)
                        ?.status ?? "",
                    )}{" "}
                    Clause {selectedClause}
                  </h3>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setSelectedClause(null)}
                  >
                    ✕
                  </button>
                </div>
                {/* Summary */}
                {(() => {
                  const clauseItem = matrix.find(
                    (m) => m.clause === selectedClause,
                  );
                  return clauseItem?.summary ? (
                    <p
                      style={{
                        fontSize: 12,
                        color: "var(--text-secondary)",
                        marginBottom: 14,
                        padding: "8px 12px",
                        background: "var(--bg-tertiary)",
                        borderRadius: "var(--radius-md)",
                      }}
                    >
                      {clauseItem.summary}
                    </p>
                  ) : null;
                })()}
                {evidence.length === 0 ? (
                  <div className="empty-state">
                    <p className="empty-state-text">
                      Aucune preuve trouvée
                    </p>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    {evidence.map((e) => (
                      <div
                        key={e.id}
                        className="card-glass"
                        style={{
                          padding: 14,
                          borderLeft: `3px solid ${getEvidenceStatusColor(e.status)}`,
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 13,
                            marginBottom: 4,
                          }}
                        >
                          {e.label}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--text-secondary)",
                            marginBottom: 6,
                          }}
                        >
                          {e.details}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 12,
                            fontSize: 10,
                            color: "var(--text-tertiary)",
                          }}
                        >
                          <span>Source: {e.sourceType}</span>
                          <span>Réf: {e.sourceRef}</span>
                          <span
                            style={{
                              color: getEvidenceStatusColor(e.status),
                              fontWeight: 600,
                            }}
                          >
                            {e.status.toUpperCase()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="card">
                <div className="empty-state">
                  <div className="empty-state-icon">👈</div>
                  <p className="empty-state-text">
                    Sélectionnez une clause pour voir les preuves
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "ncs" && (
        <div>
          {ncs.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon">✅</div>
                <p className="empty-state-text">Aucune non-conformité</p>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowNcModal(true)}
                >
                  + Signaler une non-conformité
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {ncs.map((nc) => (
                <div className="card animate-fade-in-up" key={nc.id}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 8,
                    }}
                  >
                    <div>
                      <span
                        className="mono"
                        style={{
                          color: "var(--tunisian-gold)",
                          fontSize: 11,
                          marginRight: 6,
                        }}
                      >
                        {nc.clause}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>
                        {nc.title}
                      </span>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-tertiary)",
                          marginTop: 2,
                        }}
                      >
                        Signalé par {nc.createdByName}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <span
                        className={`badge ${nc.severity === "major" ? "badge-red" : "badge-gold"}`}
                      >
                        {nc.severity}
                      </span>
                      <span
                        className={`badge ${nc.status === "open" ? "badge-red" : nc.status === "resolved" ? "badge-green" : "badge-blue"}`}
                      >
                        {nc.status}
                      </span>
                    </div>
                  </div>
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      marginBottom: 10,
                    }}
                  >
                    {nc.description}
                  </p>
                  {nc.correctiveActions &&
                    nc.correctiveActions.length > 0 && (
                      <div>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--text-secondary)",
                            marginBottom: 6,
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                          }}
                        >
                          Actions correctives
                        </div>
                        {nc.correctiveActions.map((ca) => (
                          <div
                            key={ca.id}
                            style={{
                              margin: "4px 0",
                              fontSize: 12,
                              padding: "8px 12px",
                              background: "var(--bg-primary)",
                              borderRadius: "var(--radius-md)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <span>{ca.action}</span>
                            <div
                              style={{
                                display: "flex",
                                gap: 8,
                                alignItems: "center",
                              }}
                            >
                              <span
                                style={{
                                  fontWeight: 600,
                                  fontSize: 11,
                                }}
                              >
                                {ca.owner}
                              </span>
                              <span
                                className={`badge ${ca.status === "done" ? "badge-green" : ca.status === "in_progress" ? "badge-blue" : "badge-gold"}`}
                              >
                                {ca.status}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* NC Create Modal */}
      {showNcModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowNcModal(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">
              ⚠️ Signaler une non-conformité
            </h3>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Clause ISO</label>
                <select
                  className="form-select"
                  value={ncForm.clause}
                  onChange={(e) =>
                    setNcForm({ ...ncForm, clause: e.target.value })
                  }
                >
                  <option value="">Sélectionner…</option>
                  {matrix.map((m) => (
                    <option key={m.clause} value={m.clause}>
                      {m.clause} — {m.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Titre</label>
                <input
                  className="form-input"
                  value={ncForm.title}
                  onChange={(e) =>
                    setNcForm({ ...ncForm, title: e.target.value })
                  }
                  placeholder="Ex: Absence de revue de direction"
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                className="form-textarea"
                value={ncForm.description}
                onChange={(e) =>
                  setNcForm({ ...ncForm, description: e.target.value })
                }
                placeholder="Détaillez la non-conformité observée…"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Action corrective</label>
              <input
                className="form-input"
                value={ncForm.correctiveAction}
                onChange={(e) =>
                  setNcForm({
                    ...ncForm,
                    correctiveAction: e.target.value,
                  })
                }
                placeholder="Ex: Programmer la revue de direction trimestrielle"
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Responsable</label>
                <input
                  className="form-input"
                  value={ncForm.owner}
                  onChange={(e) =>
                    setNcForm({ ...ncForm, owner: e.target.value })
                  }
                  placeholder="Ex: M. Benali"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Échéance</label>
                <input
                  className="form-input"
                  type="date"
                  value={ncForm.dueDate}
                  onChange={(e) =>
                    setNcForm({ ...ncForm, dueDate: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowNcModal(false)}
              >
                Annuler
              </button>
              <button
                className="btn btn-danger"
                onClick={handleCreateNc}
                disabled={
                  !ncForm.clause ||
                  !ncForm.title ||
                  !ncForm.description ||
                  !ncForm.correctiveAction ||
                  !ncForm.owner ||
                  !ncForm.dueDate
                }
              >
                Signaler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
