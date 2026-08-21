// Beksa TV — scraper
//
// Co dělá:
// 1. Stáhne stránku Maxa NBL na tvcom.cz (server-rendered HTML) pro aktuální
//    a (dle nastavení) minulé sezóny.
// 2. Vyfiltruje jen zápasy Pardubic (podle "Pardubice" v názvu týmu — v Maxa
//    NBL hraje jen A-tým "BK KVIS Pardubice", takže shoda na "Pardubice" je
//    bezpečná; mládežnické "BK VIVIDBOOKS Pardubice" v téhle soutěži nejsou).
// 3. U zápasů, které ještě nemáme vyřešené (bez embed GUID), stáhne detail
//    zápasu a vytáhne z něj <iframe src="//embed.tvcom.cz/{GUID}/">.
// 4. VÝSLEDEK SLOUČÍ s tím, co už v data/matches.json bylo — nikdy ho celý
//    nepřepisuje. Tvcom defaultně ukazuje jen aktuální sezónu, takže bez
//    sloučení by scraper při přechodu na novou sezónu tiše smazal historii
//    té předchozí. Každému zápasu navíc přiřadí "season" (např. "2025/2026"),
//    podle kterého web nabízí přepínač sezón.
//
// Spouští se přes GitHub Actions (viz .github/workflows/scrape.yml), žádný
// ruční krok. Lokálně jde spustit přes: node scraper.mjs
//
// Hloubka zpětného scanu se řídí proměnnou prostředí SEASONS_BACK
// (výchozí 1 = aktuální + minulá sezóna). Pro jednorázové doplnění starší
// historie stačí při ručním spuštění workflow zadat vyšší číslo do políčka
// "seasons_back" — jednou vyřešený embed se pak už jen znovupoužije.

import fs from "node:fs";
import * as cheerio from "cheerio";

const BASE = "https://www.tvcom.cz";
const TEAM_MARK = "Pardubice";
const OUT_PATH = "data/matches.json";
const REQUEST_DELAY_MS = 500; // ať na tvcom zbytečně nebušíme

// Kolik sezón zpět kromě aktuální procházet. Výchozí 1; přepsatelné přes env
// (workflow_dispatch input -> env SEASONS_BACK) pro hlubší jednorázový backfill.
const SEASONS_BACK = Math.max(0, parseInt(process.env.SEASONS_BACK ?? "1", 10) || 0);

function seasonSlug(now, seasonsBack) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-12
  let startYear = m >= 8 ? y : y - 1; // sezóna běží srpen -> červenec
  startYear -= seasonsBack;
  return `${startYear}-${startYear + 1}`;
}

// Adresy aktuální + N minulých sezón, počítané dynamicky podle dnešního data
// (kód se nemusí každý rok ručně upravovat).
function buildLeagueUrls(now) {
  return Array.from({ length: SEASONS_BACK + 1 }, (_, back) =>
    `${BASE}/Zapasy/Sport-Basketbal/Soutez-Kooperativa-NBL/Sezona-${seasonSlug(now, back)}/`
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; BeksaTV-Scraper/1.0; +https://bkpardubice.cz)",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} pro ${url}`);
  }
  return await res.text();
}

// "5. 5. 2026" -> "2025/2026" (sezóna běží srpen-červenec)
function computeSeason(dateStr) {
  const [day, month, year] = dateStr.split(".").map((s) => parseInt(s.trim(), 10));
  return month >= 8 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

function matchKey(m) {
  return `${m.date}|${m.time}|${m.home}|${m.away}`;
}

// Vyparsuje jeden <a href="/Zapas/Sport-Basketbal/Soutez-Kooperativa-NBL/...">
// odkaz z textu odkazu. Formát textu tak, jak ho tvcom vykresluje:
//   "video 19. 9.16:00 BK KVIS Pardubice - PUMPA Basket Brno Basketbal Maxa NBLZákladní část"
//   "video 30. 12. 202517:40 BK ARMEX ENERGY Děčín - BK KVIS Pardubice Basketbal Maxa NBLZákladní část"
//   "video 18. 4.17:50 Studio BasketbalBK KVIS Pardubice - Sršni Photomate Písek Basketbal Maxa NBLSkupina A1"
// Rok se v textu objevuje jen mimo "aktuální" rok zobrazení, jinak ho
// dopočítáváme ze sezóny v URL (Sezona-2025-2026).
export function parseMatchAnchor(href, rawText) {
  if (!href || !href.includes("/Zapas/Sport-Basketbal/Soutez-Kooperativa-NBL/")) {
    return null;
  }

  let text = rawText.replace(/\s+/g, " ").trim();
  text = text.replace(/^video\s*/i, "");
  text = text.replace(/Studio Basketbal/i, "");

  const dateMatch = text.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})?(\d{1,2}:\d{2})\s*(.+)$/);
  if (!dateMatch) return null;
  const [, day, month, yearInText, time, rest] = dateMatch;

  // Teams před " Basketbal Maxa NBL" / " Basketbal Kooperativa NBL", fáze za tím.
  const teamsMatch = rest.match(/^(.*?)\s*-\s*(.*?)\s*Basketbal\s*(?:Maxa|Kooperativa)\s*NBL(.+)$/);
  if (!teamsMatch) return null;
  const home = teamsMatch[1].trim();
  const away = teamsMatch[2].trim();
  const phase = teamsMatch[3].trim();

  if (!home.includes(TEAM_MARK) && !away.includes(TEAM_MARK)) return null;

  let year = yearInText;
  if (!year) {
    const seasonMatch = href.match(/Sezona-(\d{4})-(\d{4})/);
    if (seasonMatch) {
      const [, y1, y2] = seasonMatch;
      year = Number(month) >= 8 ? y1 : y2; // srpen-prosinec => první rok sezóny
    }
  }
  if (!year) return null;

  const idMatch = href.match(/\/(\d+)-[^/]+\.htm$/);
  if (!idMatch) return null;

  return {
    id: idMatch[1],
    url: href.startsWith("http") ? href : BASE + href,
    date: `${Number(day)}. ${Number(month)}. ${year}`,
    time,
    home,
    away,
    phase,
    us: home.includes(TEAM_MARK) ? "home" : "away",
  };
}

