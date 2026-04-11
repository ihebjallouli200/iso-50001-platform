const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STORE_FILE = path.join(__dirname, "..", "data", "runtime_store.json");
const SESSION_TTL_HOURS = 12;

const DEFAULT_ACCOUNTS = [
  { username: "admin.energie", fullName: "Admin Énergie", role: "ADMIN_ENERGIE", password: "Admin50001!" },
  { username: "resp.site", fullName: "Responsable Site", role: "RESPONSABLE_SITE", password: "Site50001!" },
  { username: "auditeur.interne", fullName: "Auditeur Interne", role: "AUDITEUR", password: "Audit50001!" },
  { username: "operateur.l1", fullName: "Opérateur Ligne 1", role: "OPERATEUR", password: "Oper50001!" },
];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function nextId(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return 1;
  }

  return Math.max(...items.map(item => Number(item.id) || 0)) + 1;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildTimelineSeries(machineId, baseEnpi, basePowerKw) {
  const now = Date.now();
  const points = [];

  for (let index = 23; index >= 0; index -= 1) {
    const timestamp = new Date(now - index * 3600 * 1000).toISOString();
    const trend = (23 - index) * 0.003;
    const random = (Math.random() - 0.5) * 0.02;
    const enpi = Number((baseEnpi + trend + random).toFixed(2));
    const powerKw = Number((basePowerKw + trend * 90 + (Math.random() - 0.5) * 12).toFixed(1));
    const loadPct = Math.round(clamp(68 + trend * 40 + (Math.random() - 0.5) * 8, 25, 100));

    let eventType = "normal";
    let causeHint = "Charge nominale";
    let actionHint = "Maintenir réglages";

    if (enpi > baseEnpi + 0.08) {
      eventType = "drift";
      causeHint = "Dérive consigne / pression";
      actionHint = "Recalibrer et vérifier séquence";
    }
    if (powerKw > basePowerKw + 20) {
      eventType = "spike";
      causeHint = "Pic de démarrage";
      actionHint = "Lisser la rampe de montée";
    }

    points.push({
      id: machineId * 1000 + (24 - index),
      machineId,
      timestamp,
      enpi,
      powerKw,
      loadPct,
      eventType,
      causeHint,
      actionHint,
    });
  }

  return points;
}

function getDefaultExplainabilityContributions(machineId) {
  if (Number(machineId) === 1) {
    return [
      { variable: "thdVoltage", contribution: 0.34, direction: "increase" },
      { variable: "cosPhiVoltage", contribution: 0.26, direction: "decrease" },
      { variable: "oee", contribution: 0.22, direction: "decrease" },
      { variable: "kWh", contribution: 0.18, direction: "increase" },
    ];
  }
  if (Number(machineId) === 2) {
    return [
      { variable: "thdCurrent", contribution: 0.32, direction: "increase" },
      { variable: "kVA", contribution: 0.27, direction: "increase" },
      { variable: "cosPhiCurrent", contribution: 0.23, direction: "decrease" },
      { variable: "oee", contribution: 0.18, direction: "decrease" },
    ];
  }

  return [
    { variable: "loadPct", contribution: 0.31, direction: "increase" },
    { variable: "kWh", contribution: 0.25, direction: "increase" },
    { variable: "thdVoltage", contribution: 0.24, direction: "increase" },
    { variable: "oee", contribution: 0.20, direction: "decrease" },
  ];
}

