import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// TODO: Replace with OS keychain integration (e.g., keytar) for production use.
// Currently uses restrictive file permissions (0o600) as a simple security measure.

const SECRETS_PATH = path.join(os.homedir(), ".openclaw", "azure-dab-secrets.json");

interface SecretsStore {
  [key: string]: string;
}

function ensureDir(): void {
  const dir = path.dirname(SECRETS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function readStore(filePath?: string): SecretsStore {
  const p = filePath ?? SECRETS_PATH;
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as SecretsStore;
  } catch {
    return {};
  }
}

function writeStore(store: SecretsStore, filePath?: string): void {
  const p = filePath ?? SECRETS_PATH;
  ensureDir();
  fs.writeFileSync(p, JSON.stringify(store, null, 2), { mode: 0o600 });
}

/**
 * Store a secret value by key.
 */
export function storeSecret(key: string, value: string, filePath?: string): void {
  const store = readStore(filePath);
  store[key] = value;
  writeStore(store, filePath);
}

/**
 * Retrieve a secret value by key. Returns undefined if not found.
 */
export function getSecret(key: string, filePath?: string): string | undefined {
  const store = readStore(filePath);
  return store[key];
}

/**
 * Delete a secret by key. Returns true if the key existed.
 */
export function deleteSecret(key: string, filePath?: string): boolean {
  const store = readStore(filePath);
  if (key in store) {
    delete store[key];
    writeStore(store, filePath);
    return true;
  }
  return false;
}

/**
 * List all secret keys (not values).
 */
export function listSecretKeys(filePath?: string): string[] {
  return Object.keys(readStore(filePath));
}
