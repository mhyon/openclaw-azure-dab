import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { storeSecret, getSecret, deleteSecret, listSecretKeys } from "../lib/secret-store.js";

describe("secret-store", () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dab-secrets-test-"));
    tempFile = path.join(tempDir, "test-secrets.json");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("stores and retrieves a secret", () => {
    storeSecret("MY_KEY", "my-value", tempFile);
    const value = getSecret("MY_KEY", tempFile);
    expect(value).toBe("my-value");
  });

  it("returns undefined for non-existent key", () => {
    const value = getSecret("DOES_NOT_EXIST", tempFile);
    expect(value).toBeUndefined();
  });

  it("overwrites existing key", () => {
    storeSecret("KEY", "first", tempFile);
    storeSecret("KEY", "second", tempFile);
    expect(getSecret("KEY", tempFile)).toBe("second");
  });

  it("stores multiple keys", () => {
    storeSecret("A", "1", tempFile);
    storeSecret("B", "2", tempFile);
    expect(getSecret("A", tempFile)).toBe("1");
    expect(getSecret("B", tempFile)).toBe("2");
  });

  it("creates file with 0o600 permissions", () => {
    storeSecret("KEY", "val", tempFile);
    const stat = fs.statSync(tempFile);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("deletes a secret", () => {
    storeSecret("KEY", "val", tempFile);
    const deleted = deleteSecret("KEY", tempFile);
    expect(deleted).toBe(true);
    expect(getSecret("KEY", tempFile)).toBeUndefined();
  });

  it("returns false when deleting non-existent key", () => {
    const deleted = deleteSecret("NOPE", tempFile);
    expect(deleted).toBe(false);
  });

  it("lists secret keys", () => {
    storeSecret("A", "1", tempFile);
    storeSecret("B", "2", tempFile);
    const keys = listSecretKeys(tempFile);
    expect(keys).toContain("A");
    expect(keys).toContain("B");
    expect(keys).toHaveLength(2);
  });
});
