import { ModelProviderError, type ModelProvider, type StructuredModelRequest, type StructuredModelResult } from "./model-provider.js";

/** Validation/harness-only circuit breaker. It has no quota authority. */
export type ValidationNeuronBudgetConfig = {
  maxNeuronsPerRun: number;
  configuredAvailableBudget: number;
  configuredReserve: number;
  conservativeExpectedCost: number;
  observedLocalDayNeurons?: number;
};

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
