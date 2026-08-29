import { CoreError } from "./errors.js";
import type { Tenant } from "./types.js";

export class TenantResolver {
  private readonly tenants = new Map<string, Tenant>();

  constructor(tenants: readonly Tenant[]) {
    for (const tenant of tenants) {
      if (this.tenants.has(tenant.id)) throw new Error(`Duplicate tenant: ${tenant.id}`);
      this.tenants.set(tenant.id, tenant);
    }
  }

  resolve(tenantId: string | null | undefined): Tenant {
    const normalized = tenantId?.trim();
    if (!normalized) throw new CoreError("TENANT_NOT_FOUND", "Tenant is required", 400);
    const tenant = this.tenants.get(normalized);
    if (!tenant) throw new CoreError("TENANT_NOT_FOUND", "Tenant not found", 404);
    if (tenant.status !== "active") throw new CoreError("TENANT_SUSPENDED", "Tenant is suspended", 403);
    return tenant;
  }
}
