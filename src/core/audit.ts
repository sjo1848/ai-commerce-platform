export type AuditStatus = "allowed" | "denied" | "approval_required" | "succeeded" | "failed" | "replayed";

export type AuditEvent = {
  timestamp: string;
  requestId: string;
  tenantId: string;
  actorId: string;
  sessionId: string;
  toolId: string;
  status: AuditStatus;
  detail?: string;
};

export interface AuditSink { record(event: AuditEvent): void | Promise<void>; }

export class InMemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  record(event: AuditEvent): void { this.events.push(structuredClone(event)); }
}
