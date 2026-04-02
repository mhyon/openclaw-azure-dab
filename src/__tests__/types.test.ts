import { describe, it, expect } from "vitest";
import { toolResult, toolError } from "../lib/types.js";

describe("toolResult", () => {
  it("returns correct shape", () => {
    const result = toolResult("hello world");
    expect(result).toEqual({
      content: [{ type: "text", text: "hello world" }],
    });
  });

  it("does not have isError flag", () => {
    const result = toolResult("test");
    expect(result).not.toHaveProperty("isError");
  });
});

describe("toolError", () => {
  it("returns correct shape with isError flag", () => {
    const result = toolError("something went wrong");
    expect(result).toEqual({
      content: [{ type: "text", text: "❌ something went wrong" }],
      isError: true,
    });
  });

  it("prepends error emoji to text", () => {
    const result = toolError("fail");
    expect(result.content[0].text).toBe("❌ fail");
  });

  it("has isError set to true", () => {
    const result = toolError("test");
    expect(result.isError).toBe(true);
  });
});
