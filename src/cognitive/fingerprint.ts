function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item !== undefined) result[key] = canonicalize(item);
    }
    return result;
  }
  return value;
}

/**
 * Stable causal fingerprint for bounded server-owned dependency projections.
 * This is intentionally not a security primitive and must never replace
 * authorization, signatures, idempotency tokens or policy checks.
 */
export function dependencyFingerprint(value: unknown): string {
  const encoded = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of encoded) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return `fp1:${hash.toString(16).padStart(16, "0")}`;
}
