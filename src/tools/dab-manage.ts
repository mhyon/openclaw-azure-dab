import { Type } from "@sinclair/typebox";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import type { PluginContext } from "../lib/types.js";
import { toolResult, toolError } from "../lib/types.js";
import { dabCliExists } from "../lib/az-helpers.js";
import { getDabService } from "../services/dab-service.js";

export function registerDabManageTool(api: any, ctx: PluginContext) {
  api.registerTool({
    name: "dab_manage",
    description: `Manage Data API Builder configuration and runtime. 
DAB generates REST + GraphQL + MCP endpoints from a JSON config file — no custom API code needed.
Actions: init (create config), add-entity (expose a table/view/stored proc), start (run DAB), stop, status, validate.
Requires: dab CLI installed (dotnet tool install -g Microsoft.DataApiBuilder).`,
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("init"),
        Type.Literal("add-entity"),
        Type.Literal("remove-entity"),
        Type.Literal("start"),
        Type.Literal("stop"),
        Type.Literal("status"),
        Type.Literal("validate"),
        Type.Literal("install-dab"),
      ], {
        description: "DAB management action",
      }),

      // For init
      connectionStringEnvVar: Type.Optional(
        Type.String({
          description: "Env var name holding connection string (default: SQL_CONN). DAB config will reference @env('SQL_CONN'), never the actual string.",
        })
      ),
      hostMode: Type.Optional(
        Type.Union([Type.Literal("Development"), Type.Literal("Production")], {
          description: "DAB host mode (default: Production)",
        })
      ),
      enableGraphql: Type.Optional(Type.Boolean({ description: "Enable GraphQL endpoint (default: true)" })),
      enableRest: Type.Optional(Type.Boolean({ description: "Enable REST endpoint (default: true)" })),
      enableMcp: Type.Optional(Type.Boolean({ description: "Enable MCP endpoint (default: true, requires DAB 1.7+)" })),
      corsOrigins: Type.Optional(
        Type.Array(Type.String(), { description: "CORS allowed origins (default: ['http://localhost'])" })
      ),
      authProvider: Type.Optional(
        Type.Union([
          Type.Literal("EntraID"),
          Type.Literal("AppService"),
          Type.Literal("Simulator"),
        ], { description: "Auth provider (default: Simulator for dev, EntraID for prod)" })
      ),
      authAudience: Type.Optional(Type.String({ description: "JWT audience claim (for EntraID/custom JWT)" })),
      authIssuer: Type.Optional(Type.String({ description: "JWT issuer URL (for EntraID/custom JWT)" })),

      // For add-entity / remove-entity
      entityName: Type.Optional(Type.String({ description: "Entity name (used in REST/GraphQL paths)" })),
      sourceObject: Type.Optional(Type.String({ description: "Database object: table/view name or stored proc" })),
      sourceType: Type.Optional(
        Type.Union([Type.Literal("table"), Type.Literal("view"), Type.Literal("stored-procedure")], {
          description: "Source type (default: table)",
        })
      ),
      permissions: Type.Optional(
        Type.Array(
          Type.Object({
            role: Type.String({ description: "Role name (e.g., anonymous, authenticated, admin)" }),
            actions: Type.Array(Type.String({ description: "CRUD actions: create, read, update, delete, execute, *" })),
          }),
          { description: "Permission rules for this entity" }
        )
      ),

      // For start
      port: Type.Optional(Type.Number({ description: "Port to run DAB on (default from plugin config or 5000)" })),

      // Common
      projectDir: Type.Optional(Type.String({ description: "Project directory (default from plugin config or workspace)" })),
    }),
    async execute(_id: string, params: any) {
      try {
        const projectDir = params.projectDir || ctx.config.projectDir || process.cwd();

        switch (params.action) {
          case "install-dab":
            return handleInstallDab();
          case "init":
            return handleInit(params, projectDir, ctx);
          case "add-entity":
            return handleAddEntity(params, projectDir);
          case "remove-entity":
            return handleRemoveEntity(params, projectDir);
          case "start":
            return handleStart(params, projectDir, ctx);
          case "stop":
            return handleStop(ctx);
          case "status":
            return await handleDabStatus(ctx);
          case "validate":
            return handleValidate(projectDir);
          default:
            return toolError(`Unknown action: ${params.action}`);
        }
      } catch (err: any) {
        ctx.logger.error("dab_manage error:", err);
        return toolError(err.message || String(err));
      }
    },
  });
}

