import { stableStringify } from "./idempotency.js";

export async function operationFingerprint(toolId: string, input: unknown): Promise<string> {
  const canonical = `${toolId}\u0000${stableStringify(input)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