function toIsoOrNull(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function createDefaultStore() {
  const users = DEFAULT_ACCOUNTS.map((account, index) => ({
    id: index + 1,
    openId: account.username,
    username: account.username,
    passwordHash: sha256(account.password),
    fullName: account.fullName,
    role: account.role,
    failedLoginCount: 0,
    isLocked: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastSignedIn: null,
  }));

  return {
    users,
    sessions: [],
    machines: [
      { id: 1, siteId: "SITE-01", siteName: "Site Principal", machineCode: "CMP-A", machineName: "Compresseur A", machineType: "compressor", isActive: true },
      { id: 2, siteId: "SITE-01", siteName: "Site Principal", machineCode: "FUR-C", machineName: "Four Industriel C", machineType: "furnace", isActive: true },
      { id: 3, siteId: "SITE-02", siteName: "Atelier B", machineCode: "CHL-B", machineName: "Groupe Froid B", machineType: "chiller", isActive: true },
    ],
    alerts: [
      { id: 1, machineId: 1, title: "Dérive consommation", message: "Écart > 7%", isRead: false, createdAt: nowIso() },
      { id: 2, machineId: 2, title: "THD élevé", message: "THD tension > seuil", isRead: false, createdAt: nowIso() },
    ],
    machineLive: [
      {
        id: 1,
        machineId: 1,
        powerKw: 312.4,
        enpi: 2.08,
        loadPct: 76,
        status: "running",
        updatedAt: nowIso(),
      },
      {
        id: 2,
        machineId: 2,
        powerKw: 446.2,
        enpi: 2.14,
        loadPct: 82,
        status: "running",
        updatedAt: nowIso(),
      },
      {
        id: 3,
        machineId: 3,
        powerKw: 228.3,
        enpi: 1.96,
        loadPct: 71,
        status: "running",
        updatedAt: nowIso(),
      },
    ],
    anomalies: [
      {
        id: 1,
        machineId: 1,
        type: "enpi_drift",
        severity: "major",
        title: "Dérive EnPI compresseur A",
        message: "EnPI au-dessus du seuil 2.05 depuis 25 min",
        metric: "enpi",
        observedValue: 2.12,
        threshold: 2.05,
        status: "open",
        detectedAt: nowIso(),
        acknowledgedAt: null,
        acknowledgedByUserId: null,
        acknowledgedByName: null,
        acknowledgementNote: null,
      },
      {
        id: 2,
        machineId: 2,
        type: "power_spike",
        severity: "minor",
        title: "Pic de puissance four C",
        message: "Puissance instantanée > 470 kW",
        metric: "powerKw",
        observedValue: 472.1,
        threshold: 470,
        status: "open",
        detectedAt: nowIso(),
        acknowledgedAt: null,
        acknowledgedByUserId: null,
        acknowledgedByName: null,
        acknowledgementNote: null,
      },
      {
        id: 3,
        machineId: 3,
        type: "load_instability",
        severity: "minor",
        title: "Instabilité charge groupe froid B",
        message: "Oscillation charge > 12% sur 15 min",
        metric: "loadPct",
        observedValue: 84,
        threshold: 72,
        status: "open",
        detectedAt: nowIso(),
        acknowledgedAt: null,
        acknowledgedByUserId: null,
        acknowledgedByName: null,
        acknowledgementNote: null,
      },
    ],
    energyTimeline: [
      ...buildTimelineSeries(1, 2.02, 308),
      ...buildTimelineSeries(2, 2.08, 438),
      ...buildTimelineSeries(3, 1.94, 224),
    ],
    causeActionCorrelations: [
      {
        id: 1,
        machineId: 1,
        cause: "Dérive pression réseau air",
        action: "Recalibrage capteur + réglage PID",
        correlationScore: 0.78,
        expectedGainPct: 3.4,
        evidenceCount: 12,
        linkedAnomalyType: "enpi_drift",
      },
      {
        id: 2,
        machineId: 1,
        cause: "Cycle charge/décharge instable",
        action: "Séquence anti-courts cycles",
        correlationScore: 0.69,
        expectedGainPct: 2.6,
        evidenceCount: 9,
        linkedAnomalyType: "power_spike",
      },
      {
        id: 3,
        machineId: 2,
        cause: "Excès harmonique THD",
        action: "Maintenance filtre harmonique",
        correlationScore: 0.74,
        expectedGainPct: 2.9,
        evidenceCount: 11,
        linkedAnomalyType: "power_spike",
      },
      {
        id: 4,
        machineId: 2,
        cause: "Profil thermique non stabilisé",
        action: "Réglage rampe four poste nuit",
        correlationScore: 0.66,
        expectedGainPct: 2.1,
        evidenceCount: 7,
        linkedAnomalyType: "enpi_drift",
      },
      {
        id: 5,
        machineId: 3,
        cause: "Cyclage compresseur froid",
        action: "Ajuster seuil anti-courts cycles",
        correlationScore: 0.72,
        expectedGainPct: 2.7,
        evidenceCount: 10,
        linkedAnomalyType: "load_instability",
      },
    ],
    recommendations: [
      {
        id: 1,
        machineId: 1,
        title: "Réduire pression de consigne compresseur A",
        justification: "Dérive EnPI observée avec surpression moyenne de +0.4 bar sur poste nuit.",
        estimatedImpact: {
          energySavingPct: 3.1,
          co2SavingKgMonth: 420,
          paybackMonths: 2.4,
        },
        confidenceScore: 0.81,
        status: "pending",
        createdAt: nowIso(),
        lastDecision: null,
        explainability: {
          modelVersion: "advisory-v1",
          variableContributions: getDefaultExplainabilityContributions(1),
        },
      },
      {
        id: 2,
        machineId: 2,
        title: "Planifier maintenance filtre harmonique four C",
        justification: "Pics THD corrélés aux surconsommations kWh sur 14 jours.",
        estimatedImpact: {
          energySavingPct: 2.7,
          co2SavingKgMonth: 360,
          paybackMonths: 3.1,
        },
        confidenceScore: 0.76,
        status: "pending",
        createdAt: nowIso(),
        lastDecision: null,
        explainability: {
          modelVersion: "advisory-v1",
          variableContributions: getDefaultExplainabilityContributions(2),
        },
      },
      {
        id: 3,
        machineId: 3,
        title: "Activer anti-courts cycles groupe froid B",
        justification: "Instabilité charge répétée avec oscillations > 12% détectées.",
        estimatedImpact: {
          energySavingPct: 2.2,
          co2SavingKgMonth: 280,
          paybackMonths: 1.8,
        },
        confidenceScore: 0.79,
        status: "pending",
        createdAt: nowIso(),
        lastDecision: null,
        explainability: {
          modelVersion: "advisory-v1",
          variableContributions: getDefaultExplainabilityContributions(3),
        },
      },
    ],
    recommendationDecisions: [],
    dataQualitySnapshots: [
      {
        id: 1,
        machineId: 1,
        sourceName: "synthetic_measurements.csv",
        batchId: "SYNTH-BATCH-2026-04-01-A",
        collectedAt: nowIso(),
        rowCount: 480,
        validRowCount: 470,
        missingRatePct: 1.9,
        typeErrorRatePct: 0.6,
        duplicateRatePct: 0.4,
        outlierRatePct: 1.2,
        qualityScore: 94.1,
        status: "good",
      },
      {
        id: 2,
        machineId: 2,
        sourceName: "synthetic_measurements.csv",
        batchId: "SYNTH-BATCH-2026-04-01-A",
        collectedAt: nowIso(),
        rowCount: 460,
        validRowCount: 432,
        missingRatePct: 3.8,
        typeErrorRatePct: 1.7,
        duplicateRatePct: 0.9,
        outlierRatePct: 2.2,
        qualityScore: 87.6,
        status: "warning",
      },
      {
        id: 3,
        machineId: 3,
        sourceName: "synthetic_measurements.csv",
        batchId: "SYNTH-BATCH-2026-04-01-B",
        collectedAt: nowIso(),
        rowCount: 420,
        validRowCount: 398,
        missingRatePct: 4.1,
        typeErrorRatePct: 1.9,
        duplicateRatePct: 1.1,
        outlierRatePct: 2.5,
        qualityScore: 85.8,
        status: "warning",
      },
    ],
    dataQualityIssues: [
      {
        id: 1,
        machineId: 2,
        category: "type_error",
        field: "cosPhiVoltage",
        severity: "major",
        status: "open",
        description: "Valeurs non numériques détectées sur 8 lignes du batch BATCH-2026-04-01-A.",
        sampleValue: "NaN",
        batchId: "BATCH-2026-04-01-A",
        detectedAt: nowIso(),
        lastSeenAt: nowIso(),
      },
      {
        id: 2,
        machineId: 3,
        category: "missing_values",
        field: "oee",
        severity: "minor",
        status: "open",
        description: "Taux de valeurs manquantes > 4% sur la plage atelier B.",
        sampleValue: "",
        batchId: "BATCH-2026-04-01-B",
        detectedAt: nowIso(),
        lastSeenAt: nowIso(),
      },
    ],
    importJournal: [
      {
        id: 1,
        sourceName: "Synthetic MQTT Site Principal",
        sourceType: "synthetic_mqtt",
        fileName: null,
        status: "success",
        startedAt: nowIso(),
        finishedAt: nowIso(),
        triggeredByUserId: 1,
        triggeredByName: "Admin Énergie",
        rowCount: 960,
        insertedRows: 960,
        rejectedRows: 0,
        qualityScore: 95.2,
        warningCount: 0,
        errorCount: 0,
        note: "Flux simulé MQTT terminé.",
      },
      {
        id: 2,
        sourceName: "Upload Synthetic CSV Atelier B",
        sourceType: "synthetic_csv",
        fileName: "synthetic_atelier_b_2026-04-02.csv",
        status: "warning",
        startedAt: nowIso(),
        finishedAt: nowIso(),
        triggeredByUserId: 2,
        triggeredByName: "Responsable Site",
        rowCount: 420,
        insertedRows: 398,
        rejectedRows: 22,
        qualityScore: 85.8,
        warningCount: 2,
        errorCount: 0,
        note: "Import synthétique partiel: lignes rejetées pour données manquantes/type.",
      },
    ],
    pdcaCycles: [
      {
        id: 1,
        machineId: 1,
        title: "Réduire dérive compresseur A",
        objective: "Réduire 5% de kWh/unité sur 30 jours",
        targetEnpi: 1.95,
        phase: "Check",
        status: "En validation",
        actions: [
          "Calibrage hebdomadaire capteur débit",
          "Réglage séquence démarrage compresseur",
        ],
        attachments: ["checklist_energie_compresseur.pdf"],
        createdBy: 2,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        closedAt: null,
        closeReason: null,
      },
      {
        id: 2,
        machineId: 2,
        title: "Améliorer facteur puissance four C",
        objective: "Maintenir cos phi > 0.95 sur poste nuit",
        targetEnpi: 2.02,
        phase: "Do",
        status: "En cours",
        actions: ["Audit harmonique", "Plan maintenance filtres"],
        attachments: ["rapport_harmonique_mars.pdf"],
        createdBy: 2,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        closedAt: null,
        closeReason: null,
      },
    ],
    approvals: [
      {
        id: 1,
        entityType: "DOCUMENT",
        entityId: 101,
        title: "Politique énergétique v2.3",
        requestedByUserId: 2,
        requestedByName: "Responsable Site",
        status: "pending",
        comment: "Mise à jour des objectifs 2026",
        decidedByUserId: null,
        decidedAt: null,
        createdAt: nowIso(),
      },
      {
        id: 2,
        entityType: "BASELINE",
        entityId: 202,
        title: "Baseline Four C Q2",
        requestedByUserId: 2,
        requestedByName: "Responsable Site",
        status: "pending",
        comment: "Validation référence post-maintenance",
        decidedByUserId: null,
        decidedAt: null,
        createdAt: nowIso(),
      },
    ],
    documentVersions: [
      {
        id: 1,
        documentType: "ENERGY_POLICY",
        title: "Politique énergétique",
        version: "v2.1",
        status: "approved",
        content: "Objectif: améliorer l'efficacité énergétique de 3%.\nPérimètre: site principal.\nResponsable: Responsable Site.",
        createdByUserId: 2,
        createdByName: "Responsable Site",
        createdAt: nowIso(),
      },
      {
        id: 2,
        documentType: "ENERGY_POLICY",
        title: "Politique énergétique",
        version: "v2.2",
        status: "approved",
        content: "Objectif: améliorer l'efficacité énergétique de 4%.\nPérimètre: site principal et atelier B.\nResponsable: Responsable Site.",
        createdByUserId: 2,
        createdByName: "Responsable Site",
        createdAt: nowIso(),
      },
      {
        id: 3,
        documentType: "ENPI_METHOD",
        title: "Méthode EnPI",
        version: "v1.0",
        status: "approved",
        content: "EnPI = kWh / unité produite.\nNormalisation: température et volume production.",
        createdByUserId: 1,
        createdByName: "Admin Énergie",
        createdAt: nowIso(),
      },
      {
        id: 4,
        documentType: "ENPI_METHOD",
        title: "Méthode EnPI",
        version: "v1.1",
        status: "in_review",
        content: "EnPI = kWh / unité produite.\nNormalisation: température, volume production et humidité.\nContrôle hebdomadaire qualité données.",
        createdByUserId: 1,
        createdByName: "Admin Énergie",
        createdAt: nowIso(),
      },
    ],
    auditMatrix: [
      {
        clause: "4.4",
        title: "Système de management de l'énergie",
        status: "covered",
        summary: "Périmètre EnMS défini avec responsabilités actives.",
        evidenceIds: [1, 2],
      },
      {
        clause: "6.4",
        title: "Indicateurs de performance énergétique (EnPI)",
        status: "covered",
        summary: "Méthode EnPI documentée et historique de calcul disponible.",
        evidenceIds: [3, 4],
      },
      {
        clause: "7.5",
        title: "Informations documentées",
        status: "partial",
        summary: "Versioning documentaire en place, contrôles d'approbation à renforcer.",
        evidenceIds: [5, 6],
      },
      {
        clause: "9.2",
        title: "Audit interne",
        status: "covered",
        summary: "Pré-audit consolidé avec piste de preuves navigables.",
        evidenceIds: [7, 8],
      },
      {
        clause: "10.2",
        title: "Amélioration continue",
        status: "partial",
        summary: "Actions correctives suivies, boucle de clôture en progression.",
        evidenceIds: [9, 10],
      },
    ],
    auditEvidence: [
      {
        id: 1,
        clause: "4.4",
        label: "Registre responsabilités énergétiques",
        sourceType: "responsibilities",
        sourceRef: "RESP-2026-01",
        status: "valid",
        updatedAt: nowIso(),
        details: "Attributions nominatives actives pour Admin Énergie et Responsable Site.",
      },
      {
        id: 2,
        clause: "4.4",
        label: "Périmètre EnMS validé",
        sourceType: "document",
        sourceRef: "Politique énergétique v2.2",
        status: "valid",
        updatedAt: nowIso(),
        details: "Périmètre incluant site principal et atelier B.",
      },
      {
        id: 3,
        clause: "6.4",
        label: "Historique EnPI machine",
        sourceType: "kpi",
        sourceRef: "EnPI-STREAM-7D",
        status: "valid",
        updatedAt: nowIso(),
        details: "Courbe 7 jours avec baseline normalisée et écarts associés.",
      },
      {
        id: 4,
        clause: "6.4",
        label: "Méthode EnPI v1.1",
        sourceType: "document",
        sourceRef: "ENPI_METHOD v1.1",
        status: "valid",
        updatedAt: nowIso(),
        details: "Document validant formule EnPI et facteurs de normalisation.",
      },
      {
        id: 5,
        clause: "7.5",
        label: "Historique versions politique",
        sourceType: "document_versions",
        sourceRef: "ENERGY_POLICY",
        status: "valid",
        updatedAt: nowIso(),
        details: "Versions v2.1 → v2.2 tracées avec auteurs.",
      },
      {
        id: 6,
        clause: "7.5",
        label: "Décisions d'approbation documentaire",
        sourceType: "approvals",
        sourceRef: "APPROVAL_QUEUE",
        status: "warning",
        updatedAt: nowIso(),
        details: "Une demande document en attente de décision finale.",
      },
      {
        id: 7,
        clause: "9.2",
        label: "Rapport pré-audit interne",
        sourceType: "report",
        sourceRef: "step5_advisory_gate_decision.md",
        status: "valid",
        updatedAt: nowIso(),
        details: "Rapport pré-audit compilé avec recommandations et décisions.",
      },
      {
        id: 8,
        clause: "9.2",
        label: "Traçabilité événements gouvernance",
        sourceType: "events",
        sourceRef: "governanceEvents",
        status: "valid",
        updatedAt: nowIso(),
        details: "Événements d'approbation et clôture PDCA horodatés.",
      },
      {
        id: 9,
        clause: "10.2",
        label: "Journal actions PDCA clôturées",
        sourceType: "pdca",
        sourceRef: "PDCA-CLOSE-LOG",
        status: "warning",
        updatedAt: nowIso(),
        details: "Boucle corrective active, 1 cycle en clôture récente.",
      },
      {
        id: 10,
        clause: "10.2",
        label: "Décisions utilisateur sur recommandations",
        sourceType: "recommendations",
        sourceRef: "REC-DECISION-QUEUE",
        status: "missing",
        updatedAt: nowIso(),
        details: "Traçage des décisions recommandations à compléter en V1.1.",
      },
    ],
    nonConformities: [
      {
        id: 1,
        clause: "7.5",
        title: "Validation documentaire incomplète",
        severity: "major",
        status: "open",
        description: "Une preuve documentaire est en attente d'approbation finale.",
        createdByUserId: 3,
        createdByName: "Auditeur Interne",
        createdAt: nowIso(),
        correctiveActions: [
          {
            id: 1,
            action: "Compléter la revue et valider le document ENPI_METHOD v1.1",
            owner: "Admin Énergie",
            dueDate: "2026-04-20",
            status: "in_progress",
            note: "Revue lancée",
            updatedAt: nowIso(),
          },
        ],
      },
      {
        id: 2,
        clause: "10.2",
        title: "Traçage décision recommandations incomplet",
        severity: "minor",
        status: "open",
        description: "Décisions utilisateur sur recommandations IA non systématiquement consignées.",
        createdByUserId: 3,
        createdByName: "Auditeur Interne",
        createdAt: nowIso(),
        correctiveActions: [
          {
            id: 1,
            action: "Activer la capture obligatoire de décision dans le dashboard",
            owner: "Responsable Site",
            dueDate: "2026-04-25",
            status: "open",
            note: "À démarrer",
            updatedAt: nowIso(),
          },
        ],
      },
    ],
    preAuditExports: [],
    governanceEvents: [],
    technicalIncidents: [
      {
        id: 1,
        component: "api_gateway",
        severity: "major",
        status: "open",
        title: "Latence élevée API /api/machines/live",
        description: "P95 > 450ms observé sur la dernière heure.",
        openedAt: nowIso(),
        acknowledgedAt: null,
        acknowledgedByUserId: null,
        acknowledgedByName: null,
        acknowledgementNote: null,
        escalatedAt: null,
        escalatedByUserId: null,
        escalatedByName: null,
        escalationReason: null,
        escalationTargetTeam: null,
      },
      {
        id: 2,
        component: "ingestion_worker",
        severity: "minor",
        status: "acknowledged",
        title: "Retard ingestion batch atelier B",
        description: "Un lot CSV est traité avec 18 minutes de retard.",
        openedAt: nowIso(),
        acknowledgedAt: nowIso(),
        acknowledgedByUserId: 2,
        acknowledgedByName: "Responsable Site",
        acknowledgementNote: "Investigation en cours sur connecteur CSV.",
        escalatedAt: null,
        escalatedByUserId: null,
        escalatedByName: null,
        escalationReason: null,
        escalationTargetTeam: null,
      },
      {
        id: 3,
        component: "worker_audit",
        severity: "critical",
        status: "escalated",
        title: "Échec génération dossier pré-audit",
        description: "Le worker audit a rejeté la génération pour timeout dépendance documentaire.",
        openedAt: nowIso(),
        acknowledgedAt: nowIso(),
        acknowledgedByUserId: 1,
        acknowledgedByName: "Admin Énergie",
        acknowledgementNote: "Incident confirmé, impact audit à surveiller.",
        escalatedAt: nowIso(),
        escalatedByUserId: 1,
        escalatedByName: "Admin Énergie",
        escalationReason: "Impact potentiel pré-audit ISO, action immédiate requise.",
        escalationTargetTeam: "Plateforme",
      },
    ],
  };
}

function ensureStoreFile() {
  if (!fs.existsSync(STORE_FILE)) {
    const dir = path.dirname(STORE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(createDefaultStore(), null, 2), "utf-8");
  }
}

function loadStore() {
  ensureStoreFile();
  const store = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8"));

  let updated = false;
  if (!Array.isArray(store.pdcaCycles)) {
    store.pdcaCycles = createDefaultStore().pdcaCycles;
    updated = true;
  }
  if (!Array.isArray(store.approvals)) {
    store.approvals = createDefaultStore().approvals;
    updated = true;
  }
  if (!Array.isArray(store.governanceEvents)) {
    store.governanceEvents = [];
    updated = true;
  }
  if (!Array.isArray(store.documentVersions)) {
    store.documentVersions = createDefaultStore().documentVersions;
    updated = true;
  }
  if (!Array.isArray(store.auditMatrix)) {
    store.auditMatrix = createDefaultStore().auditMatrix;
    updated = true;
  }
  if (!Array.isArray(store.auditEvidence)) {
    store.auditEvidence = createDefaultStore().auditEvidence;
    updated = true;
  }
  if (!Array.isArray(store.nonConformities)) {
    store.nonConformities = createDefaultStore().nonConformities;
    updated = true;
  }
  if (!Array.isArray(store.preAuditExports)) {
    store.preAuditExports = [];
    updated = true;
  }
  if (!Array.isArray(store.machineLive)) {
    store.machineLive = createDefaultStore().machineLive;
    updated = true;
  }
  if (!Array.isArray(store.anomalies)) {
    store.anomalies = createDefaultStore().anomalies;
    updated = true;
  }
  if (!Array.isArray(store.energyTimeline)) {
    store.energyTimeline = createDefaultStore().energyTimeline;
    updated = true;
  }
  if (!Array.isArray(store.causeActionCorrelations)) {
    store.causeActionCorrelations = createDefaultStore().causeActionCorrelations;
    updated = true;
  }
  if (!Array.isArray(store.recommendations)) {
    store.recommendations = createDefaultStore().recommendations;
    updated = true;
  }
  if (!Array.isArray(store.recommendationDecisions)) {
    store.recommendationDecisions = [];
    updated = true;
  }
  if (!Array.isArray(store.dataQualitySnapshots)) {
    store.dataQualitySnapshots = createDefaultStore().dataQualitySnapshots;
    updated = true;
  }
  if (!Array.isArray(store.dataQualityIssues)) {
    store.dataQualityIssues = createDefaultStore().dataQualityIssues;
    updated = true;
  }
  if (!Array.isArray(store.importJournal)) {
    store.importJournal = createDefaultStore().importJournal;
    updated = true;
  }
  if (!Array.isArray(store.technicalIncidents)) {
    store.technicalIncidents = createDefaultStore().technicalIncidents;
    updated = true;
  }
  if (Array.isArray(store.recommendations)) {
    let recommendationsUpdated = false;
    store.recommendations = store.recommendations.map(item => {
      const nextItem = { ...item };
      if (!nextItem.status) {
        nextItem.status = "pending";
        recommendationsUpdated = true;
      }
      if (!Object.prototype.hasOwnProperty.call(nextItem, "lastDecision")) {
        nextItem.lastDecision = null;
        recommendationsUpdated = true;
      }
      if (!nextItem.explainability || !Array.isArray(nextItem.explainability.variableContributions)) {
        nextItem.explainability = {
          modelVersion: "advisory-v1",
          variableContributions: getDefaultExplainabilityContributions(nextItem.machineId),
        };
        recommendationsUpdated = true;
      }
      return nextItem;
    });
    if (recommendationsUpdated) {
      updated = true;
    }
  }
  if (Array.isArray(store.machines)) {
    let machineUpdated = false;
    store.machines = store.machines.map(machine => {
      const nextMachine = { ...machine };
      if (!nextMachine.siteName) {
        nextMachine.siteName = nextMachine.siteId === "SITE-02" ? "Atelier B" : "Site Principal";
        machineUpdated = true;
      }
      return nextMachine;
    });
    if (machineUpdated) {
      updated = true;
    }
  }

  const hasSite02Machine = (store.machines || []).some(machine => machine.siteId === "SITE-02");
  if (!hasSite02Machine) {
    const machineId = nextId(store.machines || []);
    const machine = {
      id: machineId,
      siteId: "SITE-02",
      siteName: "Atelier B",
      machineCode: "CHL-B",
      machineName: "Groupe Froid B",
      machineType: "chiller",
      isActive: true,
      createdAt: nowIso(),
    };
    store.machines = store.machines || [];
    store.machines.push(machine);

    store.machineLive = store.machineLive || [];
    store.machineLive.push({
      id: nextId(store.machineLive),
      machineId,
      powerKw: 228.3,
      enpi: 1.96,
      loadPct: 71,
      status: "running",
      updatedAt: nowIso(),
    });

    store.anomalies = store.anomalies || [];
    store.anomalies.push({
      id: nextId(store.anomalies),
      machineId,
      type: "load_instability",
      severity: "minor",
      title: "Instabilité charge groupe froid B",
      message: "Oscillation charge > 12% sur 15 min",
      metric: "loadPct",
      observedValue: 84,
      threshold: 72,
      status: "open",
      detectedAt: nowIso(),
      acknowledgedAt: null,
      acknowledgedByUserId: null,
      acknowledgedByName: null,
      acknowledgementNote: null,
    });

    store.energyTimeline = store.energyTimeline || [];
    store.energyTimeline.push(...buildTimelineSeries(machineId, 1.94, 224));

    store.causeActionCorrelations = store.causeActionCorrelations || [];
    store.causeActionCorrelations.push({
      id: nextId(store.causeActionCorrelations),
      machineId,
      cause: "Cyclage compresseur froid",
      action: "Ajuster seuil anti-courts cycles",
      correlationScore: 0.72,
      expectedGainPct: 2.7,
      evidenceCount: 10,
      linkedAnomalyType: "load_instability",
    });

    updated = true;
  }

  if (updated) {
    saveStore(store);
  }

  return store;
}

function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function login(username, password, metadata = {}) {
  const store = loadStore();
  const user = store.users.find(candidate => candidate.username === username);

  if (!user || user.isLocked) {
    return null;
  }

  if (user.passwordHash !== sha256(password)) {
    user.failedLoginCount += 1;
    if (user.failedLoginCount >= 5) {
      user.isLocked = true;
    }
    user.updatedAt = nowIso();
    saveStore(store);
    return null;
  }

  user.failedLoginCount = 0;
  user.isLocked = false;
  user.lastSignedIn = nowIso();
  user.updatedAt = nowIso();

  const sessionToken = generateSessionToken();
  const session = {
    id: store.sessions.length + 1,
    tokenHash: sha256(sessionToken),
    userId: user.id,
    issuedAt: nowIso(),
    expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString(),
    revokedAt: null,
    userAgent: metadata.userAgent || null,
    ipAddress: metadata.ipAddress || null,
  };

  store.sessions.push(session);
  saveStore(store);

  return {
    sessionToken,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      lastSignedIn: user.lastSignedIn,
    },
    expiresAt: session.expiresAt,
  };
}

