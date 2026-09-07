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
}>;
export type ExperimentBudgetReservation = Readonly<{ token: string }>;

/**
 * Implementations must make reserve atomic for one experiment. The Durable Object
 * implementation serializes this check-and-reserve transition at its single name.
 */
export interface ExperimentNeuronBudgetStore {
  reserve(config: ValidationExperimentBudgetConfig): Promise<ExperimentBudgetReservation | null>;
  settle(token: string, providerNeurons: number | undefined): Promise<ExperimentBudgetSnapshot>;
  release(token: string): Promise<ExperimentBudgetSnapshot>;
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
  ) {
    nonNegative("configuredMaxNeurons", config.configuredMaxNeurons);
    nonNegative("configuredReserve", config.configuredReserve);
    nonNegative("conservativeNextCallAllowance", config.conservativeNextCallAllowance);
    if (config.configuredReserve > config.configuredMaxNeurons) throw new Error("configuredReserve must not exceed configuredMaxNeurons");
  }

  async completeStructured(request: StructuredModelRequest): Promise<StructuredModelResult> {
    const reservation = await this.store.reserve(this.config);
    if (!reservation) throw new ModelProviderError("Validation experiment neuron budget exceeded", "NEURON_BUDGET_EXCEEDED");
    try {
      const result = await this.provider.completeStructured(request);
      await this.store.settle(reservation.token, result.providerNeurons);
      return result;
    } catch (error) {
      // No provider result means no consumption can be truthfully recorded. Release
      // the conservative allowance so a failed local/provider call does not strand it.
      await this.store.release(reservation.token);
      throw error;
    }
  }
}
