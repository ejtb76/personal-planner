// app.js — main application

const VERSION = '1.0';

import { Auth } from './auth.js';
import { Sheets } from './sheets.js';
import { Calendar } from './calendar.js';
import { AI } from './ai.js';

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  view: 'today',      // today | tasks | add | chat | settings
  tasks: [],
  todayEvents: [],
  prioritized: [],
  chatHistory: [],
  loading: false,
  config: null
};

// ─── Config ───────────────────────────────────────────────────────────────────
function loadConfig() {
  const raw = localStorage.getItem('planner_config');
  return raw ? JSON.parse(raw) : null;
}

function saveConfig(config) {
  localStorage.setItem('planner_config', JSON.stringify(config));
  state.config = config;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  state.config = loadConfig();

  // Handle OAuth callback
  const callbackHandled = Auth.handleCallback();

  if (!state.config) {
    renderSetup();
    return;
  }

  Auth.init(state.config.clientId);

  if (!Auth.isAuthenticated()) {
    renderLogin();
    return;
  }

  AI.init(state.config.anthropicKey);
  Sheets.init(state.config.spreadsheetId);

  await loadData();
  renderApp();
}

async function loadData() {
  setLoading(true);
  try {
    await Sheets.ensureSheet();
    [state.tasks, state.todayEvents, state.gezinEvents] = await Promise.all([
      Sheets.getAllTasks(),
      Calendar.getTodayEvents(),
      Calendar.getGezinEvents(new Date())
    ]);
    // Auto-prioritize on load
    if (state.tasks.filter(t => t.status === 'open').length > 0) {
      state.prioritized = await AI.prioritize(state.tasks, state.todayEvents, state.gezinEvents);
    }
  } catch (e) {
    console.error('Load error:', e);
  }
  setLoading(false);
}

// ─── Render helpers ───────────────────────────────────────────────────────────
function setLoading(val) {
  state.loading = val;
  const el = document.getElementById('loading');
  if (el) el.style.display = val ? 'flex' : 'none';
}

function $(id) { return document.getElementById(id); }

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function deadlineBadge(task) {
  const days = daysUntil(task.deadline);
  if (days === null) return '';
  if (days < 0) return `<span class="badge badge-overdue">verlopen</span>`;
  if (days === 0) return `<span class="badge badge-today">vandaag</span>`;
  if (days === 1) return `<span class="badge badge-soon">morgen</span>`;
  if (days <= 3) return `<span class="badge badge-soon">${days}d</span>`;
  return `<span class="badge badge-later">${formatDate(task.deadline)}</span>`;
}

// ─── Setup screen ─────────────────────────────────────────────────────────────
function renderSetup() {
  document.getElementById('root').innerHTML = `
    <div class="setup-screen">
      <div class="setup-logo">◈</div>
      <h1>Planner instellen</h1>
      <p class="setup-sub">Vul eenmalig je credentials in. Deze worden alleen lokaal opgeslagen.</p>

      <div class="form-group">
        <label>Google OAuth Client ID</label>
        <input type="text" id="s-client-id" placeholder="…apps.googleusercontent.com" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Google Spreadsheet ID</label>
        <input type="text" id="s-sheet-id" placeholder="Uit de URL van je Google Sheet">
        <span class="hint">Maak een lege Sheet aan en kopieer het ID uit de URL</span>
      </div>
      <div class="form-group">
        <label>Anthropic API Key</label>
        <input type="password" id="s-anthropic-key" placeholder="sk-ant-…">
      </div>

      <button class="btn-primary" onclick="window.saveSetup()">Opslaan & inloggen met Google</button>
    </div>
  `;
}

window.saveSetup = function() {
  const clientId = $('s-client-id').value.trim();
  const spreadsheetId = $('s-sheet-id').value.trim();
  const anthropicKey = $('s-anthropic-key').value.trim();

  if (!clientId || !spreadsheetId || !anthropicKey) {
    alert('Vul alle velden in.');
    return;
  }

  saveConfig({ clientId, spreadsheetId, anthropicKey });
  Auth.init(clientId);

  // Add redirect URI hint
  const redirectUri = window.location.origin + window.location.pathname;
  alert(`Bijna klaar! Voeg deze Authorized redirect URI toe in Google Cloud Console:\n\n${redirectUri}\n\nGa naar: APIs & Services → Credentials → jouw OAuth client → bewerken`);

  Auth.signIn();
};

