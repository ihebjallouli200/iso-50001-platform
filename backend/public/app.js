/* ===== EnMS ISO 50001 — Frontend Logic ===== */
const API = '';
let sessionToken = null, currentUser = null;
const state = { view: 'dashboard', selectedMachineId: null, selectedSiteId: null, period: '24h' };
const ACCOUNTS = {
  'admin.energie': 'Admin50001!', 'resp.site': 'Site50001!',
  'auditeur.interne': 'Audit50001!', 'operateur': 'Oper50001!'
};
const PAGE_TITLES = {
  dashboard:'Dashboard', machine:'Vue Machine', pdca:'Cycle PDCA',
  recommendations:'Recommandations IA', governance:'Gouvernance',
  audit:'Audit ISO 50001', dataQuality:'Qualité des Données',
  incidents:'Incidents', settings:'Paramètres'
};
let chartInstances = {};

/* ===== UTILS ===== */
function toast(msg, ms=3000) {
  const t = document.getElementById('toast'); t.textContent = msg;
  t.classList.add('show'); setTimeout(() => t.classList.remove('show'), ms);
}
function showModal(html) {
  const o = document.getElementById('modalOverlay');
  document.getElementById('modalContent').innerHTML = html;
  o.classList.add('active');
  o.onclick = e => { if (e.target === o) closeModal(); };
}
function closeModal() { document.getElementById('modalOverlay').classList.remove('active'); }
function fmtNum(v, d=2) { return v == null ? '—' : Number(v).toFixed(d); }
function fmtPct(v) { return v == null ? '—' : Number(v).toFixed(1) + '%'; }
function colorForValue(v, thresholds) {
  if (v == null) return 'var(--text-muted)';
  if (thresholds.reverse) return v <= thresholds.green ? 'var(--green)' : v <= thresholds.yellow ? 'var(--yellow)' : 'var(--red)';
  return v >= thresholds.green ? 'var(--green)' : v >= thresholds.yellow ? 'var(--yellow)' : 'var(--red)';
}
function badgeClass(status) {
  const m = { COVERED:'badge-green', PARTIAL:'badge-yellow', GAP:'badge-red',
    ACCEPTED:'badge-green', PENDING:'badge-yellow', REJECTED:'badge-red',
    Plan:'badge-blue', Do:'badge-yellow', Check:'badge-purple', Act:'badge-green',
    VERIFICATION:'badge-purple', EN_COURS:'badge-yellow', TERMINE:'badge-green' };
  return m[status] || 'badge-blue';
}

/* ===== API ===== */
async function apiFetch(path, opts={}) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionToken) headers['Authorization'] = 'Bearer ' + sessionToken;
  try {
    const r = await fetch(API + path, { ...opts, headers: { ...headers, ...opts.headers } });
    const json = await r.json();
    return json;
  } catch (e) { console.error('API error:', path, e); return { ok: false, error: e.message }; }
}
async function apiGet(path) { return apiFetch(path); }
async function apiPost(path, body) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
}

/* ===== AUTH ===== */
async function doLogin() {
  const u = document.getElementById('username').value.trim();
  const p = document.getElementById('password').value;
  const r = await apiPost('/api/auth/login', { username: u, password: p });
  if (!r || !r.data?.token) {
    document.getElementById('loginError').textContent = r?.error || 'Échec de connexion';
    return;
  }
  sessionToken = r.data.token;
  currentUser = r.data;
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  document.getElementById('topUserName').textContent = currentUser.fullName || u;
  document.getElementById('topUserRole').textContent = currentUser.role || '';
  document.getElementById('topAvatar').textContent = (currentUser.fullName || u).substring(0, 2).toUpperCase();
  filterNavByRole(currentUser.role);
  renderCurrentView();
  startAlertPolling();
}
async function doLogout() {
  await apiPost('/api/auth/logoutByToken', { token: sessionToken });
  sessionToken = null; currentUser = null;
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('loginView').classList.remove('hidden');
}
function filterNavByRole(role) {
  const allowed = {
    AUDITEUR: ['dashboard','audit','governance'],
    OPERATEUR: ['dashboard','machine','incidents']
  };
  if (!allowed[role]) return;
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    const v = el.dataset.view;
    el.style.display = allowed[role].includes(v) ? '' : 'none';
  });
}

/* ===== NAVIGATION ===== */
function navigateTo(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('v_' + view);
  if (target) target.classList.add('active');
  document.getElementById('pageTitle').textContent = PAGE_TITLES[view] || view;
  renderCurrentView();
}
function toggleMobileSidebar() {
  document.getElementById('sidebar').classList.toggle('mobile-open');
}

/* ===== GAUGE HELPER ===== */
function createGauge(canvas, value, max, color, label) {
  const ctx = canvas.getContext('2d');
  if (chartInstances[canvas.id]) chartInstances[canvas.id].destroy();
  chartInstances[canvas.id] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [{ data: [Math.min(value, max), Math.max(0, max - value)],
        backgroundColor: [color, 'rgba(255,255,255,0.05)'],
        borderWidth: 0, circumference: 180, rotation: 270 }]
    },
    options: { cutout: '75%', responsive: true, plugins: { legend: { display: false }, tooltip: { enabled: false } } }
  });
}

