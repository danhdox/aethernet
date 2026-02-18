import type {
  ToolInvocationRequest,
  ToolInvocationResult,
  ToolSetAdapter,
} from "@aethernet/shared-types";

export type InternalToolHandler = (
  request: ToolInvocationRequest,
) => Promise<ToolInvocationResult> | ToolInvocationResult;

export class InternalToolAdapter implements ToolSetAdapter {
  readonly name = "internal";
  private readonly handlers: Map<string, InternalToolHandler>;

  constructor(handlers: Record<string, InternalToolHandler>) {
    this.handlers = new Map(Object.entries(handlers));
  }

  async invoke(request: ToolInvocationRequest): Promise<ToolInvocationResult> {
    const handler = this.handlers.get(request.toolName);
    if (!handler) {
      return {
        ok: false,
        error: `Unknown internal tool: ${request.toolName}`,
      };
    }

    return handler(request);
  }
}
