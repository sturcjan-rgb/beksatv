# Beksa TV

Klubová videoplatforma **BK KVIS Pardubice** — přebaluje veřejné přenosy
z [tvcom.cz](https://www.tvcom.cz) (Maxa NBL) do vlastního designu a filtruje
jen zápasy Beksy. Žádný vlastní streaming, jen automatizované vkládání
oficiálního přehrávače s uvedením zdroje. Data i videa se aktualizují sama,
bez ručních kroků.

## Jak to funguje

```
tvcom.cz (rozpis + embed přehrávače Maxa NBL)
        │
        ▼
scraper.mjs  ── běží automaticky přes GitHub Actions (cron každé 2 h)
        │
        ▼
data/matches.json  ── scraper sem SLUČUJE výsledek, nikdy ho nepřepisuje celý
        │
        ▼
index.html  ── web si matches.json načte přes fetch() a zobrazí v designu Beksy
        │
        ▼
GitHub Pages  ── hosting zdarma, automatický deploy při každém commitu
```

Žádný backend, žádná databáze. Celý „server" jsou statické soubory na GitHub
Pages plus jeden scheduled job, který jednou za čas přepíše jeden JSON soubor.

## Soubory

```
├── index.html                 # celá stránka v jednom souboru (logo zapečené jako base64)
├── scraper.mjs                # scraper (Node.js + cheerio)
├── package.json               # jediná závislost: cheerio
├── data/
│   └── matches.json           # výstup scraperu — zápasy + embed GUID
└── .github/workflows/
    └── scrape.yml             # kdy a jak se scraper spouští
```

## Co je ověřeno pro tenhle klub

- **Soutěž na tvcomu:** `Soutez-Kooperativa-NBL` (zobrazuje se jako „Maxa NBL").
- **Tým:** v Maxa NBL hraje jen A-tým „**BK KVIS Pardubice**", takže scraper
  filtruje podle `"Pardubice"` v názvu (mládežnické „BK VIVIDBOOKS Pardubice"
  jsou v jiných soutěžích, do výběru se nepletou).
- **Stránka je server-renderovaná** — stačí `fetch()` + `cheerio`, žádný
  headless prohlížeč.
- **Embed přehrávače:** `//embed.tvcom.cz/{GUID}/`, v HTML detailu zápasu; bývá
  předpřipravený i u budoucích zápasů.
- **Přepínač sezón na tvcomu:** `…/Sezona-RRRR-RRRR/` — scraper prochází
  aktuální + (dle nastavení) minulé sezóny a slučuje, aby při přechodu na novou
  sezónu nezmizela historie.

## Výchozí data (seed)

`data/matches.json` obsahuje reálný startovní vzorek zápasů Pardubic ze sezón
2025/2026 a 2026/2027 (přímo z výpisů tvcom.cz). Zatím má vyřešené jen jedno
video (úvod 19. 9. 2026 vs PUMPA Basket Brno) — **zbytek embedů i kompletní
rozpis doplní scraper sám při prvním běhu.** Seed slouží jen k tomu, aby web
nebyl při prvním otevření prázdný; po prvním běhu Actions ho scraper rozšíří
a udržuje aktuální.

## Nasazení na GitHub Pages

1. **Založit repozitář** a nahrát soubory. Soubor `.github/workflows/scrape.yml`
   nahrávejte přes **Add file → Create new file** a do názvu vložte **celou
   cestu** `.github/workflows/scrape.yml` (drag&drop upload skryté složky
   s tečkou běžně tiše přeskočí).
2. **Settings → Actions → General → Workflow permissions** → zaškrtnout
   **„Read and write permissions"** (jinak scraper data stáhne, ale nedokáže
   je commitnout zpět).
3. **Settings → Pages** → Source: **Deploy from a branch** → `main` → `/(root)`.
   Když se Pages po uložení nepostaví, přepněte Source pryč a zpátky.
4. **Actions → „Aktualizace zápasů Beksa TV" → Run workflow** — první ruční
   spuštění, ať se data hned naplní. Pro jednorázový hlubší backfill historie
   zadejte do pole `seasons_back` vyšší číslo (např. `3`).
5. Volitelně **vlastní doména** (např. `tv.bkpardubice.cz`) — Settings → Pages
   → Custom domain + CNAME záznam u správce DNS mířící na `{username}.github.io`.

> Web běží přes `fetch('data/matches.json')`, což **nefunguje přes `file://`** —
> stránku otevřenou dvojklikem lokálně nic nenačte. Potřebuje HTTP server
> (GitHub Pages, nebo lokálně `python3 -m http.server`).

## Než se pustí naostro k veřejnosti

Re-embedování cizího přehrávače je obvykle v pořádku (jde o jejich oficiální
player, stejný obsah, s otevřeným uvedením zdroje), ale je to jejich
infrastruktura a obsah — **předem kontaktujte tvcom.cz**, popište záměr a jak
je zdroj uvedený, a počkejte na odpověď. Produkční verzi klidně stavte
paralelně, jen ji nezveřejňujte, dokud nepřijde souhlas.

## Výměna assetů / úprava vzhledu

- **Barvy a velikosti** jsou v `:root{…}` na začátku `<style>` jako CSS
  proměnné (`--red`, `--bg`, `--fs-teams`, …) — stačí přepsat hodnoty.
  Značková červená Beksy je `#e30613`.
- **Logo** je v hlavičce jako `<img src="data:image/png;base64,…">`
  (oficiální PNG). Až bude k dispozici vektorové **SVG** loga, jde `<img>`
  nahradit inline `<svg>` (pozor na kolize CSS tříd, pokud vkládáte víc SVG —
  třídy si opatřete unikátním prefixem).
- **Font nadpisů:** zatím „Barlow Condensed" (Google Fonts) jako sportovní
  kondenzovaná náhrada. Až dorazí oficiální klubový font, přidejte ho přes
  `@font-face` (ideálně WOFF2 v base64) a přepište `font-family` u nadpisů.
