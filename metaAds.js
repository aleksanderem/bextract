// Meta Ad Library scraper — publiczny widok strony reklamodawcy (bez logowania,
// sprawdzone z IP tytana 2026-08-18: 3/3 kart dla page 109329441671675).
//
// Dwa wejścia:
//  - resolvePage(query)  → { pageId, pageName } przez typeahead "Reklamodawcy"
//  - fetchAds(pageId)    → { pageId, ads: [...] } z widoku view_all_page_id
//
// Konsument: bagent workers/meta_ads_refresh.py (nightly cron) — zestawia
// starty/stopy reklam ze zmianami cenników w monitoringu konkurencji.
import { chromium } from "playwright-core"; // deploy: pakiet z node_modules serwisu

const CHROME =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ||
  "/home/booksy/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Polskie skróty miesięcy z kart ("7 sie 2026" → 2026-08-07).
const PL_MONTHS = {
  sty: 1, lut: 2, mar: 3, kwi: 4, maj: 5, cze: 6,
  lip: 7, sie: 8, wrz: 9, "paź": 10, paz: 10, lis: 11, gru: 12,
};

function parsePlDate(text) {
  const m = text.match(/(\d{1,2})\s+([a-ząćęłńóśźż]{3,4})\s+(\d{4})/i);
  if (!m) return null;
  const month = PL_MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
}

async function withBrowser(fn) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ["--no-sandbox"],
  });
  try {
    const ctx = await browser.newContext({ locale: "pl-PL", userAgent: UA });
    const page = await ctx.newPage();
    return await fn(page);
  } finally {
    await browser.close();
  }
}

/**
 * Typeahead "Reklamodawcy": wpisz frazę, kliknij pierwszą opcję strony,
 * odczytaj view_all_page_id z URL po nawigacji SPA.
 */
/**
 * facebook_url salonu (z Booksy) -> page_id.
 * - profile.php?id=<id> niesie page_id wprost;
 * - slug: publiczna strona FB renderuje sie z tytana mimo sciany logowania
 *   (sprawdzone 2026-08-18: 1.4 MB HTML) i wstrzykuje page_id w payloadzie.
 * Typeahead Ad Library NIE dziala z IP datacenter (landing bez wyszukiwarki).
 */
export async function resolvePage(facebookUrl) {
  const direct = String(facebookUrl).match(/profile\.php\?id=(\d{6,})/);
  if (direct) return { pageId: Number(direct[1]), pageName: null, via: "profile_id" };

  const slug = String(facebookUrl)
    .replace(/^https?:\/\/(www\.|m\.|web\.)?facebook\.com\//i, "")
    .split(/[?#]/)[0]
    .replace(/\/+$/, "");
  if (!slug) return { pageId: null, pageName: null, reason: "bad_url" };

  return withBrowser(async (page) => {
    await page.goto(`https://www.facebook.com/${encodeURIComponent(slug)}`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(4000);
    const html = await page.content();
    const ids = [
      ...html.matchAll(
        /"(?:page_id|pageID|associated_page_id|delegate_page_id)"\s*:\s*"?(\d{8,})"?/g,
      ),
    ].map((m) => m[1]);
    if (ids.length === 0) return { pageId: null, pageName: null, reason: "no_page_id" };
    const counts = new Map();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const title = (await page.title()).replace(/\s*\|\s*Facebook\s*$/i, "");
    return { pageId: Number(best), pageName: title || null, via: "page_html" };
  });
}

/**
 * Widok wszystkich AKTYWNYCH reklam strony. Infinite scroll — dociągamy
 * kilka ekranów (salony beauty rzadko mają >30 aktywnych kreacji).
 */
export async function fetchAds(pageId, { scrolls = 4 } = {}) {
  return withBrowser(async (page) => {
    const url =
      "https://www.facebook.com/ads/library/?active_status=active&ad_type=all" +
      `&country=PL&view_all_page_id=${encodeURIComponent(pageId)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    for (let i = 0; i < scrolls; i++) {
      await page.mouse.wheel(0, 2400);
      await page.waitForTimeout(1500);
    }
    const cards = await page.evaluate(() => {
      // Kotwica karty: tekst "Identyfikator biblioteki: <id>". Wspinamy się do
      // kontenera, który zawiera i identyfikator, i "Sponsorowane" (pełna karta).
      const anchors = [...document.querySelectorAll("div,span")].filter(
        (el) =>
          el.childElementCount === 0 &&
          /Identyfikator biblioteki:\s*\d+/.test(el.textContent || ""),
      );
      const seen = new Set();
      const out = [];
      for (const a of anchors) {
        let node = a;
        for (let up = 0; up < 12 && node.parentElement; up++) {
          node = node.parentElement;
          const t = node.innerText || "";
          if (t.includes("Sponsorowane") && /Identyfikator biblioteki/.test(t)) break;
        }
        const text = node.innerText || "";
        const id = text.match(/Identyfikator biblioteki:\s*(\d+)/)?.[1];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, text: text.slice(0, 4000) });
      }
      return out;
    });
    const ads = cards.map(({ id, text }) => {
      const startRaw =
        text.match(/Rozpoczęcie wyświetlania[^\n]*/)?.[0] ??
        text.match(/Data rozpoczęcia emisji[^\n]*/)?.[0] ??
        "";
      // Tekst kreacji: wszystko po linii "Sponsorowane" do końca segmentu karty.
      const sponsIdx = text.indexOf("Sponsorowane");
      const creative =
        sponsIdx >= 0
          ? text
              .slice(sponsIdx + "Sponsorowane".length)
              .replace(/^\s+/, "")
              .slice(0, 2000)
          : null;
      return {
        adArchiveId: id,
        startedRunningOn: parsePlDate(startRaw),
        creativeText: creative,
        raw: { startRaw: startRaw.slice(0, 120) },
      };
    });
    return { pageId: Number(pageId), adCount: ads.length, ads };
  });
}