// ─── Login screen ─────────────────────────────────────────────────────────────
function renderLogin() {
  document.getElementById('root').innerHTML = `
    <div class="setup-screen">
      <div class="setup-logo">◈</div>
      <h1>Inloggen</h1>
      <p class="setup-sub">Je sessie is verlopen.</p>
      <button class="btn-primary" onclick="window.doLogin()">Inloggen met Google</button>
      <button class="btn-ghost" onclick="window.doReset()">Opnieuw instellen</button>
    </div>
  `;
}

window.doLogin = () => Auth.signIn();
window.doReset = () => {
  localStorage.clear();
  location.reload();
};

// ─── Main app ─────────────────────────────────────────────────────────────────
function renderApp() {
  document.getElementById('root').innerHTML = `
    <div class="app">
      <div id="loading" class="loading-overlay" style="display:none">
        <div class="spinner"></div>
      </div>

      <header class="app-header">
        <span class="app-logo">◈</span>
        <span class="app-title" id="view-title">Vandaag</span>
        <button class="icon-btn" onclick="window.refreshData()" title="Verversen">↻</button>
        <span style="font-size:0.65rem;color:var(--muted)">v${VERSION}</span>
      </header>

      <main id="main-content" class="main-content"></main>

      <nav class="bottom-nav">
        <button class="nav-btn active" data-view="today" onclick="window.switchView('today')">
          <span class="nav-icon">◎</span>
          <span>Vandaag</span>
        </button>
        <button class="nav-btn" data-view="tasks" onclick="window.switchView('tasks')">
          <span class="nav-icon">≡</span>
          <span>Taken</span>
        </button>
        <button class="nav-btn nav-add" onclick="window.switchView('add')">
          <span class="nav-icon">+</span>
        </button>
        <button class="nav-btn" data-view="chat" onclick="window.switchView('chat')">
          <span class="nav-icon">◇</span>
          <span>AI</span>
        </button>
        <button class="nav-btn" data-view="settings" onclick="window.switchView('settings')">
          <span class="nav-icon">○</span>
          <span>Instellingen</span>
        </button>
      </nav>
    </div>
  `;

  switchView('today');
}

window.switchView = function(view) {
  state.view = view;
  const titles = { today: 'Vandaag', tasks: 'Alle taken', add: 'Taak toevoegen', chat: 'AI assistent', settings: 'Instellingen' };
  $('view-title').textContent = titles[view] || '';

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  const renders = { today: renderToday, tasks: renderTasks, add: renderAdd, chat: renderChat, settings: renderSettings };
  if (renders[view]) renders[view]();
};

window.refreshData = async function() {
  await loadData();
  switchView(state.view);
};

