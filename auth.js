import { chromium } from 'playwright-core';
import { saveCredentials, loadCredentials } from './store.js';

const API_RE = /booksy\.com.*\/core\/v\d+\/customer_api\//;

function getBrowserlessUrl() {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) throw new Error('Brak BROWSERLESS_TOKEN w env');
  return `wss://production-sfo.browserless.io?token=${token}`;
}

// --- public API ---

export function ensureCredentials() {
  const existing = loadCredentials();
  if (existing?.headers?.['x-api-key']) return existing;
  return refreshApiKey();
}

export async function refreshApiKey() {
  console.log('[auth] pobieram swiezy x-api-key z booksy...');

  const browser = await chromium.connectOverCDP(getBrowserlessUrl());
  const context = browser.contexts()[0] || await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'pl-PL',
  });
  const page = context.pages()[0] || await context.newPage();

  let capturedHeaders = null;

  page.on('request', (req) => {
    if (capturedHeaders) return;
    if (!API_RE.test(req.url())) return;
    const h = req.headers();
    if (!h['x-api-key']) return;
    capturedHeaders = {};
    for (const key of ['x-api-key', 'x-app-version', 'x-fingerprint']) {
      if (h[key]) capturedHeaders[key] = h[key];
    }
    console.log(`[auth] x-api-key przechwycony: ${capturedHeaders['x-api-key']}`);
  });

  try {
    // any booksy page will trigger API calls containing x-api-key
    await page.goto('https://booksy.com/pl-pl/', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // wait for XHR to fire
    const deadline = Date.now() + 15_000;
    while (!capturedHeaders && Date.now() < deadline) {
      await page.waitForTimeout(500);
    }

    await browser.close();

    if (!capturedHeaders) {
      throw new Error('Nie przechwycono x-api-key z XHR');
    }

    const credentials = {
      headers: capturedHeaders,
      capturedAt: new Date().toISOString(),
    };

    saveCredentials(credentials);
    console.log('[auth] credentials zapisane');
    return credentials;
  } catch (err) {
    try { await browser.close(); } catch {}
    throw err;
  }
}
