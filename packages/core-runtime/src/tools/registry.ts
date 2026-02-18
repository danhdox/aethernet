import type {
  ToolInvocationRequest,
  ToolInvocationResult,
  ToolSetAdapter,
  ToolSourceConfig,
} from "@aethernet/shared-types";

export interface ToolRegistryOptions {
  sources: ToolSourceConfig[];
  adapters?: ToolSetAdapter[];
  allowExternalSources?: boolean;
}

export class ToolSourceRegistry {
  private readonly sources: Map<string, ToolSourceConfig>;
  private readonly adapters: Map<string, ToolSetAdapter>;
  private readonly allowExternalSources: boolean;

  constructor(options: ToolRegistryOptions) {
    this.sources = new Map(options.sources.map((source) => [source.id, source]));
    this.adapters = new Map((options.adapters ?? []).map((adapter) => [adapter.name, adapter]));
    this.allowExternalSources = options.allowExternalSources ?? false;
  }

  listSources(): ToolSourceConfig[] {
    return Array.from(this.sources.values());
  }

  registerAdapter(adapter: ToolSetAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  async invoke(request: ToolInvocationRequest): Promise<ToolInvocationResult> {
    const source = this.sources.get(request.sourceId);
    if (!source) {
      return {
        ok: false,
        error: `Unknown tool source: ${request.sourceId}`,
      };
    }

    if (!source.enabled) {
      return {
        ok: false,
        error: `Tool source is disabled: ${source.id}`,
      };
    }

    if (source.type !== "internal" && !this.allowExternalSources) {
      return {
        ok: false,
        error: `External tool source blocked by runtime policy: ${source.id}`,
      };
    }

    const adapter = this.resolveAdapter(source);
    if (!adapter) {
      return {
        ok: false,
        error: `No adapter registered for tool source type: ${source.type}`,
      };
    }

    return adapter.invoke({
      ...request,
      context: {
        ...(request.context ?? {}),
        source,
      },
    });
  }

  private resolveAdapter(source: ToolSourceConfig): ToolSetAdapter | undefined {
    const explicitAdapter = source.metadata?.adapter;
    if (explicitAdapter) {
      return this.adapters.get(explicitAdapter);
    }

    if (source.type === "internal") {
      return this.adapters.get("internal");
    }
    if (source.type === "api") {
      return this.adapters.get("readonly_api");
    }
    return this.adapters.get(source.type);
  }
}
