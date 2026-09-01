export type UsageKind = "message" | "model_route" | "tool_call" | "model_inference" | "model_fallback";
export type UsageEvent = {
  timestamp: string;
  tenantId: string;
  sessionId: string;
  kind: UsageKind;
  units: number;
  estimatedCostUsd: number;
  label?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  logId?: string;
  fallbackReason?: string;
  failureCategory?: string;
};

export interface UsageSink { record(event: UsageEvent): void | Promise<void>; }

export class InMemoryUsageSink implements UsageSink {
  readonly events: UsageEvent[] = [];
  record(event: UsageEvent): void { this.events.push(structuredClone(event)); }
}

export class ConsoleUsageSink implements UsageSink {
  record(event: UsageEvent): void {
    console.log(JSON.stringify({ event: "agent_core_usage", ...event }));
  }
}
