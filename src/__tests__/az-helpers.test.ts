import { describe, it, expect } from "vitest";
import { generateSecurePassword } from "../lib/az-helpers.js";

describe("generateSecurePassword", () => {
  it("produces a 32-character password", () => {
    const pw = generateSecurePassword();
    expect(pw).toHaveLength(32);
  });

  it("contains at least 1 uppercase letter", () => {
    const pw = generateSecurePassword();
    expect(pw).toMatch(/[A-Z]/);
  });

  it("contains at least 1 lowercase letter", () => {
    const pw = generateSecurePassword();
    expect(pw).toMatch(/[a-z]/);
  });

  it("contains at least 1 digit", () => {
    const pw = generateSecurePassword();
    expect(pw).toMatch(/[0-9]/);
  });

  it("contains at least 1 symbol", () => {
    const pw = generateSecurePassword();
    expect(pw).toMatch(/[!@#$%^&*()\-_=+\[\]{}|;:,.<>?]/);
  });

  it("is unique across 100 calls", () => {
    const passwords = new Set<string>();
    for (let i = 0; i < 100; i++) {
      passwords.add(generateSecurePassword());
    }
    expect(passwords.size).toBe(100);
  });
});
