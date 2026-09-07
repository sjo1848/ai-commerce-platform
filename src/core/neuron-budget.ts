import { ModelProviderError, type ModelProvider, type StructuredModelRequest, type StructuredModelResult } from "./model-provider.js";

/** Validation/harness-only circuit breaker. It has no quota authority. */
export type ValidationNeuronBudgetConfig = {
  maxNeuronsPerRun: number;
  configuredAvailableBudget: number;
  configuredReserve: number;
  conservativeExpectedCost: number;
  observedLocalDayNeurons?: number;
};

/** A validation experiment limit, not an account quota or a conversation limit. */
export type ValidationExperimentBudgetConfig = {
  configuredMaxNeurons: number;
  configuredReserve: number;
  conservativeNextCallAllowance: number;
};

export type ExperimentBudgetStatus = "ACTIVE" | "BUDGET_EXHAUSTED" | "COMPLETE";
export type ExperimentBudgetSnapshot = Readonly<{
  experimentId: string;
  configuredMaxNeurons: number;
  configuredReserve: number;
  observedProviderNeurons: number;
  inferenceCount: number;
  updatedAt: string;
  status: ExperimentBudgetStatus;
  /** Aggregate only: enough to reconcile held allowance without exposing tokens. */
  activeReservationCount: number;
  totalReservedAllowance: number;
}>;
/** The token is internal to the store/provider transition; telemetry uses snapshot only. */
export type ExperimentBudgetReservation = Readonly<{ token: string; snapshot: ExperimentBudgetSnapshot }>;
export type ExperimentBudgetTelemetry = ExperimentBudgetSnapshot;

export type StoredExperimentReservation = {
  allowance: number;
  state: "reserved" | "settled" | "released";
};
export type StoredExperimentBudget = {
  experimentId: string;
  configuredMaxNeurons: number;
  configuredReserve: number;
  observedProviderNeurons: number;
  inferenceCount: number;
  updatedAt: string;
  status: ExperimentBudgetStatus;
  conservativeNextCallAllowance: number;
  reservations: Record<string, StoredExperimentReservation>;
};

/**
 * Implementations must make reserve atomic for one experiment. The Durable Object
 * implementation serializes this check-and-reserve transition at its single name.
 */
export interface ExperimentNeuronBudgetStore {
  reserve(config: ValidationExperimentBudgetConfig): Promise<ExperimentBudgetReservation | null>;
  settle(token: string, providerNeurons: number): Promise<ExperimentBudgetSnapshot>;
  release(token: string): Promise<ExperimentBudgetSnapshot>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isExperimentId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

function isExperimentBudgetStatus(value: unknown): value is ExperimentBudgetStatus {
  return value === "ACTIVE" || value === "BUDGET_EXHAUSTED" || value === "COMPLETE";
}

const EXPERIMENT_BUDGET_RESERVATION_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasCoreSnapshotValues(value: Record<string, unknown>): boolean {
  return isExperimentId(value.experimentId)
    && isFiniteNonNegative(value.configuredMaxNeurons)
    && isFiniteNonNegative(value.configuredReserve)
    && value.configuredReserve <= value.configuredMaxNeurons
    && isFiniteNonNegative(value.observedProviderNeurons)
    && isNonNegativeInteger(value.inferenceCount)
    && typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt))
    && isExperimentBudgetStatus(value.status);
}

function isSnapshotFields(value: Record<string, unknown>): value is ExperimentBudgetSnapshot {
  return hasExactKeys(value, ["experimentId", "configuredMaxNeurons", "configuredReserve", "observedProviderNeurons", "inferenceCount", "updatedAt", "status", "activeReservationCount", "totalReservedAllowance"])
    && hasCoreSnapshotValues(value)
    && isNonNegativeInteger(value.activeReservationCount)
    && isFiniteNonNegative(value.totalReservedAllowance);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Strictly parse the token-free snapshot returned by the durable ledger. */
export function parseExperimentBudgetSnapshot(raw: string): ExperimentBudgetSnapshot {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || !isSnapshotFields(value)) throw new Error("Invalid experiment budget snapshot");
  return {
    experimentId: value.experimentId,
    configuredMaxNeurons: value.configuredMaxNeurons,
    configuredReserve: value.configuredReserve,
    observedProviderNeurons: value.observedProviderNeurons,
    inferenceCount: value.inferenceCount,
    updatedAt: value.updatedAt,
    status: value.status,
    activeReservationCount: value.activeReservationCount,
    totalReservedAllowance: value.totalReservedAllowance,
  };
}

/** Strictly parse the complete private durable-storage representation. */
export function parseStoredExperimentBudget(raw: string): StoredExperimentBudget {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || !hasExactKeys(value, ["experimentId", "configuredMaxNeurons", "configuredReserve", "observedProviderNeurons", "inferenceCount", "updatedAt", "status", "conservativeNextCallAllowance", "reservations"])
    || !hasCoreSnapshotValues(value)
    || !isFiniteNonNegative(value.conservativeNextCallAllowance) || !isRecord(value.reservations)) throw new Error("Invalid stored experiment budget");
  for (const [token, reservation] of Object.entries(value.reservations)) {
    if (!EXPERIMENT_BUDGET_RESERVATION_TOKEN.test(token) || !isRecord(reservation) || !hasExactKeys(reservation, ["allowance", "state"])
      || reservation.allowance !== value.conservativeNextCallAllowance || !["reserved", "settled", "released"].includes(String(reservation.state))) throw new Error("Invalid stored experiment budget");
  }
  return value as StoredExperimentBudget;
}

