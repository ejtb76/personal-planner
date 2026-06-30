// sheets.js — Google Sheets as task database

import { Auth } from './auth.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// Column mapping (0-indexed)
// A: id | B: title | C: notes | D: deadline | E: duration_min | F: priority
// G: status | H: category | I: dependencies | J: created_at | K: scheduled_at
// L: recurrence | M: no_weekend

const COL = {
  id: 0, title: 1, notes: 2, deadline: 3, duration: 4,
  priority: 5, status: 6, category: 7, dependencies: 8,
  created_at: 9, scheduled_at: 10, recurrence: 11, no_weekend: 12
};

export const Sheets = {
  spreadsheetId: null,
  sheetName: 'Taken',
  statsSheetName: 'Statistieken',

  init(spreadsheetId) {
    this.spreadsheetId = spreadsheetId;
  },

  async ensureSheet() {
    const res = await fetch(
      `${BASE}/${this.spreadsheetId}?fields=sheets.properties.title`,
      { headers: Auth.getHeaders() }
    );
    const data = await res.json();
    const sheets = data.sheets || [];
    if (!sheets.some(s => s.properties.title === this.sheetName)) {
      await this._createSheet();
    }
    if (!sheets.some(s => s.properties.title === this.statsSheetName)) {
      await this._createStatsSheet();
    }
  },

  async _createSheet() {
    await fetch(`${BASE}/${this.spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: Auth.getHeaders(),
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: this.sheetName } } }]
      })
    });
    await this._write(`${this.sheetName}!A1:M1`, [[
      'id', 'title', 'notes', 'deadline', 'duration_min',
      'priority', 'status', 'category', 'dependencies', 'created_at', 'scheduled_at', 'recurrence', 'no_weekend'
    ]]);
  },

  async _createStatsSheet() {
    await fetch(`${BASE}/${this.spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: Auth.getHeaders(),
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: this.statsSheetName } } }]
      })
    });
    await this._write(`${this.statsSheetName}!A1:D1`, [
      ['completed_at', 'task_id', 'task_title', 'recurrence']
    ]);
  },

  async _write(range, values) {
    return fetch(
      `${BASE}/${this.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: Auth.getHeaders(),
        body: JSON.stringify({ values })
      }
    );
  },

  async _append(sheetName, colRange, values) {
    return fetch(
      `${BASE}/${this.spreadsheetId}/values/${encodeURIComponent(sheetName + '!' + colRange)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: Auth.getHeaders(),
        body: JSON.stringify({ values: [values] })
      }
    );
  },

  async getAllTasks() {
    const res = await fetch(
      `${BASE}/${this.spreadsheetId}/values/${encodeURIComponent(this.sheetName + '!A2:M')}`,
      { headers: Auth.getHeaders() }
    );
    const data = await res.json();
    const rows = data.values || [];
    return rows.map(row => this._rowToTask(row)).filter(t => t.id);
  },

  _rowToTask(row) {
    return {
      id: row[COL.id] || '',
      title: row[COL.title] || '',
      notes: row[COL.notes] || '',
      deadline: row[COL.deadline] || '',
      duration: parseInt(row[COL.duration]) || 30,
      priority: parseInt(row[COL.priority]) || 0,
      status: row[COL.status] || 'open',
      category: row[COL.category] || '',
      dependencies: row[COL.dependencies] ? row[COL.dependencies].split(',') : [],
      created_at: row[COL.created_at] || '',
      scheduled_at: row[COL.scheduled_at] || '',
      recurrence: row[COL.recurrence] || '',
      no_weekend: row[COL.no_weekend] === 'true'
    };
  },

  async addTask(task) {
    const id = 'task_' + Date.now();
    const now = new Date().toISOString();
    await this._append(this.sheetName, 'A:M', [
      id,
      task.title,
      task.notes || '',
      task.deadline || '',
      task.duration || 30,
      task.priority || 0,
      'open',
      task.category || '',
      (task.dependencies || []).join(','),
      now,
      '',
      task.recurrence || '',
      task.no_weekend ? 'true' : ''
    ]);
    return id;
  },

  async updateTask(id, fields) {
    const tasks = await this.getAllTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return;
    const rowNum = idx + 2;
    const updated = { ...tasks[idx], ...fields };
    await this._write(`${this.sheetName}!A${rowNum}:M${rowNum}`, [[
      updated.id,
      updated.title,
      updated.notes,
      updated.deadline,
      updated.duration,
      updated.priority,
      updated.status,
      updated.category,
      updated.dependencies.join(','),
      updated.created_at,
      updated.scheduled_at,
      updated.recurrence || '',
      updated.no_weekend ? 'true' : ''
    ]]);
  },

  async completeTask(id) {
    const tasks = await this.getAllTasks();
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    if (task.recurrence) {
      await this._append(this.statsSheetName, 'A:D', [
        new Date().toISOString(), task.id, task.title, task.recurrence
      ]);
      await this.updateTask(id, { status: 'open', scheduled_at: '' });
    } else {
      await this.updateTask(id, { status: 'done' });
    }
  },

  async deleteTask(id) {
    const tasks = await this.getAllTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return;
    const rowIndex = idx + 1;

    const metaRes = await fetch(
      `${BASE}/${this.spreadsheetId}?fields=sheets.properties`,
      { headers: Auth.getHeaders() }
    );
    const meta = await metaRes.json();
    const sheet = meta.sheets?.find(s => s.properties.title === this.sheetName);
    if (!sheet) return;

    await fetch(`${BASE}/${this.spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: Auth.getHeaders(),
      body: JSON.stringify({
        requests: [{
          deleteDimension: {
            range: {
              sheetId: sheet.properties.sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex,
              endIndex: rowIndex + 1
            }
          }
        }]
      })
    });
  }
};
