export type UsageKind = "message" | "model_route" | "tool_call";
export type UsageEvent = {
  timestamp: string;
  tenantId: string;
  sessionId: string;
  kind: UsageKind;
  units: number;
  estimatedCostUsd: number;
  label?: string;
};

export interface UsageSink { record(event: UsageEvent): void | Promise<void>; }

export class InMemoryUsageSink implements UsageSink {
  readonly events: UsageEvent[] = [];
  record(event: UsageEvent): void { this.events.push(structuredClone(event)); }
}
