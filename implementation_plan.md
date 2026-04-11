# Plan d'implémentation : Finalisation des User Stories Énergie & Production

Suite à la vérification de l'état actuel de votre plateforme ISO 50001, nous posons le constat suivant : **les user stories demandées sont actuellement non développées ou partiellement développées (simples vues statiques/maquettes HTML sans vraie liaison dynamique React et sans connecteur industriel actif)**.

Voici le plan détaillé pour développer l'intégralité de ces fonctionnalités et assurer une coordination parfaite backend/frontend.

## 1. Connecter PLC/MES/SCADA via OPC-UA (Backend)
Nous allons développer le connecteur industriel pour simuler et récupérer les données de production côté machine :
### `[NEW] backend/ingestion/opc_ua_simulator.js`
- Création d'un serveur OPC-UA (via le paquet `node-opcua`) exposant les variables temps réel : **Énergie** (`kWh_Total`, `ActivePower_kW`, `ApparentPower_kVA`, `CosPhi`, `THD`) et **Production** (`Pieces_Count`, `OEE`, `Machine_Status`).
- Création d'un client OPC-UA qui souscrit aux changements de ces variables et transfère les données vers notre base de données temporelle (ou endpoint d'ingestion `http_main_server.js`).
> [!IMPORTANT]
> Aidez-nous à confirmer : Souhaitez-vous que le script OPC-UA s'exécute de façon autonome (daemon) ou préférez-vous l'intégrer directement dans le serveur Express existant (`http_main_server.js`) ? (Le plan prévoit par défaut un script autonome pour éviter de bloquer l'API principale).

## 2. Nouveaux Graphiques (Frontend React)
Développement des composants de visualisation avancée avec de la fluidité (ECharts/Recharts ou proxy Chart.js).
### `[NEW] components/graphs/RealtimeGauge.tsx`
- Jauge et compteurs en temps réel affichant les KPIs (kVA, cosφ, THD).
### `[NEW] components/graphs/CorrelationChart.tsx`
- Graphique superposant la Consommation Énergétique (axe Y gauche) et la Production / OEE (axe Y droit) pour visualiser instantanément la corrélation.
### `[NEW] components/graphs/EnpiChart.tsx`
- Graphique linéaire retraçant l'évolution de l'EnPI (Energy Performance Indicator) avec la "Baseline" affichée en zone d'arrière-plan (aire semi-transparente).

## 3. Mode "Vue Machine" (Machine View)
### `[NEW] components/MachineView.tsx`
- Dispositif condensant spécifiquement pour une machine : ses compteurs en temps réel (OPC-UA), sa corrélation production/énergie et son journal d'anomalies IA.

## 4. Dynamisation des Composants React avec de Réels Appels API
Les données actuelles (mockées) de la version TypeScript seront remplacées par des appels (ex: `fetch('/api/...')`).
### `[MODIFY] Dashboard.tsx`
- Intégration de requêtes backend `/api/machines`, `/api/anomalies`, `/api/enpi/latest` pour calculer les KPIs dynamiques par rôle.
### `[MODIFY] PDCAManagement.tsx`
- Requête API vers `/api/pdca` pour afficher les véritables cycles (Plan, Do, Check, Act).
### `[MODIFY] ApprovalsManagement.tsx` et `AuditCenter.tsx`
- Appels vers la gouvernance et l'audit pour la gestion des preuves et clôtures ("fetch('/api/governance...')").

## Vérification requise
Pour la dynamisation côté React, React Router ou la gestion interne des états (comme c'est le cas actuellement dans `App.tsx` via un simple `switch`) sera enrichie pour inclure la navigation vers la Vue Machine `MachineView.tsx`.
Avez-vous des préférences spécifiques sur les librairies graphiques à utiliser côté React (`recharts`, ou `chart.js` existant) ? (Le plan prévoit d'utiliser `recharts` pour une meilleure intégration avec les composants React).
