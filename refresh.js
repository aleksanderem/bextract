import { refreshApiKey } from './auth.js';

console.log('[refresh] pobieram swiezy x-api-key...');

try {
  const creds = await refreshApiKey();
  console.log(`[refresh] x-api-key: ${creds.headers['x-api-key']}`);
  console.log('[refresh] gotowe');
} catch (err) {
  console.error('[refresh]', err.message);
  process.exit(1);
}
