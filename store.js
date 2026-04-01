import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(__dirname, '.credentials.json');

export function saveCredentials(credentials) {
  writeFileSync(STORE_PATH, JSON.stringify(credentials, null, 2));
}

export function loadCredentials() {
  if (!existsSync(STORE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

export function clearCredentials() {
  if (existsSync(STORE_PATH)) {
    writeFileSync(STORE_PATH, '{}');
  }
}
