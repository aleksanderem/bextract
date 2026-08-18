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
    if (ids.length > 0) {
      const counts = new Map();
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const title = (await page.title()).replace(/\s*\|\s*Facebook\s*$/i, "");
      return { pageId: Number(best), pageName: title || null, via: "page_html" };
    }
    // Fallback: publiczna strona sluga wpada w login-wall z DC IP. Widget
    // page-plugin (do osadzania na stronach) renderuje się anonimowo i ma
    // page_id w HTML.
    await page.goto(
      `https://www.facebook.com/plugins/page.php?href=${encodeURIComponent(
        `https://www.facebook.com/${slug}`,
      )}&tabs=&width=340&small_header=true`,
      { waitUntil: "domcontentloaded", timeout: 30000 },
    );
    await page.waitForTimeout(3000);
    const pluginHtml = await page.content();
    const pluginId =
      pluginHtml.match(/"(?:page_id|pageID|entity_id)"\s*:\s*"?(\d{8,})"?/)?.[1] ??
      pluginHtml.match(/facebook\.com\/(\d{8,})/)?.[1] ??
      null;
    if (!pluginId) return { pageId: null, pageName: null, reason: "no_page_id" };
    return { pageId: Number(pluginId), pageName: null, via: "page_plugin" };
  });
}

/**
 * Widok wszystkich AKTYWNYCH reklam strony. Infinite scroll — dociągamy
 * kilka ekranów (salony beauty rzadko mają >30 aktywnych kreacji).
 */

/**
 * Reklamy z JSON-a osadzonego w HTML strony wyników (search_results_connection
 * → collated_results). Pewniejsze niż DOM: niesie publisher_platform,
 * start/end_date i URL-e mediów wprost. Forward balanced-brace scan od
 * literału {"ad_archive_id" (pierwszy klucz obiektu reklamy).
 */
function extractEmbeddedAds(html) {
  const ads = [];
  let from = 0;
  for (;;) {
    const start = html.indexOf('{"ad_archive_id"', from);
    if (start < 0) break;
    from = start + 1;
    let depth = 0;
    let end = -1;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (c === '"') {
        i++;
        while (i < html.length && html[i] !== '"') {
          if (html[i] === "\\") i++;
          i++;
        }
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end < 0) break;
    try {
      const obj = JSON.parse(html.slice(start, end));
      if (obj && obj.ad_archive_id) ads.push(obj);
    } catch { /* fragment nie był czystym JSON-em — pomiń */ }
  }
  return ads;
}

function embeddedToAd(obj) {
  const snap = obj.snapshot || {};
  const video = (snap.videos || [])[0];
  const image = (snap.images || [])[0];
  const mediaUrl =
    (video && video.video_preview_image_url) ||
    (image && (image.resized_image_url || image.original_image_url)) ||
    null;
  const bodyText =
    (snap.body && (snap.body.text ?? snap.body.markup?.__html)) ?? null;
  return {
    adArchiveId: String(obj.ad_archive_id),
    isActive: obj.is_active !== false,
    // end_date dla aktywnych bywa planowanym końcem — bierzemy tylko gdy
    // emisja faktycznie zakończona.
    endedRunningOn:
      obj.is_active === false && obj.end_date
        ? new Date(obj.end_date * 1000).toISOString().slice(0, 10)
        : null,
    startedRunningOn: obj.start_date
      ? new Date(obj.start_date * 1000).toISOString().slice(0, 10)
      : null,
    creativeText: typeof bodyText === "string" ? bodyText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null : null,
    platforms: (obj.publisher_platform || []).map((p) => String(p).toLowerCase()),
    mediaUrl,
    pageName: snap.page_name || null,
    raw: { source: "embedded", collationCount: obj.collation_count ?? null },
  };
}

/**
 * status: "active" (domyślnie — źródło prawdy dla diffu i alertów) albo
 * "inactive" (historia DSA, do roku po końcu emisji; realny end_date).
 * UWAGA: widoki active/inactive/all pokazują RÓŻNE ad_archive_id dla tych
 * samych kampanii (reprezentanci kolacji) — nie wolno diffować aktywnych
 * na podstawie widoku "all" (sprawdzone 2026-08-18: przecięcie 1/30).
 */
export async function fetchAds(pageId, { scrolls = 6, status = "active" } = {}) {
  return withBrowser(async (page) => {
    const url =
      `https://www.facebook.com/ads/library/?active_status=${status}&ad_type=all` +
      `&country=PL&view_all_page_id=${encodeURIComponent(pageId)}`;
    // Kolejne strony wyników dojeżdżają GraphQL-em przy scrollu — nie ma ich
    // w HTML. Nasłuch odpowiedzi + ten sam skaner literału {"ad_archive_id".
    const fromGraphql = [];
    page.on("response", async (resp) => {
      try {
        if (!resp.url().includes("/api/graphql")) return;
        const body = await resp.text();
        if (body.includes('"ad_archive_id"')) {
          fromGraphql.push(...extractEmbeddedAds(body.replace(/\\"/g, '"')));
          fromGraphql.push(...extractEmbeddedAds(body));
        }
      } catch { /* odpowiedź nie-tekstowa — pomiń */ }
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);

    // Ścieżka główna: JSON osadzony w HTML (platformy, daty, media wprost).
    const htmlAds = extractEmbeddedAds(await page.content());
    if (htmlAds.length > 0) {
      for (let i = 0; i < scrolls; i++) {
        await page.mouse.wheel(0, 2600);
        await page.waitForTimeout(1500);
      }
      await page.waitForTimeout(2000);
      const embedded = [...new Map(
        [...htmlAds, ...fromGraphql].map((o) => [String(o.ad_archive_id), o]),
      ).values()];
      const ads = embedded.map(embeddedToAd);
      return { pageId: String(pageId), adCount: ads.length, ads, source: "embedded" };
    }
    // Fallback: parsowanie DOM kart (stary tor).
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
        // Miniatura kreacji: poster wideo > największy obrazek karty.
        // Avatar strony to małe s60x60 — odpada przez próg rozmiaru.
        const video = node.querySelector("video[poster]");
        let mediaUrl = video ? video.poster : null;
        if (!mediaUrl) {
          const imgs = [...node.querySelectorAll("img")]
            .map((i) => ({ src: i.src, size: (i.naturalWidth || i.width || 0) }))
            .filter((i) => i.size >= 150 && /fbcdn/.test(i.src));
          imgs.sort((a, b) => b.size - a.size);
          mediaUrl = imgs[0]?.src ?? null;
        }
        out.push({ id, text: text.slice(0, 4000), mediaUrl });
      }
      return out;
    });
    const ads = cards.map(({ id, text, mediaUrl }) => {
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
        mediaUrl,
        raw: { startRaw: startRaw.slice(0, 120) },
      };
    });
    return { pageId: Number(pageId), adCount: ads.length, ads };
  });
}

/**
 * Pobiera miniatury kreacji na dysk (linki fbcdn wygasają po godzinach).
 * Zwraca mapę adArchiveId -> ścieżka względna (/media/meta-ads/<id>.jpg).
 */
export async function downloadMedia(ads, mediaDir) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(mediaDir, { recursive: true });
  const saved = {};
  for (const ad of ads) {
    if (!ad.mediaUrl) continue;
    const file = path.join(mediaDir, `${ad.adArchiveId}.jpg`);
    try {
      // Nie pobieraj ponownie — kreacja się nie zmienia pod tym samym id.
      await fs.access(file).catch(async () => {
        const resp = await fetch(ad.mediaUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        await fs.writeFile(file, Buffer.from(await resp.arrayBuffer()));
      });
      saved[ad.adArchiveId] = `/media/meta-ads/${ad.adArchiveId}.jpg`;
    } catch (err) {
      console.warn(`[meta-ads] media ${ad.adArchiveId}: ${err.message}`);
    }
  }
  return saved;
}
