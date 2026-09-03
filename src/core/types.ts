import type { ConversationState, ConversationStatePatch } from "./conversation-state.js";
import type { MutationGrounding } from "./mutation-grounding.js";

export type TenantStatus = "active" | "suspended";
export type Channel = "webchat" | "whatsapp" | "email";
export type ActorType = "customer" | "staff" | "system";
export type Primitive =
  | "SEARCH"
  | "CHECK"
  | "QUOTE"
  | "RESERVE"
  | "ORDER"
  | "PAY"
  | "MODIFY"
  | "CANCEL"
  | "NOTIFY"
  | "MATCH"
  | "REQUEST_APPROVAL"
  | "ESCALATE";
export type RiskLevel = "read" | "write" | "financial" | "admin";
export type SideEffect = "none" | "reversible" | "irreversible";
export type ToolPolicyMode = "auto" | "approval" | "deny";
export type IdempotencyMode = "core" | "downstream";
export type JsonSchema = Readonly<Record<string, unknown>>;

export type Tenant = {
  id: string;
  slug: string;
  status: TenantStatus;
  allowedToolIds: readonly string[];
  toolPolicies?: Readonly<Record<string, ToolPolicyMode>>;
};

export type Actor = {
  id: string;
  type: ActorType;
  roles: readonly string[];
  permissions: readonly string[];
};

export type Session = {
  id: string;
  tenantId: string;
  actorId: string;
  channel: Channel;
  createdAt: string;
  expiresAt: string;
};

export type ExecutionContext = {
  requestId: string;
  tenant: Tenant;
  actor: Actor;
  session: Session;
  now: string;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export type ToolExecutionMeta = {
  idempotencyKey?: string;
  humanApproved?: boolean;
  approvedOperationFingerprint?: string;
  /** Server-owned approval recovery depth. Never model/request-authored. */
  recoveryAttempt?: number;
};

export type ToolDefinition<I, O> = {
  id: string;
  primitive: Primitive;
  description: string;
  risk: RiskLevel;
  sideEffect: SideEffect;
  idempotencyMode?: IdempotencyMode;
  requiredPermissions: readonly string[];
  /** Model-visible business arguments only. Trusted execution metadata must never appear here. */
  inputSchema?: JsonSchema;
  /**
   * Canonicalizes and validates execution input. The optional server context may
   * inject trusted bindings that are deliberately absent from model-visible
   * schemas; the returned canonical value is what approval fingerprints bind.
   */
  validateInput(input: unknown, context?: ExecutionContext): ValidationResult<I>;
  execute(input: I, context: ExecutionContext, meta: ToolExecutionMeta): Promise<O>;
};

export type ToolPlan = {
  toolId: string;
  input: unknown;
};

export type ModelMessagePurpose = "clarification" | "unsupported" | "greeting" | "social" | "help" | "policy" | "acknowledgement";
export type ModelClarificationField = "dates" | "guests" | "room" | "booking" | "selection" | "occupancy";

export type ModelRouteResult =
  | { kind: "tool"; plan: ToolPlan; statePatch?: ConversationStatePatch; mutationGrounding?: MutationGrounding }
  | {
      kind: "message";
      message: string;
      purpose?: ModelMessagePurpose;
      missing?: readonly ModelClarificationField[];
      statePatch?: ConversationStatePatch;
    };

export type ModelConversationTurn = {
  role: "user" | "assistant" | "tool";
  content: string;
  toolId?: string;
};

export interface ModelRouter {
  route(
    message: string,
    context: ExecutionContext,
    availableTools: readonly ToolDescriptor[],
    conversation?: readonly ModelConversationTurn[],
    state?: Readonly<ConversationState>,
  ): Promise<ModelRouteResult>;
}

export type ToolDescriptor = {
  id: string;
  primitive: Primitive;
  description: string;
  risk: RiskLevel;
  inputSchema?: JsonSchema;
};
