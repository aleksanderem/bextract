import express from 'express';
import { fetchBusiness, fetchReviews, fetchListing, fetchLocationDetails, extractBusinessId } from './client.js';
import { ensureCredentials, refreshApiKey } from './auth.js';
import { loadCredentials, clearCredentials } from './store.js';
import { initSentry, sentryErrorHandler } from "./observability.js";
import { resolvePage as metaResolvePage, fetchAds as metaFetchAds, downloadMedia as metaDownloadMedia } from './metaAds.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


initSentry();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error('[server] brak API_KEY w env — ustaw go przed startem');
  process.exit(1);
}

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Miniatury kreacji Meta — publiczne (ładowane przez <img> z panelu, bez
// możliwości dołożenia nagłówka x-api-key). Same obrazki z publicznej
// Ad Library — brak danych wrażliwych.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const META_MEDIA_DIR = path.join(__dirname, 'media', 'meta-ads');
app.use('/media/meta-ads', express.static(META_MEDIA_DIR, { maxAge: '7d' }));

app.use((req, res, next) => {
  if (req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Nieprawidlowy lub brak x-api-key' });
  }
  next();
});

// GET /api/salon/:id
app.get('/api/salon/:id', async (req, res) => {
  try {
    const data = await fetchBusiness(req.params.id);
    res.json(data);
  } catch (err) {
    console.error('[server]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/salon/:id/reviews?page=1&per_page=10
app.get('/api/salon/:id/reviews', async (req, res) => {
  try {
    const page = parseInt(req.query.page || req.query.reviews_page || '1', 10);
    const perPage = Math.max(1, Math.min(50, parseInt(req.query.per_page || req.query.reviews_per_page || '10', 10)));

    const data = await fetchReviews(req.params.id, page, perPage);
    res.json(data);
  } catch (err) {
    console.error('[server]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/salon?url=https://booksy.com/...
app.get('/api/salon', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Podaj ?url=...' });

  const id = extractBusinessId(url);
  if (!id) return res.status(400).json({ error: 'Nie mozna wyodrebnic ID z URL' });

  try {
    const data = await fetchBusiness(id);
    res.json(data);
  } catch (err) {
    console.error('[server]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/refresh - force key refresh
let refreshLock = false;

app.post('/api/auth/refresh', async (req, res) => {
  if (refreshLock) return res.status(409).json({ error: 'Odswiezanie w toku' });
  refreshLock = true;
  try {
    clearCredentials();
    await refreshApiKey();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    refreshLock = false;
  }
});

// GET /api/auth/status
app.get('/api/auth/status', (req, res) => {
  const creds = loadCredentials();
  const hasKey = !!creds?.headers?.['x-api-key'];
  res.json({ active: hasKey, ...(hasKey ? { apiKey: creds.headers['x-api-key'], capturedAt: creds.capturedAt } : {}) });
});

// --- startup ---

async function start() {
  try {
    console.log('[server] sprawdzam x-api-key...');
    await ensureCredentials();
    console.log('[server] klucz aktywny');
  } catch (err) {
    console.error('[server] brak klucza:', err.message);
    console.error('[server] pierwsze zapytanie sprobuje pobrac klucz automatycznie');
  }

// ── Meta Ad Library (publiczny widok, bez logowania) ─────────────────────
// GET /api/meta-ads/resolve?q=<nazwa|slug> → { pageId, pageName }
app.get('/api/meta-ads/resolve', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Brak parametru q' });
  try {
    const data = await metaResolvePage(q);
    res.json(data);
  } catch (err) {
    console.error('[meta-ads/resolve]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/meta-ads?page_id=<id> → { pageId, adCount, ads: [...] }
app.get('/api/meta-ads', async (req, res) => {
  const pageId = String(req.query.page_id || '').trim();
  if (!/^\d+$/.test(pageId)) return res.status(400).json({ error: 'Brak/zly page_id' });
  try {
    const data = await metaFetchAds(pageId);
    const media = await metaDownloadMedia(data.ads, META_MEDIA_DIR);
    for (const ad of data.ads) {
      ad.creativeImagePath = media[ad.adArchiveId] ?? null;
    }
    res.json(data);
  } catch (err) {
    console.error('[meta-ads]', err.message);
    res.status(500).json({ error: err.message });
  }
});

  app.use(sentryErrorHandler());


// Issue #34 — listing proxy. Caller paginates by shrinking area bbox.
app.get('/api/booksy/listing', async (req, res) => {
  const { category, location_id, area, location_geo, per_page } = req.query;
  try {
    const data = await fetchListing({
      category: category != null ? Number(category) : null,
      location_id: location_id != null ? Number(location_id) : null,
      area: area || null,
      location_geo: location_geo || null,
      per_page: per_page != null ? Number(per_page) : null,
    });
    res.json(data);
  } catch (err) {
    console.error('[server] listing failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Issue #34 — fetch canonical hierarchy for a location_id (city → districts).
// Discovery uses this to enumerate sub-locations for deep coverage.
app.get('/api/booksy/location/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'invalid location id' });
  }
  try {
    const details = await fetchLocationDetails(id);
    if (!details) return res.status(404).json({ error: 'location not found' });
    res.json(details);
  } catch (err) {
    console.error('[server] location details failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
    console.log(`[server] http://localhost:${PORT}`);
    console.log(`[server] GET /api/salon/:id`);
    console.log(`[server] GET /api/salon/:id/reviews?page=1&per_page=10`);
    console.log(`[server] GET /api/salon?url=...`);
  });
}

start();