function getSessionUser(sessionToken) {
  const store = loadStore();
  const tokenHash = sha256(sessionToken);
  const session = store.sessions.find(entry => entry.tokenHash === tokenHash);

  if (!session || session.revokedAt) {
    return null;
  }

  if (new Date(session.expiresAt).getTime() < Date.now()) {
    return null;
  }

  const user = store.users.find(candidate => candidate.id === session.userId);
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    sessionExpiresAt: session.expiresAt,
    lastSignedIn: user.lastSignedIn,
  };
}

function revokeSession(sessionToken) {
  const store = loadStore();
  const tokenHash = sha256(sessionToken);
  const session = store.sessions.find(entry => entry.tokenHash === tokenHash);

  if (!session) {
    return false;
  }

  session.revokedAt = nowIso();
  saveStore(store);
  return true;
}

function listMachines() {
  const store = loadStore();
  return store.machines.filter(machine => machine.isActive !== false);
}

function createMachine(input) {
  const store = loadStore();
  const machine = {
    id: nextId(store.machines),
    siteId: input.siteId,
    machineCode: input.machineCode,
    machineName: input.machineName,
    machineType: input.machineType || null,
    location: input.location || null,
    nominalPower: input.nominalPower || null,
    isActive: true,
    createdAt: nowIso(),
  };
  store.machines.push(machine);
  saveStore(store);
  return machine;
}

function getUnreadAlerts() {
  const store = loadStore();
  return store.alerts.filter(alert => !alert.isRead);
}

function markAlertAsRead(alertId) {
  const store = loadStore();
  const alert = store.alerts.find(item => item.id === alertId);
  if (!alert) {
    return null;
  }

  alert.isRead = true;
  alert.acknowledgedAt = nowIso();
  saveStore(store);
  return alert;
}