// ─── Today view ───────────────────────────────────────────────────────────────
function renderToday() {
  const open = state.prioritized.length > 0
    ? state.prioritized
    : state.tasks.filter(t => t.status === 'open');

  const now = new Date();
  const greeting = now.getHours() < 12 ? 'Goedemorgen' : now.getHours() < 18 ? 'Goedemiddag' : 'Goedenavond';
  const dateStr = now.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });

  const calEvents = (state.todayEvents || []).filter(e => !e.summary?.startsWith('✓'));
  const gezinEvents = (state.gezinEvents || []);

  const taskRow = t => `
    <div class="task-item" onclick="window.openTask('${t.id}')">
      <div class="task-item-left">
        <button class="check-btn" onclick="event.stopPropagation(); window.completeTask('${t.id}')">○</button>
      </div>
      <div class="task-item-body">
        <div class="task-item-main">
          <span class="task-item-title">${t.title}</span>
          ${deadlineBadge(t)}
        </div>
        <div class="task-item-sub">⏱ ${t.duration} min${t.aiReason ? ' · ' + t.aiReason : ''}</div>
      </div>
      <button class="btn-schedule" style="flex:0;padding:0.4rem 0.65rem;font-size:0.8rem" onclick="event.stopPropagation(); window.showScheduleModal('${t.id}')" title="Inplannen">📅</button>
      <button class="btn-schedule" style="flex:0;padding:0.4rem 0.65rem;font-size:0.8rem" onclick="event.stopPropagation(); window.postponeTask('${t.id}')" title="Doorschuiven">→</button>
    </div>
  `;

  const calRow = (e, badge) => {
    const start = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '';
    const end = e.end?.dateTime ? new Date(e.end.dateTime).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '';
    return `
      <div class="task-item cal-event">
        <div class="task-item-body">
          <div class="task-item-main">
            <span class="task-item-title">${e.summary || 'Afspraak'}</span>
            ${badge ? `<span class="badge badge-later" style="font-size:0.65rem">${badge}</span>` : ''}
          </div>
          ${start ? `<div class="task-item-sub">${start}${end ? ' – ' + end : ''}</div>` : ''}
        </div>
      </div>
    `;
  };

  $('main-content').innerHTML = `
    <div class="today-view">
      <div class="today-header">
        <div class="greeting">${greeting}</div>
        <div class="today-date">${dateStr}</div>
      </div>

      ${open.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">◎</div>
          <div>Geen openstaande taken.</div>
          <button class="btn-primary" onclick="window.switchView('add')">Taak toevoegen</button>
        </div>
      ` : `
        <div class="section-label">Nu doen</div>
        <div class="focus-task" onclick="window.openTask('${open[0].id}')">
          <div class="focus-title">${open[0].title}</div>
          ${open[0].aiReason ? `<div class="focus-reason">${open[0].aiReason}</div>` : ''}
          <div class="focus-meta">
            <span>⏱ ${open[0].duration} min</span>
            ${deadlineBadge(open[0])}
          </div>
          <div class="focus-actions">
            <button class="btn-done" onclick="event.stopPropagation(); window.completeTask('${open[0].id}')">✓ Gedaan</button>
            <button class="btn-schedule" onclick="event.stopPropagation(); window.showScheduleModal('${open[0].id}')">📅 Inplannen</button>
            <button class="btn-schedule" onclick="event.stopPropagation(); window.postponeTask('${open[0].id}')">→ Doorschuiven</button>
          </div>
        </div>

        ${open.length > 1 ? `
          <div class="section-label" style="margin-top:1.5rem">Alle taken</div>
          <div class="task-list">
            ${open.slice(1).map(taskRow).join('')}
          </div>
        ` : ''}
      `}

      ${calEvents.length > 0 ? `
        <div class="section-label" style="margin-top:1.5rem">Agenda</div>
        <div class="task-list">
          ${calEvents.map(e => calRow(e, '')).join('')}
        </div>
      ` : ''}

      ${gezinEvents.length > 0 ? `
        <div class="section-label" style="margin-top:1.5rem">Gezinsagenda</div>
        <div class="task-list">
          ${gezinEvents.map(e => calRow(e, 'Gezin')).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

// ─── Tasks view ───────────────────────────────────────────────────────────────
function renderTasks() {
  const open = state.tasks.filter(t => t.status === 'open');
  const done = state.tasks.filter(t => t.status === 'done');

  $('main-content').innerHTML = `
    <div class="tasks-view">
      ${open.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">≡</div>
          <div>Geen openstaande taken.</div>
          <button class="btn-primary" onclick="window.switchView('add')">Taak toevoegen</button>
        </div>
      ` : `
        <div class="section-label">${open.length} open</div>
        <div class="task-list">
          ${open.map(t => `
            <div class="task-item" onclick="window.openTask('${t.id}')">
              <div class="task-item-left">
                <button class="check-btn" onclick="event.stopPropagation(); window.completeTask('${t.id}')">○</button>
              </div>
              <div class="task-item-body">
                <div class="task-item-main">
                  <span class="task-item-title">${t.title}</span>
                  ${deadlineBadge(t)}
                </div>
                <div class="task-item-sub">⏱ ${t.duration} min${t.category ? ' · ' + t.category : ''}</div>
              </div>
            </div>
          `).join('')}
        </div>
      `}

      ${done.length > 0 ? `
        <div class="section-label" style="margin-top:1.5rem; opacity:0.5">Gedaan (${done.length})</div>
        <div class="task-list done-list">
          ${done.slice(-5).reverse().map(t => `
            <div class="task-item task-done">
              <div class="task-item-left"><span class="check-done">✓</span></div>
              <div class="task-item-body">
                <div class="task-item-title">${t.title}</div>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

// ─── Add task view ────────────────────────────────────────────────────────────
function renderAdd() {
  const openTasks = state.tasks.filter(t => t.status === 'open');
  $('main-content').innerHTML = `
    <div class="add-view">
      <div class="form-group">
        <label>Wat moet er gedaan worden? *</label>
        <input type="text" id="a-title" placeholder="Taak omschrijving" autofocus>
      </div>
      <div class="form-group">
        <label>Extra context (optioneel)</label>
        <textarea id="a-notes" placeholder="Wat helpt om dit te begrijpen of te starten?" rows="2"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group half">
          <label>Deadline</label>
          <input type="date" id="a-deadline">
          <label style="display:flex;align-items:center;gap:0.4rem;margin-top:0.4rem;font-size:0.82rem;color:var(--muted);text-transform:none;letter-spacing:0;cursor:pointer">
            <input type="checkbox" id="a-no-deadline" onchange="document.getElementById('a-deadline').disabled=this.checked;if(this.checked)document.getElementById('a-deadline').value=''">
            Geen deadline
          </label>
        </div>
        <div class="form-group half">
          <label>Duur (minuten)</label>
          <input type="number" id="a-duration" value="30" min="5" step="5">
        </div>
      </div>
      <div class="form-group">
        <label>Categorie</label>
        <input type="text" id="a-category" placeholder="bijv. werk, persoonlijk, gezondheid">
      </div>
      ${openTasks.length > 0 ? `
        <div class="form-group">
          <label>Wacht op (afhankelijkheid)</label>
          <select id="a-dep">
            <option value="">Geen</option>
            ${openTasks.map(t => `<option value="${t.id}">${t.title}</option>`).join('')}
          </select>
        </div>
      ` : ''}
      <button class="btn-primary" onclick="window.submitTask()">Toevoegen</button>
    </div>
  `;
}

window.submitTask = async function() {
  const title = $('a-title')?.value.trim();
  if (!title) { alert('Vul een taakomschrijving in.'); return; }

  const depVal = $('a-dep')?.value;
  const task = {
    title,
    notes: $('a-notes')?.value.trim() || '',
    deadline: $('a-deadline')?.value || '',
    duration: parseInt($('a-duration')?.value) || 30,
    category: $('a-category')?.value.trim() || '',
    dependencies: depVal ? [depVal] : []
  };

  setLoading(true);
  await Sheets.addTask(task);
  await loadData();
  setLoading(false);
  switchView('today');
};

// ─── Task detail / edit ───────────────────────────────────────────────────────
window.openTask = function(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;

  $('main-content').innerHTML = `
    <div class="add-view">
      <div class="form-group">
        <label>Taak</label>
        <input type="text" id="e-title" value="${task.title}">
      </div>
      <div class="form-group">
        <label>Context</label>
        <textarea id="e-notes" rows="2">${task.notes}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group half">
          <label>Deadline</label>
          <input type="date" id="e-deadline" value="${task.deadline}" ${!task.deadline ? 'disabled' : ''}>
          <label style="display:flex;align-items:center;gap:0.4rem;margin-top:0.4rem;font-size:0.82rem;color:var(--muted);text-transform:none;letter-spacing:0;cursor:pointer">
            <input type="checkbox" id="e-no-deadline" ${!task.deadline ? 'checked' : ''} onchange="document.getElementById('e-deadline').disabled=this.checked;if(this.checked)document.getElementById('e-deadline').value=''">
            Geen deadline
          </label>
        </div>
        <div class="form-group half">
          <label>Duur (min)</label>
          <input type="number" id="e-duration" value="${task.duration}" min="5" step="5">
        </div>
      </div>
      <div class="form-group">
        <label>Categorie</label>
        <input type="text" id="e-category" value="${task.category}">
      </div>
      <div style="display:flex;gap:0.75rem;margin-top:1rem">
        <button class="btn-primary" onclick="window.saveTask('${id}')">Opslaan</button>
        <button class="btn-done" onclick="window.completeTask('${id}')">✓ Gedaan</button>
        <button class="btn-schedule" onclick="window.showScheduleModal('${id}')">📅 Plannen</button>
        <button class="btn-schedule" onclick="window.postponeTask('${id}')">→ Doorschuiven</button>
      </div>
      <button class="btn-ghost" style="margin-top:0.5rem" onclick="window.switchView('tasks')">← Terug</button>
      <button class="btn-ghost" style="margin-top:0.5rem;color:var(--red);border-color:rgba(224,82,82,0.3)" onclick="window.deleteTask('${id}')">Verwijderen</button>
    </div>
  `;
  $('view-title').textContent = 'Taak';
};

window.saveTask = async function(id) {
  setLoading(true);
  await Sheets.updateTask(id, {
    title: $('e-title').value.trim(),
    notes: $('e-notes').value.trim(),
    deadline: $('e-deadline').value,
    duration: parseInt($('e-duration').value) || 30,
    category: $('e-category').value.trim()
  });
  await loadData();
  setLoading(false);
  switchView('tasks');
};

// ─── Later vandaag met ruimtecheck ────────────────────────────────────────────
async function _laterTodayWithCheck(task) {
  setLoading(true);
  const slots = await Calendar.getFreeSlots(new Date(), task.duration);
  setLoading(false);

  if (slots.length === 0) {
    alert('Er zijn geen vrije tijdsloten meer vandaag.');
    return;
  }

  const totalFree = slots.reduce((sum, s) => sum + (s.end - s.start) / 60000, 0);
  const tight = slots.length === 1 || totalFree < task.duration * 2;

  if (tight) {
    const lastSlot = slots[slots.length - 1];
    const eindtijd = lastSlot.end.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-title">Weinig ruimte vandaag</div>
        <div style="font-size:0.88rem;color:var(--muted);line-height:1.5">
          Er is nog <strong>${Math.round(totalFree)} minuten</strong> vrije tijd over (tot ${eindtijd}).
          ${slots.length === 1 ? 'Er is nog maar één tijdslot beschikbaar.' : ''}
        </div>
        <div class="modal-options" style="margin-top:0.75rem">
          <button class="btn-modal-option" id="lt-proceed">Toch vandaag inplannen</button>
          <button class="btn-modal-option" id="lt-other">Andere dag kiezen</button>
        </div>
        <div class="modal-actions">
          <button class="btn-ghost" id="lt-cancel">Annuleren</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#lt-cancel').addEventListener('click', () => document.body.removeChild(overlay));
    overlay.querySelector('#lt-proceed').addEventListener('click', () => {
      document.body.removeChild(overlay);
      window.showScheduleModal(task.id);
    });
    overlay.querySelector('#lt-other').addEventListener('click', () => {
      document.body.removeChild(overlay);
      window.postponeTask(task.id);
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });
  } else {
    window.showScheduleModal(task.id);
  }
}

// ─── Postpone task ────────────────────────────────────────────────────────────
window.postponeTask = function(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const minDateStr = tomorrow.toISOString().slice(0, 10);

  if (task.deadline) {
    const deadline = new Date(task.deadline);
    deadline.setHours(0, 0, 0, 0);
    const daysLeft = Math.round((deadline - today) / 86400000);

    if (daysLeft <= 1) {
      _showPostponeWarning(task, daysLeft, minDateStr);
      return;
    }
  }

  _showPostponePicker(task, minDateStr, task.deadline ? new Date(task.deadline).toISOString().slice(0, 10) : '');
};

function _showPostponeWarning(task, daysLeft, minDateStr) {
  const label = daysLeft <= 0 ? 'vandaag' : 'morgen';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-title">Deadline is ${label}</div>
      <div style="font-size:0.88rem;color:var(--muted);line-height:1.5;margin-bottom:0.25rem">
        De deadline voor <strong>${task.title}</strong> is ${label}. Doorschuiven betekent dat je de deadline mist.
      </div>
      <div class="modal-options">
        <button class="btn-modal-option" id="pp-keep">Laten staan — ik doe het vandaag</button>
        <button class="btn-modal-option" id="pp-later-today">⏱ Later vandaag inplannen</button>
        <button class="btn-modal-option" id="pp-change">Deadline aanpassen en doorschuiven</button>
      </div>
      <div class="modal-dt-picker" id="pp-deadline-section">
        <label style="font-size:0.78rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em">Nieuwe deadline</label>
        <input type="date" id="pp-new-deadline" min="${minDateStr}">
        <div class="modal-options" id="pp-date-options" style="margin-top:0.75rem">
          <button class="btn-modal-option" id="pp-ai-date">✨ AI kiest de beste dag</button>
          <button class="btn-modal-option" id="pp-manual-date">📅 Ik kies zelf</button>
        </div>
        <div class="modal-dt-picker" id="pp-manual-section">
          <input type="date" id="pp-new-date" min="${minDateStr}">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" id="pp-cancel">Annuleren</button>
        <button class="btn-primary" id="pp-confirm" style="display:none">Bevestigen</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#pp-keep').addEventListener('click', () => document.body.removeChild(overlay));
  overlay.querySelector('#pp-cancel').addEventListener('click', () => document.body.removeChild(overlay));

  overlay.querySelector('#pp-later-today').addEventListener('click', () => {
    document.body.removeChild(overlay);
    _laterTodayWithCheck(task);
  });

  overlay.querySelector('#pp-change').addEventListener('click', () => {
    overlay.querySelector('#pp-change').classList.add('selected');
    overlay.querySelector('#pp-deadline-section').classList.add('visible');
  });

  overlay.querySelector('#pp-ai-date').addEventListener('click', () => {
    overlay.querySelector('#pp-ai-date').classList.add('selected');
    overlay.querySelector('#pp-manual-date').classList.remove('selected');
    overlay.querySelector('#pp-manual-section').classList.remove('visible');
    overlay.querySelector('#pp-confirm').style.display = '';
    overlay.querySelector('#pp-confirm').dataset.mode = 'ai';
  });

  overlay.querySelector('#pp-manual-date').addEventListener('click', () => {
    overlay.querySelector('#pp-manual-date').classList.add('selected');
    overlay.querySelector('#pp-ai-date').classList.remove('selected');
    overlay.querySelector('#pp-manual-section').classList.add('visible');
    overlay.querySelector('#pp-confirm').style.display = '';
    overlay.querySelector('#pp-confirm').dataset.mode = 'manual';
  });

  overlay.querySelector('#pp-confirm').addEventListener('click', async () => {
    const newDeadline = overlay.querySelector('#pp-new-deadline').value;
    if (!newDeadline) { alert('Vul een nieuwe deadline in.'); return; }
    const mode = overlay.querySelector('#pp-confirm').dataset.mode;
    if (mode === 'manual') {
      const newDate = overlay.querySelector('#pp-new-date').value;
      if (!newDate) { alert('Kies een datum.'); return; }
      document.body.removeChild(overlay);
      _doPostpone(task, newDate, newDeadline);
    } else {
      document.body.removeChild(overlay);
      setLoading(true);
      const aiDate = await AI.suggestPostponeDate({ ...task, deadline: newDeadline }, newDeadline, state.tasks);
      setLoading(false);
      if (!aiDate) { alert('AI kon geen geschikte datum vinden. Kies zelf een datum.'); return; }
      _doPostpone(task, aiDate, newDeadline);
    }
  });

  overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });
}

function _showPostponePicker(task, minDateStr, maxDateStr) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-title">Doorschuiven naar</div>
      ${maxDateStr ? `<div style="font-size:0.75rem;color:var(--muted);margin-bottom:0.25rem">Deadline: ${new Date(maxDateStr).toLocaleDateString('nl-NL', {day:'numeric',month:'long'})}</div>` : ''}
      <div class="modal-options">
        <button class="btn-modal-option" id="pp-later-today">⏱ Later vandaag</button>
        <button class="btn-modal-option" id="pp-ai-date">✨ AI kiest de beste dag</button>
        <button class="btn-modal-option" id="pp-manual-date">📅 Ik kies zelf</button>
      </div>
      <div class="modal-dt-picker" id="pp-manual-section">
        <input type="date" id="pp-date" min="${minDateStr}" ${maxDateStr ? `max="${maxDateStr}"` : ''}>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" id="pp-cancel">Annuleren</button>
        <button class="btn-primary" id="pp-confirm" style="display:none">Doorschuiven</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#pp-cancel').addEventListener('click', () => document.body.removeChild(overlay));

  overlay.querySelector('#pp-later-today').addEventListener('click', () => {
    document.body.removeChild(overlay);
    _laterTodayWithCheck(task);
  });

  overlay.querySelector('#pp-ai-date').addEventListener('click', () => {
    overlay.querySelector('#pp-ai-date').classList.add('selected');
    overlay.querySelector('#pp-manual-date').classList.remove('selected');
    overlay.querySelector('#pp-manual-section').classList.remove('visible');
    overlay.querySelector('#pp-confirm').style.display = '';
    overlay.querySelector('#pp-confirm').dataset.mode = 'ai';
  });

  overlay.querySelector('#pp-manual-date').addEventListener('click', () => {
    overlay.querySelector('#pp-manual-date').classList.add('selected');
    overlay.querySelector('#pp-ai-date').classList.remove('selected');
    overlay.querySelector('#pp-manual-section').classList.add('visible');
    overlay.querySelector('#pp-confirm').style.display = '';
    overlay.querySelector('#pp-confirm').dataset.mode = 'manual';
  });

  overlay.querySelector('#pp-confirm').addEventListener('click', async () => {
    const mode = overlay.querySelector('#pp-confirm').dataset.mode;
    if (mode === 'manual') {
      const newDate = overlay.querySelector('#pp-date').value;
      if (!newDate) { alert('Kies een datum.'); return; }
      document.body.removeChild(overlay);
      _doPostpone(task, newDate, null);
    } else {
      document.body.removeChild(overlay);
      setLoading(true);
      const aiDate = await AI.suggestPostponeDate(task, task.deadline || null, state.tasks);
      setLoading(false);
      if (!aiDate) { alert('AI kon geen geschikte datum vinden. Kies zelf een datum.'); return; }
      _doPostpone(task, aiDate, null);
    }
  });

  overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });
}

async function _doPostpone(task, newDateStr, newDeadline) {
  setLoading(true);
  await Calendar.deleteTaskEvent(task.id);

  const updates = { scheduled_at: '' };
  if (newDeadline) updates.deadline = newDeadline;
  await Sheets.updateTask(task.id, updates);

  const newDate = new Date(newDateStr);
  const gezinEvents = await Calendar.getGezinEvents(newDate);
  const slots = await Calendar.getFreeSlots(newDate, task.duration);

  if (slots.length > 0) {
    const updatedTask = newDeadline ? { ...task, deadline: newDeadline } : task;
    const bestIdx = await AI.suggestSchedule(updatedTask, slots, gezinEvents);
    const slot = slots[bestIdx];
    await Calendar.scheduleTask(updatedTask, slot.start);
    await Sheets.updateTask(task.id, { scheduled_at: slot.start.toISOString() });
  }

  await loadData();
  setLoading(false);

  const dateLabel = newDate.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
  alert(`Doorgeschoven naar ${dateLabel}.${slots.length === 0 ? ' Geen vrije tijdsloten gevonden op die dag — taak staat open zonder agenda-event.' : ''}`);
  switchView('today');
}

window.deleteTask = async function(id) {
  if (!confirm('Taak verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
  setLoading(true);
  await Sheets.deleteTask(id);
  await Calendar.deleteTaskEvent(id);
  await loadData();
  setLoading(false);
  switchView('tasks');
};

window.completeTask = async function(id) {
  setLoading(true);
  await Sheets.completeTask(id);
  await loadData();
  setLoading(false);
  switchView('today');
};

// ─── Schedule modal ───────────────────────────────────────────────────────────
window.showScheduleModal = function(id) {
  const now = new Date();
  const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-title">Wanneer wil je dit inplannen?</div>
      <div class="modal-options">
        <button class="btn-modal-option" id="opt-ai">✨ AI kiest het beste moment voor mij</button>
        <button class="btn-modal-option" id="opt-manual">📅 Zelf een datum en tijd kiezen</button>
      </div>
      <div class="modal-dt-picker" id="dt-picker">
        <input type="datetime-local" id="dt-input" min="${localIso}" value="${localIso}">
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" id="modal-cancel">Annuleren</button>
        <button class="btn-primary" id="modal-confirm" style="display:none">Inplannen</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#opt-ai').addEventListener('click', () => {
    document.body.removeChild(overlay);
    window.scheduleTask(id);
  });

  overlay.querySelector('#opt-manual').addEventListener('click', () => {
    overlay.querySelector('#opt-manual').classList.add('selected');
    overlay.querySelector('#opt-ai').classList.remove('selected');
    overlay.querySelector('#dt-picker').classList.add('visible');
    overlay.querySelector('#modal-confirm').style.display = '';
  });

  overlay.querySelector('#modal-cancel').addEventListener('click', () => {
    document.body.removeChild(overlay);
  });

  overlay.querySelector('#modal-confirm').addEventListener('click', () => {
    const val = overlay.querySelector('#dt-input').value;
    if (!val) return;
    document.body.removeChild(overlay);
    window.scheduleTaskManual(id, val);
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) document.body.removeChild(overlay);
  });
};

window.scheduleTaskManual = async function(id, datetimeLocalStr) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;

  const startTime = new Date(datetimeLocalStr);
  if (startTime <= new Date()) {
    alert('Kies een tijdstip in de toekomst.');
    return;
  }

  const gezinEvents = await Calendar.getGezinEvents(startTime);
  const conflicts = gezinConflictsAt(startTime, task.duration, gezinEvents);
  if (conflicts.length > 0) {
    const names = conflicts.map(e => e.summary).join(', ');
    const proceed = confirm(`Je hebt op dit tijdstip al "${names}" in de gezinsagenda staan. Toch op dit tijdstip inplannen?`);
    if (!proceed) return;
  }

  setLoading(true);
  await Calendar.scheduleTask(task, startTime);
  await Sheets.updateTask(id, { scheduled_at: startTime.toISOString() });
  await loadData();
  setLoading(false);

  const timeStr = startTime.toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  alert(`Ingepland op ${timeStr}`);
  switchView('today');
};

// ─── Gezin conflict check ─────────────────────────────────────────────────────
function gezinConflictsAt(startTime, durationMin, gezinEvents) {
  const end = new Date(startTime.getTime() + durationMin * 60000);
  return gezinEvents.filter(e => {
    if (!e.start?.dateTime) return false;
    const evStart = new Date(e.start.dateTime);
    const evEnd = new Date(e.end.dateTime);
    return evStart < end && evEnd > startTime;
  });
}

// ─── Schedule task ────────────────────────────────────────────────────────────
window.scheduleTask = async function(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;

  setLoading(true);
  const today = new Date();
  const slots = await Calendar.getFreeSlots(today, task.duration);

  if (slots.length === 0) {
    setLoading(false);
    alert('Geen vrije tijdsloten gevonden voor vandaag.');
    return;
  }

  const gezinEvents = await Calendar.getGezinEvents(today);
  const bestIdx = await AI.suggestSchedule(task, slots, gezinEvents);
  let chosenSlot = slots[bestIdx];

  const conflicts = gezinConflictsAt(chosenSlot.start, task.duration, gezinEvents);
  if (conflicts.length > 0) {
    setLoading(false);
    const names = conflicts.map(e => e.summary).join(', ');
    const planAround = confirm(`Je hebt op dit tijdstip al "${names}" in de gezinsagenda staan. Moet ik hier omheen plannen?`);
    if (planAround) {
      const clearSlots = slots.filter(s => gezinConflictsAt(s.start, task.duration, gezinEvents).length === 0);
      if (clearSlots.length === 0) {
        alert('Er zijn geen vrije tijdsloten die niet overlappen met de gezinsagenda.');
        return;
      }
      setLoading(true);
      const newIdx = await AI.suggestSchedule(task, clearSlots, gezinEvents);
      chosenSlot = clearSlots[newIdx];
    } else {
      setLoading(true);
    }
  }

  await Calendar.scheduleTask(task, chosenSlot.start);
  await Sheets.updateTask(id, { scheduled_at: chosenSlot.start.toISOString() });
  await loadData();
  setLoading(false);

  const timeStr = chosenSlot.start.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  alert(`Ingepland om ${timeStr}`);
  switchView('today');
};

// ─── Chat view ────────────────────────────────────────────────────────────────
function renderChat() {
  $('main-content').innerHTML = `
    <div class="chat-view">
      <div class="chat-messages" id="chat-messages">
        ${state.chatHistory.length === 0 ? `
          <div class="chat-bubble ai-bubble">
            Hoi! Vraag me gerust wat je nu het beste kunt doen, of wat er op je planning staat.
          </div>
        ` : state.chatHistory.map(m => `
          <div class="chat-bubble ${m.role === 'user' ? 'user-bubble' : 'ai-bubble'}">${m.content}</div>
        `).join('')}
      </div>
      <div class="chat-input-row">
        <input type="text" id="chat-input" placeholder="Stel een vraag…" onkeydown="if(event.key==='Enter') window.sendChat()">
        <button class="chat-send-btn" onclick="window.sendChat()">→</button>
      </div>
    </div>
  `;
  const msgs = $('chat-messages');
  msgs.scrollTop = msgs.scrollHeight;
}

window.sendChat = async function() {
  const input = $('chat-input');
  const msg = input.value.trim();
  if (!msg) return;

  state.chatHistory.push({ role: 'user', content: msg });
  input.value = '';
  renderChat();

  setLoading(true);
  const reply = await AI.chat(msg, state.tasks, state.todayEvents, state.chatHistory.slice(-10), state.gezinEvents || []);
  setLoading(false);

  state.chatHistory.push({ role: 'assistant', content: reply });
  renderChat();
};

// ─── Settings view ────────────────────────────────────────────────────────────
function renderSettings() {
  const config = state.config || {};
  $('main-content').innerHTML = `
    <div class="add-view">
      <div class="section-label">Configuratie</div>
      <div class="form-group">
        <label>Google OAuth Client ID</label>
        <input type="text" id="cfg-client-id" value="${config.clientId || ''}">
      </div>
      <div class="form-group">
        <label>Google Spreadsheet ID</label>
        <input type="text" id="cfg-sheet-id" value="${config.spreadsheetId || ''}">
      </div>
      <div class="form-group">
        <label>Anthropic API Key</label>
        <input type="password" id="cfg-anthropic-key" value="${config.anthropicKey || ''}">
      </div>
      <button class="btn-primary" onclick="window.saveSettings()">Opslaan</button>
      <button class="btn-ghost" style="margin-top:0.5rem;color:#e05;" onclick="window.doReset()">Alles wissen & opnieuw</button>
      <div style="text-align:center;font-size:0.75rem;color:var(--muted);margin-top:1rem">v${VERSION}</div>
    </div>
  `;
}

window.saveSettings = function() {
  saveConfig({
    clientId: $('cfg-client-id').value.trim(),
    spreadsheetId: $('cfg-sheet-id').value.trim(),
    anthropicKey: $('cfg-anthropic-key').value.trim()
  });
  alert('Opgeslagen. Herlaad de pagina om wijzigingen toe te passen.');
};

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
