export type CoreErrorCode =
  | "BAD_REQUEST"
  | "TENANT_NOT_FOUND"
  | "TENANT_SUSPENDED"
  | "TENANT_MISMATCH"
  | "SESSION_EXPIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "TOOL_NOT_FOUND"
  | "TOOL_NOT_ALLOWED"
  | "APPROVAL_REQUIRED"
  | "IDEMPOTENCY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "LIMIT_EXCEEDED"
  | "TOOL_EXECUTION_FAILED";

export class CoreError extends Error {
  constructor(
    public readonly code: CoreErrorCode,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "CoreError";
  }
}

export class ApprovalRequiredError extends CoreError {
  public constructor(public readonly operationFingerprint: string) {
    super("APPROVAL_REQUIRED", "Human approval is required", 409);
    this.name = "ApprovalRequiredError";
  }
}