function listMachineLiveSnapshot(filters = {}) {
  const store = loadStore();

  store.machineLive = (store.machineLive || []).map(item => {
    const powerDelta = (Math.random() - 0.5) * 8;
    const enpiDelta = (Math.random() - 0.5) * 0.04;
    const loadDelta = (Math.random() - 0.5) * 4;

    const powerKw = Number(clamp((Number(item.powerKw) || 0) + powerDelta, 120, 640).toFixed(1));
    const enpi = Number(clamp((Number(item.enpi) || 0) + enpiDelta, 1.6, 2.6).toFixed(2));
    const loadPct = Math.round(clamp((Number(item.loadPct) || 0) + loadDelta, 15, 100));

    let status = "running";
    if (loadPct < 25) {
      status = "idle";
    }
    if (enpi > 2.25) {
      status = "degraded";
    }

    return {
      ...item,
      powerKw,
      enpi,
      loadPct,
      status,
      updatedAt: nowIso(),
    };
  });

  saveStore(store);

  const machines = store.machines || [];
  const siteId = filters.siteId ? String(filters.siteId) : null;
  const machineId = Number(filters.machineId || 0);

  return [...store.machineLive]
    .map(item => {
      const machine = machines.find(entry => Number(entry.id) === Number(item.machineId));
      return {
        ...item,
        siteId: machine?.siteId || null,
        siteName: machine?.siteName || null,
        machineCode: machine?.machineCode || `M-${item.machineId}`,
        machineName: machine?.machineName || "Machine inconnue",
        machineType: machine?.machineType || null,
      };
    })
    .filter(item => (siteId ? item.siteId === siteId : true))
    .filter(item => (machineId > 0 ? Number(item.machineId) === machineId : true))
    .sort((a, b) => Number(a.machineId) - Number(b.machineId));
}

function listAnomalies(statusOrFilters = null) {
  const store = loadStore();
  const machines = store.machines || [];

  let status = null;
  let siteId = null;
  let machineId = null;

  if (typeof statusOrFilters === "string") {
    status = statusOrFilters;
  } else if (statusOrFilters && typeof statusOrFilters === "object") {
    status = statusOrFilters.status || null;
    siteId = statusOrFilters.siteId ? String(statusOrFilters.siteId) : null;
    machineId = Number(statusOrFilters.machineId || 0);
  }

  return [...(store.anomalies || [])]
    .filter(item => (status ? item.status === status : true))
    .map(item => {
      const machine = machines.find(entry => Number(entry.id) === Number(item.machineId));
      return {
        ...item,
        siteId: machine?.siteId || null,
        siteName: machine?.siteName || null,
        machineCode: machine?.machineCode || `M-${item.machineId}`,
        machineName: machine?.machineName || "Machine inconnue",
      };
    })
    .filter(item => (siteId ? item.siteId === siteId : true))
    .filter(item => (machineId > 0 ? Number(item.machineId) === machineId : true))
    .sort((a, b) => Number(b.id) - Number(a.id));
}

function listSites() {
  const store = loadStore();
  const unique = new Map();

  for (const machine of store.machines || []) {
    if (!unique.has(machine.siteId)) {
      unique.set(machine.siteId, {
        siteId: machine.siteId,
        siteName: machine.siteName || machine.siteId,
      });
    }
  }

  return [...unique.values()].sort((a, b) => a.siteId.localeCompare(b.siteId));
}

function listSiteComparison(windowHours = 24) {
  const store = loadStore();
  const safeWindow = clamp(Number(windowHours) || 24, 6, 48);
  const sites = listSites();

  return sites.map(site => {
    const machineIds = (store.machines || [])
      .filter(machine => machine.siteId === site.siteId)
      .map(machine => Number(machine.id));

    const liveRows = (store.machineLive || []).filter(item => machineIds.includes(Number(item.machineId)));
    const avgCurrentEnpi = liveRows.length > 0
      ? Number((liveRows.reduce((sum, row) => sum + Number(row.enpi || 0), 0) / liveRows.length).toFixed(2))
      : null;

    const avgCurrentPowerKw = liveRows.length > 0
      ? Number((liveRows.reduce((sum, row) => sum + Number(row.powerKw || 0), 0) / liveRows.length).toFixed(1))
      : null;

    const timelineRows = [...(store.energyTimeline || [])]
      .filter(item => machineIds.includes(Number(item.machineId)))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(-safeWindow * Math.max(1, machineIds.length));

    const baselineRows = timelineRows.slice(0, Math.max(1, Math.floor(timelineRows.length / 2)));
    const baselineEnpi = baselineRows.length > 0
      ? baselineRows.reduce((sum, row) => sum + Number(row.enpi || 0), 0) / baselineRows.length
      : null;

    const deltaPct = baselineEnpi && avgCurrentEnpi
      ? Number((((avgCurrentEnpi - baselineEnpi) / baselineEnpi) * 100).toFixed(1))
      : null;

    const openAnomalies = (store.anomalies || []).filter(item => item.status === "open" && machineIds.includes(Number(item.machineId))).length;

    return {
      siteId: site.siteId,
      siteName: site.siteName,
      machineCount: machineIds.length,
      avgCurrentEnpi,
      avgCurrentPowerKw,
      baselineEnpi: baselineEnpi ? Number(baselineEnpi.toFixed(2)) : null,
      enpiDeltaPct: deltaPct,
      openAnomalies,
      windowHours: safeWindow,
    };
  });
}

function acknowledgeAnomaly(anomalyId, note, user) {
  const store = loadStore();
  const anomaly = (store.anomalies || []).find(item => Number(item.id) === Number(anomalyId));
  if (!anomaly) {
    return null;
  }

  anomaly.status = "acknowledged";
  anomaly.acknowledgedAt = nowIso();
  anomaly.acknowledgedByUserId = user.id;
  anomaly.acknowledgedByName = user.fullName;
  anomaly.acknowledgementNote = note;

  saveStore(store);
  return anomaly;
}

function createAnomaly(input = {}) {
  const store = loadStore();
  const anomaly = {
    id: nextId(store.anomalies || []),
    machineId: Number(input.machineId),
    type: String(input.type || "ml_sequential_drift"),
    severity: String(input.severity || "minor"),
    title: String(input.title || "Anomalie detectee"),
    message: String(input.message || "Anomalie detectee par le service d'inference."),
    metric: String(input.metric || "ml_anomaly_score"),
    observedValue: Number(input.observedValue || 0),
    threshold: Number(input.threshold || 0),
    status: "open",
    detectedAt: toIsoOrNull(input.detectedAt) || nowIso(),
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    acknowledgedByName: null,
    acknowledgementNote: null,
    modelVersion: input.modelVersion ? String(input.modelVersion) : null,
    inferenceId: input.inferenceId ? String(input.inferenceId) : null,
    explainability: input.explainability && typeof input.explainability === "object" ? input.explainability : null,
  };

  store.anomalies = store.anomalies || [];
  store.anomalies.push(anomaly);
  saveStore(store);
  return anomaly;
}

function createRecommendationFromAnomaly(anomaly, user) {
  const store = loadStore();
  const machineId = Number(anomaly?.machineId || 0);
  if (!Number.isFinite(machineId) || machineId <= 0) {
    return null;
  }

  const correlation = [...(store.causeActionCorrelations || [])]
    .filter(item => Number(item.machineId) === machineId)
    .sort((a, b) => Number(b.correlationScore || 0) - Number(a.correlationScore || 0))[0] || null;

  const observedValue = Number(anomaly?.observedValue || 0);
  const threshold = Number(anomaly?.threshold || 0);
  const topVariable = anomaly?.explainability?.topContributions?.[0]?.variable || "signal_principal";

  const recommendation = {
    id: nextId(store.recommendations || []),
    machineId,
    title: correlation
      ? `Action ML: ${correlation.action}`
      : "Action ML: analyser derive et stabiliser les parametres process",
    justification: correlation
      ? `Anomalie ML detectee (score ${observedValue.toFixed(3)} > seuil ${threshold.toFixed(3)}). Cause probable: ${correlation.cause}.`
      : `Anomalie ML detectee (score ${observedValue.toFixed(3)} > seuil ${threshold.toFixed(3)}).`,
    estimatedImpact: {
      energySavingPct: correlation ? Number(correlation.expectedGainPct || 0) : 2.0,
      co2SavingKgMonth: correlation ? Math.round(Number(correlation.expectedGainPct || 0) * 120) : 240,
      paybackMonths: 3.0,
    },
    confidenceScore: Number(Math.min(0.95, Math.max(0.5, observedValue))),
    status: "pending",
    createdAt: nowIso(),
    lastDecision: null,
    explainability: {
      modelVersion: anomaly?.modelVersion || "anomaly-sequential",
      variableContributions: [
        {
          variable: String(topVariable),
          contribution: 0.5,
          direction: "increase",
        },
      ],
      linkedAnomalyId: anomaly?.id || null,
      generatedBy: user?.fullName || "system",
    },
  };

  store.recommendations = store.recommendations || [];
  store.recommendations.push(recommendation);
  saveStore(store);
  return recommendation;
}

function listEnergyTimeline(machineId, windowHours = 24) {
  const store = loadStore();
  const points = [...(store.energyTimeline || [])]
    .filter(item => Number(item.machineId) === Number(machineId))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const safeWindow = clamp(Number(windowHours) || 24, 6, 48);
  return points.slice(-safeWindow);
}

function listCauseActionCorrelations(machineId) {
  const store = loadStore();

  return [...(store.causeActionCorrelations || [])]
    .filter(item => Number(item.machineId) === Number(machineId))
    .sort((a, b) => Number(b.correlationScore) - Number(a.correlationScore));
}

function listRecommendations(filters = {}) {
  const store = loadStore();
  const machines = store.machines || [];
  const machineId = Number(filters.machineId || 0);
  const status = filters.status ? String(filters.status) : null;

  return [...(store.recommendations || [])]
    .filter(item => (machineId > 0 ? Number(item.machineId) === machineId : true))
    .filter(item => (status ? item.status === status : true))
    .map(item => {
      const machine = machines.find(entry => Number(entry.id) === Number(item.machineId));
      return {
        ...item,
        machineCode: machine?.machineCode || `M-${item.machineId}`,
        machineName: machine?.machineName || "Machine inconnue",
        siteId: machine?.siteId || null,
      };
    })
    .sort((a, b) => Number(b.id) - Number(a.id));
}

function decideRecommendation(recommendationId, decision, comment, user) {
  const store = loadStore();
  const recommendation = (store.recommendations || []).find(item => Number(item.id) === Number(recommendationId));
  if (!recommendation) {
    return null;
  }

  const decisionItem = {
    id: nextId(store.recommendationDecisions || []),
    recommendationId: recommendation.id,
    decision,
    comment,
    decidedByUserId: user.id,
    decidedByName: user.fullName,
    decidedAt: nowIso(),
  };

  recommendation.status = decision;
  recommendation.lastDecision = decisionItem;

  store.recommendationDecisions = store.recommendationDecisions || [];
  store.recommendationDecisions.push(decisionItem);
  saveStore(store);

  return {
    recommendation,
    decision: decisionItem,
  };
}

function listRecommendationDecisionHistory(filters = {}) {
  const store = loadStore();
  const machineId = Number(filters.machineId || 0);
  const recommendations = store.recommendations || [];
  const machines = store.machines || [];

  return [...(store.recommendationDecisions || [])]
    .map(item => {
      const recommendation = recommendations.find(rec => Number(rec.id) === Number(item.recommendationId));
      const machine = machines.find(m => Number(m.id) === Number(recommendation?.machineId));
      return {
        ...item,
        recommendationTitle: recommendation?.title || "Recommandation inconnue",
        machineId: recommendation?.machineId || null,
        machineCode: machine?.machineCode || null,
        machineName: machine?.machineName || null,
      };
    })
    .filter(item => (machineId > 0 ? Number(item.machineId) === machineId : true))
    .sort((a, b) => Number(b.id) - Number(a.id));
}