async function getTeamMatches(leagueUrls) {
  const byId = new Map();

  for (const url of leagueUrls) {
    console.log(`  … prochází ${url}`);
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    $('a[href*="/Zapas/Sport-Basketbal/Soutez-Kooperativa-NBL/"]').each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text();
      const parsed = parseMatchAnchor(href, text);
      if (parsed) byId.set(parsed.id, parsed);
    });

    await sleep(REQUEST_DELAY_MS);
  }

  return [...byId.values()];
}

async function getEmbedId(matchUrl) {
  const html = await fetchHtml(matchUrl);
  const m = html.match(/embed\.tvcom\.cz\/([a-f0-9-]{20,})\//i);
  return m ? m[1] : null;
}

// Načte, co už v repu máme — napříč VŠEMI dosud viděnými sezónami.
function loadExisting() {
  const map = new Map();
  if (!fs.existsSync(OUT_PATH)) return map;
  try {
    const prev = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
    for (const m of prev) map.set(matchKey(m), m);
  } catch (e) {
    console.warn(`Nepodařilo se přečíst existující ${OUT_PATH}, začínám od nuly: ${e.message}`);
  }
  return map;
}

function toTimestamp(m) {
  const [d, mo, y] = m.date.split(".").map((s) => Number(s.trim()));
  const [hh, mm] = m.time.split(":").map(Number);
  return new Date(y, mo - 1, d, hh, mm).getTime();
}

async function main() {
  const now = new Date();
  const leagueUrls = buildLeagueUrls(now);
  console.log(`Stahuji rozpis Maxa NBL (aktuální + ${SEASONS_BACK} zpět):`);
  const found = await getTeamMatches(leagueUrls);
  console.log(`Nalezeno ${found.length} zápasů Pardubic na tvcom.cz`);

  // Start: vše, co už máme uložené (klidně i z dřívějších sezón).
  const merged = loadExisting();
  console.log(`V repu už bylo ${merged.size} zápasů (napříč sezónami)`);

  for (const m of found) {
    const key = matchKey(m);
    const existing = merged.get(key);
    let embed = existing?.embed ?? null;

    if (!embed) {
      try {
        embed = await getEmbedId(m.url);
        await sleep(REQUEST_DELAY_MS);
      } catch (e) {
        console.warn(`  ! Nepodařilo se načíst detail (${m.url}): ${e.message}`);
      }
    }

    merged.set(key, {
      date: m.date,
      time: m.time,
      home: m.home,
      away: m.away,
      phase: m.phase,
      us: m.us,
      season: computeSeason(m.date),
      ...(embed ? { embed } : {}),
    });
  }

  // Starším záznamům (z doby před zavedením "season") sezónu dopočítáme.
  for (const [key, m] of merged) {
    if (!m.season) merged.set(key, { ...m, season: computeSeason(m.date) });
  }

  const result = [...merged.values()].sort((a, b) => toTimestamp(b) - toTimestamp(a));

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2) + "\n", "utf8");

  const withVideo = result.filter((m) => m.embed).length;
  const seasons = [...new Set(result.map((m) => m.season))].sort();
  console.log(`Uloženo ${OUT_PATH}: ${result.length} zápasů (sezóny: ${seasons.join(", ")}), ${withVideo} s videem.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Scraper selhal:", err);
    process.exit(1);
  });
}