/* ===== RENDER DISPATCHER ===== */
function renderCurrentView() {
  const fn = { dashboard: renderDashboard, machine: renderMachine, pdca: renderPdca,
    recommendations: renderRecommendations, governance: renderGovernance,
    audit: renderAudit, dataQuality: renderDataQuality,
    incidents: renderIncidents, settings: renderSettings };
  if (fn[state.view]) fn[state.view]();
}


/* ===== DASHBOARD ===== */
async function renderDashboard() {
  const el = document.getElementById('v_dashboard');
  const [live, enpi] = await Promise.all([apiGet('/api/machines/live'), apiGet('/api/enpi/current')]);
  const machines = Array.isArray(live?.data) ? live.data : [];
  const snap = enpi?.data || {};
  const onlineCount = machines.filter(m => m.status === 'running').length;
  const totalPower = machines.reduce((s, m) => s + (m.puissanceKw || 0), 0);
  const anomR = await apiGet('/api/anomalies/open');
  const anomCount = Array.isArray(anomR?.data) ? anomR.data.length : (anomR?.data?.count || 0);
  const pdcaR = await apiGet('/api/pdca/cycles');
  const pdcaCount = Array.isArray(pdcaR?.data) ? pdcaR.data.length : 0;
  const sites = await apiGet('/api/sites/comparison');
  const siteList = Array.isArray(sites?.data) ? sites.data : [];
  const selM = machines.find(m => m.id === state.selectedMachineId) || machines[0] || {};
  if (!state.selectedMachineId && machines[0]) state.selectedMachineId = machines[0].id;

  let siteChips = siteList.map(s => '<button class="chip" onclick="state.selectedSiteId=\''+s.id+'\';renderDashboard()">'+s.name+'</button>').join('');
  let machOpts = machines.map(m => '<option value="'+m.id+'"'+(state.selectedMachineId===m.id?' selected':'')+'>'+m.id+' — '+m.name+'</option>').join('');

  el.innerHTML = '<div class="chip-row"><button class="chip active">Tous</button>'+siteChips+'</div>'
    +'<div class="flex-between mb-2"><div></div><div class="flex-center">'
    +'<select class="form-select" style="width:auto" onchange="state.period=this.value;renderDashboard()">'
    +'<option value="24h"'+(state.period==='24h'?' selected':'')+'>24h</option>'
    +'<option value="12h"'+(state.period==='12h'?' selected':'')+'>12h</option>'
    +'<option value="6h"'+(state.period==='6h'?' selected':'')+'>6h</option></select>'
    +'<select class="form-select" style="width:auto" onchange="state.selectedMachineId=this.value;renderDashboard()">'+machOpts+'</select>'
    +'</div></div>'
    +'<div class="kpi-grid mb-2">'
    +'<div class="kpi-card"><div class="kpi-label">Machines actives</div><div class="kpi-value">'+onlineCount+'/'+machines.length+'</div></div>'
    +'<div class="kpi-card"><div class="kpi-label">Anomalies ouvertes</div><div class="kpi-value text-red">'+anomCount+'</div></div>'
    +'<div class="kpi-card"><div class="kpi-label">Cycles PDCA actifs</div><div class="kpi-value">'+pdcaCount+'</div></div>'
    +'<div class="kpi-card"><div class="kpi-label">Puissance totale</div><div class="kpi-value">'+fmtNum(totalPower,1)+' kW</div></div>'
    +'</div>'
    +'<div class="card"><div class="flex-between"><span class="card-title">EnPI — '+(state.selectedMachineId||'Global')+'</span>'
    +'<span class="badge '+(snap.enpiStatus==='DEGRADED'?'badge-red':'badge-green')+'">'+(snap.enpiStatus||'—')+'</span></div>'
    +'<div style="text-align:center"><canvas id="mainGauge" width="260" height="140"></canvas>'
    +'<div class="main-gauge-value" style="color:'+(snap.enpiNormalized>2.5?'var(--red)':'var(--green)')+'">'+fmtNum(snap.enpiNormalized)+' kWh/u</div></div>'
    +'<div class="baseline-bar" id="baselineBar"></div></div>'
    +'<div class="sub-gauges-row mt-2">'
    +'<div class="card mini-gauge"><canvas id="gaugeTHD" width="120" height="70"></canvas><div class="mini-gauge-value" id="valTHD"></div><div class="gauge-label">THD</div></div>'
    +'<div class="card mini-gauge"><canvas id="gaugeCosPhi" width="120" height="70"></canvas><div class="mini-gauge-value" id="valCosPhi"></div><div class="gauge-label">cos φ</div></div>'
    +'<div class="card mini-gauge"><canvas id="gaugeUnbalance" width="120" height="70"></canvas><div class="mini-gauge-value" id="valUnbalance"></div><div class="gauge-label">Déséquilibre</div></div>'
    +'</div>';

  setTimeout(() => {
    createGauge(document.getElementById('mainGauge'), snap.enpiNormalized||0, 5, snap.enpiNormalized>2.5?'#f85149':'#d29922');
    createGauge(document.getElementById('gaugeTHD'), selM.thd||0, 10, (selM.thd||0)<5?'#3fb950':'#d29922');
    document.getElementById('valTHD').textContent = fmtNum(selM.thd,1)+'%';
    document.getElementById('valTHD').style.color = (selM.thd||0)<5?'var(--green)':'var(--yellow)';
    createGauge(document.getElementById('gaugeCosPhi'), selM.cosPhi||0, 1, (selM.cosPhi||0)>0.95?'#3fb950':'#d29922');
    document.getElementById('valCosPhi').textContent = fmtNum(selM.cosPhi,2);
    createGauge(document.getElementById('gaugeUnbalance'), selM.voltageUnbalance||0, 5, (selM.voltageUnbalance||0)<2?'#3fb950':'#d29922');
    document.getElementById('valUnbalance').textContent = fmtNum(selM.voltageUnbalance,1)+'%';
  }, 100);

  const eb = await apiGet('/api/enb/baseline'+(state.selectedMachineId?'?machineId='+state.selectedMachineId:''));
  if (eb?.data) {
    const dev = snap.deviationPercent||((snap.enpiNormalized-(eb.data.baselineEnpi||0))/(eb.data.baselineEnpi||1)*100);
    document.getElementById('baselineBar').innerHTML = '<span class="baseline-label">EnB (baseline):</span> <span class="baseline-value">'+fmtNum(eb.data.baselineEnpi)+' kWh/u</span> <span class="baseline-label">Déviation:</span> <span class="baseline-value">'+fmtNum(dev,1)+'%</span> <span class="badge '+(Math.abs(dev)<10?'badge-green':'badge-red')+'">'+(Math.abs(dev)<10?'NORMAL':'ALERTE')+'</span>';
  }
}

