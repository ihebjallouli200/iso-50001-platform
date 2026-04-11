# Interfaces spécifiques par rôle (V1)

## Admin Énergie
- **Pages**: Dashboard Gouvernance, PDCA global, Approbations documentaires, Exports Audit.
- **Données exigées**: conformité clauses 4→10, EnPI multi-sites, journal actions sensibles, statut des preuves.
- **Actions**:
  - Valider baseline (sensible)
  - Approuver document (sensible)
  - Exporter dossier de preuve (sensible)

## Responsable Site
- **Pages**: Dashboard Site, PDCA site, Anomalies, Actions correctives.
- **Données exigées**: EnPI local, anomalies machine, progression PDCA, tâches ouvertes.
- **Actions**:
  - Valider baseline locale (sensible)
  - Clôturer cycle PDCA (sensible)
  - Assigner actions correctives

## Auditeur
- **Pages**: Dashboard Audit, Matrice exigence→preuve, Non-conformités, Export pré-audit.
- **Données exigées**: preuves par clause, historique d'approbations, traçabilité who/what/when/why.
- **Actions**:
  - Exporter rapport pré-audit (sensible)
  - Ouvrir non-conformité
  - Demander complément de preuve

## Opérateur
- **Pages**: Dashboard Opérations, PDCA machine assigné, Alertes actives, Saisie terrain.
- **Données exigées**: checklists machine, alertes ligne, actions assignées, historique interventions.
- **Actions**:
  - Déclarer intervention terrain
  - Acquitter alerte
  - Soumettre suggestion d'amélioration

## Règle lecture/écriture sensible
- Écriture sensible autorisée selon matrice RBAC globale.
- Si action non autorisée, l'interface passe en lecture seule.
- Exception possible via validation explicite (traçable) dans le contexte utilisateur.
