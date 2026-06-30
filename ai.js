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

  async prioritize(tasks, calendarEvents, gezinEvents = []) {
    const openTasks = tasks.filter(t => t.status === 'open');
    if (openTasks.length === 0) return [];

    const now = new Date();
    const todayStr = now.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });

    const taskList = openTasks.map(t => ({
      id: t.id,
      title: t.title,
      deadline: t.deadline || 'geen deadline',
      duration: t.duration + ' min',
      recurrence: t.recurrence || null,
      category: t.category || '-',
      notes: t.notes || ''
    }));

    const eventList = calendarEvents.map(e => ({
      title: e.summary,
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date
    }));

    const system = `Je bent een planningsassistent. Rangschik taken op basis van objectieve criteria: deadline-urgentie, tijdsduur, agenda-ruimte en onderlinge afhankelijkheden. Geen aanmoedigingen, geen opvulling.

Herhalende taken (recurrence-veld): een taak met `"daily"` moet elke dag gedaan worden en heeft hoge dagelijkse urgentie. Een taak met `"weekly:N"` moet N keer per week en krijgt urgentie naarmate de week vordert. Maandelijkse taken krijgen urgentie naarmate de maand vordert. Herhalende taken zonder deadline worden na voltooiing automatisch gereset.

Prioriteitsregel voor taken zonder deadline: deze staan lager dan taken met een urgente of nabije deadline. Ze mogen echter hoger staan dan taken met een deadline ver in de toekomst, mits er nog voldoende tijd is om die deadline-taken voor hun deadline in te plannen. Verdring een taak zonder deadline alleen als een deadline-taak anders niet op tijd afkomt.

Per taak één zin: de feitelijke reden waarom deze hoger staat dan de volgende. Benoem het concrete criterium (bijv. "deadline morgen", "blokkeert taak X", "deadline nog 3 weken dus geen urgentie t.o.v. deze taak").
Antwoord in het Nederlands.
Retourneer ALLEEN valide JSON in dit formaat:
[{"id": "task_id", "reason": "korte feitelijke reden"}]`;

    const gezinList = gezinEvents
      .filter(e => e.start?.dateTime)
      .map(e => ({ title: e.summary, start: e.start.dateTime, end: e.end.dateTime }));

    const user = `Vandaag is het ${todayStr}.

Mijn taken:
${JSON.stringify(taskList, null, 2)}

Wat er vandaag al in mijn eigen agenda staat:
${JSON.stringify(eventList, null, 2)}

Wat er vandaag in de gezinsagenda staat (niet blokkerend, wel relevant voor timing):
${gezinList.length > 0 ? JSON.stringify(gezinList, null, 2) : 'Niets.'}

Rangschik mijn taken van meest naar minst urgent/belangrijk voor vandaag. Houd rekening met deadlines, hoe lang iets duurt, wat er al in de agenda staat, en gezinsverplichtingen die concentratie of beschikbaarheid beïnvloeden.`;

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

  async chat(message, tasks, calendarEvents, history = [], gezinEvents = []) {
    const openTasks = tasks.filter(t => t.status === 'open');
    const todayStr = new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });

    const taskSummary = openTasks.map(t =>
      `- ${t.title} (${t.deadline ? 'deadline: ' + t.deadline : 'geen deadline'}, ${t.duration} min${t.notes ? ', ' + t.notes : ''})`
    ).join('\n');

    const eventSummary = calendarEvents.map(e =>
      `- ${e.summary}: ${e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : 'hele dag'}`
    ).join('\n');

    const gezinSummary = gezinEvents
      .filter(e => e.start?.dateTime)
      .map(e => `- ${e.summary}: ${new Date(e.start.dateTime).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`)
      .join('\n');

    const system = `Je bent een planningsassistent. Vandaag is ${todayStr}.

De gebruiker heeft de volgende openstaande taken:
${taskSummary || 'Geen openstaande taken.'}

Wat er vandaag in de eigen agenda staat:
${eventSummary || 'Niets gepland.'}

Wat er vandaag in de gezinsagenda staat (niet blokkerend, wel relevant voor timing):
${gezinSummary || 'Niets.'}

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

  async suggestSchedule(task, freeSlots, gezinEvents = []) {
    if (freeSlots.length === 0) return null;

    const system = `Je bent een planningsassistent. Kies het objectief beste tijdslot voor de taak. Criteria: genoeg ruimte voor de duur, niet vlak voor of na een ander event (buffer), voorkeur voor ochtend bij concentratietaken tenzij de taak anders vereist. Retourneer ALLEEN de index (0, 1, 2...) van het gekozen tijdslot als getal. Geen uitleg.`;

    const gezinSummary = gezinEvents
      .filter(e => e.start?.dateTime)
      .map(e => `- ${e.summary}: ${new Date(e.start.dateTime).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })} - ${new Date(e.end.dateTime).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`)
      .join('\n');

    const user = `Taak: ${task.title} (${task.duration} minuten, ${task.notes || 'geen extra context'})

Beschikbare tijdsloten:
${freeSlots.map((s, i) => `${i}: ${new Date(s.start).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })} - ${new Date(s.end).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`).join('\n')}

Gezinsagenda vandaag (niet blokkerend maar houd er rekening mee):
${gezinSummary || 'Niets.'}

Welk tijdslot past het beste?`;

    try {
      const response = await this._call(system, user);
      const idx = parseInt(response.trim());
      return isNaN(idx) ? 0 : Math.min(idx, freeSlots.length - 1);
    } catch {
      return 0;
    }
  },

  async suggestPostponeDate(task, deadline, allTasks) {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const otherTasks = allTasks
      .filter(t => t.status === 'open' && t.id !== task.id && t.deadline)
      .map(t => ({ title: t.title, deadline: t.deadline, duration: t.duration + ' min' }));

    const system = `Je bent een planningsassistent. Kies de beste datum om een taak opnieuw in te plannen. Retourneer ALLEEN een datum in het formaat YYYY-MM-DD. Geen uitleg, geen andere tekst.`;

    const user = `Vandaag: ${todayStr}
Taak: ${task.title} (${task.duration} min${task.notes ? ', ' + task.notes : ''})
${deadline ? `Deadline: ${deadline}` : 'Geen deadline — lage prioriteit, mag achteraan'}

Andere open taken met deadline:
${otherTasks.length > 0 ? JSON.stringify(otherTasks) : 'Geen'}

${deadline
  ? `Kies een datum na vandaag en vóór de deadline (${deadline}). Geef voldoende buffer: plan niet op de deadline zelf. Vermijd datums waarop al veel andere deadlines vallen.`
  : `Geen deadline: kies een datum die past in de ruimte tussen taken met urgente deadlines. Als er taken zijn met deadlines ver in de toekomst en er is tussentijds genoeg ruimte, mag deze taak ook eerder worden gepland. Doel: zo dicht mogelijk bij nu, maar zonder urgente deadline-taken te verdringen.`
}`;


    try {
      const response = await this._call(system, user);
      const match = response.trim().match(/\d{4}-\d{2}-\d{2}/);
      return match ? match[0] : null;
    } catch {
      return null;
    }
  }
};
