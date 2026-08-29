import type { ExecutionContext, ToolDefinition, ToolPolicyMode } from "./types.js";

export type PolicyDecision =
  | { decision: "allow" }
  | { decision: "approval_required"; reason: string }
  | { decision: "deny"; reason: string };

function hasAll(haystack: readonly string[], needles: readonly string[]): boolean {
  const set = new Set(haystack);
  return needles.every((item) => set.has(item));
}

export class PolicyEngine {
  evaluate(tool: ToolDefinition<unknown, unknown>, context: ExecutionContext): PolicyDecision {
    if (!context.tenant.allowedToolIds.includes(tool.id)) {
      return { decision: "deny", reason: "tool_not_enabled_for_tenant" };
    }
    if (!hasAll(context.actor.permissions, tool.requiredPermissions)) {
      return { decision: "deny", reason: "actor_missing_permission" };
    }

    const configured: ToolPolicyMode | undefined = context.tenant.toolPolicies?.[tool.id];
    if (configured === "deny") return { decision: "deny", reason: "tenant_policy_denies_tool" };
    if (configured === "approval") return { decision: "approval_required", reason: "tenant_policy_requires_approval" };

    if (tool.risk === "admin" || tool.risk === "financial" || tool.sideEffect === "irreversible") {
      return { decision: "approval_required", reason: "risk_requires_approval" };
    }
    return { decision: "allow" };
  }
}
