import { useEffect, useState } from "react";
import { canWriteEndpoint, ROLE_LABELS, ROLE_ICONS, type SessionUser } from "./auth_rbac";
import {
  fetchApprovals,
  decideApproval as apiDecideApproval,
  type Approval,
} from "./api";

type Props = { sessionUser: SessionUser };

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function ApprovalsManagement({ sessionUser }: Props) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "decided">("all");

  const canApproveDoc = canWriteEndpoint(sessionUser.role, "APPROVE_DOCUMENT");
  const canApproveBaseline = canWriteEndpoint(
    sessionUser.role,
    "VALIDATE_BASELINE",
  );

  useEffect(() => {
    loadApprovals();
  }, []);

  async function loadApprovals() {
    setLoading(true);
    const data = await fetchApprovals();
    setApprovals(data ?? []);
    setLoading(false);
  }

  async function handleDecide(
    approvalId: number,
    decision: "approved" | "rejected",
  ) {
    if (comment.length < 3) return;
    await apiDecideApproval(approvalId, decision, comment);
    setDeciding(null);
    setComment("");
    loadApprovals();
  }

  function canDecide(entityType: string): boolean {
    if (entityType === "DOCUMENT") return canApproveDoc;
    if (entityType === "BASELINE") return canApproveBaseline;
    return canWriteEndpoint(sessionUser.role, "CLOSE_PDCA");
  }

  function getTypeIcon(type: string): string {
    switch (type) {
      case "DOCUMENT":
        return "📄";
      case "BASELINE":
        return "📊";
      case "PDCA":
        return "🔄";
      default:
        return "📋";
    }
  }

  function getTypeBadgeClass(type: string): string {
    switch (type) {
      case "DOCUMENT":
        return "badge-blue";
      case "BASELINE":
        return "badge-gold";
      case "PDCA":
        return "badge-green";
      default:
        return "badge-blue";
    }
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case "approved":
        return <span className="badge badge-green">✓ Approuvé</span>;
      case "rejected":
        return <span className="badge badge-red">✕ Rejeté</span>;
      default:
        return <span className="badge badge-gold">⏳ En attente</span>;
    }
  }

  const pending = approvals.filter((a) => a.status === "pending");
  const decided = approvals.filter((a) => a.status !== "pending");
  const approvedCount = decided.filter((d) => d.status === "approved").length;
  const rejectedCount = decided.filter((d) => d.status === "rejected").length;

  const filtered =
    filter === "pending"
      ? pending
      : filter === "decided"
        ? decided
        : approvals;

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1>Centre d'Approbations</h1>
          <p className="muted">Chargement…</p>
        </div>
        {[1, 2].map((i) => (
          <div
            key={i}
            className="card"
            style={{ marginBottom: 12, height: 100 }}
          >
            <div
              className="skeleton"
              style={{ width: "60%", height: 16, marginBottom: 10 }}
            />
            <div
              className="skeleton"
              style={{ width: "40%", height: 12 }}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>✅ Centre d'Approbations</h1>
        <p className="muted">
          {ROLE_ICONS[sessionUser.role]} {sessionUser.fullName} —{" "}
          {ROLE_LABELS[sessionUser.role]}. Les actions sensibles sont filtrées
          par RBAC.
        </p>
      </div>

      {/* KPI */}
      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <div className="kpi-card kpi-gold">
          <div className="kpi-icon">⏳</div>
          <div className="kpi-label">En attente</div>
          <div className="kpi-value">{pending.length}</div>
        </div>
        <div className="kpi-card kpi-olive">
          <div className="kpi-icon">✅</div>
          <div className="kpi-label">Approuvées</div>
          <div className="kpi-value">{approvedCount}</div>
        </div>
        <div className="kpi-card kpi-terracotta">
          <div className="kpi-icon">❌</div>
          <div className="kpi-label">Rejetées</div>
          <div className="kpi-value">{rejectedCount}</div>
        </div>
        <div className="kpi-card kpi-blue">
          <div className="kpi-icon">📋</div>
          <div className="kpi-label">Total</div>
          <div className="kpi-value">{approvals.length}</div>
        </div>
      </div>

      {/* Authorization summary */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 className="card-title" style={{ marginBottom: 12 }}>
          Autorisations du rôle
        </h3>
        <div
          style={{
            display: "flex",
            gap: 20,
            fontSize: 13,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              padding: "8px 14px",
              borderRadius: "var(--radius-md)",
              background: canApproveDoc
                ? "var(--success-dim)"
                : "var(--error-dim)",
              border: `1px solid ${canApproveDoc ? "rgba(122,143,74,0.2)" : "rgba(212,113,79,0.2)"}`,
            }}
          >
            📄 Approbation documentaire :{" "}
            <span
              style={{
                color: canApproveDoc ? "var(--success)" : "var(--error)",
                fontWeight: 600,
              }}
            >
              {canApproveDoc ? "✓ autorisée" : "✕ lecture seule"}
            </span>
          </div>
          <div
            style={{
              padding: "8px 14px",
              borderRadius: "var(--radius-md)",
              background: canApproveBaseline
                ? "var(--success-dim)"
                : "var(--error-dim)",
              border: `1px solid ${canApproveBaseline ? "rgba(122,143,74,0.2)" : "rgba(212,113,79,0.2)"}`,
            }}
          >
            📊 Validation baseline :{" "}
            <span
              style={{
                color: canApproveBaseline
                  ? "var(--success)"
                  : "var(--error)",
                fontWeight: 600,
              }}
            >
              {canApproveBaseline ? "✓ autorisée" : "✕ lecture seule"}
            </span>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="tabs">
        {(["all", "pending", "decided"] as const).map((f) => (
          <button
            key={f}
            className={`tab${filter === f ? " active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all"
              ? `Toutes (${approvals.length})`
              : f === "pending"
                ? `En attente (${pending.length})`
                : `Décidées (${decided.length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">✅</div>
            <p className="empty-state-text">
              {filter === "pending"
                ? "Aucune demande en attente"
                : filter === "decided"
                  ? "Aucune décision enregistrée"
                  : "Aucune demande d'approbation"}
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((item) => {
            const isPending = item.status === "pending";
            return (
              <div className="card animate-fade-in-up" key={item.id}>
                <div className="card-header">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: "var(--radius-md)",
                        background: "var(--bg-tertiary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 20,
                        flexShrink: 0,
                      }}
                    >
                      {getTypeIcon(item.entityType)}
                    </div>
                    <div>
                      <h3 className="card-title">{item.title}</h3>
                      <div className="card-subtitle">
                        <span className={`badge ${getTypeBadgeClass(item.entityType)}`} style={{ marginRight: 6 }}>
                          {item.entityType}
                        </span>
                        Demandé par{" "}
                        <span style={{ fontWeight: 600 }}>
                          {item.requestedByName}
                        </span>
                        {" · "}
                        <span style={{ color: "var(--text-tertiary)" }}>
                          {formatDate(item.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                  {getStatusBadge(item.status)}
                </div>

                {item.comment && (
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--text-secondary)",
                      marginBottom: 12,
                      padding: "8px 12px",
                      background: "var(--bg-tertiary)",
                      borderRadius: "var(--radius-md)",
                      borderLeft: "3px solid var(--border-hover)",
                    }}
                  >
                    « {item.comment} »
                  </p>
                )}

                {isPending && (
                  <>
                    {deciding === item.id ? (
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <input
                          className="form-input"
                          placeholder="Commentaire de décision (min 3 car.)"
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          style={{
                            flex: 1,
                            minWidth: 200,
                            padding: "8px 12px",
                            fontSize: 12,
                          }}
                        />
                        <button
                          className="btn btn-success btn-sm"
                          onClick={() =>
                            handleDecide(item.id, "approved")
                          }
                          disabled={comment.length < 3}
                        >
                          ✓ Approuver
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() =>
                            handleDecide(item.id, "rejected")
                          }
                          disabled={comment.length < 3}
                        >
                          ✕ Rejeter
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setDeciding(null);
                            setComment("");
                          }}
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={!canDecide(item.entityType)}
                          onClick={() => setDeciding(item.id)}
                          title={
                            !canDecide(item.entityType)
                              ? "Action non autorisée pour ce rôle"
                              : ""
                          }
                        >
                          Décider
                        </button>
                        <button className="btn btn-secondary btn-sm">
                          Voir justificatifs
                        </button>
                      </div>
                    )}
                  </>
                )}

                {!isPending && item.decidedAt && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-tertiary)",
                      marginTop: 4,
                    }}
                  >
                    Décision le {formatDate(item.decidedAt)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
