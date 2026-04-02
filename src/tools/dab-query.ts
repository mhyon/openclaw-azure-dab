import { Type } from "@sinclair/typebox";
import type { PluginContext } from "../lib/types.js";
import { toolResult, toolError } from "../lib/types.js";

export function registerDabQueryTool(api: any, ctx: PluginContext) {
  api.registerTool({
    name: "dab_query",
    description: `Query a running Data API Builder instance via REST or GraphQL.
DAB must be running (use dab_manage action=start first).
REST: standard CRUD with OData-like filtering, sorting, pagination.
GraphQL: full query/mutation support with nested relationships.`,
    parameters: Type.Object({
      method: Type.Union([
        Type.Literal("rest"),
        Type.Literal("graphql"),
      ], { description: "Query method" }),

      // REST params
      entity: Type.Optional(Type.String({ description: "Entity name for REST (e.g., 'products')" })),
      restMethod: Type.Optional(
        Type.Union([
          Type.Literal("GET"),
          Type.Literal("POST"),
          Type.Literal("PUT"),
          Type.Literal("PATCH"),
          Type.Literal("DELETE"),
        ], { description: "HTTP method for REST (default: GET)" })
      ),
      id: Type.Optional(Type.String({ description: "Item ID for REST GET/PUT/PATCH/DELETE by key" })),
      filter: Type.Optional(Type.String({ description: "OData $filter expression (e.g., \"price gt 10\")" })),
      select: Type.Optional(Type.Array(Type.String(), { description: "Fields to return ($select)" })),
      orderby: Type.Optional(Type.String({ description: "$orderby expression (e.g., \"name asc\")" })),
      top: Type.Optional(Type.Number({ description: "Max items to return ($first / $top)" })),
      body: Type.Optional(Type.Any({ description: "Request body for POST/PUT/PATCH (JSON object)" })),

      // GraphQL params
      query: Type.Optional(Type.String({ description: "Full GraphQL query or mutation string" })),
      variables: Type.Optional(Type.Any({ description: "GraphQL variables (JSON object)" })),

      // Common
      baseUrl: Type.Optional(Type.String({ description: "DAB base URL (default: http://localhost:<port>)" })),
      authToken: Type.Optional(Type.String({ description: "Bearer token for authenticated requests" })),
    }),
    async execute(_id: string, params: any) {
      try {
        const port = ctx.config.dabPort || 5000;
        const baseUrl = params.baseUrl || `http://localhost:${port}`;

        if (params.method === "rest") {
          return await handleRestQuery(params, baseUrl);
        } else if (params.method === "graphql") {
          return await handleGraphqlQuery(params, baseUrl);
        } else {
          return toolError(`Unknown method: ${params.method}`);
        }
      } catch (err: any) {
        ctx.logger.error("dab_query error:", err);
        return toolError(err.message || String(err));
      }
    },
  });
}

async function handleRestQuery(params: any, baseUrl: string) {
  if (!params.entity) return toolError("entity is required for REST queries.");

  const method = params.restMethod || "GET";

  // Build URL with query params
  let url = `${baseUrl}/api/${params.entity}`;
  if (params.id) url += `/${params.id}`;

  const queryParts: string[] = [];
  if (params.filter) queryParts.push(`$filter=${encodeURIComponent(params.filter)}`);
  if (params.select?.length) queryParts.push(`$select=${params.select.join(",")}`);
  if (params.orderby) queryParts.push(`$orderby=${encodeURIComponent(params.orderby)}`);
  if (params.top) queryParts.push(`$first=${params.top}`);
  if (queryParts.length) url += `?${queryParts.join("&")}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (params.authToken) {
    headers["Authorization"] = `Bearer ${params.authToken}`;
  }

  const fetchOpts: RequestInit = { method, headers };
  if (params.body && ["POST", "PUT", "PATCH"].includes(method)) {
    fetchOpts.body = JSON.stringify(params.body);
  }

  const resp = await fetch(url, fetchOpts);
  const contentType = resp.headers.get("content-type") || "";

  if (!resp.ok) {
    const errorBody = contentType.includes("json")
      ? JSON.stringify(await resp.json(), null, 2)
      : await resp.text();
    return toolError(`REST ${method} ${url} → ${resp.status}\n${errorBody}`);
  }

  if (contentType.includes("json")) {
    const data = await resp.json();
    return toolResult(
      `REST ${method} ${params.entity} → ${resp.status}\n\n${JSON.stringify(data, null, 2)}`
    );
  }

  return toolResult(`REST ${method} ${params.entity} → ${resp.status} (no JSON body)`);
}

async function handleGraphqlQuery(params: any, baseUrl: string) {
  if (!params.query) return toolError("query is required for GraphQL.");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (params.authToken) {
    headers["Authorization"] = `Bearer ${params.authToken}`;
  }

  const resp = await fetch(`${baseUrl}/graphql`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: params.query,
      variables: params.variables || {},
    }),
  });

  const data = await resp.json();

  if (data.errors?.length) {
    return toolError(
      `GraphQL errors:\n${JSON.stringify(data.errors, null, 2)}`
    );
  }

  return toolResult(
    `GraphQL response:\n\n${JSON.stringify(data.data, null, 2)}`
  );
}