function getRecommendationAdoptionSummary(filters = {}) {
  const store = loadStore();
  const machineId = Number(filters.machineId || 0);

  const recommendations = [...(store.recommendations || [])]
    .filter(item => (machineId > 0 ? Number(item.machineId) === machineId : true));

  const total = recommendations.length;
  const accepted = recommendations.filter(item => item.status === "accepted").length;
  const rejected = recommendations.filter(item => item.status === "rejected").length;
  const deferred = recommendations.filter(item => item.status === "deferred").length;
  const pending = recommendations.filter(item => item.status === "pending" || !item.status).length;
  const decided = accepted + rejected + deferred;

  return {
    machineId: machineId > 0 ? machineId : null,
    total,
    accepted,
    rejected,
    deferred,
    pending,
    decided,
    adoptionRatePct: total > 0 ? Number(((accepted / total) * 100).toFixed(1)) : 0,
    decisionCoveragePct: total > 0 ? Number(((decided / total) * 100).toFixed(1)) : 0,
  };
}

function getRecommendationExplainability(recommendationId) {
  const store = loadStore();
  const recommendation = (store.recommendations || []).find(item => Number(item.id) === Number(recommendationId));
  if (!recommendation) {
    return null;
  }

  const machine = (store.machines || []).find(item => Number(item.id) === Number(recommendation.machineId));
  const variableContributions = Array.isArray(recommendation.explainability?.variableContributions)
    ? [...recommendation.explainability.variableContributions]
        .sort((a, b) => Number(b.contribution || 0) - Number(a.contribution || 0))
    : getDefaultExplainabilityContributions(recommendation.machineId);

  return {
    recommendationId: recommendation.id,
    title: recommendation.title,
    machineId: recommendation.machineId,
    machineCode: machine?.machineCode || null,
    machineName: machine?.machineName || null,
    modelVersion: recommendation.explainability?.modelVersion || "advisory-v1",
    variableContributions,
  };
}

function listDataQualitySummary(filters = {}) {
  const store = loadStore();
  const siteId = filters.siteId ? String(filters.siteId) : null;
  const machineId = Number(filters.machineId || 0);
  const machines = store.machines || [];
  const snapshots = store.dataQualitySnapshots || [];
  const issues = store.dataQualityIssues || [];

  const latestSnapshotByMachine = new Map();
  for (const snapshot of snapshots) {
    const current = latestSnapshotByMachine.get(Number(snapshot.machineId));
    const snapshotTime = new Date(snapshot.collectedAt || 0).getTime();
    const currentTime = current ? new Date(current.collectedAt || 0).getTime() : 0;
    if (!current || snapshotTime >= currentTime) {
      latestSnapshotByMachine.set(Number(snapshot.machineId), snapshot);
    }
  }

  return [...latestSnapshotByMachine.values()]
    .map(snapshot => {
      const machine = machines.find(item => Number(item.id) === Number(snapshot.machineId));
      const machineIssues = issues.filter(item => Number(item.machineId) === Number(snapshot.machineId));
      const openIssues = machineIssues.filter(item => item.status === "open").length;
      const majorIssues = machineIssues.filter(item => item.status === "open" && item.severity === "major").length;

      return {
        machineId: snapshot.machineId,
        machineCode: machine?.machineCode || `M-${snapshot.machineId}`,
        machineName: machine?.machineName || "Machine inconnue",
        siteId: machine?.siteId || null,
        siteName: machine?.siteName || null,
        sourceName: snapshot.sourceName || null,
        batchId: snapshot.batchId || null,
        collectedAt: snapshot.collectedAt || null,
        rowCount: Number(snapshot.rowCount || 0),
        validRowCount: Number(snapshot.validRowCount || 0),
        missingRatePct: Number(snapshot.missingRatePct || 0),
        typeErrorRatePct: Number(snapshot.typeErrorRatePct || 0),
        duplicateRatePct: Number(snapshot.duplicateRatePct || 0),
        outlierRatePct: Number(snapshot.outlierRatePct || 0),
        qualityScore: Number(snapshot.qualityScore || 0),
        status: snapshot.status || "warning",
        openIssues,
        majorIssues,
      };
    })
    .filter(item => (siteId ? item.siteId === siteId : true))
    .filter(item => (machineId > 0 ? Number(item.machineId) === machineId : true))
    .sort((a, b) => Number(a.machineId) - Number(b.machineId));
}

function listDataQualityIssues(filters = {}) {
  const store = loadStore();
  const machines = store.machines || [];
  const machineId = Number(filters.machineId || 0);
  const siteId = filters.siteId ? String(filters.siteId) : null;
  const status = filters.status ? String(filters.status) : null;
  const severity = filters.severity ? String(filters.severity) : null;
  const limit = Number.isFinite(Number(filters.limit)) ? clamp(Number(filters.limit), 1, 500) : null;
  const offset = Number.isFinite(Number(filters.offset)) ? clamp(Number(filters.offset), 0, 100000) : 0;

  const items = [...(store.dataQualityIssues || [])]
    .map(item => {
      const machine = machines.find(entry => Number(entry.id) === Number(item.machineId));
      return {
        ...item,
        machineCode: machine?.machineCode || `M-${item.machineId}`,
        machineName: machine?.machineName || "Machine inconnue",
        siteId: machine?.siteId || null,
        siteName: machine?.siteName || null,
      };
    })
    .filter(item => (machineId > 0 ? Number(item.machineId) === machineId : true))
    .filter(item => (siteId ? item.siteId === siteId : true))
    .filter(item => (status ? item.status === status : true))
    .filter(item => (severity ? item.severity === severity : true))
    .sort((a, b) => Number(b.id) - Number(a.id));

  if (!Number.isFinite(limit)) {
    return items;
  }

  const pagedItems = items.slice(offset, offset + limit);
  if (filters.paginationMode === "meta") {
    const hasNext = offset + pagedItems.length < items.length;
    const hasPrevious = offset > 0;
    return {
      items: pagedItems,
      total: items.length,
      count: pagedItems.length,
      limit,
      offset,
      hasNext,
      hasPrevious,
    };
  }

  return pagedItems;
}

function listImportJournal(filters = {}) {
  const store = loadStore();
  const status = filters.status ? String(filters.status) : null;
  const sourceType = filters.sourceType ? String(filters.sourceType) : null;
  const limit = Number.isFinite(Number(filters.limit)) ? clamp(Number(filters.limit), 1, 500) : null;
  const offset = Number.isFinite(Number(filters.offset)) ? clamp(Number(filters.offset), 0, 100000) : 0;

  const items = [...(store.importJournal || [])]
    .filter(item => (status ? item.status === status : true))
    .filter(item => (sourceType ? item.sourceType === sourceType : true))
    .sort((a, b) => Number(b.id) - Number(a.id));

  if (!Number.isFinite(limit)) {
    return items;
  }

  const pagedItems = items.slice(offset, offset + limit);
  if (filters.paginationMode === "meta") {
    const hasNext = offset + pagedItems.length < items.length;
    const hasPrevious = offset > 0;
    return {
      items: pagedItems,
      total: items.length,
      count: pagedItems.length,
      limit,
      offset,
      hasNext,
      hasPrevious,
    };
  }

  return pagedItems;
}

function listDataRejections(filters = {}) {
  const store = loadStore();
  const machineId = Number(filters.machineId || 0);
  const siteId = filters.siteId ? String(filters.siteId) : null;
  const machines = store.machines || [];
  const limit = Number.isFinite(Number(filters.limit)) ? clamp(Number(filters.limit), 1, 500) : null;
  const offset = Number.isFinite(Number(filters.offset)) ? clamp(Number(filters.offset), 0, 100000) : 0;

  const buildGuide = issue => {
    if (issue.category === "type_error") {
      return "Vérifier le mapping de types sur le champ et remplacer les valeurs non numériques.";
    }
    if (issue.category === "missing_values") {
      return "Compléter la source en amont ou appliquer une stratégie d'imputation validée.";
    }
    if (issue.category === "import_failure") {
      return "Rejouer l'import après correction du fichier source et validation du schéma.";
    }
    if (issue.category === "rejected_rows") {
      return "Isoler les lignes rejetées, corriger les colonnes invalides, puis réimporter.";
    }
    return "Analyser la cause et appliquer la correction standard du playbook data.";
  };

  const items = [...(store.dataQualityIssues || [])]
    .filter(issue => issue.status === "open")
    .map(issue => {
      const machine = machines.find(item => Number(item.id) === Number(issue.machineId));
      return {
        ...issue,
        machineCode: machine?.machineCode || `M-${issue.machineId}`,
        machineName: machine?.machineName || "Machine inconnue",
        siteId: machine?.siteId || null,
        siteName: machine?.siteName || null,
        correctionGuide: buildGuide(issue),
      };
    })
    .filter(item => (machineId > 0 ? Number(item.machineId) === machineId : true))
    .filter(item => (siteId ? item.siteId === siteId : true))
    .sort((a, b) => Number(b.id) - Number(a.id));

  if (!Number.isFinite(limit)) {
    return items;
  }

  const pagedItems = items.slice(offset, offset + limit);
  if (filters.paginationMode === "meta") {
    const hasNext = offset + pagedItems.length < items.length;
    const hasPrevious = offset > 0;
    return {
      items: pagedItems,
      total: items.length,
      count: pagedItems.length,
      limit,
      offset,
      hasNext,
      hasPrevious,
    };
  }

  return pagedItems;
}

function resolveDataRejection(issueId, resolutionCode, resolutionNote, user) {
  const store = loadStore();
  const issue = (store.dataQualityIssues || []).find(item => Number(item.id) === Number(issueId));
  if (!issue) {
    return null;
  }

  issue.status = "resolved";
  issue.resolutionCode = resolutionCode;
  issue.resolutionNote = resolutionNote;
  issue.resolvedAt = nowIso();
  issue.resolvedByUserId = user.id;
  issue.resolvedByName = user.fullName;
  issue.lastSeenAt = nowIso();

  const latestSnapshot = [...(store.dataQualitySnapshots || [])]
    .filter(item => Number(item.machineId) === Number(issue.machineId))
    .sort((a, b) => new Date(b.collectedAt || 0).getTime() - new Date(a.collectedAt || 0).getTime())[0];

  if (latestSnapshot) {
    latestSnapshot.qualityScore = Number(clamp(Number(latestSnapshot.qualityScore || 0) + 0.8, 0, 100).toFixed(1));
    latestSnapshot.status = latestSnapshot.qualityScore >= 90 ? "good" : "warning";
  }

  saveStore(store);
  return issue;
}

