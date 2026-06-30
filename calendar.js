// calendar.js — Google Calendar timeblocking

import { Auth } from './auth.js';

const BASE = 'https://www.googleapis.com/calendar/v3';

export const Calendar = {
  calendarId: 'primary',

  async getTodayEvents() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

    const res = await fetch(
      `${BASE}/calendars/${encodeURIComponent(this.calendarId)}/events?timeMin=${start}&timeMax=${end}&singleEvents=true&orderBy=startTime`,
      { headers: Auth.getHeaders() }
    );
    const data = await res.json();
    return data.items || [];
  },

  async getWeekEvents() {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - now.getDay() + 1);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 7);

    const res = await fetch(
      `${BASE}/calendars/${encodeURIComponent(this.calendarId)}/events?timeMin=${monday.toISOString()}&timeMax=${sunday.toISOString()}&singleEvents=true&orderBy=startTime`,
      { headers: Auth.getHeaders() }
    );
    const data = await res.json();
    return data.items || [];
  },

  async getFreeSlots(date, durationMinutes) {
    // Get events for the day and find free slots between 8:00 and 21:00
    const d = new Date(date);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8, 0);
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 21, 0);

    const res = await fetch(
      `${BASE}/calendars/${encodeURIComponent(this.calendarId)}/events?timeMin=${start.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime`,
      { headers: Auth.getHeaders() }
    );
    const data = await res.json();
    const events = (data.items || []).filter(e => e.start?.dateTime); // exclude all-day

    const slots = [];
    const now = new Date();
    let cursor = new Date(Math.max(start.getTime(), now.getTime()));

    for (const event of events) {
      const evStart = new Date(event.start.dateTime);
      const evEnd = new Date(event.end.dateTime);
      const gap = (evStart - cursor) / 60000;
      if (gap >= durationMinutes) {
        slots.push({ start: new Date(cursor), end: evStart });
      }
      if (evEnd > cursor) cursor = evEnd;
    }

    // Check remaining time after last event
    const remaining = (end - cursor) / 60000;
    if (remaining >= durationMinutes) {
      slots.push({ start: new Date(cursor), end });
    }

    return slots;
  },

  async scheduleTask(task, startTime) {
    const start = new Date(startTime);
    const end = new Date(start.getTime() + task.duration * 60000);

    const event = {
      summary: `✓ ${task.title}`,
      description: task.notes || '',
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      colorId: '2', // sage green
      extendedProperties: {
        private: { planner_task_id: task.id }
      }
    };

    const res = await fetch(
      `${BASE}/calendars/${encodeURIComponent(this.calendarId)}/events`,
      {
        method: 'POST',
        headers: Auth.getHeaders(),
        body: JSON.stringify(event)
      }
    );
    return res.json();
  },

  async deleteTaskEvent(taskId) {
    // Find and delete calendar event linked to this task
    const now = new Date();
    const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const res = await fetch(
      `${BASE}/calendars/${encodeURIComponent(this.calendarId)}/events?timeMin=${now.toISOString()}&timeMax=${future.toISOString()}&privateExtendedProperty=planner_task_id=${taskId}`,
      { headers: Auth.getHeaders() }
    );
    const data = await res.json();
    for (const event of data.items || []) {
      await fetch(
        `${BASE}/calendars/${encodeURIComponent(this.calendarId)}/events/${event.id}`,
        { method: 'DELETE', headers: Auth.getHeaders() }
      );
    }
  }
};
