export interface PluginContext {
  logger: { debug: (...args: unknown[]) => void; info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  config: {
    projectDir?: string;
    defaultRegion?: string;
    dabPort?: number;
  };
  resolvePath: (input: string) => string;
}

export interface ProvisionResult {
  server: string;
  database: string;
  resourceGroup: string;
  region: string;
  connectionString: string;
  adminUser: string;
}

export interface DabEntity {
  name: string;
  source: string;
  type: "table" | "view" | "stored-procedure";
  restPath?: string;
  graphqlType?: string;
  permissions: EntityPermission[];
}

export interface EntityPermission {
  role: string;
  actions: ("create" | "read" | "update" | "delete" | "execute" | "*")[];
}

export function toolResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function toolError(text: string) {
  return { content: [{ type: "text" as const, text: `❌ ${text}` }], isError: true };
}
