# openclaw-azure-dab

Get a free SQL database with a REST + GraphQL + MCP API in minutes. No Azure experience needed.

## What this does

This OpenClaw plugin gives your agent three superpowers:

1. **Creates a free Azure SQL database** for you (no credit card required to start)
2. **Sets up Data API Builder** to turn your tables into REST, GraphQL, and MCP endpoints — zero custom code
3. **Lets your agent query data** directly through the API

You don't need to know Azure. The plugin walks you through every step.

---

## Quick start (from zero)

### Step 1: Install the plugin

```bash
openclaw plugins install /path_to_clone/openclaw-azure-dab
openclaw plugins enable azure-dab
openclaw gateway restart
```

### Step 2: Ask your agent

Just say:

> "Set up a free Azure SQL database"

That's it. The agent detects what you're missing and walks you through each step:

- No Azure CLI? → tells you how to install it
- No Azure account? → walks you through creating one (free)
- Not logged in? → starts the login flow
- No .NET SDK? → shows you where to get it
- No DAB CLI? → installs it for you

If you prefer to do it manually, keep reading.

---

## Manual setup (step by step)

### 1. Get an Azure account (free)

If you don't have an Azure subscription:

1. Go to **[azure.microsoft.com/free](https://azure.microsoft.com/free)**
2. Click **Start free**
3. Sign in with a Microsoft account (or create one)
4. You'll get **$200 credit** for 30 days + many services free for 12 months
5. The free SQL database offer is **separate** from the trial — it lasts as long as your subscription exists

> **Will I get charged?** The free SQL database offer gives you 100,000 vCore seconds + 32 GB of storage per month at no cost. If you exceed the limit, the database auto-pauses (it does NOT bill you). You can have up to 10 free databases per subscription.

### 2. Install the Azure CLI

The plugin uses `az` to talk to Azure.

| Platform | Command |
|----------|---------|
| **macOS** | `brew install azure-cli` |
| **Windows** | `winget install Microsoft.AzureCLI` |
| **Linux (Ubuntu/Debian)** | `curl -sL https://aka.ms/InstallAzureCLIDeb \| sudo bash` |
| **Linux (other)** | See [aka.ms/installazurecli](https://aka.ms/installazurecli) |

Verify: `az --version`

### 3. Install .NET SDK (for Data API Builder)

DAB runs on .NET. You need the SDK to install and run it.

| Platform | Command |
|----------|---------|
| **macOS** | `brew install dotnet` |
| **Windows** | `winget install Microsoft.DotNet.SDK.9` |
| **Linux** | See [dot.net/download](https://dot.net/download) |

Verify: `dotnet --version`

### 4. That's it for prerequisites

The plugin handles the rest:
- Installing the DAB CLI (`dotnet tool install -g Microsoft.DataApiBuilder`)
- Logging you into Azure
- Creating the database with secure defaults
- Configuring DAB
- Starting the API server

---

## What happens during setup

When the plugin provisions a database, it automatically:

| What | How |
|------|-----|
| **Password** | 32-char cryptographic random (upper + lower + digit + symbol) |
| **Connection string** | Stored in `~/.openclaw/azure-dab-secrets.json` with 0600 permissions — never in config files |
| **Firewall** | Allows your current IP only (no `0.0.0.0/0` wildcard) |
| **TLS** | 1.2 minimum enforced |
| **Free tier limits** | Auto-pauses the database if you exceed the monthly quota — no surprise bills |
| **DAB auth** | Entra ID (Microsoft's identity platform) for production; local simulator for development |
| **SQL session context** | Enabled by default — JWT claims flow into the database for row-level security |
| **CORS** | Locked to `localhost` only |

---

## Plugin tools

Once installed, your agent has four tools:

| Tool | What it does |
|------|-------------|
| `azure_sql_provision` | Create free databases, log in, set up Entra ID auth |
| `dab_manage` | Configure and run Data API Builder |
| `dab_query` | Query your data via REST or GraphQL |
| `dab_mcp` | Check DAB's native MCP endpoint status |

### Example conversations

**Create a database and expose a table:**
> "Create a free Azure SQL database, add a products table with columns id, name, and price, then expose it as a REST API"

**Query your data:**
> "Show me all products over $10, sorted by price"

**Set up production auth:**
> "Set up Entra ID authentication for my DAB instance"

---

## Plugin config (optional)

You can set defaults in your OpenClaw config:

```json5
{
  plugins: {
    entries: {
      "azure-dab": {
        enabled: true,
        config: {
          projectDir: "/path/to/your/project",  // where dab-config.json lives
          defaultRegion: "westus2",              // Azure region
          dabPort: 5000                          // DAB server port
        }
      }
    }
  }
}
```

All of these are optional. The plugin uses sensible defaults if you don't set them.

---

## FAQ

**Q: Do I need a credit card?**
A: You need one to create an Azure account, but the free SQL database offer itself costs nothing. The database auto-pauses if you exceed the free monthly limit — you won't be charged.

**Q: What if I already have Azure resources?**
A: The plugin creates new resources in their own resource group (`rg-openclaw-dab-<region>`). It won't touch your existing resources.

**Q: Can I use this with an existing database?**
A: Yes. Skip the provisioning step and just use `dab_manage` to configure DAB against your existing connection string.

**Q: What databases does DAB support?**
A: Azure SQL, SQL Server, PostgreSQL, MySQL, and Azure Cosmos DB. This plugin defaults to Azure SQL but DAB supports all of them.

**Q: Is Data API Builder free?**
A: Yes, completely. It's open source ([github.com/Azure/data-api-builder](https://github.com/Azure/data-api-builder)) and runs locally or in any container.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `az: command not found` | Install Azure CLI (see step 2 above) |
| `dotnet: command not found` | Install .NET SDK (see step 3 above) |
| `dab: command not found` | Run `dotnet tool install -g Microsoft.DataApiBuilder` or let the plugin do it |
| Login fails | Try `az login` manually in your terminal first |
| Firewall blocks connection | Your IP may have changed. Re-run provisioning or update the firewall rule in Azure Portal |
| Free offer not applied | Check [aka.ms/azuresqlhub](https://aka.ms/azuresqlhub) — you need a non-expired subscription |

---

## License

MIT
