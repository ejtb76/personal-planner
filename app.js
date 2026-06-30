// app.js — main application

const VERSION = '0.4';

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
    [state.tasks, state.todayEvents] = await Promise.all([
      Sheets.getAllTasks(),
      Calendar.getTodayEvents()
    ]);
    // Auto-prioritize on load
    if (state.tasks.filter(t => t.status === 'open').length > 0) {
      state.prioritized = await AI.prioritize(state.tasks, state.todayEvents);
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

  // Today's calendar events (not planner tasks)
  const calEvents = state.todayEvents.filter(e => !e.summary?.startsWith('✓'));

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
          </div>
        </div>

        ${open.length > 1 ? `
          <div class="section-label" style="margin-top:1.5rem">Daarna</div>
          <div class="task-list">
            ${open.slice(1, 4).map(t => `
              <div class="task-item" onclick="window.openTask('${t.id}')">
                <div class="task-item-main">
                  <span class="task-item-title">${t.title}</span>
                  ${deadlineBadge(t)}
                </div>
                <div class="task-item-sub">⏱ ${t.duration} min${t.aiReason ? ' · ' + t.aiReason : ''}</div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      `}

      ${calEvents.length > 0 ? `
        <div class="section-label" style="margin-top:1.5rem">Agenda vandaag</div>
        <div class="task-list">
          ${calEvents.map(e => {
            const start = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '';
            return `
              <div class="task-item cal-event">
                <div class="task-item-main">
                  <span class="task-item-title">${e.summary || 'Afspraak'}</span>
                  ${start ? `<span class="badge badge-later">${start}</span>` : ''}
                </div>
              </div>
            `;
          }).join('')}
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
          <input type="date" id="e-deadline" value="${task.deadline}">
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

  setLoading(true);
  await Calendar.scheduleTask(task, startTime);
  await Sheets.updateTask(id, { scheduled_at: startTime.toISOString() });
  await loadData();
  setLoading(false);

  const timeStr = startTime.toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  alert(`Ingepland op ${timeStr}`);
  switchView('today');
};

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

  const bestIdx = await AI.suggestSchedule(task, slots);
  const slot = slots[bestIdx];
  await Calendar.scheduleTask(task, slot.start);
  await Sheets.updateTask(id, { scheduled_at: slot.start.toISOString() });
  await loadData();
  setLoading(false);

  const timeStr = slot.start.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
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
  const reply = await AI.chat(msg, state.tasks, state.todayEvents, state.chatHistory.slice(-10));
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
