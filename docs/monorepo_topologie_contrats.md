# Topologie monorepo 5 services et contrats inter-services

## Services cibles
- frontend: UI web rôle-based
- api: logique métier synchrone
- ingestion: pipelines batch/stream + qualité
- analytics: entraînement/inférence advisory-first
- worker-audit: génération preuves et dossiers clause

## Contrats synchrones (HTTP)
- /api/auth/* : login, session, logout
- /api/machines/* : lecture/écriture machine
- /api/measurements/* : séries temporelles
- /api/enpi/* : dernier état + historique
- /api/pdca/* : cycles et transitions
- /api/anomalies/* : détection/résolution
- /api/recommendations/* : recommandations et décision utilisateur
- /api/governance/* : approvals, baselines, reviews
- /api/reports/* : exports audit/pré-audit

## Contrats asynchrones (événements)
Nommage recommandé: enms.<domaine>.<événement>.v1

Événements minimaux:
- enms.ingestion.batch.completed.v1
- enms.ingestion.quality.flagged.v1
- enms.enpi.calculated.v1
- enms.anomaly.detected.v1
- enms.pdca.phase.changed.v1
- enms.governance.approval.decided.v1
- enms.audit.evidence.generated.v1

## Convention payload
- eventId (uuid)
- correlationId (id de flux métier)
- causationId (event source)
- occurredAt (iso timestamp)
- actor { userId, role }
- data (payload métier versionné)

## Versionnement
- DTO HTTP: champ apiVersion obligatoire
- Événements: suffixe .v1 dans nom d'événement
- Stratégie évolutive: compatibilité backward sur N-1

## Corrélation et traçabilité
- Un correlationId de bout en bout pour chaque scénario E2E.
- worker-audit consomme les événements corrélés pour assembler dossier preuve.

## Contrat frontend minimal
- Toute mutation doit envoyer Authorization Bearer + idempotencyKey.
- Toute réponse erreur suit: { code, message, details, correlationId }.
