# Baseline de stabilisation technique

## Portée
Figer un socle exécutable avant découpage complet multi-services.

## État courant (2026-04-04)
- Serveur HTTP principal unique en JS: backend/http_main_server.js
- Auth locale persistante runtime: backend/core/store.js
- RBAC écriture global: backend/core/rbac.js
- UI locale servie: backend/public/index.html
- Test RBAC intégration: backend/tests/rbac_http_integration.test.js

## Écarts à fermer avant baseline finale
1. Unifier les stacks TypeScript historiques et la stack JS runtime (choix architecture final)
2. Rendre les modules TS historiques compilables (routers.ts/db_energy.ts dépendances)
3. Ajouter script build/test standard (package manifest manquant)
4. Stabiliser migration DB complète vs schéma enrichi (users, sessions, docs, approvals, reviews)
5. Mettre en place test unitaire automatique exécutable en CI

## Critères baseline technique
- Démarrage serveur sans erreur.
- Healthcheck API OK.
- Auth login/session/logout OK.
- Toutes mutations d'écriture protégées RBAC testées.
- Interface rôle accessible en localhost.

## Commandes de contrôle recommandées
- node backend/http_main_server.js
- node backend/tests/rbac_http_integration.test.js
