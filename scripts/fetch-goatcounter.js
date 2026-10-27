// Henter besøgstal fra GoatCounter og gemmer dem i stats-historik.md.
// Hver kørsel opdaterer de seneste DAYS døgn (standard 2: i går + i dag),
// så gårsdagens tal bliver endelige, og dagens tal er med indtil kørslen.
//
// Miljøvariabler:
//   GOATCOUNTER_TOKEN  API-nøgle med læseadgang til statistik (påkrævet)
//   GOATCOUNTER_SITE   site-kode, fx "forza20" (standard)
//   DAYS               antal døgn bagud inkl. i dag (standard 2, brug fx 365 til at hente historik)
//
// Alle tal er unikke besøgende pr. UTC-døgn (GoatCounters lokationer og
// skærmstørrelser findes kun i UTC).

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GOATCOUNTER_TOKEN;
const SITE = process.env.GOATCOUNTER_SITE || 'forza20';
const DAYS = Math.max(1, parseInt(process.env.DAYS || '2', 10));
const FILE = path.join(__dirname, '..', 'stats-historik.md');
const API = `https://${SITE}.goatcounter.com/api/v0`;

if (!TOKEN) {
  console.error('Mangler GOATCOUNTER_TOKEN.');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// GoatCounter tillader 4 kald i sekundet.
async function get(endpoint, params) {
  const url = `${API}${endpoint}?${new URLSearchParams(params)}`;
  for (let attempt = 1; ; attempt++) {
    await sleep(300);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } });
    if (res.status === 429 && attempt < 5) {
      await sleep((parseInt(res.headers.get('X-Rate-Limit-Reset') || '2', 10) + 1) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${endpoint}: ${await res.text()}`);
    return res.json();
  }
}

// Henter alle rækker for en opdeling (locations/sizes), med sideskift.
async function breakdown(page, range) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const data = await get(`/stats/${page}`, { ...range, limit: 100, offset });
    rows.push(...(data.stats || []));
    if (!data.more || !data.stats || data.stats.length === 0) return rows;
  }
}

function isoWeek(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const clean = s => String(s || 'Ukendt').replace(/\|/g, '/').trim();

async function fetchDay(date) {
  const range = { start: `${date}T00:00:00Z`, end: `${date}T23:59:59Z` };
  const total = await get('/stats/total', range);
  const locations = await breakdown('locations', range);
  const sizes = await breakdown('sizes', range);
  const week = isoWeek(date);
  return [
    { date, week, type: 'Total', value: 'Alle', count: total.total_utc ?? total.total ?? 0 },
    ...locations.map(s => ({ date, week, type: 'Location', value: clean(s.name || s.id), count: s.count })),
    ...sizes.map(s => ({ date, week, type: 'Screen size', value: clean(s.name || s.id), count: s.count })),
  ].filter(r => r.type === 'Total' || r.count > 0);
}

const ROW = /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|\s*(\d+)\s*\|\s*$/;

function readExisting() {
  if (!fs.existsSync(FILE)) return [];
  return fs.readFileSync(FILE, 'utf8').split(/\r?\n/).map(l => ROW.exec(l)).filter(Boolean)
    .map(m => ({ date: m[1], week: m[2].trim(), type: m[3].trim(), value: m[4].trim(), count: parseInt(m[5], 10) }));
}

function write(rows) {
  const typeOrder = { Total: 0, Location: 1, 'Screen size': 2 };
  rows.sort((a, b) => a.date.localeCompare(b.date) || typeOrder[a.type] - typeOrder[b.type]
    || b.count - a.count || a.value.localeCompare(b.value));
  const lines = [
    '# Besøgsstatistik: Forza20.github.io',
    '',
    `Unikke besøgende pr. døgn (UTC) fra GoatCounter (site: \`${SITE}\`). Opdateres automatisk hver dag af GitHub Actions.`,
    'Rediger ikke tabellen i hånden; rækker for de seneste døgn bliver overskrevet ved hver kørsel.',
    '',
    '- **Type = Total:** alle besøgende den dag',
    '- **Type = Location:** besøgende pr. land',
    '- **Type = Screen size:** besøgende pr. skærmstørrelse',
    '',
    `Senest opdateret: ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}`,
    '',
    '| Dato | Uge | Type | Værdi | Besøgende |',
    '| --- | --- | --- | --- | ---: |',
    ...rows.map(r => `| ${r.date} | ${r.week} | ${r.type} | ${r.value} | ${r.count} |`),
    '',
  ];
  fs.writeFileSync(FILE, lines.join('\n'));
}

(async () => {
  const today = new Date();
  const dates = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    dates.push(d.toISOString().slice(0, 10));
  }
  const fresh = [];
  for (const date of dates) {
    const rows = await fetchDay(date);
    console.log(`${date}: ${rows[0].count} besøgende, ${rows.length - 1} opdelingsrækker`);
    fresh.push(...rows);
  }
  const kept = readExisting().filter(r => !dates.includes(r.date));
  write([...kept, ...fresh]);
  console.log(`Gemte ${kept.length + fresh.length} rækker i stats-historik.md`);
})().catch(err => { console.error(err.message); process.exit(1); });