function getPlatformHealthSummary() {
  const store = loadStore();
  const now = Date.now();
  const dayAgo = now - 24 * 3600 * 1000;
  const imports = store.importJournal || [];
  const exports = store.preAuditExports || [];
  const openIssues = (store.dataQualityIssues || []).filter(item => item.status === "open");

  const recentImports = imports.filter(item => new Date(item.startedAt || 0).getTime() >= dayAgo);
  const failedImports = recentImports.filter(item => item.status === "failed").length;
  const warningImports = recentImports.filter(item => item.status === "warning").length;
  const latestImport = [...imports]
    .sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime())[0] || null;

  const latestExport = [...exports]
    .sort((a, b) => new Date(b.generatedAt || 0).getTime() - new Date(a.generatedAt || 0).getTime())[0] || null;

  const ingestionStatus = failedImports > 0 ? "degraded" : warningImports > 0 ? "warning" : "healthy";
  const workerAuditStatus = latestExport ? "healthy" : "warning";

  return {
    ingestion: {
      status: ingestionStatus,
      imports24h: recentImports.length,
      failedImports24h: failedImports,
      warningImports24h: warningImports,
      openDataIssues: openIssues.length,
      lastImportAt: latestImport?.startedAt || null,
      lastImportStatus: latestImport?.status || null,
    },
    workerAudit: {
      status: workerAuditStatus,
      exportsCount: exports.length,
      lastPreAuditExportAt: latestExport?.generatedAt || null,
      lastPreAuditExportId: latestExport?.id || null,
    },
  };
}

function getSloDashboard(windowHours = 24) {
  const store = loadStore();
  const safeWindowHours = clamp(Number(windowHours) || 24, 6, 168);
  const now = Date.now();
  const lowerBound = now - safeWindowHours * 3600 * 1000;

  const incidents = store.technicalIncidents || [];
  const imports = store.importJournal || [];
  const snapshots = store.dataQualitySnapshots || [];
  const recommendations = store.recommendations || [];
  const decisions = store.recommendationDecisions || [];
  const pdcaCycles = store.pdcaCycles || [];

  const windowIncidents = incidents.filter(item => new Date(item.openedAt || 0).getTime() >= lowerBound);
  const apiCriticalOpen = incidents.filter(item => item.component === "api_gateway" && ["open", "escalated"].includes(item.status) && item.severity === "critical").length;
  const apiMajorOpen = incidents.filter(item => item.component === "api_gateway" && ["open", "escalated"].includes(item.status) && item.severity === "major").length;
  const apiAvailabilityPct = Number(clamp(99.96 - apiCriticalOpen * 0.25 - apiMajorOpen * 0.08, 96.5, 99.99).toFixed(2));

  const recentImports = imports.filter(item => new Date(item.startedAt || 0).getTime() >= lowerBound);
  const importRows = recentImports.reduce((sum, item) => sum + Number(item.rowCount || 0), 0);
  const insertedRows = recentImports.reduce((sum, item) => sum + Number(item.insertedRows || 0), 0);
  const ingestionSuccessPct = importRows > 0 ? Number(((insertedRows / importRows) * 100).toFixed(2)) : 100;

  const workerIncidentOpen = incidents.filter(item => item.component === "worker_audit" && ["open", "escalated"].includes(item.status)).length;
  const workerAuditSuccessPct = Number(clamp(99.8 - workerIncidentOpen * 2.2, 85, 100).toFixed(2));

  const p95LatencyMs = Math.round(clamp(165 + apiMajorOpen * 60 + apiCriticalOpen * 120, 120, 1200));

  const latestSnapshotByMachine = new Map();
  for (const snapshot of snapshots) {
    const previous = latestSnapshotByMachine.get(Number(snapshot.machineId));
    if (!previous || new Date(snapshot.collectedAt || 0).getTime() >= new Date(previous.collectedAt || 0).getTime()) {
      latestSnapshotByMachine.set(Number(snapshot.machineId), snapshot);
    }
  }
  const latestSnapshots = [...latestSnapshotByMachine.values()];
  const dataQualityPassPct = latestSnapshots.length > 0
    ? Number(((latestSnapshots.filter(item => Number(item.qualityScore || 0) >= 90).length / latestSnapshots.length) * 100).toFixed(2))
    : 100;

  const decidedCount = recommendations.filter(item => ["accepted", "rejected", "deferred"].includes(item.status)).length;
  const recommendationCoveragePct = recommendations.length > 0
    ? Number(((decidedCount / recommendations.length) * 100).toFixed(2))
    : 0;

  const closedPdca = pdcaCycles.filter(item => Boolean(item.closedAt));
  const pdcaClosureRatePct = pdcaCycles.length > 0
    ? Number(((closedPdca.length / pdcaCycles.length) * 100).toFixed(2))
    : 0;

  const acknowledgedInSla = windowIncidents.filter(item => {
    if (!item.acknowledgedAt || !item.openedAt) {
      return false;
    }
    const deltaHours = (new Date(item.acknowledgedAt).getTime() - new Date(item.openedAt).getTime()) / (3600 * 1000);
    return deltaHours <= 2;
  }).length;
  const incidentAckWithinSlaPct = windowIncidents.length > 0
    ? Number(((acknowledgedInSla / windowIncidents.length) * 100).toFixed(2))
    : 100;

  const technical = [
    {
      key: "api_availability",
      label: "Disponibilité API",
      targetPct: 99.5,
      valuePct: apiAvailabilityPct,
      unit: "%",
      status: apiAvailabilityPct >= 99.5 ? "met" : "at_risk",
      budgetRemainingPct: Number(clamp(100 - ((99.5 - apiAvailabilityPct) * 100), 0, 100).toFixed(2)),
    },
    {
      key: "api_latency_p95",
      label: "Latence API P95",
      targetMax: 350,
      value: p95LatencyMs,
      unit: "ms",
      status: p95LatencyMs <= 350 ? "met" : "at_risk",
      budgetRemainingPct: Number(clamp(100 - (((p95LatencyMs - 350) / 350) * 100), 0, 100).toFixed(2)),
    },
    {
      key: "ingestion_success",
      label: "Succès ingestion",
      targetPct: 98,
      valuePct: ingestionSuccessPct,
      unit: "%",
      status: ingestionSuccessPct >= 98 ? "met" : "at_risk",
      budgetRemainingPct: Number(clamp(100 - ((98 - ingestionSuccessPct) * 10), 0, 100).toFixed(2)),
    },
    {
      key: "worker_audit_success",
      label: "Succès worker audit",
      targetPct: 97,
      valuePct: workerAuditSuccessPct,
      unit: "%",
      status: workerAuditSuccessPct >= 97 ? "met" : "at_risk",
      budgetRemainingPct: Number(clamp(100 - ((97 - workerAuditSuccessPct) * 8), 0, 100).toFixed(2)),
    },
  ];

  const business = [
    {
      key: "recommendation_coverage",
      label: "Couverture décisions recommandations",
      targetPct: 90,
      valuePct: recommendationCoveragePct,
      unit: "%",
      status: recommendationCoveragePct >= 90 ? "met" : "at_risk",
      budgetRemainingPct: Number(clamp(100 - ((90 - recommendationCoveragePct) * 2), 0, 100).toFixed(2)),
    },
    {
      key: "data_quality_pass",
      label: "Machines conformes qualité data",
      targetPct: 80,
      valuePct: dataQualityPassPct,
      unit: "%",
      status: dataQualityPassPct >= 80 ? "met" : "at_risk",
      budgetRemainingPct: Number(clamp(100 - ((80 - dataQualityPassPct) * 3), 0, 100).toFixed(2)),
    },
    {
      key: "incident_ack_sla",
      label: "Acquittement incidents < 2h",
      targetPct: 95,
      valuePct: incidentAckWithinSlaPct,
      unit: "%",
      status: incidentAckWithinSlaPct >= 95 ? "met" : "at_risk",
      budgetRemainingPct: Number(clamp(100 - ((95 - incidentAckWithinSlaPct) * 2), 0, 100).toFixed(2)),
    },
    {
      key: "pdca_closure",
      label: "Taux clôture cycles PDCA",
      targetPct: 60,
      valuePct: pdcaClosureRatePct,
      unit: "%",
      status: pdcaClosureRatePct >= 60 ? "met" : "at_risk",
      budgetRemainingPct: Number(clamp(100 - ((60 - pdcaClosureRatePct) * 2), 0, 100).toFixed(2)),
    },
  ];

  const overallAtRisk = [...technical, ...business].filter(item => item.status !== "met").length;

  return {
    windowHours: safeWindowHours,
    generatedAt: nowIso(),
    summary: {
      totalSlo: technical.length + business.length,
      metSlo: technical.filter(item => item.status === "met").length + business.filter(item => item.status === "met").length,
      atRiskSlo: overallAtRisk,
    },
    technical,
    business,
    diagnostics: {
      incidentsInWindow: windowIncidents.length,
      importsInWindow: recentImports.length,
      recommendationDecisions: decisions.length,
    },
  };
}

function listTechnicalIncidents(filters = {}) {
  const store = loadStore();
  const status = filters.status ? String(filters.status) : null;
  const severity = filters.severity ? String(filters.severity) : null;
  const component = filters.component ? String(filters.component) : null;
  const limit = clamp(Number(filters.limit) || 50, 1, 200);
  const offset = clamp(Number(filters.offset) || 0, 0, 100000);

  const items = [...(store.technicalIncidents || [])]
    .filter(item => (status ? item.status === status : true))
    .filter(item => (severity ? item.severity === severity : true))
    .filter(item => (component ? item.component === component : true))
    .sort((a, b) => Number(b.id) - Number(a.id));

  if (!Number.isFinite(limit)) {
    return items;
  }

  const pagedItems = items.slice(offset, offset + limit);
  if (filters.paginationMode === "meta") {
    const hasNext = offset + pagedItems.length < items.length;
    const hasPrevious = offset > 0;
    return {
      items: pagedItems,
      total: items.length,
      count: pagedItems.length,
      limit,
      offset,
      hasNext,
      hasPrevious,
    };
  }

  return pagedItems;
}

function acknowledgeTechnicalIncident(incidentId, note, user) {
  const store = loadStore();
  const incident = (store.technicalIncidents || []).find(item => Number(item.id) === Number(incidentId));
  if (!incident) {
    return null;
  }

  incident.status = incident.status === "escalated" ? "escalated" : "acknowledged";
  incident.acknowledgedAt = nowIso();
  incident.acknowledgedByUserId = user.id;
  incident.acknowledgedByName = user.fullName;
  incident.acknowledgementNote = note;

  saveStore(store);
  return incident;
}

function escalateTechnicalIncident(incidentId, reason, targetTeam, user) {
  const store = loadStore();
  const incident = (store.technicalIncidents || []).find(item => Number(item.id) === Number(incidentId));
  if (!incident) {
    return null;
  }

  incident.status = "escalated";
  incident.escalatedAt = nowIso();
  incident.escalatedByUserId = user.id;
  incident.escalatedByName = user.fullName;
  incident.escalationReason = reason;
  incident.escalationTargetTeam = targetTeam;

  if (!incident.acknowledgedAt) {
    incident.acknowledgedAt = nowIso();
    incident.acknowledgedByUserId = user.id;
    incident.acknowledgedByName = user.fullName;
    incident.acknowledgementNote = "Escalade directe";
  }

  saveStore(store);
  return incident;
}