/* ===== MACHINE VIEW ===== */
async function renderMachine() {
  const el = document.getElementById('v_machine');
  const live = await apiGet('/api/machines/live');
  const machines = Array.isArray(live?.data) ? live.data : [];
  if (!state.selectedMachineId && machines[0]) state.selectedMachineId = machines[0].id;
  const m = machines.find(x => x.id === state.selectedMachineId) || machines[0] || {};
  let machOpts = machines.map(x => '<option value="'+x.id+'"'+(state.selectedMachineId===x.id?' selected':'')+'>'+x.id+' — '+x.name+'</option>').join('');

  const anomR = await apiGet('/api/anomalies/open?machineId='+(state.selectedMachineId||''));
  const machAnoms = Array.isArray(anomR?.data) ? anomR.data : [];

  el.innerHTML = '<div class="flex-between mb-2">'
    +'<select class="form-select" style="width:auto;max-width:300px" onchange="state.selectedMachineId=this.value;renderMachine()">'+machOpts+'</select>'
    +'<span class="flex-center"><span class="status-dot '+(m.status==='running'?'online':'offline')+'"></span><span class="badge '+(m.enpiStatus==='DEGRADED'?'badge-red':'badge-green')+'">'+(m.enpiStatus||m.status||'—')+'</span></span></div>'
    +'<div class="card mb-2"><div style="text-align:center"><canvas id="machGauge" width="260" height="140"></canvas>'
    +'<div class="main-gauge-value">'+fmtNum(m.enpiKwhPerUnit)+' kWh/u</div><div class="gauge-label">EnPI (kWh/u)</div></div></div>'
    +'<div class="sub-gauges-row mb-2">'
    +'<div class="card mini-gauge"><canvas id="machTHD" width="120" height="70"></canvas><div class="mini-gauge-value">'+fmtNum(m.thd,1)+'%</div><div class="gauge-label">THD</div></div>'
    +'<div class="card mini-gauge"><canvas id="machCosPhi" width="120" height="70"></canvas><div class="mini-gauge-value">'+fmtNum(m.cosPhi,2)+'</div><div class="gauge-label">cos φ</div></div>'
    +'<div class="card mini-gauge"><canvas id="machUnbal" width="120" height="70"></canvas><div class="mini-gauge-value">'+fmtNum(m.voltageUnbalance,1)+'%</div><div class="gauge-label">Déséquilibre</div></div></div>'
    +'<div class="grid grid-3 mb-2">'
    +'<div class="stat-box"><div class="stat-label">Consommation</div><div class="stat-value">'+fmtNum(m.kwh,1)+' kWh</div></div>'
    +'<div class="stat-box"><div class="stat-label">Puissance</div><div class="stat-value">'+fmtNum(m.puissanceKw,1)+' kW</div></div>'
    +'<div class="stat-box"><div class="stat-label">Charge</div><div class="stat-value">'+fmtNum(m.loadPercent,0)+'%</div></div>'
    +'<div class="stat-box"><div class="stat-label">Température</div><div class="stat-value">'+fmtNum(m.temperature,1)+'°C</div></div>'
    +'<div class="stat-box"><div class="stat-label">Humidité</div><div class="stat-value">'+fmtNum(m.humidity,0)+'%</div></div>'
    +'<div class="stat-box"><div class="stat-label">Durée fonct.</div><div class="stat-value">'+fmtNum(m.runHours,0)+' h</div></div></div>'
    +'<div class="card mb-2"><div class="card-header"><span class="card-title">Tendance EnPI</span></div>'
    +'<div class="chart-container"><canvas id="machTrend"></canvas></div></div>'
    +'<div class="card mt-2"><div class="card-header"><span class="card-title">Anomalies détectées</span><span class="badge badge-red">'+machAnoms.length+'</span></div>'
    +(machAnoms.length===0?'<p class="muted">Aucune anomalie ouverte.</p>':machAnoms.map(a =>
      '<div style="padding:12px 0;border-bottom:1px solid var(--border)"><div class="flex-between">'
      +'<div><strong class="text-red">'+(a.title||a.type||'Anomalie ML detectee ('+a.modelType+')')+'</strong><br><span class="muted">'+(a.severity||'major')+' • Score: '+(a.anomalyScore||a.score||'—')+'</span></div>'
      +'<button class="btn btn-sm btn-secondary" onclick="ackIncident(\''+a.id+'\')">Acquitter</button></div></div>'
    ).join(''))+'</div>';

  setTimeout(() => {
    createGauge(document.getElementById('machGauge'), m.enpiKwhPerUnit||0, 5, (m.enpiKwhPerUnit||0)>2.5?'#f85149':'#3fb950');
    createGauge(document.getElementById('machTHD'), m.thd||0, 10, (m.thd||0)<5?'#3fb950':'#d29922');
    createGauge(document.getElementById('machCosPhi'), m.cosPhi||0, 1, (m.cosPhi||0)>0.95?'#3fb950':'#d29922');
    createGauge(document.getElementById('machUnbal'), m.voltageUnbalance||0, 5, (m.voltageUnbalance||0)<2?'#3fb950':'#d29922');
    renderMachineTrend();
  }, 100);
}
async function renderMachineTrend() {
  const hrs = state.period==='6h'?6:state.period==='12h'?12:24;
  const tl = await apiGet('/api/analytics/energy-timeline?machineId='+(state.selectedMachineId||'')+'&windowHours='+hrs);
  const points = Array.isArray(tl?.data) ? tl.data : [];
  const canvas = document.getElementById('machTrend');
  if (!canvas || points.length === 0) return;
  if (chartInstances.machTrend) chartInstances.machTrend.destroy();
  chartInstances.machTrend = new Chart(canvas.getContext('2d'), {
    type:'line',
    data:{labels:points.map((_,i)=>'T'+(i+1)),
      datasets:[{label:'EnPI',data:points.map(p=>p.enpi||p.value||0),borderColor:'#58a6ff',tension:0.3,yAxisID:'y'},
        {label:'kW',data:points.map(p=>p.power||p.kw||0),borderColor:'#a371f7',tension:0.3,yAxisID:'y1'}]},
    options:{responsive:true,interaction:{mode:'index'},scales:{y:{position:'left',grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#8b949e'}},y1:{position:'right',grid:{display:false},ticks:{color:'#8b949e'}}},plugins:{legend:{labels:{color:'#e6edf3'}}}}
  });
}
async function ackIncident(id) {
  await apiPost('/api/incidents/ack', {incidentId:id,reason:'Acquitté depuis vue machine'});
  toast('Incident acquitté'); renderMachine();
}


/* ===== PDCA ===== */
async function renderPdca() {
  const el = document.getElementById('v_pdca');
  const r = await apiGet('/api/pdca/cycles');
  const cycles = Array.isArray(r?.data) ? r.data : [];
  const phases = ['Plan','Do','Check','Act'];
  el.innerHTML = '<div class="flex-between mb-2"><p class="muted">Gestion du cycle Plan-Do-Check-Act ISO 50001</p>'
    +'<button class="btn btn-primary" onclick="showNewPdcaModal()">+ Nouveau cycle</button></div>'
    + cycles.map(c => {
      const pi = phases.indexOf(c.currentPhase||'Plan');
      const nextPhase = phases[Math.min(pi+1, 3)];
      return '<div class="card mb-2"><div class="flex-between"><div><strong>Cycle #'+c.id+' — '+(c.machineId||'Machine 1')+'</strong>'
        +'<br><span class="muted">'+(c.objective||c.title||'')+'</span></div>'
        +'<span class="badge '+badgeClass(c.status||c.currentPhase)+'">'+(c.status||c.currentPhase)+'</span></div>'
        +'<div class="pdca-steps">'+phases.map((p,i) =>
          '<div class="pdca-step '+(i<pi?'completed':i===pi?'current':'pending')+'">'+p+'</div>'
        ).join('')+'</div>'
        +(pi<3?'<button class="btn btn-sm btn-primary" onclick="transitionPdca(\''+c.id+'\',\''+nextPhase+'\')">Avancer → '+nextPhase+'</button> ':'')
        +'<button class="btn btn-sm btn-secondary" onclick="showPdcaDetail(\''+c.id+'\')">Détails</button></div>';
    }).join('');
}
async function transitionPdca(id, toPhase) {
  const reason = prompt('Raison de la transition vers '+toPhase+' :');
  if (!reason) return;
  await apiPost('/api/pdca/transition', {pdcaCycleId:id, toPhase:toPhase, reason:reason});
  toast('Cycle avancé vers '+toPhase); renderPdca();
}
async function showPdcaDetail(id) {
  const r = await apiGet('/api/pdca/cycles/'+id);
  const c = r?.data || {};
  showModal('<h3 class="modal-title">Cycle PDCA #'+c.id+'</h3>'
    +'<p><strong>Machine:</strong> '+(c.machineId||'—')+'</p>'
    +'<p><strong>Objectif:</strong> '+(c.objective||c.title||'—')+'</p>'
    +'<p><strong>Phase:</strong> '+(c.currentPhase||'—')+'</p>'
    +'<p><strong>Cible EnPI:</strong> '+(c.targetEnpi||'—')+'</p>'
    +'<p><strong>EnPI atteint (Check):</strong> '+fmtNum(c.checkEnpiAchieved)+'</p>'
    +'<p><strong>Amélioration:</strong> '+fmtPct(c.checkImprovementProof||0)+'</p>'
    +'<div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">Fermer</button></div>');
}
function showNewPdcaModal() {
  showModal('<h3 class="modal-title">Nouveau Cycle PDCA</h3>'
    +'<div class="form-group"><label class="form-label">Machine ID</label><input id="pdcaMachine" class="form-input" value="'+(state.selectedMachineId||'')+'"/></div>'
    +'<div class="form-group"><label class="form-label">Titre</label><input id="pdcaTitle" class="form-input"/></div>'
    +'<div class="form-group"><label class="form-label">Objectif</label><input id="pdcaObjective" class="form-input"/></div>'
    +'<div class="form-group"><label class="form-label">Cible EnPI</label><input id="pdcaTarget" class="form-input" type="number" step="0.01"/></div>'
    +'<div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button>'
    +'<button class="btn btn-primary" onclick="createPdca()">Créer</button></div>');
}
async function createPdca(linkedRecoId) {
  const body = {
    machineId: document.getElementById('pdcaMachine')?.value || state.selectedMachineId,
    title: document.getElementById('pdcaTitle')?.value || 'Nouveau cycle',
    objective: document.getElementById('pdcaObjective')?.value || '',
    targetEnpi: parseFloat(document.getElementById('pdcaTarget')?.value) || null
  };
  if (linkedRecoId) body.linkedRecommendationId = linkedRecoId;
  await apiPost('/api/pdca/cycles', body);
  closeModal(); toast('Cycle PDCA créé'); renderPdca();
}

/* ===== RECOMMENDATIONS ===== */
async function renderRecommendations() {
  const el = document.getElementById('v_recommendations');
  const r = await apiGet('/api/recommendations');
  const recos = Array.isArray(r?.data) ? r.data : [];
  el.innerHTML = '<p class="muted mb-2">Recommandations IA basées sur les anomalies détectées</p>'
    + recos.map(rc => '<div class="card mb-2"><div class="flex-between">'
      +'<strong>'+(rc.title||rc.action||'Recommandation IA')+'</strong>'
      +'<span class="badge badge-blue">Confiance '+(rc.confidence?fmtPct(rc.confidence*100):fmtPct(rc.confidencePercent))+'</span></div>'
      +'<p class="muted mt-1" style="font-size:13px">'+(rc.justification||rc.description||'')+'</p>'
      +'<div class="flex-center mt-1"><span class="badge '+(rc.decision==='ACCEPTED'?'badge-green':rc.decision==='REJECTED'?'badge-red':'badge-yellow')+'">'+(rc.decision||'PENDING')+'</span>'
      +' <span class="muted">Impact: '+(rc.estimatedImpact||'—')+' énergie</span></div>'
      +'<div class="flex-center mt-2">'
      +'<button class="btn btn-sm btn-primary" onclick="acceptReco(\''+rc.id+'\')">Accepter</button>'
      +'<button class="btn btn-sm btn-danger" onclick="rejectReco(\''+rc.id+'\')">Rejeter</button>'
      +'<button class="btn btn-sm btn-secondary" onclick="showExplainability(\''+rc.id+'\')">Explicabilité</button>'
      +'<button class="btn btn-sm btn-secondary" onclick="linkRecoToPdca(\''+rc.id+'\')">→ PDCA</button>'
      +'</div></div>'
    ).join('');
}
async function acceptReco(id) { await apiPost('/api/recommendations/'+id+'/accept',{}); toast('Recommandation acceptée'); renderRecommendations(); }
async function rejectReco(id) { await apiPost('/api/recommendations/'+id+'/reject',{}); toast('Recommandation rejetée'); renderRecommendations(); }
async function showExplainability(id) {
  const r = await apiGet('/api/recommendations/'+id+'/explainability');
  const factors = Array.isArray(r?.data?.factors) ? r.data.factors : (r?.data?.shapValues || []);
  showModal('<h3 class="modal-title">Explicabilité IA</h3>'
    +'<p class="muted mb-2">Facteurs contributifs (SHAP-style)</p>'
    + factors.map(f => '<div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--border)">'
      +'<span>'+f.variable+'</span><span class="badge '+(f.direction==='increase'?'badge-red':'badge-green')+'">'
      +fmtPct((f.contribution||0)*100)+' '+f.direction+'</span></div>').join('')
    +'<div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">Fermer</button></div>');
}
function linkRecoToPdca(recoId) {
  showModal('<h3 class="modal-title">Créer PDCA depuis recommandation</h3>'
    +'<div class="form-group"><label class="form-label">Machine ID</label><input id="pdcaMachine" class="form-input" value="'+(state.selectedMachineId||'')+'"/></div>'
    +'<div class="form-group"><label class="form-label">Titre</label><input id="pdcaTitle" class="form-input" value="Action suite reco #'+recoId+'"/></div>'
    +'<div class="form-group"><label class="form-label">Objectif</label><input id="pdcaObjective" class="form-input"/></div>'
    +'<div class="form-group"><label class="form-label">Cible EnPI</label><input id="pdcaTarget" class="form-input" type="number" step="0.01"/></div>'
    +'<div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button>'
    +'<button class="btn btn-primary" onclick="createPdca(\''+recoId+'\')">Créer & Lier</button></div>');
}

/* ===== GOVERNANCE ===== */
async function renderGovernance() {
  const el = document.getElementById('v_governance');
  const r = await apiGet('/api/governance/events?limit=50');
  const events = Array.isArray(r?.data) ? r.data : [];
  el.innerHTML = '<p class="muted mb-2">Traçabilité gouvernance — who/what/when/why</p>'
    +'<div class="card"><div class="card-header"><span class="card-title">Événements récents</span></div>'
    + events.map(ev => '<div style="padding:12px 0;border-bottom:1px solid var(--border)"><div class="flex-between">'
      +'<div><strong>'+(ev.eventType||ev.type||'—')+'</strong><br><span class="muted">'+(ev.userName||ev.who||'—')+' — '+(ev.reason||ev.context||'—')+'</span></div>'
      +'<span class="muted" style="font-size:12px;white-space:nowrap">'+(ev.createdAt||ev.timestamp||'')+'</span></div></div>'
    ).join('')+'</div>';
}

/* ===== AUDIT ===== */
async function renderAudit() {
  const el = document.getElementById('v_audit');
  const [matrix, summary, exports] = await Promise.all([
    apiGet('/api/audit/matrix'), apiGet('/api/audit/summary'), apiGet('/api/audit/pre-audit-exports')
  ]);
  const clauses = Array.isArray(matrix?.data) ? matrix.data : [];
  const s = summary?.data || {};
  const exList = Array.isArray(exports?.data) ? exports.data : [];
  const covered = clauses.filter(c => c.status === 'COVERED').length;

  el.innerHTML = '<div class="flex-between mb-2"><p class="muted">Conformité ISO 50001 — Matrice preuves par clause</p>'
    +'<div class="flex-center"><button class="btn btn-primary" onclick="showReportModal()">📄 Rapport EnPI</button>'
    +'<button class="btn btn-secondary" onclick="exportPreAudit()">📦 Export pré-audit</button></div></div>'
    +'<div class="kpi-grid mb-2">'
    +'<div class="kpi-card"><div class="kpi-label">Conformité</div><div class="kpi-value text-green">'+Math.round((covered/Math.max(clauses.length,1))*100)+'%</div></div>'
    +'<div class="kpi-card"><div class="kpi-label">Clauses couvertes</div><div class="kpi-value">'+covered+'/'+clauses.length+'</div></div>'
    +'<div class="kpi-card"><div class="kpi-label">Non-conformités</div><div class="kpi-value text-red">'+(s.nonConformities||0)+'</div></div>'
    +'<div class="kpi-card"><div class="kpi-label">Exports</div><div class="kpi-value">'+exList.length+'</div></div></div>'
    +'<div class="card"><div class="card-header"><span class="card-title">Matrice ISO 50001</span></div>'
    +'<table class="data-table"><thead><tr><th>Clause</th><th>Exigence</th><th>Preuve</th><th>Statut</th></tr></thead><tbody>'
    + clauses.map(c => '<tr><td><strong>'+c.clause+'</strong></td><td>'+(c.requirement||'')+'</td><td>'+(c.evidence||'')+'</td>'
      +'<td><span class="badge '+badgeClass(c.status)+'">'+(c.status||'—')+'</span></td></tr>').join('')
    +'</tbody></table></div>';
}
function showReportModal() {
  showModal('<h3 class="modal-title">Générer Rapport EnPI</h3>'
    +'<div class="form-group"><label class="form-label">Période</label><select id="reportPeriod" class="form-select">'
    +'<option value="7">7 jours</option><option value="30" selected>30 jours</option><option value="90">90 jours</option></select></div>'
    +'<div class="form-group"><label class="form-label">Périmètre</label><select id="reportScope" class="form-select">'
    +'<option value="all">Tout le site</option></select></div>'
    +'<div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button>'
    +'<button class="btn btn-primary" onclick="generateReport()">Générer</button></div>');
}
async function generateReport() {
  const period = document.getElementById('reportPeriod')?.value || '30';
  await apiPost('/api/governance/export-audit', {periodDays:parseInt(period), scope:'all'});
  closeModal(); toast('Rapport généré'); renderAudit();
}
async function exportPreAudit() {
  await apiPost('/api/audit/pre-audit-export', {});
  toast('Export pré-audit généré'); renderAudit();
}

/* ===== DATA QUALITY ===== */
async function renderDataQuality() {
  const el = document.getElementById('v_dataQuality');
  const [summary, issues, rejects, events] = await Promise.all([
    apiGet('/api/data-quality/summary'), apiGet('/api/data-quality/issues'),
    apiGet('/api/data-quality/rejections'), apiGet('/api/ingestion/health/events?limit=20')
  ]);
  const s = summary?.data || {};
  const iss = Array.isArray(issues?.data) ? issues.data : [];
  const rej = Array.isArray(rejects?.data) ? rejects.data : [];
  const evts = Array.isArray(events?.data) ? events.data : [];

  el.innerHTML = '<div class="flex-between mb-2"><p class="muted">Monitoring qualité des sources de données et statut d\'ingestion</p>'
    +'<button class="btn btn-primary" onclick="showCsvImportModal()">📥 Importer CSV</button></div>'
    +'<div class="kpi-grid mb-2">'
    +'<div class="kpi-card"><div class="kpi-label">Score qualité</div><div class="kpi-value text-yellow">'+(s.qualityScore!=null?fmtPct(s.qualityScore):'—%')+'</div></div>'
    +'<div class="kpi-card"><div class="kpi-label">Statut</div><div class="kpi-value">'+(s.status||'—')+'</div></div>'
    +'<div class="kpi-card"><div class="kpi-label">Lignes valides</div><div class="kpi-value">'+(s.validRows||0)+'/'+(s.totalRows||0)+'</div></div>'
    +'<div class="kpi-card"><div class="kpi-label">Issues ouvertes</div><div class="kpi-value text-red">'+iss.length+'</div></div></div>'
    +'<div class="card mb-2"><div class="card-header"><span class="card-title">Anomalies qualité</span></div>'
    +(iss.length===0?'<p class="muted">Aucune issue.</p>':iss.map(i=>'<p>'+i.description+'</p>').join(''))+'</div>'
    +'<div class="card mb-2"><div class="card-header"><span class="card-title">Rejets récents</span></div>'
    +(rej.length===0?'<p class="muted">Aucun rejet.</p>':rej.map(r=>'<p>'+r.reason+'</p>').join(''))+'</div>'
    +'<div class="card"><div class="card-header"><span class="card-title">Journal d\'imports</span></div>'
    + evts.map(ev => '<div style="padding:10px 0;border-bottom:1px solid var(--border)"><div class="flex-between">'
      +'<div><strong>#'+(ev.batchId||ev.id||'')+' '+(ev.sourceName||ev.name||'')+'</strong> ('+(ev.sourceType||'')+')'
      +'<br><span class="muted">Lignes: '+(ev.insertedRows||ev.rowCount||0)+' • Rejetées: '+(ev.rejectedRows||0)+' • Score: '+fmtPct(ev.qualityScore||100)+'</span></div>'
      +'<span class="badge '+(ev.status==='SUCCESS'||!ev.status?'badge-green':'badge-yellow')+'">'+(ev.status||'SUCCESS')+'</span></div></div>'
    ).join('')+'</div>';
}
function showCsvImportModal() {
  showModal('<h3 class="modal-title">Importer CSV</h3>'
    +'<div class="form-group"><label class="form-label">Chemin fichier</label><input id="csvPath" class="form-input" placeholder="/data/raw/export.csv"/></div>'
    +'<div class="form-row"><div class="form-group"><label class="form-label">Source</label><input id="csvSource" class="form-input" value="manual_import"/></div>'
    +'<div class="form-group"><label class="form-label">Machine ID</label><input id="csvMachine" class="form-input" value="'+(state.selectedMachineId||'CMP-A')+'"/></div></div>'
    +'<div class="form-group"><label class="form-label">Max lignes</label><input id="csvMax" class="form-input" type="number" value="500"/></div>'
    +'<div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button>'
    +'<button class="btn btn-primary" onclick="doCsvImport()">Importer</button></div>');
}
async function doCsvImport() {
  const body = {
    filePath: document.getElementById('csvPath').value,
    sourceName: document.getElementById('csvSource').value,
    sourceType: 'synthetic_csv',
    machineId: document.getElementById('csvMachine').value,
    maxRows: parseInt(document.getElementById('csvMax').value) || 500
  };
  const r = await apiPost('/api/ingestion/batch/load', body);
  closeModal();
  toast(r?.data ? 'Import: '+r.data.insertedRows+' lignes insérées' : 'Erreur: '+(r?.error||'inconnue'));
  renderDataQuality();
}

/* ===== INCIDENTS ===== */
async function renderIncidents() {
  const el = document.getElementById('v_incidents');
  const r = await apiGet('/api/incidents/open');
  const incidents = Array.isArray(r?.data) ? r.data : [];
  el.innerHTML = '<p class="muted mb-2">Incidents ouverts nécessitant une action</p>'
    +(incidents.length===0?'<div class="card"><p class="muted">Aucun incident ouvert.</p></div>':'')
    + incidents.map(inc => '<div class="card mb-2"><div class="flex-between">'
      +'<div><strong>'+(inc.title||inc.type||'Incident')+'</strong><br><span class="muted">'+(inc.description||'')+'</span></div>'
      +'<button class="btn btn-sm btn-primary" onclick="ackIncident(\''+inc.id+'\')">Acquitter</button></div></div>'
    ).join('');
}

/* ===== SETTINGS ===== */
function renderSettings() {
  document.getElementById('v_settings').innerHTML = '<div class="card">'
    +'<h3 class="card-title mb-2">Paramètres</h3>'
    +'<p class="muted">Configuration de la plateforme EnMS ISO 50001.</p>'
    +'<div class="mt-2"><strong>Version:</strong> 2.0</div>'
    +'<div><strong>Utilisateur:</strong> '+(currentUser?.fullName||'—')+'</div>'
    +'<div><strong>Rôle:</strong> '+(currentUser?.role||'—')+'</div></div>';
}

/* ===== ALERTS ===== */
let alertInterval = null;
function startAlertPolling() {
  fetchAlerts();
  if (alertInterval) clearInterval(alertInterval);
  alertInterval = setInterval(fetchAlerts, 60000);
}
async function fetchAlerts() {
  const r = await apiGet('/api/alerts/unread');
  const alerts = Array.isArray(r?.data) ? r.data : [];
  const badge = document.getElementById('alertBadge');
  if (badge) {
    badge.textContent = alerts.length;
    badge.classList.toggle('hidden', alerts.length === 0);
  }
  window._alerts = alerts;
}
function showAlertPanel() {
  const alerts = window._alerts || [];
  const existing = document.querySelector('.alert-panel');
  if (existing) { existing.remove(); return; }
  const panel = document.createElement('div');
  panel.className = 'alert-panel';
  panel.innerHTML = '<div class="alert-panel-header"><strong>Alertes ('+alerts.length+')</strong>'
    +'<button class="btn btn-sm btn-secondary" onclick="this.closest(\'.alert-panel\').remove()">✕</button></div>'
    + alerts.map(a => '<div class="alert-item unread" onclick="markAlertRead(\''+a.id+'\')">'
      +'<div class="flex-between"><strong style="font-size:13px">'+(a.title||a.type||'Alerte')+'</strong>'
      +'<span class="badge '+(a.severity==='critical'?'badge-red':'badge-yellow')+'">'+(a.severity||'info')+'</span></div>'
      +'<span class="muted" style="font-size:12px">'+(a.message||a.description||'')+'</span></div>'
    ).join('')
    +(alerts.length===0?'<div style="padding:20px;text-align:center" class="muted">Aucune alerte</div>':'');
  document.body.appendChild(panel);
}
async function markAlertRead(id) {
  await apiPost('/api/alerts/mark-read', {alertId:id});
  fetchAlerts();
  const panel = document.querySelector('.alert-panel');
  if (panel) panel.remove();
  toast('Alerte marquée comme lue');
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('logoutBtn').addEventListener('click', doLogout);
  document.querySelectorAll('.quick-login .btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const acc = btn.dataset.account;
      document.getElementById('username').value = acc;
      document.getElementById('password').value = ACCOUNTS[acc] || '';
    });
  });
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.view);
      document.getElementById('sidebar').classList.remove('mobile-open');
    });
  });
  // Auto-refresh
  setInterval(() => { if (sessionToken && state.view === 'dashboard') renderDashboard(); }, 30000);
});