/** Creates the only public ledger representation; private reservation state never leaves storage. */
export function experimentBudgetSnapshot(state: StoredExperimentBudget): ExperimentBudgetSnapshot {
  const activeReservations = Object.values(state.reservations).filter((reservation) => reservation.state === "reserved");
  return {
    experimentId: state.experimentId,
    configuredMaxNeurons: state.configuredMaxNeurons,
    configuredReserve: state.configuredReserve,
    observedProviderNeurons: state.observedProviderNeurons,
    inferenceCount: state.inferenceCount,
    updatedAt: state.updatedAt,
    status: state.status,
    activeReservationCount: activeReservations.length,
    totalReservedAllowance: activeReservations.reduce((total, reservation) => total + reservation.allowance, 0),
  };
}

function nonNegative(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a finite non-negative number`);
  return value;
}

export class ValidationNeuronBudgetProvider implements ModelProvider {
  private observedRunNeurons = 0;
  private observedLocalDayNeurons: number;

  constructor(private readonly provider: ModelProvider, private readonly config: ValidationNeuronBudgetConfig) {
    nonNegative("maxNeuronsPerRun", config.maxNeuronsPerRun);
    nonNegative("configuredAvailableBudget", config.configuredAvailableBudget);
    nonNegative("configuredReserve", config.configuredReserve);
    nonNegative("conservativeExpectedCost", config.conservativeExpectedCost);
    this.observedLocalDayNeurons = nonNegative("observedLocalDayNeurons", config.observedLocalDayNeurons ?? 0);
  }

  snapshot(): Readonly<{ observedRunNeurons: number; observedLocalDayNeurons: number; configuredAvailableBudget: number; configuredReserve: number }> {
    return { observedRunNeurons: this.observedRunNeurons, observedLocalDayNeurons: this.observedLocalDayNeurons, configuredAvailableBudget: this.config.configuredAvailableBudget, configuredReserve: this.config.configuredReserve };
  }

  private admit(): void {
    const expected = this.config.conservativeExpectedCost;
    if (this.observedRunNeurons + expected > this.config.maxNeuronsPerRun || this.observedLocalDayNeurons + expected + this.config.configuredReserve > this.config.configuredAvailableBudget) {
      throw new ModelProviderError("Validation neuron budget exceeded", "NEURON_BUDGET_EXCEEDED");
    }
  }

  async completeStructured(request: StructuredModelRequest): Promise<StructuredModelResult> {
    this.admit(); // Never cancels or interrupts a call after it has been sent.
    const result = await this.provider.completeStructured(request);
    if (result.providerNeurons !== undefined) {
      this.observedRunNeurons += result.providerNeurons;
      this.observedLocalDayNeurons += result.providerNeurons;
    }
    return result;
  }
}

/** Validation-only provider wrapper backed by one durable experiment ledger. */
export class DurableExperimentBudgetProvider implements ModelProvider {
  constructor(
    private readonly provider: ModelProvider,
    private readonly store: ExperimentNeuronBudgetStore,
    private readonly config: ValidationExperimentBudgetConfig,
    private readonly onTelemetry?: (telemetry: ExperimentBudgetTelemetry) => void,
  ) {
    nonNegative("configuredMaxNeurons", config.configuredMaxNeurons);
    nonNegative("configuredReserve", config.configuredReserve);
    nonNegative("conservativeNextCallAllowance", config.conservativeNextCallAllowance);
    if (config.configuredReserve > config.configuredMaxNeurons) throw new Error("configuredReserve must not exceed configuredMaxNeurons");
  }

  private report(snapshot: ExperimentBudgetSnapshot): void {
    try { this.onTelemetry?.(snapshot); } catch { /* Observability must not alter settlement semantics. */ }
  }

  async completeStructured(request: StructuredModelRequest): Promise<StructuredModelResult> {
    const reservation = await this.store.reserve(this.config);
    if (!reservation) throw new ModelProviderError("Validation experiment neuron budget exceeded", "NEURON_BUDGET_EXCEEDED");
    this.report(reservation.snapshot);
    let result: StructuredModelResult;
    try {
      result = await this.provider.completeStructured(request);
    } catch (error) {
      // A provider failure has no successful result to account for, so release its
      // conservative allowance. A release transport failure is itself uncertain.
      try {
        this.report(await this.store.release(reservation.token));
      } catch {
        throw new ModelProviderError("Validation experiment budget release is uncertain", "EXPERIMENT_BUDGET_RELEASE_UNCERTAIN");
      }
      throw error;
    }
    if (result.providerNeurons === undefined) {
      // A successful provider response without usage is unknown consumption, never zero.
      throw new ModelProviderError("Validation experiment budget settlement is uncertain", "EXPERIMENT_BUDGET_SETTLEMENT_UNCERTAIN");
    }
    try {
      this.report(await this.store.settle(reservation.token, result.providerNeurons));
    } catch {
      // The provider may have run, but durable accounting is unknown. Do not release
      // the reservation and do not return an unaccounted successful model result.
      throw new ModelProviderError("Validation experiment budget settlement is uncertain", "EXPERIMENT_BUDGET_SETTLEMENT_UNCERTAIN");
    }
    return result;
  }
}
