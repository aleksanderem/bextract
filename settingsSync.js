// Nadpisania z panelu admina „Klucze i stałe" (Convex, tabela systemSettings,
// zakres bextract). Pobierane z GET {CONVEX_SITE_URL}/api/settings?scope=bextract
// tym samym x-api-key, którym Convex i bagent wołają bextract — przy starcie
// i co 5 minut. Wartości lądują w process.env, bo kod czyta je przy każdym
// użyciu (auth.js: BROWSERLESS_TOKEN). Klucz API (API_KEY) celowo NIE jest
// nadpisywalny zdalnie — bez niego sync nie ma jak działać.
//
// CONVEX_SITE_URL w .env; gdy brak, domyślnie prod (keen-mouse-438).

const ALLOWED = new Set(["BROWSERLESS_TOKEN", "BUGSINK_DSN_BEXTRACT"]);
const DEFAULT_CONVEX_SITE_URL = "https://keen-mouse-438.convex.site";
const originals = new Map();

export async function syncSettings({ fetchImpl = fetch, env = process.env } = {}) {
  const base = (env.CONVEX_SITE_URL || DEFAULT_CONVEX_SITE_URL).replace(/\/$/, "");
  const key = env.API_KEY;
  if (!key) return { skipped: "brak API_KEY" };
  const res = await fetchImpl(`${base}/api/settings?scope=bextract`, {
    headers: { "x-api-key": key },
  });
  if (!res.ok) throw new Error(`settings ${res.status}`);
  const { settings = {} } = await res.json();
  const applied = [];
  for (const k of ALLOWED) {
    if (Object.prototype.hasOwnProperty.call(settings, k)) {
      if (!originals.has(k)) originals.set(k, env[k]);
      if (env[k] !== String(settings[k])) {
        env[k] = String(settings[k]);
        applied.push(k);
      }
    } else if (originals.has(k)) {
      // Nadpisanie zdjęte w panelu → wraca wartość z .env.
      const original = originals.get(k);
      if (original === undefined) delete env[k];
      else env[k] = original;
      originals.delete(k);
      applied.push(`${k} (przywrócony)`);
    }
  }
  return { applied, count: Object.keys(settings).length };
}

export function startSettingsSync(intervalMs = 5 * 60 * 1000) {
  const run = () =>
    syncSettings()
      .then((r) => {
        if (r.applied?.length) console.log("[settings-sync]", JSON.stringify(r));
      })
      .catch((e) => console.warn("[settings-sync]", e.message));
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
