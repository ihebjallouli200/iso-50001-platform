import { useEffect, useState } from "react";
import { type SessionUser } from "./auth_rbac";
import {
  fetchIngestionHealth,
  SESSION_TOKEN_KEY,
  type ImportJournalEntry,
} from "./api";

type Props = { sessionUser: SessionUser };

type Machine = {
  id: number;
  siteId: string;
  siteName?: string;
  machineCode: string;
  machineName: string;
  machineType: string | null;
  location?: string | null;
  nominalPower?: number | null;
  isActive: boolean;
};

type Site = {
  siteId: string;
  siteName: string;
};

type ConfigTab = "machines" | "csv" | "scada";

function getToken(): string {
  return localStorage.getItem(SESSION_TOKEN_KEY) || "";
}

async function apiPost<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `API error ${res.status}`);
  return json.data !== undefined ? json.data : json;
}

async function apiGetList<T>(url: string): Promise<T[]> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `API error ${res.status}`);
  const d = json.data !== undefined ? json.data : json;
  return Array.isArray(d) ? d : [];
}

export default function ConfigurationPanel({ sessionUser }: Props) {
  const [tab, setTab] = useState<ConfigTab>("machines");
  const [machines, setMachines] = useState<Machine[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [healthData, setHealthData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Machine form
  const [mForm, setMForm] = useState({ siteId: "", machineName: "", machineCode: "", machineType: "compressor", location: "", nominalPower: "" });
  const [mCreating, setMCreating] = useState(false);

  // CSV Import form
  const [csvForm, setCsvForm] = useState({ sourceName: "", machineId: "", rowCount: "25", sourceType: "synthetic_csv" });
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState<ImportJournalEntry | null>(null);

  // SCADA form
  const [scadaForm, setScadaForm] = useState({
    opcuaEndpoint: "opc.tcp://localhost:4840",
    opcuaNamespace: "2",
    opcuaPollMs: "5000",
    modbusHost: "127.0.0.1",
    modbusPort: "502",
    modbusUnitId: "1",
    modbusPollMs: "5000",
    mqttBroker: "mqtt://localhost:1883",
    mqttTopic: "energy/machine/+",
  });

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    try {
      const [m, s, h] = await Promise.all([
        apiGetList<Machine>("/api/machines"),
        apiGetList<Site>("/api/sites"),
        fetchIngestionHealth().catch(() => null),
      ]);
      setMachines(m);
      setSites(s);
      setHealthData(h);
      // Pre-fill SCADA from health data
      if (h?.broker) {
        setScadaForm(prev => ({
          ...prev,
          mqttBroker: h.broker.url || prev.mqttBroker,
          mqttTopic: h.broker.topic || prev.mqttTopic,
        }));
      }
    } catch (e) {
      console.error("Config load error:", e);
    } finally {
      setLoading(false);
    }
  }

  function showFeedback(type: "success" | "error", msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 5000);
  }

  async function handleCreateMachine() {
    if (!mForm.machineName.trim() || !mForm.machineCode.trim() || !mForm.siteId) {
      showFeedback("error", "Nom, code machine et site sont requis.");
      return;
    }
    setMCreating(true);
    try {
      await apiPost("/api/machines", {
        siteId: mForm.siteId,
        machineName: mForm.machineName.trim(),
        machineCode: mForm.machineCode.trim(),
        machineType: mForm.machineType || null,
        location: mForm.location.trim() || null,
        nominalPower: mForm.nominalPower ? Number(mForm.nominalPower) : null,
      });
      showFeedback("success", `Machine "${mForm.machineName}" créée avec succès.`);
      setMForm({ siteId: mForm.siteId, machineName: "", machineCode: "", machineType: "compressor", location: "", nominalPower: "" });
      await loadData();
    } catch (e: unknown) {
      showFeedback("error", `Erreur: ${e instanceof Error ? e.message : "inconnue"}`);
    } finally {
      setMCreating(false);
    }
  }

  async function handleCsvImport() {
    const sourceName = csvForm.sourceName.trim();
    const machineId = Number(csvForm.machineId);
    const rowCount = Number(csvForm.rowCount);
    if (sourceName.length < 3) { showFeedback("error", "Nom source requis (min 3 caractères)."); return; }
    if (!machineId || machineId <= 0) { showFeedback("error", "Sélectionnez une machine."); return; }
    if (!rowCount || rowCount <= 0) { showFeedback("error", "Nombre de lignes invalide."); return; }

    setCsvImporting(true);
    setCsvResult(null);
    try {
      const result = await apiPost<ImportJournalEntry>("/api/imports/run", {
        sourceName,
        sourceType: csvForm.sourceType,
        machineId,
        rowCount,
        measurements: [],
      });
      setCsvResult(result);
      showFeedback("success", `Import "${sourceName}" réussi — ${rowCount} lignes traitées.`);
    } catch (e: unknown) {
      showFeedback("error", `Import échoué: ${e instanceof Error ? e.message : "erreur inconnue"}`);
    } finally {
      setCsvImporting(false);
    }
  }

  if (loading) {
    return (
      <div className="fade-in" style={{ padding: 32 }}>
        <div className="loading-skeleton" style={{ height: 400, borderRadius: 12 }} />
      </div>
    );
  }

  const MACHINE_TYPES = [
    { value: "compressor", label: "Compresseur" },
    { value: "furnace", label: "Four industriel" },
    { value: "chiller", label: "Groupe froid" },
    { value: "pump", label: "Pompe" },
    { value: "motor", label: "Moteur" },
    { value: "hvac", label: "CVC (HVAC)" },
    { value: "lighting", label: "Éclairage" },
    { value: "other", label: "Autre" },
  ];

  return (
    <div className="fade-in" style={{ padding: "0 8px" }}>
      {/* Feedback toast */}
      {feedback && (
        <div
          style={{
            position: "fixed",
            top: 20,
            right: 20,
            zIndex: 9999,
            padding: "12px 20px",
            borderRadius: 8,
            background: feedback.type === "success" ? "var(--success)" : "var(--error)",
            color: "#fff",
            fontWeight: 600,
            fontSize: 13,
            boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
            animation: "fadeIn 0.3s ease",
          }}
        >
          {feedback.type === "success" ? "✅" : "❌"} {feedback.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>⚙️ Configuration Plateforme</h2>
        <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: 13 }}>
          Gestion machines, injection données, configuration SCADA — {sessionUser.fullName}
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {([
          { key: "machines" as const, icon: "🏭", label: `Machines (${machines.length})` },
          { key: "csv" as const, icon: "📥", label: "Injection Données" },
          { key: "scada" as const, icon: "📡", label: "Configuration SCADA" },
        ]).map(t => (
          <button
            key={t.key}
            className={`btn btn-sm ${tab === t.key ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTab(t.key)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ========== TAB: MACHINES ========== */}
      {tab === "machines" && (
        <div className="grid-2">
          {/* Add Machine Form */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">➕ Ajouter une Machine</h3>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
              <div className="grid-2" style={{ gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>
                    Site *
                  </label>
                  <select
                    className="input"
                    value={mForm.siteId}
                    onChange={e => setMForm({ ...mForm, siteId: e.target.value })}
                    style={{ fontSize: 13 }}
                  >
                    <option value="">— Sélectionner un site —</option>
                    {sites.map(s => (
                      <option key={s.siteId} value={s.siteId}>{s.siteName}</option>
                    ))}
                    <option value="NEW_SITE">+ Nouveau site</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>
                    Type machine
                  </label>
                  <select
                    className="input"
                    value={mForm.machineType}
                    onChange={e => setMForm({ ...mForm, machineType: e.target.value })}
                    style={{ fontSize: 13 }}
                  >
                    {MACHINE_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid-2" style={{ gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>
                    Nom machine *
                  </label>
                  <input
                    className="input"
                    placeholder="Ex: Compresseur A"
                    value={mForm.machineName}
                    onChange={e => setMForm({ ...mForm, machineName: e.target.value })}
                    style={{ fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>
                    Code machine *
                  </label>
                  <input
                    className="input"
                    placeholder="Ex: CMP-D"
                    value={mForm.machineCode}
                    onChange={e => setMForm({ ...mForm, machineCode: e.target.value })}
                    style={{ fontSize: 13 }}
                  />
                </div>
              </div>

              <div className="grid-2" style={{ gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>
                    Localisation
                  </label>
                  <input
                    className="input"
                    placeholder="Ex: Bâtiment A — Zone 3"
                    value={mForm.location}
                    onChange={e => setMForm({ ...mForm, location: e.target.value })}
                    style={{ fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>
                    Puissance nominale (kW)
                  </label>
                  <input
                    className="input"
                    type="number"
                    placeholder="Ex: 350"
                    value={mForm.nominalPower}
                    onChange={e => setMForm({ ...mForm, nominalPower: e.target.value })}
                    style={{ fontSize: 13 }}
                  />
                </div>
              </div>

              <button
                className="btn btn-primary"
                onClick={handleCreateMachine}
                disabled={mCreating}
                style={{ marginTop: 4 }}
              >
                {mCreating ? "Création…" : "🏭 Créer la Machine"}
              </button>
            </div>
          </div>

          {/* Machine List */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">📋 Machines Enregistrées</h3>
              <span className="badge badge-blue">{machines.length}</span>
            </div>
            {machines.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">🏭</div>
                <p className="empty-state-text">Aucune machine enregistrée</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 480, overflowY: "auto" }}>
                {machines.map(m => (
                  <div key={m.id} className="card-glass hover-lift" style={{ padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{m.machineName}</div>
                        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                          {m.machineCode} · {m.machineType || "—"} · {m.siteName || m.siteId}
                        </div>
                        {m.location && (
                          <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 2 }}>
                            📍 {m.location}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span className={`badge ${m.isActive ? "badge-green" : "badge-red"}`}>
                          {m.isActive ? "Actif" : "Inactif"}
                        </span>
                        {m.nominalPower && (
                          <div className="mono" style={{ fontSize: 11, color: "var(--tunisian-gold)", marginTop: 4 }}>
                            {m.nominalPower} kW
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========== TAB: CSV / DATA INJECTION ========== */}
      {tab === "csv" && (
        <div className="grid-2">
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">📥 Injection de Données</h3>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>
                  Type de source
                </label>
                <select
                  className="input"
                  value={csvForm.sourceType}
                  onChange={e => setCsvForm({ ...csvForm, sourceType: e.target.value })}
                  style={{ fontSize: 13 }}
                >
                  <option value="synthetic_csv">CSV Synthétique</option>
                  <option value="synthetic_batch">Batch Synthétique</option>
                  <option value="synthetic_mqtt">MQTT Simulé</option>
                  <option value="manual">Import Manuel</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>
                  Nom de la source *
                </label>
                <input
                  className="input"
                  placeholder="Ex: capteur_zone_a_2024"
                  value={csvForm.sourceName}
                  onChange={e => setCsvForm({ ...csvForm, sourceName: e.target.value })}
                  style={{ fontSize: 13 }}
                />
              </div>

              <div className="grid-2" style={{ gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>
                    Machine cible *
                  </label>
                  <select
                    className="input"
                    value={csvForm.machineId}
                    onChange={e => setCsvForm({ ...csvForm, machineId: e.target.value })}
                    style={{ fontSize: 13 }}
                  >
                    <option value="">— Sélectionner —</option>
                    {machines.map(m => (
                      <option key={m.id} value={m.id}>{m.machineName} ({m.machineCode})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>
                    Nombre de lignes
                  </label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="500"
                    value={csvForm.rowCount}
                    onChange={e => setCsvForm({ ...csvForm, rowCount: e.target.value })}
                    style={{ fontSize: 13 }}
                  />
                </div>
              </div>

              {/* Data Format Help */}
              <div className="card-glass" style={{ padding: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: "var(--tunisian-gold)", marginBottom: 6 }}>
                  📋 Format des données attendu
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  <code style={{ background: "rgba(255,255,255,0.05)", padding: "1px 4px", borderRadius: 3 }}>
                    timestamp, machineId, powerKw, kVA, cosPhiVoltage, thdVoltage, loadPct, enpi, oee
                  </code>
                  <br />
                  Exemple: <em>2024-01-15T08:00:00Z, 1, 312.5, 367.5, 0.92, 3.2, 85, 2.1, 82</em>
                </div>
              </div>

              <button
                className="btn btn-primary"
                onClick={handleCsvImport}
                disabled={csvImporting}
                style={{ marginTop: 4 }}
              >
                {csvImporting ? "Import en cours…" : "📥 Lancer l'Import"}
              </button>

              {csvResult && (
                <div className="card-glass" style={{ padding: 12, marginTop: 4 }}>
                  <div style={{ fontWeight: 700, color: "var(--success)", fontSize: 13, marginBottom: 4 }}>
                    ✅ Import complété
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                    <span>ID Import:</span><span className="mono">#{csvResult.id}</span>
                    <span>Lignes:</span><span className="mono">{csvResult.rowCount}</span>
                    <span>Insérées:</span><span className="mono" style={{ color: "var(--success)" }}>{csvResult.insertedRows}</span>
                    <span>Rejetées:</span><span className="mono" style={{ color: Number(csvResult.rejectedRows) > 0 ? "var(--error)" : "inherit" }}>{csvResult.rejectedRows}</span>
                    <span>Statut:</span><span className={`badge ${csvResult.status === "success" ? "badge-green" : "badge-gold"}`} style={{ fontSize: 10 }}>{csvResult.status}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Import summary info */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">📖 Guide d'Import</h3>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                {
                  icon: "📊",
                  title: "CSV Synthétique",
                  desc: "Génère des données simulées basées sur des profils de charge réalistes. Idéal pour les tests et la démonstration.",
                  badge: "synthetic_csv",
                },
                {
                  icon: "📦",
                  title: "Batch Synthétique",
                  desc: "Import en lot depuis un fichier CSV local. Valide les schémas, détecte les anomalies, et écrit en TimescaleDB.",
                  badge: "synthetic_batch",
                },
                {
                  icon: "📡",
                  title: "MQTT Simulé",
                  desc: "Simule un flux de données MQTT depuis un broker. Chaque message est validé et stocké en temps réel.",
                  badge: "synthetic_mqtt",
                },
                {
                  icon: "🔧",
                  title: "Import Manuel",
                  desc: "Saisie manuelle ou API directe. Permet l'injection de données historiques ou de corrections unitaires.",
                  badge: "manual",
                },
              ].map((item, i) => (
                <div key={i} className="card-glass" style={{ padding: 12 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "start" }}>
                    <span style={{ fontSize: 22 }}>{item.icon}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{item.title}</div>
                      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{item.desc}</div>
                      <span className="badge badge-blue" style={{ fontSize: 9, marginTop: 6 }}>{item.badge}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========== TAB: SCADA CONFIG ========== */}
      {tab === "scada" && (
        <div>
          {/* SCADA Overview cards */}
          <div className="kpi-grid" style={{ marginBottom: 16 }}>
            <div className="card kpi-card">
              <div className="kpi-icon" style={{ borderColor: "var(--tunisian-blue)" }}>📡</div>
              <div className="kpi-label">MQTT</div>
              <div className="kpi-value">
                <span className="badge" style={{ background: healthData?.activity?.lastMqttMessageAt ? "#34d39922" : "#94a3b822", color: healthData?.activity?.lastMqttMessageAt ? "#34d399" : "#94a3b8" }}>
                  {healthData?.activity?.lastMqttMessageAt ? "● Connecté" : "● Standby"}
                </span>
              </div>
              <div className="kpi-trend neutral" style={{ fontSize: 10 }}>{healthData?.activity?.counters?.mqttMessages || 0} messages</div>
            </div>
            <div className="card kpi-card">
              <div className="kpi-icon" style={{ borderColor: "var(--tunisian-gold)" }}>🔌</div>
              <div className="kpi-label">OPC-UA</div>
              <div className="kpi-value">
                <span className="badge" style={{ background: "#94a3b822", color: "#94a3b8" }}>● Config.</span>
              </div>
              <div className="kpi-trend neutral" style={{ fontSize: 10 }}>node-opcua installé</div>
            </div>
            <div className="card kpi-card">
              <div className="kpi-icon" style={{ borderColor: "var(--tunisian-olive)" }}>⚡</div>
              <div className="kpi-label">MODBUS</div>
              <div className="kpi-value">
                <span className="badge" style={{ background: "#94a3b822", color: "#94a3b8" }}>● Config.</span>
              </div>
              <div className="kpi-trend neutral" style={{ fontSize: 10 }}>TCP natif</div>
            </div>
            <div className="card kpi-card">
              <div className="kpi-icon" style={{ borderColor: "var(--success)" }}>🗄️</div>
              <div className="kpi-label">STOCKAGE</div>
              <div className="kpi-value">
                <span className="badge" style={{ background: "#34d39922", color: "#34d399" }}>
                  ● {healthData?.status || "—"}
                </span>
              </div>
              <div className="kpi-trend neutral" style={{ fontSize: 10 }}>{healthData?.integrationMode || "—"}</div>
            </div>
          </div>

          <div className="grid-2">
            {/* MQTT Config */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">📡 Configuration MQTT</h3>
                <span className="badge badge-blue">Mosquitto</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>
                    URL Broker MQTT
                  </label>
                  <input className="input" value={scadaForm.mqttBroker} onChange={e => setScadaForm({ ...scadaForm, mqttBroker: e.target.value })} style={{ fontSize: 13 }} />
                  <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>Env: MQTT_BROKER_URL</span>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Topic</label>
                  <input className="input" value={scadaForm.mqttTopic} onChange={e => setScadaForm({ ...scadaForm, mqttTopic: e.target.value })} style={{ fontSize: 13 }} />
                  <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>Env: MQTT_TOPIC_MEASUREMENTS</span>
                </div>
              </div>
            </div>

            {/* OPC-UA Config */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">🔌 Configuration OPC-UA</h3>
                <span className="badge badge-gold">node-opcua</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>
                    Endpoint OPC-UA
                  </label>
                  <input className="input" value={scadaForm.opcuaEndpoint} onChange={e => setScadaForm({ ...scadaForm, opcuaEndpoint: e.target.value })} style={{ fontSize: 13 }} />
                  <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>Env: OPCUA_ENDPOINT_URL</span>
                </div>
                <div className="grid-2" style={{ gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Namespace</label>
                    <input className="input" type="number" value={scadaForm.opcuaNamespace} onChange={e => setScadaForm({ ...scadaForm, opcuaNamespace: e.target.value })} style={{ fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Poll interval (ms)</label>
                    <input className="input" type="number" value={scadaForm.opcuaPollMs} onChange={e => setScadaForm({ ...scadaForm, opcuaPollMs: e.target.value })} style={{ fontSize: 13 }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Modbus Config */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">⚡ Configuration Modbus TCP</h3>
                <span className="badge badge-gold">TCP natif</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="grid-2" style={{ gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Hôte</label>
                    <input className="input" value={scadaForm.modbusHost} onChange={e => setScadaForm({ ...scadaForm, modbusHost: e.target.value })} style={{ fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Port</label>
                    <input className="input" type="number" value={scadaForm.modbusPort} onChange={e => setScadaForm({ ...scadaForm, modbusPort: e.target.value })} style={{ fontSize: 13 }} />
                  </div>
                </div>
                <div className="grid-2" style={{ gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Unit ID</label>
                    <input className="input" type="number" value={scadaForm.modbusUnitId} onChange={e => setScadaForm({ ...scadaForm, modbusUnitId: e.target.value })} style={{ fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Poll interval (ms)</label>
                    <input className="input" type="number" value={scadaForm.modbusPollMs} onChange={e => setScadaForm({ ...scadaForm, modbusPollMs: e.target.value })} style={{ fontSize: 13 }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Storage info */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">🗄️ Backend de Stockage</h3>
                <span className="badge badge-green">{healthData?.status || "—"}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { label: "Mode intégration", value: healthData?.integrationMode || "—" },
                  { label: "TimescaleDB", value: healthData?.components?.timescale?.status || "N/A" },
                  { label: "InfluxDB Mirror", value: healthData?.components?.influxMirror?.health?.status || "N/A" },
                  { label: "Rétention (jours)", value: healthData?.retentionDays || "—" },
                  { label: "Mode synthétique", value: healthData?.syntheticOnlyMode ? "Oui" : "Non" },
                  { label: "Batch runs", value: healthData?.activity?.counters?.batchRuns || 0 },
                  { label: "Messages MQTT", value: healthData?.activity?.counters?.mqttMessages || 0 },
                  { label: "Dernier batch", value: healthData?.activity?.lastBatchRunAt ? new Date(healthData.activity.lastBatchRunAt).toLocaleString("fr-FR") : "—" },
                ].map((item, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>{item.label}</span>
                    <span className="mono" style={{ color: "var(--text-primary)" }}>{String(item.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
