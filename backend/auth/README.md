# Auth HTTP Server (délegué au serveur principal)

Endpoints exposés:
- `POST /api/auth/login`
- `GET /api/auth/meByToken?sessionToken=...`
- `POST /api/auth/logoutByToken`

Fichier serveur:
- `backend/http_main_server.js` (entrée principale)
- `backend/auth/auth_http_server.js` (wrapper de compatibilité)

Exécution:
- `node backend/http_main_server.js`
- Vérifier que l'application frontend pointe vers ce serveur (proxy `/api`).

Important:
- Le client auth côté front n'a plus de fallback local silencieux; le serveur HTTP auth doit être joignable.

Contrats:
- `login` retourne `{ sessionToken, user, expiresAt }`.
- `meByToken` retourne l'utilisateur de session si token valide.
- `logoutByToken` révoque la session persistée.
