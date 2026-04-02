import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import path from "node:path";
import type { PluginContext } from "../lib/types.js";
import { toolResult, toolError } from "../lib/types.js";
import {
  azJson,
  azRaw,
  checkAzAuth,
  generateSecurePassword,
  getCurrentIp,
  azCliExists,
  dabCliExists,
  dotnetCliExists,
  detectOs,
} from "../lib/az-helpers.js";
import { storeSecret, getSecret, listSecretKeys } from "../lib/secret-store.js";

export function registerProvisionTool(api: any, ctx: PluginContext) {
  api.registerTool({
    name: "azure_sql_provision",
    description: `Provision a free Azure SQL Database. Handles login, resource group, server, database, and firewall setup. 
The free offer gives 100K vCore seconds + 32GB storage per month per database (up to 10 per subscription). 
Generates a secure admin password and stores the connection string safely. 
Requires: az CLI installed and user must complete interactive login.`,
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("setup"),
        Type.Literal("check"),
        Type.Literal("login"),
        Type.Literal("create"),
        Type.Literal("status"),
        Type.Literal("setup-entra"),
      ], {
        description:
          "setup = guided first-time setup (detects what's missing and gives step-by-step instructions), check = verify prerequisites, login = start az login, create = provision resources, status = show existing free databases, setup-entra = configure Entra ID auth for DAB",
      }),
      // For 'create' action
      resourceGroup: Type.Optional(
        Type.String({ description: "Resource group name (auto-generated if omitted)" })
      ),
      serverName: Type.Optional(
        Type.String({ description: "SQL server name (auto-generated if omitted)" })
      ),
      databaseName: Type.Optional(
        Type.String({ description: "Database name (default: free-db)" })
      ),
      region: Type.Optional(
        Type.String({ description: "Azure region (default from plugin config or westus2)" })
      ),
      adminUser: Type.Optional(
        Type.String({ description: "SQL admin username (default: sqladmin)" })
      ),
    }),
    async execute(_id: string, params: any) {
      try {
        switch (params.action) {
          case "setup":
            return handleSetup(ctx);
          case "check":
            return handleCheck();
          case "login":
            return handleLogin();
          case "create":
            return await handleCreate(params, ctx);
          case "status":
            return handleStatus();
          case "setup-entra":
            return await handleSetupEntra(params, ctx);
          default:
            return toolError(`Unknown action: ${params.action}`);
        }
      } catch (err: any) {
        ctx.logger.error("azure_sql_provision error:", err);
        return toolError(err.message || String(err));
      }
    },
  });
}

/**
 * Guided first-time setup. Detects the user's current state and gives
 * step-by-step instructions for whatever is missing. Designed for someone
 * who found this plugin on GitHub and has never touched Azure.
 */
