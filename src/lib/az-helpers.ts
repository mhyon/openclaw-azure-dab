import { execSync } from "node:child_process";
import crypto from "node:crypto";

/**
 * Run an az CLI command and return parsed JSON output.
 * Throws on non-zero exit or parse failure.
 */
export function azJson<T = unknown>(args: string): T {
  const raw = execSync(`az ${args} --output json`, {
    encoding: "utf-8",
    timeout: 120_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return JSON.parse(raw.trim()) as T;
}

/**
 * Run an az CLI command, return stdout as string.
 */
export function azRaw(args: string): string {
  return execSync(`az ${args}`, {
    encoding: "utf-8",
    timeout: 120_000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/**
 * Check if the az CLI is installed and the user is logged in.
 */
export function checkAzAuth(): { loggedIn: boolean; subscription?: string; tenantId?: string } {
  try {
    const account = azJson<{ id: string; tenantId: string; name: string }>("account show");
    return { loggedIn: true, subscription: account.id, tenantId: account.tenantId };
  } catch {
    return { loggedIn: false };
  }
}

/**
 * Generate a cryptographically secure password for SQL admin.
 * 32 chars, mix of upper/lower/digits/symbols. Meets Azure SQL complexity requirements.
 */
export function generateSecurePassword(): string {
  const length = 32;
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const symbols = "!@#$%^&*()-_=+[]{}|;:,.<>?";
  const all = upper + lower + digits + symbols;

  // Guarantee at least one from each category
  const guaranteed = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
  ];

  const remaining = Array.from({ length: length - guaranteed.length }, () =>
    all[crypto.randomInt(all.length)]
  );

  // Shuffle all characters together
  const chars = [...guaranteed, ...remaining];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}

/**
 * Get the current machine's public IP for firewall rules.
 */
export async function getCurrentIp(): Promise<string> {
  const resp = await fetch("https://api.ipify.org?format=text");
  return (await resp.text()).trim();
}

/**
 * Check if the az CLI binary exists.
 */
export function azCliExists(): boolean {
  try {
    execSync("which az", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the dab CLI binary exists.
 */
export function dabCliExists(): boolean {
  try {
    execSync("which dab", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the dotnet CLI binary exists.
 */
export function dotnetCliExists(): boolean {
  try {
    execSync("which dotnet", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the current OS for install instructions.
 */
export function detectOs(): "macos" | "linux" | "windows" | "unknown" {
  const platform = process.platform;
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  if (platform === "win32") return "windows";
  return "unknown";
}
