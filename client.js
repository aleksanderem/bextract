import { loadCredentials, clearCredentials } from './store.js';
import { refreshApiKey } from './auth.js';

const API_BASE = 'https://pl.booksy.com/core/v2/customer_api';

export async function fetchBusiness(businessId) {
  let creds = loadCredentials();

  if (!creds?.headers?.['x-api-key']) {
    console.log('[client] brak x-api-key, pobieram...');
    creds = await refreshApiKey();
  }

  return callApi(creds, businessId);
}

async function callApi(creds, businessId) {
  const url = `${API_BASE}/businesses/${businessId}/?no_thumbs=true&with_markdown=1&with_combos=1`;

  const res = await fetch(url, {
    headers: {
      ...creds.headers,
      accept: 'application/json, text/plain, */*',
      origin: 'https://booksy.com',
      referer: 'https://booksy.com/',
    },
  });

  if (res.status === 403 || res.status === 401) {
    console.log(`[client] ${res.status} - x-api-key wygasl, odswiezam...`);
    clearCredentials();
    const fresh = await refreshApiKey();
    return callApiOnce(fresh, businessId);
  }

  if (!res.ok) {
    throw new Error(`Booksy API ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

async function callApiOnce(creds, businessId) {
  const url = `${API_BASE}/businesses/${businessId}/?no_thumbs=true&with_markdown=1&with_combos=1`;

  const res = await fetch(url, {
    headers: {
      ...creds.headers,
      accept: 'application/json, text/plain, */*',
      origin: 'https://booksy.com',
      referer: 'https://booksy.com/',
    },
  });

  if (!res.ok) {
    throw new Error(`Booksy API ${res.status} po odswiezeniu klucza`);
  }

  return res.json();
}

export function extractBusinessId(url) {
  const match = url.match(/\/(\d+)(?:[?#]|$)/);
  return match ? match[1] : null;
}
