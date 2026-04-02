import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import path from "node:path";
import type { PluginContext } from "../lib/types.js";
import { toolResult, toolError } from "../lib/types.js";
import { getDabService } from "../services/dab-service.js";

export function registerMcpBridgeTool(api: any, ctx: PluginContext) {
  api.registerTool({
    name: "dab_mcp",
    description: `Bridge to Data API Builder's native MCP endpoint (DAB 1.7+).
DAB exposes an MCP server via SSE transport at /mcp. This tool checks status and provides connection info.
Actions: status (check MCP availability), list-tools (show available MCP tools), call-tool (info about calling MCP tools).`,
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("list-tools"),
        Type.Literal("call-tool"),
        Type.Literal("status"),
      ], {
        description: "MCP bridge action",
      }),
      toolName: Type.Optional(Type.String({ description: "MCP tool name to call" })),
      toolArgs: Type.Optional(Type.Any({ description: "Arguments for the MCP tool call (JSON object)" })),
      baseUrl: Type.Optional(Type.String({ description: "DAB base URL (default: http://localhost:<port>)" })),
    }),
    async execute(_id: string, params: any) {
      try {
        const port = ctx.config.dabPort || 5000;
        const baseUrl = params.baseUrl || `http://localhost:${port}`;

        switch (params.action) {
          case "status":
            return await handleStatus(baseUrl, ctx);
          case "list-tools":
            return await handleListTools(baseUrl, ctx);
          case "call-tool":
            return handleCallTool(params, baseUrl);
          default:
            return toolError(`Unknown action: ${params.action}`);
        }
      } catch (err: any) {
        ctx.logger.error("dab_mcp error:", err);
        return toolError(err.message || String(err));
      }
    },
  });
}

async function handleStatus(baseUrl: string, ctx: PluginContext) {
  const lines: string[] = [];

  // Check if DAB is running via service
  const service = getDabService();
  if (service) {
    const state = service.state;
    lines.push(`DAB Service: ${state.running ? "running" : "stopped"}`);
    if (state.pid) lines.push(`PID: ${state.pid}`);
    if (state.startedAt) lines.push(`Started: ${state.startedAt}`);
  }

  // Check DAB health
  let dabHealthy = false;
  try {
    const resp = await fetch(`${baseUrl}/health`);
    dabHealthy = resp.ok;
    lines.push(`DAB Health: ${dabHealthy ? "✅ healthy" : "⚠️ unhealthy"}`);
  } catch {
    lines.push("DAB Health: ❌ unreachable");
  }

  // Check if MCP is enabled in config
  const mcpEnabled = checkMcpInConfig(ctx);
  lines.push(`MCP Enabled in Config: ${mcpEnabled ? "✅ yes" : "❌ no"}`);

  if (dabHealthy && mcpEnabled) {
    lines.push("");
    lines.push("🔌 MCP Connection Info:");
    lines.push(`   Transport: SSE (Server-Sent Events)`);
    lines.push(`   Endpoint:  ${baseUrl}/mcp`);
    lines.push("");
    lines.push("To connect from an MCP client, use:");
    lines.push(`   URL: ${baseUrl}/mcp`);
    lines.push(`   Transport: sse`);
  } else if (!mcpEnabled) {
    lines.push("");
    lines.push("💡 To enable MCP, reinitialize DAB with enableMcp=true");
    lines.push("   or add to dab-config.json: { \"runtime\": { \"mcp\": { \"enabled\": true } } }");
  }

  return toolResult(lines.join("\n"));
}

async function handleListTools(baseUrl: string, ctx: PluginContext) {
  // Check if DAB is running
  let dabHealthy = false;
  try {
    const resp = await fetch(`${baseUrl}/health`);
    dabHealthy = resp.ok;
  } catch {
    return toolError("DAB is not running. Start it with dab_manage action=start.");
  }

  if (!dabHealthy) {
    return toolError("DAB health check failed. Ensure DAB is running and healthy.");
  }

  const mcpEnabled = checkMcpInConfig(ctx);
  if (!mcpEnabled) {
    return toolError("MCP is not enabled in dab-config.json. Enable it first.");
  }

  // Read config to infer available MCP tools from entities
  const projectDir = ctx.config.projectDir || process.cwd();
  const configPath = path.join(projectDir, "dab-config.json");

  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const entities = config.entities || {};
    const entityNames = Object.keys(entities);

    if (entityNames.length === 0) {
      return toolResult(
        "MCP endpoint is available but no entities are configured.\n" +
        "Add entities with dab_manage action=add-entity first."
      );
    }

    const lines = [
      `🔧 DAB MCP Tools (inferred from ${entityNames.length} entities):`,
      "",
    ];

    for (const [name, entity] of Object.entries(entities)) {
      const e = entity as any;
      const sourceType = e.source?.type || "table";
      const perms = e.permissions || [];
      const actions = perms.flatMap((p: any) => p.actions || []);
      const uniqueActions = [...new Set(actions)];

      lines.push(`  📋 ${name} (${sourceType})`);
      lines.push(`     Source: ${e.source?.object || "unknown"}`);
      lines.push(`     Actions: ${uniqueActions.join(", ") || "none"}`);
      lines.push("");
    }

    lines.push("🔌 Connect an MCP client to consume these tools:");
    lines.push(`   URL: ${baseUrl}/mcp`);
    lines.push(`   Transport: SSE`);

    return toolResult(lines.join("\n"));
  } catch (err: any) {
    return toolError(`Could not read DAB config: ${err.message}`);
  }
}

function handleCallTool(params: any, baseUrl: string) {
  if (!params.toolName) {
    return toolError("toolName is required for call-tool action.");
  }

  // DAB's MCP uses SSE transport — direct tool calls require a proper MCP client handshake.
  // Provide guidance on how to use it.
  const lines = [
    `ℹ️ DAB MCP uses SSE transport and requires a proper MCP client handshake.`,
    ``,
    `To call tool "${params.toolName}", use an MCP-compatible client:`,
    ``,
    `1. Configure your MCP client with:`,
    `   URL: ${baseUrl}/mcp`,
    `   Transport: SSE`,
    ``,
    `2. Alternatively, use the REST or GraphQL endpoints directly:`,
    `   REST:    ${baseUrl}/api/<entity>`,
    `   GraphQL: ${baseUrl}/graphql`,
    ``,
    `For direct data access without MCP, use the dab_query tool instead.`,
  ];

  if (params.toolArgs) {
    lines.push(``, `Requested args: ${JSON.stringify(params.toolArgs, null, 2)}`);
  }

  return toolResult(lines.join("\n"));
}

function checkMcpInConfig(ctx: PluginContext): boolean {
  const projectDir = ctx.config.projectDir || process.cwd();
  const configPath = path.join(projectDir, "dab-config.json");

  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return config?.runtime?.mcp?.enabled === true;
  } catch {
    return false;
  }
}
