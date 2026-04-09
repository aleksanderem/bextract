import { loadCredentials, clearCredentials } from './store.js';
import { refreshApiKey } from './auth.js';

const API_BASE = 'https://pl.booksy.com/core/v2/customer_api';

const COMMON_HEADERS = {
  accept: 'application/json, text/plain, */*',
  origin: 'https://booksy.com',
  referer: 'https://booksy.com/',
};

// --- helpers ---

async function ensureCreds() {
  let creds = loadCredentials();
  if (!creds?.headers?.['x-api-key']) {
    console.log('[client] brak x-api-key, pobieram...');
    creds = await refreshApiKey();
  }
  return creds;
}

async function booksyFetch(url, creds) {
  return fetch(url, {
    headers: { ...creds.headers, ...COMMON_HEADERS },
  });
}

async function booksyFetchWithRetry(url, label) {
  const creds = await ensureCreds();
  const res = await booksyFetch(url, creds);

  if (res.status === 403 || res.status === 401) {
    console.log(`[client] ${res.status} - x-api-key wygasl, odswiezam... (${label})`);
    clearCredentials();
    const fresh = await refreshApiKey();
    const retry = await booksyFetch(url, fresh);
    if (!retry.ok) {
      throw new Error(`Booksy API ${retry.status} po odswiezeniu klucza (${label})`);
    }
    return retry.json();
  }

  if (!res.ok) {
    throw new Error(`Booksy API ${res.status}: ${res.statusText} (${label})`);
  }

  return res.json();
}

// --- public API ---

export async function fetchBusiness(businessId) {
  const url = `${API_BASE}/businesses/${businessId}/?no_thumbs=true&with_markdown=1&with_combos=1`;
  return booksyFetchWithRetry(url, 'business');
}

// Rate limit advisory: callers should space requests at ~500ms intervals
// to avoid Booksy rate limiting. The sentiment pipeline (Etap 8) handles this.
export async function fetchReviews(businessId, page = 1, perPage = 10) {
  const url = `${API_BASE}/businesses/${businessId}/reviews/?reviews_page=${page}&reviews_per_page=${perPage}&ordering=-created`;
  return booksyFetchWithRetry(url, 'reviews');
}

export function extractBusinessId(url) {
  // booksy.com/{locale}/{id}_slug... e.g. /en-pl/36993_barber-shop...
  const booksyMatch = url.match(/booksy\.com\/[a-z]{2}-[a-z]{2}\/(\d+)/);
  if (booksyMatch) return booksyMatch[1];

  // fallback: bare /digits at end or before ? / #
  const fallback = url.match(/\/(\d+)(?:[_?#]|$)/);
  return fallback ? fallback[1] : null;
}