function handleSetup(ctx: PluginContext) {
  const os = detectOs();
  const lines: string[] = [];
  let step = 1;
  let allGood = true;

  lines.push("🔍 Checking your setup...\n");

  // ── Step: Azure CLI ──
  const hasAz = azCliExists();
  if (hasAz) {
    lines.push(`  ✅ Azure CLI installed`);
  } else {
    allGood = false;
    lines.push(`  ❌ Step ${step}: Install the Azure CLI`);
    lines.push(``);
    if (os === "macos") {
      lines.push(`     Run: brew install azure-cli`);
    } else if (os === "linux") {
      lines.push(`     Run: curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash`);
    } else if (os === "windows") {
      lines.push(`     Run: winget install Microsoft.AzureCLI`);
    } else {
      lines.push(`     See: https://aka.ms/installazurecli`);
    }
    lines.push(`     Then come back and try again.`);
    lines.push(``);
    step++;
  }

  // ── Step: Azure account / login ──
  if (hasAz) {
    const auth = checkAzAuth();
    if (auth.loggedIn) {
      lines.push(`  ✅ Logged in (subscription: ${auth.subscription})`);
    } else {
      allGood = false;
      lines.push(`  ❌ Step ${step}: Log in to Azure`);
      lines.push(``);
      lines.push(`     If you have an Azure account:`);
      lines.push(`       Run action=login (or 'az login' in your terminal)`);
      lines.push(``);
      lines.push(`     If you DON'T have an Azure account yet:`);
      lines.push(`       1. Go to https://azure.microsoft.com/free`);
      lines.push(`       2. Click "Start free" — you get $200 credit for 30 days`);
      lines.push(`       3. You need a Microsoft account and a credit card for verification`);
      lines.push(`          (the free SQL database will NOT charge you)`);
      lines.push(`       4. After signup, come back and run action=login`);
      lines.push(``);
      step++;
    }
  }

  // ── Step: .NET SDK ──
  const hasDotnet = dotnetCliExists();
  if (hasDotnet) {
    lines.push(`  ✅ .NET SDK installed`);
  } else {
    allGood = false;
    lines.push(`  ❌ Step ${step}: Install the .NET SDK`);
    lines.push(``);
    if (os === "macos") {
      lines.push(`     Run: brew install dotnet`);
    } else if (os === "windows") {
      lines.push(`     Run: winget install Microsoft.DotNet.SDK.9`);
    } else {
      lines.push(`     See: https://dot.net/download`);
    }
    lines.push(`     (Required for Data API Builder)`);
    lines.push(``);
    step++;
  }

  // ── Step: DAB CLI ──
  const hasDab = dabCliExists();
  if (hasDab) {
    lines.push(`  ✅ Data API Builder CLI installed`);
  } else if (hasDotnet) {
    // Can auto-install
    lines.push(`  ⚠️ Data API Builder CLI not found (I can install it for you during setup)`);
  } else {
    allGood = false;
    lines.push(`  ❌ Step ${step}: Install Data API Builder (after installing .NET above)`);
    lines.push(``);
    lines.push(`     Run: dotnet tool install -g Microsoft.DataApiBuilder`);
    lines.push(``);
    step++;
  }

  // ── Step: Existing databases ──
  const existingConn = getSecret("SQL_CONN");
  if (existingConn) {
    lines.push(`  ✅ Connection string stored from previous setup`);
  }

  // ── Summary ──
  lines.push(``);
  if (allGood) {
    lines.push(`🎉 Everything looks good! You're ready to go.`);
    lines.push(``);
    if (!existingConn) {
      lines.push(`Next: Run action=create to provision a free Azure SQL database.`);
      lines.push(`  → This creates a database, sets up firewall rules, and stores the connection securely.`);
      lines.push(`  → Then use dab_manage to expose your tables as REST/GraphQL APIs.`);
    } else {
      lines.push(`You already have a stored connection. You can:`);
      lines.push(`  → Run dab_manage action=init to create a DAB config`);
      lines.push(`  → Run dab_manage action=add-entity to expose tables`);
      lines.push(`  → Run action=create to provision another database`);
    }
  } else {
    lines.push(`📋 Complete the steps above, then run action=setup again to re-check.`);
    lines.push(``);
    lines.push(`The whole process takes about 5 minutes.`);
  }

  return toolResult(lines.join("\n"));
}

function handleCheck() {
  const issues: string[] = [];
  const good: string[] = [];

  // Azure CLI
  if (!azCliExists()) {
    issues.push("❌ Azure CLI (`az`) not found. Install: https://aka.ms/installazurecli");
  } else {
    good.push("✅ Azure CLI installed");
    const auth = checkAzAuth();
    if (auth.loggedIn) {
      good.push(`✅ Logged in to subscription: ${auth.subscription}`);
    } else {
      issues.push("⚠️ Not logged in. Run action=login first.");
    }
  }

  // .NET SDK
  if (!dotnetCliExists()) {
    issues.push("❌ .NET SDK (`dotnet`) not found. Install: https://dot.net/download");
  } else {
    good.push("✅ .NET SDK installed");
  }

  // DAB CLI
  if (!dabCliExists()) {
    issues.push("⚠️ DAB CLI not found. Run dab_manage action=install-dab to install.");
  } else {
    good.push("✅ DAB CLI installed");
  }

  // Stored connection
  const existingConn = getSecret("SQL_CONN");
  if (existingConn) {
    good.push("✅ Connection string stored");
  }

  const status = issues.length === 0 ? "🎉 Ready to provision!" : "Issues found:";
  return toolResult([status, ...good, ...issues].join("\n"));
}

function handleLogin() {
  try {
    // Try device code flow (works in headless/remote environments)
    azRaw("login --use-device-code");
    const auth = checkAzAuth();
    return toolResult(
      `✅ Logged in successfully!\nSubscription: ${auth.subscription}\nTenant: ${auth.tenantId}`
    );
  } catch (err: any) {
    return toolError(
      `Login failed. The user needs to run 'az login' manually in their terminal.\nError: ${err.message}`
    );
  }
}

