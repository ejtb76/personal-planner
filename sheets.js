// sheets.js — Google Sheets as task database

import { Auth } from './auth.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// Column mapping (0-indexed)
// A: id | B: title | C: notes | D: deadline | E: duration_min | F: priority
// G: status | H: category | I: dependencies | J: created_at | K: scheduled_at

const COL = {
  id: 0, title: 1, notes: 2, deadline: 3, duration: 4,
  priority: 5, status: 6, category: 7, dependencies: 8,
  created_at: 9, scheduled_at: 10
};

export const Sheets = {
  spreadsheetId: null,
  sheetName: 'Taken',

  init(spreadsheetId) {
    this.spreadsheetId = spreadsheetId;
  },

  async ensureSheet() {
    // Check if sheet exists, if not create it with headers
    const res = await fetch(
      `${BASE}/${this.spreadsheetId}?fields=sheets.properties.title`,
      { headers: Auth.getHeaders() }
    );
    const data = await res.json();
    const exists = data.sheets?.some(s => s.properties.title === this.sheetName);
    if (!exists) {
      await this._createSheet();
    }
  },

  async _createSheet() {
    // Add sheet
    await fetch(`${BASE}/${this.spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: Auth.getHeaders(),
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: this.sheetName } } }]
      })
    });
    // Add headers
    await this._write(`${this.sheetName}!A1:K1`, [[
      'id', 'title', 'notes', 'deadline', 'duration_min',
      'priority', 'status', 'category', 'dependencies', 'created_at', 'scheduled_at'
    ]]);
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

  async _append(values) {
    return fetch(
      `${BASE}/${this.spreadsheetId}/values/${encodeURIComponent(this.sheetName + '!A:K')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: Auth.getHeaders(),
        body: JSON.stringify({ values: [values] })
      }
    );
  },

  async getAllTasks() {
    const res = await fetch(
      `${BASE}/${this.spreadsheetId}/values/${encodeURIComponent(this.sheetName + '!A2:K')}`,
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
      scheduled_at: row[COL.scheduled_at] || ''
    };
  },

  async addTask(task) {
    const id = 'task_' + Date.now();
    const now = new Date().toISOString();
    await this._append([
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
      ''
    ]);
    return id;
  },

  async updateTask(id, fields) {
    const tasks = await this.getAllTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return;
    const rowNum = idx + 2; // +1 for header, +1 for 1-indexed
    const updated = { ...tasks[idx], ...fields };
    await this._write(`${this.sheetName}!A${rowNum}:K${rowNum}`, [[
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
      updated.scheduled_at
    ]]);
  },

  async completeTask(id) {
    await this.updateTask(id, { status: 'done' });
  },

  async deleteTask(id) {
    const tasks = await this.getAllTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return;
    const rowIndex = idx + 1; // +1 for header row (0-indexed in API)

    const metaRes = await fetch(
      `${BASE}/${this.spreadsheetId}?fields=sheets.properties`,
      { headers: Auth.getHeaders() }
    );
    const meta = await metaRes.json();
    const sheet = meta.sheets?.find(s => s.properties.title === this.sheetName);
    if (!sheet) return;
    const sheetId = sheet.properties.sheetId;

    await fetch(`${BASE}/${this.spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: Auth.getHeaders(),
      body: JSON.stringify({
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
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
