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

// Issue #34 — listing API. Two pagination paths:
//   * geo: shrink the area bbox to surface different top-N
//   * per_page: bump up to 100 (Booksy hard-caps at 100) for 5x more
//     results in a single call vs the default 20.
// Combined with location-id walking (city → districts via location_details.canonical_children)
// this gives near-100% coverage without exhaustive bbox quad-tree.
export async function fetchListing(opts) {
  const params = new URLSearchParams({
    response_type: "listing_web",
    no_thumbs: "true",
    include_venues: "1",
    listing_id: crypto.randomUUID(),
  });
  if (opts.category != null) params.set("category", String(opts.category));
  if (opts.location_id != null) params.set("location_id", String(opts.location_id));
  if (opts.area) params.set("area", opts.area);
  if (opts.location_geo) params.set("location_geo", opts.location_geo);
  if (opts.per_page != null) {
    const n = Math.max(1, Math.min(100, Number(opts.per_page) || 20));
    params.set("businesses_per_page", String(n));
  }
  const url = `${API_BASE}/businesses/?${params.toString()}`;
  return booksyFetchWithRetry(url, "listing");
}

// Issue #34 follow-up: location_details for a given location_id includes
// canonical_children (e.g. Warsaw=3 has 90+ district sub-locations).
// Re-uses the listing endpoint with per_page=1 to fetch cheaply.
export async function fetchLocationDetails(locationId) {
  const params = new URLSearchParams({
    response_type: "listing_web",
    no_thumbs: "true",
    include_venues: "0",
    listing_id: crypto.randomUUID(),
    location_id: String(locationId),
    businesses_per_page: "1",
  });
  const url = `${API_BASE}/businesses/?${params.toString()}`;
  const data = await booksyFetchWithRetry(url, "location_details");
  return data.location_details || null;
}
