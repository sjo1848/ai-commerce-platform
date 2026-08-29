import { CoreError } from "./errors.js";
import type { Tenant, ToolDefinition, ToolDescriptor } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>();

  register<I, O>(tool: ToolDefinition<I, O>): void {
    if (this.tools.has(tool.id)) throw new Error(`Duplicate tool: ${tool.id}`);
    this.tools.set(tool.id, tool as ToolDefinition<unknown, unknown>);
  }

  get(toolId: string): ToolDefinition<unknown, unknown> {
    const tool = this.tools.get(toolId);
    if (!tool) throw new CoreError("TOOL_NOT_FOUND", "Tool not found", 404);
    return tool;
  }

  descriptorsFor(tenant: Tenant): ToolDescriptor[] {
    const allowed = new Set(tenant.allowedToolIds);
    return [...this.tools.values()]
      .filter((tool) => allowed.has(tool.id) && tenant.toolPolicies?.[tool.id] !== "deny")
      .map(({ id, primitive, description, risk }) => ({ id, primitive, description, risk }));
  }
}
