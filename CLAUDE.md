# Personal Planner

Persoonlijke taakplanner-PWA, geïnspireerd op Motion, maar gratis en custom gebouwd.

## Doel

Structuur bieden bij het plannen en uitvoeren van taken, specifiek ontworpen om uitstelgedrag te ondersteunen (niet te bestraffen). De gebruiker is in behandeling voor een ontwijkende persoonlijkheidsstoornis; uitstelgedrag is een kernsymptoom. De tool moet drempelverlagend werken, niet schuldgevoel opwekken.

## Ontwerpprincipes (niet onderhandelbaar)

- **Prioriteit bovenaan, overzicht daaronder.** De "Vandaag"-view toont prominent de hoogste prioriteit taak ("Nu doen"), gevolgd door alle overige open taken en de agenda-items van de dag. Gezinsagenda-items zijn read-only en worden apart weergegeven.
- **Geen schuldgevoel-UI.** Geen overdue-banners in fel rood, geen streak-tellers, geen "je hebt dit al 3 dagen laten liggen"-meldingen.
- **Lage frictie bij invoer.** Een taak toevoegen moet in een paar tikken kunnen.
- **Concrete, ondersteunende AI-toon.** De AI-assistent geeft directe, korte antwoorden ("Doe dit nu, kost 20 minuten") in plaats van vage suggesties. Nederlands, informeel ("je"), geen overbodige uitleg.
- **Nooit plannen in het verleden.** Tijdsloten voor agenda-planning starten altijd vanaf het huidige moment, niet vanaf een vast beginpunt zoals 8:00.

## Architectuur

- **Stack:** vanilla HTML/CSS/JS met ES modules — geen framework, geen build step
- **Database:** Google Sheets (via Sheets API), functioneert als simpele, inspecteerbare taken-tabel
- **Kalender:** Google Calendar API voor timeblocking
- **AI:** Claude API (Anthropic), rechtstreeks vanuit de browser aangeroepen
- **Hosting:** GitHub Pages, statisch, gratis
- **Auth:** Google OAuth2 (implicit flow, token in localStorage) — geen eigen backend

## Bestanden

| Bestand | Functie |
|---|---|
| `index.html` | PWA-shell + alle CSS (dark theme, mobile-first) |
| `app.js` | Hoofdlogica, view-rendering, state management |
| `auth.js` | Google OAuth flow |
| `sheets.js` | CRUD-operaties op de Google Sheet (taken-database) |
| `calendar.js` | Vrije tijdsloten zoeken + events aanmaken in Google Calendar |
| `ai.js` | Claude API calls voor prioritering en chat |
| `sw.js` | Service worker voor offline caching |
| `manifest.json` | PWA-manifest (icoon, naam, standalone mode) |

## Databasestructuur (Google Sheet, tabblad "Taken")

Kolommen A–K: `id, title, notes, deadline, duration_min, priority, status, category, dependencies, created_at, scheduled_at`

`dependencies` is een komma-gescheiden lijst van task-ID's. Er is geen prioriteitsveld dat de gebruiker handmatig invult — prioritering gebeurt door de AI op basis van deadline, duur en agenda-context.

## Bekende aandachtspunten

- Tijdsloten voor scheduling moeten altijd vanaf `now` starten, nooit vanaf een vast tijdstip eerder op de dag (anders worden taken in het verleden ingepland).
- De `icons/` map (PWA-iconen) ontbreekt mogelijk lokaal — los dit zelf op of vraag erom indien nodig voor manifest.json.
- Credentials (Google Client ID, Spreadsheet ID, Anthropic API key) worden door de gebruiker zelf ingevuld via het instellingenscherm in de app, niet hardcoded.

## Stijl van samenwerken

Zakelijk en feitelijk. Geen onnodige complimenten. Bij grotere wijzigingen aan de code: eerst uitleggen wat je van plan bent en toestemming vragen voordat je het doorvoert.
