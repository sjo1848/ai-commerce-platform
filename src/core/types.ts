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
};

export type ToolDefinition<I, O> = {
  id: string;
  primitive: Primitive;
  description: string;
  risk: RiskLevel;
  sideEffect: SideEffect;
  idempotencyMode?: IdempotencyMode;
  requiredPermissions: readonly string[];
  validateInput(input: unknown): ValidationResult<I>;
  execute(input: I, context: ExecutionContext, meta: ToolExecutionMeta): Promise<O>;
};

export type ToolPlan = {
  toolId: string;
  input: unknown;
};

export type ModelRouteResult =
  | { kind: "tool"; plan: ToolPlan }
  | { kind: "message"; message: string };

export interface ModelRouter {
  route(message: string, context: ExecutionContext, availableTools: readonly ToolDescriptor[]): Promise<ModelRouteResult>;
}

export type ToolDescriptor = {
  id: string;
  primitive: Primitive;
  description: string;
  risk: RiskLevel;
};