function handleInstallDab() {
  try {
    execSync("dotnet tool install -g Microsoft.DataApiBuilder", {
      encoding: "utf-8",
      timeout: 120_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return toolResult("✅ Data API Builder CLI installed globally.\nRun `dab --version` to verify.");
  } catch (err: any) {
    if (err.message?.includes("already installed")) {
      // Try update instead
      try {
        execSync("dotnet tool update -g Microsoft.DataApiBuilder", {
          encoding: "utf-8",
          timeout: 120_000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return toolResult("✅ Data API Builder CLI updated to latest version.");
      } catch {
        return toolResult("✅ Data API Builder CLI is already installed and up to date.");
      }
    }
    if (err.message?.includes("dotnet")) {
      return toolError(
        "dotnet CLI not found. Install .NET SDK first: https://dot.net/download\n" +
        "Then run: dotnet tool install -g Microsoft.DataApiBuilder"
      );
    }
    return toolError(`Install failed: ${err.message}`);
  }
}

function handleInit(params: any, projectDir: string, ctx: PluginContext) {
  if (!dabCliExists()) {
    return toolError("DAB CLI not found. Run action=install-dab first.");
  }

  const connEnvVar = params.connectionStringEnvVar || "SQL_CONN";
  const hostMode = params.hostMode || "Production";
  const corsOrigins = params.corsOrigins || ["http://localhost"];
  const authProvider = params.authProvider || (hostMode === "Development" ? "Simulator" : "EntraID");

  let cmd = `dab init` +
    ` --database-type mssql` +
    ` --connection-string "@env('${connEnvVar}')"` +
    ` --host-mode ${hostMode}` +
    ` --set-session-context true` +
    ` --cors-origin "${corsOrigins.join(",")}"` +
    ` --rest.enabled ${params.enableRest !== false}` +
    ` --graphql.enabled ${params.enableGraphql !== false}`;

  // MCP support (DAB 1.7+)
  if (params.enableMcp !== false) {
    cmd += ` --mcp.enabled true`;
  }

  // Auth
  cmd += ` --auth.provider ${authProvider}`;
  if (params.authAudience) cmd += ` --auth.audience ${params.authAudience}`;
  if (params.authIssuer) cmd += ` --auth.issuer ${params.authIssuer}`;

  execSync(cmd, {
    cwd: projectDir,
    encoding: "utf-8",
    timeout: 30_000,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const configPath = path.join(projectDir, "dab-config.json");
  const lines = [
    `✅ DAB configuration created!`,
    ``,
    `📁 Config: ${configPath}`,
    ``,
    `🔒 Security settings:`,
    `   Auth provider:       ${authProvider}`,
    `   Session context:     enabled (JWT claims → SQL SESSION_CONTEXT)`,
    `   CORS:                ${corsOrigins.join(", ")}`,
    `   Connection string:   @env('${connEnvVar}') — never stored in config`,
    `   REST:                ${params.enableRest !== false ? "enabled" : "disabled"}`,
    `   GraphQL:             ${params.enableGraphql !== false ? "enabled" : "disabled"}`,
    `   MCP:                 ${params.enableMcp !== false ? "enabled" : "disabled"}`,
    ``,
    `Next: Add entities with action=add-entity to expose tables/views.`,
  ];

  return toolResult(lines.join("\n"));
}

function handleAddEntity(params: any, projectDir: string) {
  if (!dabCliExists()) return toolError("DAB CLI not found. Run action=install-dab first.");
  if (!params.entityName) return toolError("entityName is required.");
  if (!params.sourceObject) return toolError("sourceObject is required (table/view/proc name).");

  const sourceType = params.sourceType || "table";
  const permissions = params.permissions || [{ role: "anonymous", actions: ["read"] }];

  // Build permission string: "role:actions" pairs
  const permStrings = permissions.map(
    (p: any) => `"${p.role}:${p.actions.join(",")}"`
  );

  let cmd = `dab add ${params.entityName}` +
    ` --source "${params.sourceObject}"` +
    ` --source.type ${sourceType}` +
    ` --permissions ${permStrings.join(" ")}`;

  execSync(cmd, {
    cwd: projectDir,
    encoding: "utf-8",
    timeout: 30_000,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const lines = [
    `✅ Entity "${params.entityName}" added!`,
    ``,
    `   Source:      ${params.sourceObject} (${sourceType})`,
    `   REST:        /api/${params.entityName}`,
    `   GraphQL:     query { ${params.entityName}s { items { ... } } }`,
    `   Permissions: ${permissions.map((p: any) => `${p.role}=[${p.actions.join(",")}]`).join(", ")}`,
  ];

  return toolResult(lines.join("\n"));
}

function handleRemoveEntity(params: any, projectDir: string) {
  if (!dabCliExists()) return toolError("DAB CLI not found. Run action=install-dab first.");
  if (!params.entityName) return toolError("entityName is required.");

  // Read config and remove the entity
  const configPath = path.join(projectDir, "dab-config.json");
  if (!fs.existsSync(configPath)) return toolError("No dab-config.json found. Run action=init first.");

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  if (!config.entities?.[params.entityName]) {
    return toolError(`Entity "${params.entityName}" not found in config.`);
  }

  delete config.entities[params.entityName];
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  return toolResult(`✅ Entity "${params.entityName}" removed from config.`);
}

async function handleStart(params: any, projectDir: string, ctx: PluginContext) {
  if (!dabCliExists()) return toolError("DAB CLI not found. Run action=install-dab first.");

  const configPath = path.join(projectDir, "dab-config.json");
  if (!fs.existsSync(configPath)) return toolError("No dab-config.json found. Run action=init first.");

  const port = params.port || ctx.config.dabPort || 5000;

  const service = getDabService();
  if (!service) {
    return toolError("DAB service not initialized. This is a plugin setup error.");
  }

  try {
    const state = await service.start({ projectDir, port });
    const lines = [
      `🚀 DAB started via background service!`,
      ``,
      `   PID:     ${state.pid}`,
      `   Port:    ${state.port}`,
      `   Healthy: ${state.healthy ? "✅" : "⏳ starting up..."}`,
      `   Started: ${state.startedAt}`,
      ``,
      `Endpoints:`,
      `   REST:    http://localhost:${port}/api`,
      `   GraphQL: http://localhost:${port}/graphql`,
      `   MCP:     http://localhost:${port}/mcp`,
      `   Health:  http://localhost:${port}/health`,
    ];
    return toolResult(lines.join("\n"));
  } catch (err: any) {
    return toolError(`Failed to start DAB: ${err.message}`);
  }
}

async function handleStop(ctx: PluginContext) {
  const service = getDabService();
  if (!service) {
    // Fallback to pkill if service not initialized
    try {
      execSync("pkill -f 'Microsoft.DataApiBuilder'", { stdio: "pipe" });
      return toolResult("✅ DAB process stopped (via pkill fallback).");
    } catch {
      return toolResult("ℹ️ No DAB process found running.");
    }
  }

  const state = await service.stop();
  if (!state.running) {
    return toolResult("✅ DAB service stopped.");
  }
  return toolError("Failed to stop DAB service.");
}

async function handleDabStatus(ctx: PluginContext) {
  const port = ctx.config.dabPort || 5000;
  try {
    const resp = await fetch(`http://localhost:${port}/health`);
    if (resp.ok) {
      return toolResult(`✅ DAB is running on port ${port} and healthy.`);
    }
    return toolResult(`⚠️ DAB responded on port ${port} but health check returned ${resp.status}.`);
  } catch {
    return toolResult(`ℹ️ DAB is not running on port ${port}.`);
  }
}

function handleValidate(projectDir: string) {
  if (!dabCliExists()) return toolError("DAB CLI not found. Run action=install-dab first.");

  const configPath = path.join(projectDir, "dab-config.json");
  if (!fs.existsSync(configPath)) return toolError("No dab-config.json found.");

  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const issues: string[] = [];

    // Check connection string isn't plaintext
    const connStr = config?.["data-source"]?.["connection-string"] || "";
    if (connStr && !connStr.includes("@env(")) {
      issues.push("🔴 Connection string is plaintext in config! Use @env('SQL_CONN') instead.");
    }

    // Check auth provider
    const authProvider = config?.runtime?.host?.authentication?.provider;
    if (authProvider === "Simulator") {
      issues.push("⚠️ Auth provider is 'Simulator' — use EntraID or custom JWT for production.");
    }

    // Check CORS
    const corsOrigins = config?.runtime?.host?.cors?.origins || [];
    if (corsOrigins.includes("*")) {
      issues.push("🔴 CORS allows all origins (*). Restrict to specific domains.");
    }

    // Check session context
    const sessionCtx = config?.["data-source"]?.options?.["set-session-context"];
    if (!sessionCtx) {
      issues.push("⚠️ Session context is disabled. Enable for row-level security with JWT claims.");
    }

    // Check host mode
    const hostMode = config?.runtime?.host?.mode;
    if (hostMode === "development" || hostMode === "Development") {
      issues.push("⚠️ Host mode is 'Development'. Use 'Production' for deployed environments.");
    }

    // Check entities have permissions
    const entities = config?.entities || {};
    for (const [name, entity] of Object.entries(entities)) {
      const perms = (entity as any)?.permissions;
      if (!perms || perms.length === 0) {
        issues.push(`⚠️ Entity "${name}" has no permissions defined.`);
      }
    }

    const entityCount = Object.keys(entities).length;

    if (issues.length === 0) {
      return toolResult(
        `✅ Config validation passed!\n\n` +
        `   Entities:    ${entityCount}\n` +
        `   Auth:        ${authProvider || "not set"}\n` +
        `   Conn string: env-referenced ✓\n` +
        `   Session ctx: ${sessionCtx ? "enabled ✓" : "disabled"}`
      );
    }

    return toolResult(
      `⚠️ Config validation found ${issues.length} issue(s):\n\n${issues.join("\n")}`
    );
  } catch (err: any) {
    return toolError(`Config parse error: ${err.message}`);
  }
}
