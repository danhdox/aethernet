import type {
  ToolInvocationRequest,
  ToolInvocationResult,
  ToolSetAdapter,
  ToolSourceConfig,
} from "@aethernet/shared-types";

interface ReadOnlyApiInvocationContext {
  source?: ToolSourceConfig;
}

export class ReadOnlyApiToolAdapter implements ToolSetAdapter {
  readonly name = "readonly_api";

  async invoke(request: ToolInvocationRequest): Promise<ToolInvocationResult> {
    const context = (request.context ?? {}) as ReadOnlyApiInvocationContext;
    const source = context.source;
    if (!source?.baseUrl) {
      return {
        ok: false,
        error: `Tool source ${request.sourceId} is missing baseUrl.`,
      };
    }

    const methodInput = request.input.method;
    const method = typeof methodInput === "string" ? methodInput.toUpperCase() : "GET";
    if (method !== "GET") {
      return {
        ok: false,
        error: "read-only external API adapter only permits GET requests.",
      };
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (source.authEnv) {
      const token = process.env[source.authEnv];
      if (!token) {
        return {
          ok: false,
          error: `Missing auth token env var for tool source: ${source.authEnv}`,
        };
      }
      headers.Authorization = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
    }

    const query = toSearchParams(request.input.query);
    const url = `${source.baseUrl.replace(/\/$/, "")}/v1/tools/${encodeURIComponent(request.toolName)}${query}`;
    const response = await fetch(url, {
      method: "GET",
      headers,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json") ? await response.json() : await response.text();

    if (!response.ok) {
      return {
        ok: false,
        error: `External tool call failed (${response.status})`,
        metadata: {
          status: response.status,
          body,
        },
      };
    }

    return {
      ok: true,
      output: body,
      metadata: {
        status: response.status,
        source: source.id,
      },
    };
  }
}

function toSearchParams(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return "";
  }
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return pairs.length ? `?${pairs.join("&")}` : "";
}
