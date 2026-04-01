import express from 'express';
import { fetchBusiness, extractBusinessId } from './client.js';
import { ensureCredentials, refreshApiKey } from './auth.js';
import { loadCredentials, clearCredentials } from './store.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
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

  app.listen(PORT, () => {
    console.log(`[server] http://localhost:${PORT}`);
    console.log(`[server] GET /api/salon/:id`);
    console.log(`[server] GET /api/salon?url=...`);
  });
}

start();
