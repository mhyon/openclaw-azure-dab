import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { registerProvisionTool } from "./tools/provision.js";
import { registerDabManageTool } from "./tools/dab-manage.js";
import { registerDabQueryTool } from "./tools/dab-query.js";
import { registerMcpBridgeTool } from "./tools/mcp-bridge.js";
import { createDabService } from "./services/dab-service.js";

export default definePluginEntry({
  id: "azure-dab",
  name: "Azure Data API Builder",
  description:
    "Provision free Azure SQL databases and expose them via Data API Builder (REST/GraphQL/MCP)",

  register(api) {
    const pluginConfig = api.pluginConfig as {
      projectDir?: string;
      defaultRegion?: string;
      dabPort?: number;
    };

    const ctx = {
      logger: api.logger,
      config: pluginConfig,
      resolvePath: api.resolvePath,
    };

    // Create and register DAB background service
    const dabService = createDabService(ctx);
    api.registerService({
      id: "dab-runtime",
      start: () => dabService.start(),
      stop: () => dabService.stop(),
    });

    registerProvisionTool(api, ctx);
    registerDabManageTool(api, ctx);
    registerDabQueryTool(api, ctx);
    registerMcpBridgeTool(api, ctx);

    // Health check route for DAB status
    api.registerHttpRoute({
      path: "/azure-dab/health",
      auth: "gateway",
      match: "exact",
      handler: async (_req, res) => {
        const port = pluginConfig.dabPort ?? 5000;
        try {
          const resp = await fetch(`http://localhost:${port}/health`);
          const ok = resp.ok;
          res.statusCode = ok ? 200 : 503;
          res.end(JSON.stringify({ dab: ok ? "healthy" : "unhealthy", port }));
        } catch {
          res.statusCode = 503;
          res.end(JSON.stringify({ dab: "unreachable", port }));
        }
        return true;
      },
    });

    api.logger.info("Azure DAB plugin registered");
  },
});
