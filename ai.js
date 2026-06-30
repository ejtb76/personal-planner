// ai.js — Claude API integration for prioritization and chat

export const AI = {
  apiKey: null,

  init(apiKey) {
    this.apiKey = apiKey;
  },

  async _call(systemPrompt, userMessage) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });
    const data = await res.json();
    return data.content?.[0]?.text || '';
  },

  async prioritize(tasks, calendarEvents) {
    const openTasks = tasks.filter(t => t.status === 'open');
    if (openTasks.length === 0) return [];

    const now = new Date();
    const todayStr = now.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });

    const taskList = openTasks.map(t => ({
      id: t.id,
      title: t.title,
      deadline: t.deadline || 'geen deadline',
      duration: t.duration + ' min',
      category: t.category || '-',
      notes: t.notes || ''
    }));

    const eventList = calendarEvents.map(e => ({
      title: e.summary,
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date
    }));

    const system = `Je bent een planningsassistent. Rangschik taken op basis van objectieve criteria: deadline-urgentie, tijdsduur, agenda-ruimte en onderlinge afhankelijkheden. Geen aanmoedigingen, geen opvulling.

Per taak één zin: de feitelijke reden waarom deze hoger staat dan de volgende. Benoem het concrete criterium (bijv. "deadline morgen", "blokkeert taak X", "past alleen in de ochtend").
Antwoord in het Nederlands.
Retourneer ALLEEN valide JSON in dit formaat:
[{"id": "task_id", "reason": "korte feitelijke reden"}]`;

    const user = `Vandaag is het ${todayStr}.

Mijn taken:
${JSON.stringify(taskList, null, 2)}

Wat er vandaag al in mijn agenda staat:
${JSON.stringify(eventList, null, 2)}

Rangschik mijn taken van meest naar minst urgent/belangrijk voor vandaag. Houd rekening met deadlines, hoe lang iets duurt, en wat er al in de agenda staat.`;

    try {
      const response = await this._call(system, user);
      // Strip potential markdown code blocks
      const clean = response.replace(/```json|```/g, '').trim();
      const ranked = JSON.parse(clean);
      // Return tasks in ranked order with reasons
      return ranked.map(r => ({
        ...openTasks.find(t => t.id === r.id),
        aiReason: r.reason
      })).filter(Boolean);
    } catch (e) {
      console.error('AI prioritize error:', e);
      return openTasks;
    }
  },

  async chat(message, tasks, calendarEvents, history = []) {
    const openTasks = tasks.filter(t => t.status === 'open');
    const todayStr = new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });

    const taskSummary = openTasks.map(t =>
      `- ${t.title} (${t.deadline ? 'deadline: ' + t.deadline : 'geen deadline'}, ${t.duration} min${t.notes ? ', ' + t.notes : ''})`
    ).join('\n');

    const eventSummary = calendarEvents.map(e =>
      `- ${e.summary}: ${e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : 'hele dag'}`
    ).join('\n');

    const system = `Je bent een planningsassistent. Vandaag is ${todayStr}.

De gebruiker heeft de volgende openstaande taken:
${taskSummary || 'Geen openstaande taken.'}

Wat er vandaag in de agenda staat:
${eventSummary || 'Niets gepland.'}

Toon: zakelijk, feitelijk, bondig. Geen aanmoedigingen, geen complimenten, geen holle frasen. Geef concrete adviezen met een korte, heldere onderbouwing op basis van deadlines, duur en agenda. Als de gebruiker het er niet mee eens is, heroverweeg dan op basis van de argumenten — niet om een plezier te doen. Spreek de gebruiker aan met 'je'. Antwoord in het Nederlands.`;

    const messages = [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system,
        messages
      })
    });
    const data = await res.json();
    return data.content?.[0]?.text || 'Er ging iets mis.';
  },

  async suggestSchedule(task, freeSlots) {
    if (freeSlots.length === 0) return null;

    const system = `Je bent een planningsassistent. Kies het objectief beste tijdslot voor de taak. Criteria: genoeg ruimte voor de duur, niet vlak voor of na een ander event (buffer), voorkeur voor ochtend bij concentratietaken tenzij de taak anders vereist. Retourneer ALLEEN de index (0, 1, 2...) van het gekozen tijdslot als getal. Geen uitleg.`;

    const user = `Taak: ${task.title} (${task.duration} minuten, ${task.notes || 'geen extra context'})

Beschikbare tijdsloten:
${freeSlots.map((s, i) => `${i}: ${new Date(s.start).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })} - ${new Date(s.end).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`).join('\n')}

Welk tijdslot past het beste?`;

    try {
      const response = await this._call(system, user);
      const idx = parseInt(response.trim());
      return isNaN(idx) ? 0 : Math.min(idx, freeSlots.length - 1);
    } catch {
      return 0;
    }
  }
};