function createImportJournalEntry(input = {}, user) {
  const store = loadStore();
  const sourceType = ["synthetic_csv", "synthetic_mqtt", "synthetic_batch", "manual"].includes(String(input.sourceType || "").toLowerCase())
    ? String(input.sourceType).toLowerCase()
    : "manual";

  const sourceName = String(input.sourceName || "Import manuel").trim() || "Import manuel";
  const fileName = input.fileName ? String(input.fileName).trim() : null;
  const rowCount = clamp(Math.round(Number(input.rowCount) || 0), 0, 500000);
  const rejectedRows = clamp(Math.round(Number(input.rejectedRows) || 0), 0, rowCount);
  const insertedRows = rowCount - rejectedRows;
  const qualityScore = Number(clamp(Number(input.qualityScore) || (rowCount > 0 ? ((insertedRows / rowCount) * 100) : 0), 0, 100).toFixed(1));

  let status = "success";
  if (rejectedRows > 0 || qualityScore < 90) {
    status = "warning";
  }
  if (qualityScore < 75 || rejectedRows > Math.max(5, Math.round(rowCount * 0.1))) {
    status = "failed";
  }

  const startedAt = toIsoOrNull(input.startedAt) || nowIso();
  const finishedAt = toIsoOrNull(input.finishedAt) || nowIso();
  const warningCount = Number.isFinite(Number(input.warningCount))
    ? clamp(Math.round(Number(input.warningCount)), 0, 10000)
    : (status === "warning" ? 1 : 0);
  const errorCount = Number.isFinite(Number(input.errorCount))
    ? clamp(Math.round(Number(input.errorCount)), 0, 10000)
    : (status === "failed" ? 1 : 0);

  const entry = {
    id: nextId(store.importJournal || []),
    sourceName,
    sourceType,
    fileName,
    status,
    startedAt,
    finishedAt,
    triggeredByUserId: user.id,
    triggeredByName: user.fullName,
    rowCount,
    insertedRows,
    rejectedRows,
    qualityScore,
    warningCount,
    errorCount,
    note: String(input.note || "").trim() || null,
  };

  store.importJournal = store.importJournal || [];
  store.importJournal.push(entry);

  if (rejectedRows > 0 || status !== "success") {
    const machineId = Number(input.machineId || 0);
    if (machineId > 0) {
      store.dataQualityIssues = store.dataQualityIssues || [];
      store.dataQualityIssues.push({
        id: nextId(store.dataQualityIssues),
        machineId,
        category: status === "failed" ? "import_failure" : "rejected_rows",
        field: "batch",
        severity: status === "failed" ? "major" : "minor",
        status: "open",
        description: status === "failed"
          ? `Import ${entry.id} échoué: ${rejectedRows} lignes rejetées.`
          : `Import ${entry.id}: ${rejectedRows} lignes rejetées à analyser.`,
        sampleValue: fileName || sourceName,
        batchId: String(input.batchId || `IMPORT-${entry.id}`),
        detectedAt: nowIso(),
        lastSeenAt: nowIso(),
      });
    }
  }

  saveStore(store);
  return entry;
}

function addGovernanceEvent(type, payload, user) {
  const store = loadStore();
  const event = {
    id: nextId(store.governanceEvents),
    type,
    payload,
    userId: user.id,
    role: user.role,
    createdAt: nowIso(),
  };
  store.governanceEvents.push(event);
  saveStore(store);
  return event;
}

function listGovernanceEvents(filters = {}) {
  const store = loadStore();
  const type = filters.type ? String(filters.type) : null;
  const limit = Math.max(1, Math.min(200, Number(filters.limit || 50)));

  return [...(store.governanceEvents || [])]
    .filter(item => (type ? item.type === type : true))
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, limit);
}

function listPdcaCycles() {
  const store = loadStore();
  return [...(store.pdcaCycles || [])].sort((a, b) => Number(b.id) - Number(a.id));
}

function getPdcaCycleById(cycleId) {
  const store = loadStore();
  return (store.pdcaCycles || []).find(item => Number(item.id) === Number(cycleId)) || null;
}

function createPdcaCycle(input, user) {
  const store = loadStore();
  const cycle = {
    id: nextId(store.pdcaCycles || []),
    machineId: Number(input.machineId),
    title: input.title,
    objective: input.objective,
    targetEnpi: Number(input.targetEnpi),
    phase: input.phase || "Plan",
    status: input.status || "Ouvert",
    actions: Array.isArray(input.actions) ? input.actions : [],
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    createdBy: user.id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    closedAt: null,
    closeReason: null,
  };

  store.pdcaCycles = store.pdcaCycles || [];
  store.pdcaCycles.push(cycle);
  saveStore(store);
  return cycle;
}

function updatePdcaCycle(cycleId, input, user) {
  const store = loadStore();
  const cycle = (store.pdcaCycles || []).find(item => Number(item.id) === Number(cycleId));
  if (!cycle) {
    return null;
  }

  cycle.machineId = Number(input.machineId);
  cycle.title = input.title;
  cycle.objective = input.objective;
  cycle.targetEnpi = Number(input.targetEnpi);
  cycle.phase = input.phase;
  cycle.status = input.status;
  cycle.actions = Array.isArray(input.actions) ? input.actions : [];
  cycle.attachments = Array.isArray(input.attachments) ? input.attachments : [];
  cycle.updatedAt = nowIso();
  cycle.updatedBy = user.id;

  saveStore(store);
  return cycle;
}

function closePdcaCycle(cycleId, reason, user) {
  const store = loadStore();
  const cycle = (store.pdcaCycles || []).find(item => Number(item.id) === Number(cycleId));
  if (!cycle) {
    return null;
  }

  cycle.phase = "Act";
  cycle.status = "Clôturé";
  cycle.closedAt = nowIso();
  cycle.closeReason = reason;
  cycle.updatedAt = nowIso();
  cycle.updatedBy = user.id;
  saveStore(store);

  return cycle;
}

function normalizeFactorsProduct(normalizationFactors = {}) {
  const factors = normalizationFactors && typeof normalizationFactors === "object"
    ? Object.values(normalizationFactors)
    : [];
  if (factors.length === 0) {
    return 1;
  }
  return factors.reduce((product, value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return product;
    }
    return product * numeric;
  }, 1);
}

function computeRegressionEnpi(coefficients = {}, variables = {}) {
  if (!coefficients || typeof coefficients !== "object") {
    return null;
  }

  let enpi = Number(coefficients.intercept || 0);
  for (const [name, coefficient] of Object.entries(coefficients)) {
    if (name === "intercept") {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      continue;
    }
    const coeff = Number(coefficient);
    const variable = Number(variables[name]);
    if (Number.isFinite(coeff) && Number.isFinite(variable)) {
      enpi += coeff * variable;
    }
  }

  if (!Number.isFinite(enpi)) {
    return null;
  }
  return Math.max(0, enpi);
}

function getEnbBaselineSnapshot(input = {}) {
  const store = loadStore();
  const machineId = Number(input.machineId || 0);
  const referenceWindowHours = clamp(Number(input.referenceWindowHours) || 24, 6, 168);

  if (!Number.isFinite(machineId) || machineId <= 0) {
    return null;
  }

  const rows = [...(store.energyTimeline || [])]
    .filter(item => Number(item.machineId) === machineId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-referenceWindowHours);

  if (rows.length === 0) {
    return null;
  }

  const baselineEnpi = rows.reduce((sum, row) => sum + Number(row.enpi || 0), 0) / rows.length;
  const baselinePowerKw = rows.reduce((sum, row) => sum + Number(row.powerKw || 0), 0) / rows.length;
  const baselineLoadPct = rows.reduce((sum, row) => sum + Number(row.loadPct || 0), 0) / rows.length;

  return {
    machineId,
    referenceWindowHours,
    sampleSize: rows.length,
    baselineEnpi: Number(baselineEnpi.toFixed(4)),
    baselinePowerKw: Number(baselinePowerKw.toFixed(3)),
    baselineLoadPct: Number(baselineLoadPct.toFixed(3)),
    method: "historical_mean",
    startedAt: rows[0].timestamp,
    endedAt: rows[rows.length - 1].timestamp,
  };
}

function getEnpiCurrentSnapshot(input = {}) {
  const store = loadStore();
  const machineId = Number(input.machineId || 0);
  const windowHours = clamp(Number(input.windowHours) || 24, 6, 168);
  const regressionR2 = Number(input.regressionR2);
  const minRegressionR2 = Number.isFinite(Number(input.minRegressionR2))
    ? Number(input.minRegressionR2)
    : 0.7;

  if (!Number.isFinite(machineId) || machineId <= 0) {
    return null;
  }

  const rows = [...(store.energyTimeline || [])]
    .filter(item => Number(item.machineId) === machineId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-windowHours);

  if (rows.length === 0) {
    return null;
  }

  const ratioEnpi = rows.reduce((sum, row) => sum + Number(row.enpi || 0), 0) / rows.length;
  const avgPowerKw = rows.reduce((sum, row) => sum + Number(row.powerKw || 0), 0) / rows.length;
  const avgLoadPct = rows.reduce((sum, row) => sum + Number(row.loadPct || 0), 0) / rows.length;

  const coefficients = input.regressionCoefficients && typeof input.regressionCoefficients === "object"
    ? input.regressionCoefficients
    : {
      intercept: 0.75,
      avgPowerKw: 0.0026,
      avgLoadPct: 0.0055,
    };

  const regressionEnpi = computeRegressionEnpi(coefficients, {
    avgPowerKw,
    avgLoadPct,
    sampleSize: rows.length,
  });

  const regressionUsable = Number.isFinite(regressionR2)
    && regressionR2 >= minRegressionR2
    && Number.isFinite(regressionEnpi);
  const selectedMethod = regressionUsable ? "regression" : "ratio";
  const selectedEnpi = regressionUsable ? Number(regressionEnpi) : Number(ratioEnpi);

  const normalizationProduct = normalizeFactorsProduct(input.normalizationFactors || {});
  const normalizedEnpi = Math.max(0, selectedEnpi * normalizationProduct);

  const baseline = getEnbBaselineSnapshot({
    machineId,
    referenceWindowHours: Number(input.referenceWindowHours || windowHours),
  });
  const baselineEnpi = Number(baseline?.baselineEnpi || 0);
  const deviationPct = baselineEnpi > 0
    ? ((normalizedEnpi - baselineEnpi) / baselineEnpi) * 100
    : 0;
  const improvementPct = baselineEnpi > 0
    ? ((baselineEnpi - normalizedEnpi) / baselineEnpi) * 100
    : 0;

  let status = "normal";
  if (Math.abs(deviationPct) >= 15) {
    status = "critical";
  } else if (Math.abs(deviationPct) >= 5) {
    status = "warning";
  }

  return {
    machineId,
    windowHours,
    sampleSize: rows.length,
    enpiValue: Number(selectedEnpi.toFixed(6)),
    enpiNormalized: Number(normalizedEnpi.toFixed(6)),
    enpiDeviationPct: Number(deviationPct.toFixed(3)),
    improvementProofPct: Number(improvementPct.toFixed(3)),
    baselineEnpi: baselineEnpi ? Number(baselineEnpi.toFixed(6)) : null,
    status,
    diagnostics: {
      selectedMethod,
      ratioEnpi: Number(ratioEnpi.toFixed(6)),
      regressionEnpi: Number.isFinite(regressionEnpi) ? Number(regressionEnpi.toFixed(6)) : null,
      regressionR2: Number.isFinite(regressionR2) ? Number(regressionR2.toFixed(4)) : null,
      minRegressionR2: Number(minRegressionR2.toFixed(4)),
      fallbackApplied: !regressionUsable,
      normalizationProduct: Number(normalizationProduct.toFixed(6)),
      variables: {
        avgPowerKw: Number(avgPowerKw.toFixed(4)),
        avgLoadPct: Number(avgLoadPct.toFixed(4)),
      },
    },
  };
}

