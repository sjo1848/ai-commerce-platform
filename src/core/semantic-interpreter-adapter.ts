import type { ModelProvider, StructuredModelRequest } from "./model-provider.js";
import type { ValidationResult } from "./types.js";
import {
  type InterpreterInput,
  type InterpreterOutput,
  type SemanticInterpreterAdapter,
} from "./semantic-interpreter.js";
import { SEMANTIC_INTERPRETER_OUTPUT_SCHEMA } from "./semantic-interpreter-schema.js";
import { validateInterpreterOutput } from "./semantic-interpreter-validation.js";

const MAX_USER_MESSAGE_CHARS = 4_000;

export class SemanticInterpreterInputError extends Error {
  public constructor() {
    super("SEMANTIC_INTERPRETER_INPUT_INVALID");
    this.name = "SemanticInterpreterInputError";
  }
}

export const SEMANTIC_INTERPRETER_SYSTEM_PROMPT = [
  "Interpret the current user's meaning for the typed hotel task contract.",
  "Return only the structured schema. Do not write the final user-facing response and do not add explanatory keys.",
  "Do not select tools, tool IDs, raw tool arguments, policies, approvals, execution outcomes, fingerprints, or operational entity IDs.",
  "Represent room and booking references semantically; never invent internal roomId or bookingId values.",
  "For mutable facts use set(value) or clear; omit a field for noChange. Every set patch must include value; every clear patch must omit value.",
  "Do not emit empty taskSemanticChanges or directives objects.",
  "A goal is not a mutation commitment. Emit operationIntent only when the user currently commits to reserve/cancel/modify.",
  "abortCurrentOperation means stop a pending action; it is not cancel_booking.",
  "For explicit absolute calendar dates that can be normalized without trustedNow, set the ISO dates directly and omit temporalResolutionProvenance.",
  "Emit temporalResolutionProvenance only when temporalContext was actually needed to resolve relative or deictic date language.",
  "When temporalResolutionProvenance is emitted, copy trustedNow, timezone and locale exactly; use calendarPolicyId as resolutionPolicyId, temporalPolicyVersion as resolutionPolicyVersion, and make normalizedDates exactly match the emitted date patches.",
  "Use only the supplied temporalContext to normalize time. If meaning is not unambiguous, emit bounded ambiguity instead of guessing.",
  "Do not reconstruct a workflow and do not decide what capability should run next.",
].join("\n");

export function buildSemanticInterpreterRequest(input: Readonly<InterpreterInput>): StructuredModelRequest {
  if (!input.currentUserMessage.trim() || input.currentUserMessage.length > MAX_USER_MESSAGE_CHARS) {
    throw new SemanticInterpreterInputError();
  }
  return {
    messages: [
      { role: "system", content: SEMANTIC_INTERPRETER_SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          currentUserMessage: input.currentUserMessage,
          taskContextProjection: input.taskContextProjection,
          ...(input.dialogueAnchor ? { dialogueAnchor: input.dialogueAnchor } : {}),
          temporalContext: input.temporalContext,
          domainSemanticContract: input.domainSemanticContract,
        }),
      },
    ],
    schema: SEMANTIC_INTERPRETER_OUTPUT_SCHEMA,
    temperature: 0,
    maxTokens: 1_200,
    label: "acp.semantic_interpreter.v1",
  };
}

export class StructuredSemanticInterpreterAdapter implements SemanticInterpreterAdapter {
  public constructor(private readonly provider: ModelProvider) {}

  public async interpret(input: Readonly<InterpreterInput>): Promise<unknown> {
    const result = await this.provider.completeStructured(buildSemanticInterpreterRequest(input));
    return result.value;
  }
}

export type SemanticInterpreterValidationResult = ValidationResult<InterpreterOutput>;

export class ValidatedSemanticInterpreter {
  public constructor(private readonly adapter: SemanticInterpreterAdapter) {}

  public async interpret(input: Readonly<InterpreterInput>): Promise<SemanticInterpreterValidationResult> {
    let raw: unknown;
    try {
      raw = await this.adapter.interpret(input);
    } catch (error) {
      if (error instanceof SemanticInterpreterInputError) {
        return { ok: false, message: "SEMANTIC_INTERPRETER_INPUT_INVALID" };
      }
      return { ok: false, message: "SEMANTIC_INTERPRETER_PROVIDER_FAILURE" };
    }
    return validateInterpreterOutput(raw, input);
  }
}