async function handleCreate(params: any, ctx: PluginContext) {
  // Verify auth
  const auth = checkAzAuth();
  if (!auth.loggedIn) {
    return toolError("Not logged in. Run action=login first.");
  }

  const region = params.region || ctx.config.defaultRegion || "westus2";
  const resourceGroup = params.resourceGroup || `rg-openclaw-dab-${region}`;
  const serverName = params.serverName || `sql-openclaw-${Date.now().toString(36)}`;
  const databaseName = params.databaseName || "free-db";
  const adminUser = params.adminUser || "sqladmin";
  const adminPassword = generateSecurePassword();

  const steps: string[] = [];

  // Step 1: Resource group
  steps.push(`📦 Creating resource group: ${resourceGroup}...`);
  try {
    azJson(`group create --name ${resourceGroup} --location ${region}`);
    steps.push(`   ✅ Resource group ready`);
  } catch (err: any) {
    if (err.message?.includes("already exists")) {
      steps.push(`   ✅ Resource group already exists`);
    } else throw err;
  }

  // Step 2: SQL Server
  steps.push(`🖥️  Creating SQL server: ${serverName}...`);
  azJson(
    `sql server create` +
    ` --name ${serverName}` +
    ` --resource-group ${resourceGroup}` +
    ` --location ${region}` +
    ` --admin-user ${adminUser}` +
    ` --admin-password "${adminPassword}"` +
    ` --enable-public-network true` +
    ` --minimal-tls-version 1.2`
  );
  steps.push(`   ✅ SQL server created (TLS 1.2 enforced)`);

  // Step 3: Firewall — allow current IP only
  steps.push(`🔒 Configuring firewall (current IP only)...`);
  const ip = await getCurrentIp();
  azJson(
    `sql server firewall-rule create` +
    ` --server ${serverName}` +
    ` --resource-group ${resourceGroup}` +
    ` --name openclaw-dev` +
    ` --start-ip-address ${ip}` +
    ` --end-ip-address ${ip}`
  );
  steps.push(`   ✅ Firewall rule: ${ip} only`);

  // Step 4: Free database
  steps.push(`🗄️  Creating free database: ${databaseName}...`);
  azJson(
    `sql db create` +
    ` --name ${databaseName}` +
    ` --server ${serverName}` +
    ` --resource-group ${resourceGroup}` +
    ` --edition GeneralPurpose` +
    ` --family Gen5` +
    ` --capacity 2` +
    ` --compute-model Serverless` +
    ` --free-limit true` +
    ` --free-limit-exhaustion-behavior AutoPause`
  );
  steps.push(`   ✅ Free database created (auto-pause on limit)`);

  // Build connection string
  const fqdn = `${serverName}.database.windows.net`;
  const connString =
    `Server=tcp:${fqdn},1433;Initial Catalog=${databaseName};` +
    `Persist Security Info=False;User ID=${adminUser};Password=${adminPassword};` +
    `MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;` +
    `Connection Timeout=30;`;

  // Store connection string in secret store
  storeSecret("SQL_CONN", connString);
  steps.push(`\n🔐 Connection string stored in secret store (SQL_CONN).`);

  steps.push(`\n🎉 Provisioning complete!`);
  steps.push(`\n📋 Connection Details:`);
  steps.push(`   Server:         ${fqdn}`);
  steps.push(`   Database:       ${databaseName}`);
  steps.push(`   Admin User:     ${adminUser}`);
  steps.push(`   Resource Group: ${resourceGroup}`);
  steps.push(`   Region:         ${region}`);
  steps.push(`\n🔐 Security:`);
  steps.push(`   - TLS 1.2 enforced`);
  steps.push(`   - Firewall: ${ip} only`);
  steps.push(`   - Free tier: auto-pauses when limits exhausted`);
  steps.push(`   - Password: 32-char cryptographic random`);
  steps.push(`\n⚠️  IMPORTANT: Store the connection string securely.`);
  steps.push(`   Set it as an environment variable:`);
  steps.push(`   export SQL_CONN='${connString}'`);
  steps.push(`\n   Or for DAB, it will be referenced as @env('SQL_CONN') in the config.`);

  return toolResult(steps.join("\n"));
}