function getPdcaAllowedTransition(phase) {
  const map = {
    Plan: "Do",
    Do: "Check",
    Check: "Act",
    Act: null,
  };
  return map[String(phase || "Plan")] || null;
}

function transitionPdcaCycle(cycleId, input = {}, user) {
  const store = loadStore();
  const cycle = (store.pdcaCycles || []).find(item => Number(item.id) === Number(cycleId));
  if (!cycle) {
    return { error: "pdca_not_found" };
  }

  const toPhase = String(input.toPhase || "").trim();
  const reason = String(input.reason || "").trim();
  const allowedPhases = ["Plan", "Do", "Check", "Act"];
  if (!allowedPhases.includes(toPhase)) {
    return { error: "toPhase_invalid" };
  }
  if (reason.length < 3) {
    return { error: "reason_required_min_3" };
  }

  const fromPhase = String(cycle.phase || "Plan");
  const allowedNext = getPdcaAllowedTransition(fromPhase);
  if (toPhase !== allowedNext) {
    return {
      error: "pdca_transition_invalid",
      details: {
        fromPhase,
        toPhase,
        allowedNext,
      },
    };
  }

  const beforeValue = {
    phase: fromPhase,
    status: cycle.status || "Ouvert",
    targetEnpi: Number(cycle.targetEnpi || 0),
  };

  cycle.phase = toPhase;
  if (toPhase === "Do") {
    cycle.status = "En cours";
  } else if (toPhase === "Check") {
    cycle.status = "Verification";
  } else if (toPhase === "Act") {
    cycle.status = "Pret cloture";
  }
  cycle.updatedAt = nowIso();
  cycle.updatedBy = user.id;
  cycle.transitions = Array.isArray(cycle.transitions) ? cycle.transitions : [];

  const transition = {
    id: nextId(cycle.transitions),
    fromPhase,
    toPhase,
    reason,
    linkedAnomalyId: Number(input.linkedAnomalyId || 0) || null,
    linkedRecommendationId: Number(input.linkedRecommendationId || 0) || null,
    transitionedAt: nowIso(),
    transitionedByUserId: user.id,
    transitionedByName: user.fullName,
    transitionedByRole: user.role,
  };

  cycle.transitions.push(transition);

  const afterValue = {
    phase: cycle.phase,
    status: cycle.status,
    targetEnpi: Number(cycle.targetEnpi || 0),
  };

  saveStore(store);

  return {
    cycle,
    transition,
    beforeValue,
    afterValue,
  };
}

function getPdcaStatus(input = {}) {
  const store = loadStore();
  const cycleId = Number(input.cycleId || 0);
  let cycle = null;

  if (cycleId > 0) {
    cycle = (store.pdcaCycles || []).find(item => Number(item.id) === cycleId) || null;
  } else {
    cycle = [...(store.pdcaCycles || [])]
      .sort((a, b) => Number(b.id) - Number(a.id))
      .find(item => String(item.status || "").toLowerCase() !== "clôturé")
      || [...(store.pdcaCycles || [])].sort((a, b) => Number(b.id) - Number(a.id))[0]
      || null;
  }

  if (!cycle) {
    return null;
  }

  const phase = String(cycle.phase || "Plan");
  return {
    cycleId: Number(cycle.id),
    machineId: Number(cycle.machineId),
    title: cycle.title,
    status: cycle.status,
    currentPhase: phase,
    nextAllowedPhase: getPdcaAllowedTransition(phase),
    transitionCount: Array.isArray(cycle.transitions) ? cycle.transitions.length : 0,
    transitions: Array.isArray(cycle.transitions) ? [...cycle.transitions] : [],
    updatedAt: cycle.updatedAt || cycle.createdAt || nowIso(),
  };
}

function listApprovals() {
  const store = loadStore();
  return [...(store.approvals || [])].sort((a, b) => Number(b.id) - Number(a.id));
}

function decideApproval(approvalId, decision, comment, user) {
  const store = loadStore();
  const approval = (store.approvals || []).find(item => Number(item.id) === Number(approvalId));
  if (!approval) {
    return null;
  }

  if (approval.status !== "pending") {
    return { error: "already_decided" };
  }

  approval.status = decision;
  approval.comment = comment;
  approval.decidedByUserId = user.id;
  approval.decidedByName = user.fullName;
  approval.decidedAt = nowIso();

  saveStore(store);
  return approval;
}

function listDocumentVersions() {
  const store = loadStore();
  return [...(store.documentVersions || [])].sort((a, b) => Number(b.id) - Number(a.id));
}

function getDocumentVersionById(versionId) {
  const store = loadStore();
  return (store.documentVersions || []).find(item => Number(item.id) === Number(versionId)) || null;
}

function diffDocumentVersions(versionAId, versionBId) {
  const versionA = getDocumentVersionById(versionAId);
  const versionB = getDocumentVersionById(versionBId);

  if (!versionA || !versionB) {
    return null;
  }

  const linesA = String(versionA.content || "").split("\n");
  const linesB = String(versionB.content || "").split("\n");
  const maxLen = Math.max(linesA.length, linesB.length);
  const diff = [];

  for (let index = 0; index < maxLen; index += 1) {
    const left = linesA[index] ?? "";
    const right = linesB[index] ?? "";

    if (left === right) {
      diff.push({ type: "unchanged", left, right, line: index + 1 });
    } else {
      if (left) {
        diff.push({ type: "removed", left, right: "", line: index + 1 });
      }
      if (right) {
        diff.push({ type: "added", left: "", right, line: index + 1 });
      }
    }
  }

  return {
    from: {
      id: versionA.id,
      title: versionA.title,
      version: versionA.version,
    },
    to: {
      id: versionB.id,
      title: versionB.title,
      version: versionB.version,
    },
    diff,
  };
}

function listAuditMatrix() {
  const store = loadStore();
  return [...(store.auditMatrix || [])].sort((a, b) => a.clause.localeCompare(b.clause));
}

function listAuditEvidenceByClause(clause) {
  const store = loadStore();
  return (store.auditEvidence || []).filter(item => item.clause === clause);
}

function getAuditEvidenceById(evidenceId) {
  const store = loadStore();
  return (store.auditEvidence || []).find(item => Number(item.id) === Number(evidenceId)) || null;
}

function listNonConformities() {
  const store = loadStore();
  return [...(store.nonConformities || [])].sort((a, b) => Number(b.id) - Number(a.id));
}

function createNonConformity(input, user) {
  const store = loadStore();
  const item = {
    id: nextId(store.nonConformities || []),
    clause: input.clause,
    title: input.title,
    severity: input.severity || "minor",
    status: "open",
    description: input.description,
    createdByUserId: user.id,
    createdByName: user.fullName,
    createdAt: nowIso(),
    correctiveActions: [
      {
        id: 1,
        action: input.correctiveAction,
        owner: input.owner,
        dueDate: input.dueDate,
        status: "open",
        note: "Créée",
        updatedAt: nowIso(),
      },
    ],
  };

  store.nonConformities = store.nonConformities || [];
  store.nonConformities.push(item);
  saveStore(store);
  return item;
}

function updateCorrectiveAction(nonConformityId, actionId, status, note, user) {
  const store = loadStore();
  const nc = (store.nonConformities || []).find(item => Number(item.id) === Number(nonConformityId));
  if (!nc) {
    return null;
  }

  const action = (nc.correctiveActions || []).find(entry => Number(entry.id) === Number(actionId));
  if (!action) {
    return { error: "action_not_found" };
  }

  action.status = status;
  action.note = note;
  action.updatedAt = nowIso();
  action.updatedBy = user.fullName;

  if (nc.correctiveActions.every(entry => entry.status === "done")) {
    nc.status = "closed";
    nc.closedAt = nowIso();
  }

  saveStore(store);
  return nc;
}

function generatePreAuditExport(input, user) {
  const store = loadStore();
  const matrix = listAuditMatrix();
  const nonConformities = listNonConformities();

  const summary = {
    covered: matrix.filter(item => item.status === "covered").length,
    partial: matrix.filter(item => item.status === "partial").length,
    missing: matrix.filter(item => item.status === "missing").length,
  };

  const exportItem = {
    id: nextId(store.preAuditExports || []),
    generatedAt: nowIso(),
    generatedByUserId: user.id,
    generatedByName: user.fullName,
    period: {
      from: input.from || null,
      to: input.to || null,
    },
    matrixSummary: summary,
    nonConformitySummary: {
      total: nonConformities.length,
      open: nonConformities.filter(item => item.status !== "closed").length,
      closed: nonConformities.filter(item => item.status === "closed").length,
    },
    clauses: matrix.map(item => ({ clause: item.clause, status: item.status, title: item.title })),
  };

  store.preAuditExports = store.preAuditExports || [];
  store.preAuditExports.push(exportItem);
  saveStore(store);
  return exportItem;
}

function listPreAuditExports() {
  const store = loadStore();
  return [...(store.preAuditExports || [])].sort((a, b) => Number(b.id) - Number(a.id));
}

module.exports = {
  login,
  getSessionUser,
  revokeSession,
  listMachines,
  createMachine,
  getUnreadAlerts,
  markAlertAsRead,
  listMachineLiveSnapshot,
  listAnomalies,
  acknowledgeAnomaly,
  createAnomaly,
  listSites,
  listSiteComparison,
  listEnergyTimeline,
  listCauseActionCorrelations,
  listRecommendations,
  createRecommendationFromAnomaly,
  decideRecommendation,
  listRecommendationDecisionHistory,
  getRecommendationAdoptionSummary,
  getRecommendationExplainability,
  listDataQualitySummary,
  listDataQualityIssues,
  listDataRejections,
  resolveDataRejection,
  listTechnicalIncidents,
  acknowledgeTechnicalIncident,
  escalateTechnicalIncident,
  getSloDashboard,
  listImportJournal,
  createImportJournalEntry,
  getPlatformHealthSummary,
  addGovernanceEvent,
  listGovernanceEvents,
  listPdcaCycles,
  getPdcaCycleById,
  createPdcaCycle,
  updatePdcaCycle,
  closePdcaCycle,
  getEnbBaselineSnapshot,
  getEnpiCurrentSnapshot,
  transitionPdcaCycle,
  getPdcaStatus,
  listApprovals,
  decideApproval,
  listDocumentVersions,
  getDocumentVersionById,
  diffDocumentVersions,
  listAuditMatrix,
  listAuditEvidenceByClause,
  getAuditEvidenceById,
  listNonConformities,
  createNonConformity,
  updateCorrectiveAction,
  generatePreAuditExport,
  listPreAuditExports,
};
