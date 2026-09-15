export type DependencyValue =
  | null
  | boolean
  | number
  | string
  | readonly DependencyValue[]
  | { readonly [key: string]: DependencyValue | undefined };

type DependencyObject = { readonly [key: string]: DependencyValue | undefined };

function canonicalize(value: DependencyValue): DependencyValue {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("Dependency projections must contain only finite numbers");
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item as DependencyValue));
  if (value !== null && typeof value === "object") {
    const record = value as DependencyObject;
    const result: Record<string, DependencyValue> = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item !== undefined) result[key] = canonicalize(item);
    }
    return result;
  }
  return value;
}

export function canonicalDependencyProjection(value: DependencyValue): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Collision-resistant causal identity for bounded, server-owned dependency
 * projections. SHA-256 is used because equality of these identities participates
 * in staleness/pre-write revalidation. It is still NOT authorization, a
 * signature, an idempotency token, or a policy decision.
 */
export async function dependencyFingerprint(value: DependencyValue): Promise<string> {
  const encoded = new TextEncoder().encode(canonicalDependencyProjection(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `fp1:sha256:${hex}`;
}