function handleStatus() {
  const auth = checkAzAuth();
  if (!auth.loggedIn) {
    return toolError("Not logged in. Run action=login first.");
  }

  try {
    const dbs = azJson<any[]>(
      `sql db list --query "[?sku.name=='GP_S_Gen5_2' && currentServiceObjectiveName=='GP_S_Gen5_2'].{name:name, server:managedBy, status:status, maxSizeBytes:maxSizeBytes}" --recursive`
    );

    if (!dbs || dbs.length === 0) {
      return toolResult("No free-tier Azure SQL databases found in this subscription.");
    }

    const lines = ["📊 Free-tier Azure SQL Databases:\n"];
    for (const db of dbs) {
      lines.push(`  • ${db.name} (status: ${db.status})`);
    }
    lines.push(`\n  Total: ${dbs.length}/10 free databases used`);
    return toolResult(lines.join("\n"));
  } catch {
    return toolResult(
      "Could not enumerate databases. Use Azure Portal to check free offer status."
    );
  }
}

async function handleSetupEntra(params: any, ctx: PluginContext) {
  const auth = checkAzAuth();
  if (!auth.loggedIn) {
    return toolError("Not logged in. Run action=login first.");
  }

  const steps: string[] = [];
  const timestamp = Date.now().toString(36);
  const displayName = `DAB-OpenClaw-${timestamp}`;

  // Step 1: Create Entra ID app registration
  steps.push(`🔐 Creating Entra ID app registration: ${displayName}...`);
  const app = azJson<{ appId: string; id: string }>(
    `ad app create --display-name "${displayName}" --sign-in-audience AzureADMyOrg`
  );
  const appId = app.appId;
  steps.push(`   ✅ App created (appId: ${appId})`);

  // Step 2: Create service principal
  steps.push(`👤 Creating service principal...`);
  try {
    azJson(`ad sp create --id ${appId}`);
    steps.push(`   ✅ Service principal created`);
  } catch (err: any) {
    if (err.message?.includes("already exists")) {
      steps.push(`   ✅ Service principal already exists`);
    } else {
      steps.push(`   ⚠️ Service principal creation failed: ${err.message}`);
    }
  }

  // Step 3: Set identifier URI (API scope)
  steps.push(`🔗 Setting API identifier URI...`);
  azRaw(`ad app update --id ${appId} --identifier-uris "api://${appId}"`);
  steps.push(`   ✅ Identifier URI: api://${appId}`);

  // Step 4: Enable ID tokens
  steps.push(`🎟️  Enabling ID token issuance...`);
  azRaw(`ad app update --id ${appId} --enable-id-token-issuance true`);
  steps.push(`   ✅ ID tokens enabled`);

  // Step 5: Get tenant ID
  const tenantId = auth.tenantId!;
  const audience = `api://${appId}`;
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;

  steps.push(`\n🎉 Entra ID setup complete!`);
  steps.push(`\n📋 Auth Configuration:`);
  steps.push(`   App Name:    ${displayName}`);
  steps.push(`   App ID:      ${appId}`);
  steps.push(`   Tenant ID:   ${tenantId}`);
  steps.push(`   Audience:    ${audience}`);
  steps.push(`   Issuer:      ${issuer}`);
  steps.push(`\n📝 DAB Config Values:`);
  steps.push(`   auth.provider:  EntraID`);
  steps.push(`   auth.audience:  ${audience}`);
  steps.push(`   auth.issuer:    ${issuer}`);

  // Auto-update DAB config if it exists
  const projectDir = params.projectDir || ctx.config.projectDir || process.cwd();
  const configPath = path.join(projectDir, "dab-config.json");

  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (!config.runtime) config.runtime = {};
      if (!config.runtime.host) config.runtime.host = {};
      if (!config.runtime.host.authentication) config.runtime.host.authentication = {};

      config.runtime.host.authentication.provider = "EntraID";
      config.runtime.host.authentication.jwt = {
        audience: audience,
        issuer: issuer,
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      steps.push(`\n✅ dab-config.json updated with Entra ID auth settings.`);
    } catch (err: any) {
      steps.push(`\n⚠️ Could not auto-update dab-config.json: ${err.message}`);
      steps.push(`   Update manually or re-run dab_manage action=init with the auth parameters.`);
    }
  } else {
    steps.push(`\nℹ️ No dab-config.json found. Use these values when running dab_manage action=init:`);
    steps.push(`   authProvider: "EntraID"`);
    steps.push(`   authAudience: "${audience}"`);
    steps.push(`   authIssuer: "${issuer}"`);
  }

  return toolResult(steps.join("\n"));
}
