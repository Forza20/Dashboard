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
      const wait = Math.min(parseInt(res.headers.get('X-Rate-Limit-Reset') || '2', 10) + 1, 60);
      console.log(`  Rate limit nået, venter ${wait} s`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) {
      const err = new Error(`${res.status} ${res.statusText} for ${endpoint}: ${await res.text()}`);
      err.status = res.status;
      throw err;
    }
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
  let total;
  try {
    total = await get('/stats/total', range);
  } catch (err) {
    // GoatCounter svarer 404 for datoer før sitet blev oprettet.
    if (err.status === 404) return null;
    throw err;
  }
  // Opdelingerne gemmes pr. døgn, og GoatCounter runder slutningen op til
  // næste døgn; en slutning i løbet af dagen tager derfor næste døgn med.
  const dayRange = { start: `${date}T00:00:00Z`, end: `${date}T00:00:00Z` };
  const locations = await breakdown('locations', dayRange);
  const sizes = await breakdown('sizes', dayRange);
  const sum = rows => rows.reduce((a, r) => a + (r.count || 0), 0);
  const t = total.total_utc ?? total.total ?? 0;
  if (sum(locations) !== t || sum(sizes) !== t) {
    console.log(`  Afvigelse ${date}: total ${t}, lande ${sum(locations)}, skærme ${sum(sizes)}`);
  }
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
  // Find dage med besøgende med få kald (31 døgn pr. kald). Dage uden besøg
  // får en Total-række med 0 uden flere kald. Nabodage tages med, fordi
  // oversigten er i sitets tidszone, mens resten er i UTC.
  const active = new Set();
  let firstKnown = null;
  if (DAYS > 3) {
    for (let i = 0; i < dates.length; i += 31) {
      const chunk = dates.slice(i, i + 31);
      let data;
      try {
        data = await get('/stats/total', { start: `${chunk[0]}T00:00:00Z`, end: `${chunk[chunk.length - 1]}T23:59:59Z` });
      } catch (err) {
        // 404 = perioden starter før sitet fandtes. Hent dagene enkeltvis,
        // så dagene efter oprettelsen i samme periode ikke går tabt.
        if (err.status === 404) { chunk.forEach(d => active.add(d)); continue; }
        throw err;
      }
      if (!firstKnown) firstKnown = chunk[0];
      for (const s of data.stats || []) {
        if (s.daily > 0) {
          const d = new Date(`${s.day}T00:00:00Z`);
          for (const off of [-1, 0, 1]) {
            active.add(new Date(d.getTime() + off * 86400000).toISOString().slice(0, 10));
          }
        }
      }
    }
  }

  const fresh = [];
  let skipped = 0;
  for (const date of dates) {
    if (DAYS > 3 && !active.has(date)) {
      if (!firstKnown || date < firstKnown) { skipped++; continue; }
      fresh.push({ date, week: isoWeek(date), type: 'Total', value: 'Alle', count: 0 });
      continue;
    }
    const rows = await fetchDay(date);
    if (!rows) { skipped++; continue; }
    console.log(`${date}: ${rows[0].count} besøgende, ${rows.length - 1} opdelingsrækker`);
    fresh.push(...rows);
  }
  if (skipped) console.log(`Sprang ${skipped} døgn over (før sitet blev oprettet).`);
  const kept = readExisting().filter(r => !dates.includes(r.date));
  write([...kept, ...fresh]);
  console.log(`Gemte ${kept.length + fresh.length} rækker i stats-historik.md`);
})().catch(err => { console.error(err.message); process.exit(1); });
