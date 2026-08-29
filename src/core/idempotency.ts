export type IdempotencyRecord = {
  tenantId: string;
  actorId: string;
  toolId: string;
  fingerprint: string;
  result: unknown;
};

export interface IdempotencyStore {
  get(key: string): IdempotencyRecord | undefined;
  put(key: string, record: IdempotencyRecord): void;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();
  get(key: string): IdempotencyRecord | undefined { return this.records.get(key); }
  put(key: string, record: IdempotencyRecord): void { this.records.set(key, structuredClone(record)); }
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
}
