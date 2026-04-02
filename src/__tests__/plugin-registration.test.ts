import { describe, it, expect, vi } from "vitest";

// We need to mock the openclaw/plugin-sdk/plugin-entry module
// since it's a peer dependency that won't be installed in test
vi.mock("openclaw/plugin-sdk/plugin-entry", () => ({
  definePluginEntry: (entry: any) => entry,
}));

describe("plugin registration", () => {
  it("has correct id", async () => {
    const mod = await import("../index.js");
    expect(mod.default.id).toBe("azure-dab");
  });

  it("has correct name", async () => {
    const mod = await import("../index.js");
    expect(mod.default.name).toBe("Azure Data API Builder");
  });

  it("has a register function", async () => {
    const mod = await import("../index.js");
    expect(typeof mod.default.register).toBe("function");
  });

  it("registration does not throw with mock api", async () => {
    const mod = await import("../index.js");

    const mockApi = {
      pluginConfig: {},
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      resolvePath: (p: string) => p,
      registerTool: vi.fn(),
      registerHttpRoute: vi.fn(),
      registerService: vi.fn(),
    };

    expect(() => mod.default.register(mockApi)).not.toThrow();
  });

  it("registers expected tools and services", async () => {
    const mod = await import("../index.js");

    const mockApi = {
      pluginConfig: {},
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      resolvePath: (p: string) => p,
      registerTool: vi.fn(),
      registerHttpRoute: vi.fn(),
      registerService: vi.fn(),
    };

    mod.default.register(mockApi);

    // Should register 4 tools: provision, dab_manage, dab_query, dab_mcp
    expect(mockApi.registerTool).toHaveBeenCalledTimes(4);

    // Should register 1 HTTP route (health check)
    expect(mockApi.registerHttpRoute).toHaveBeenCalledTimes(1);

    // Should register 1 service (dab-runtime)
    expect(mockApi.registerService).toHaveBeenCalledTimes(1);
    expect(mockApi.registerService).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dab-runtime" })
    );
  });
});
