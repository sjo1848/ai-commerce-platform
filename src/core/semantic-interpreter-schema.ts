import type { JsonSchema } from "./types.js";
import { HOTEL_SEMANTIC_CONTRACT_V1 } from "./semantic-interpreter.js";

function patchSchema(valueSchema: JsonSchema): JsonSchema {
  return {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          op: { type: "string", enum: ["set"] },
          value: valueSchema,
        },
        required: ["op", "value"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          op: { type: "string", enum: ["clear"] },
        },
        required: ["op"],
      },
    ],
  };
}

const ROOM_REFERENCE_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["room_number", "ordinal", "ordinal_set", "relation", "descriptive_preference", "ambiguous"] },
    roomNumber: { type: "string", minLength: 1, maxLength: 20 },
    ordinal: { type: "integer", minimum: 1, maximum: 25 },
    ordinals: { type: "array", items: { type: "integer", minimum: 1, maximum: 25 }, minItems: 1, maxItems: 10 },
    relation: { type: "string", enum: ["other", "both"] },
    value: { type: "string", minLength: 1, maxLength: 100 },
    reasonCode: { type: "string", minLength: 1, maxLength: 128 },
    scope: { type: "string", enum: ["entity_scoped", "observation_scoped"] },
  },
  required: ["kind"],
};

const BOOKING_REFERENCE_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["explicit_code", "ordinal", "descriptive", "ambiguous"] },
    code: { type: "string", minLength: 1, maxLength: 128 },
    ordinal: { type: "integer", minimum: 1, maximum: 25 },
    value: { type: "string", minLength: 1, maxLength: 128 },
    reasonCode: { type: "string", minLength: 1, maxLength: 128 },
  },
  required: ["kind"],
};

const SEMANTIC_REFERENCE_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["room_number", "ordinal", "ordinal_set", "relation", "descriptive_preference", "explicit_code", "descriptive", "ambiguous"] },
    roomNumber: { type: "string", minLength: 1, maxLength: 20 },
    ordinal: { type: "integer", minimum: 1, maximum: 25 },
    ordinals: { type: "array", items: { type: "integer", minimum: 1, maximum: 25 }, minItems: 1, maxItems: 10 },
    relation: { type: "string", enum: ["other", "both"] },
    value: { type: "string", minLength: 1, maxLength: 128 },
    code: { type: "string", minLength: 1, maxLength: 128 },
    reasonCode: { type: "string", minLength: 1, maxLength: 128 },
    scope: { type: "string", enum: ["entity_scoped", "observation_scoped"] },
  },
  required: ["kind"],
};

const OPERATION_INTENT_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["reserve", "cancel", "modify"] },
    status: { type: "string", enum: ["active", "ambiguous"] },
    targetSemanticReference: SEMANTIC_REFERENCE_SCHEMA,
  },
  required: ["kind", "status"],
};

export const SEMANTIC_INTERPRETER_OUTPUT_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    classification: { type: "string", enum: ["task", "social", "help", "unknown"] },
    taskSemanticChanges: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      properties: {
        requestedGoal: patchSchema({ type: "string", enum: HOTEL_SEMANTIC_CONTRACT_V1.allowedGoals }),
        checkIn: patchSchema({ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        checkOut: patchSchema({ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        guests: patchSchema({ type: "integer", minimum: 1, maximum: 20 }),
        requestedRoomCount: patchSchema({ type: "integer", minimum: 1, maximum: 10 }),
        requestedSelectionReference: patchSchema(ROOM_REFERENCE_SCHEMA),
        bookingReference: patchSchema(BOOKING_REFERENCE_SCHEMA),
        operationIntent: patchSchema(OPERATION_INTENT_SCHEMA),
        preferences: patchSchema({ type: "array", items: { type: "string", minLength: 1, maxLength: 128 }, maxItems: 8 }),
        ambiguity: {
          type: "object",
          additionalProperties: false,
          properties: {
            topic: { type: "string", enum: ["dates", "guests", "selection", "booking_reference", "occupancy", "operation_intent", "other"] },
            reasonCode: { type: "string", minLength: 1, maxLength: 128 },
            candidateMeaningTypes: { type: "array", items: { type: "string", minLength: 1, maxLength: 128 }, maxItems: 8 },
          },
          required: ["topic", "reasonCode"],
        },
      },
    },
    directives: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      properties: {
        retry: {
          type: "object",
          additionalProperties: false,
          properties: { target: { type: "string", enum: ["availability", "quote", "current_operation"] } },
        },
        readRequest: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: HOTEL_SEMANTIC_CONTRACT_V1.allowedReadRequests },
            fields: { type: "array", items: { type: "string", minLength: 1, maxLength: 128 }, maxItems: 8 },
          },
          required: ["kind"],
        },
        showOptions: { type: "boolean", enum: [true] },
        abortCurrentOperation: { type: "boolean", enum: [true] },
        interaction: { type: "string", enum: ["acknowledge", "social", "help"] },
      },
    },
    temporalResolutionProvenance: {
      type: "object",
      additionalProperties: false,
      properties: {
        expressionClass: { type: "string", minLength: 1, maxLength: 128 },
        trustedNow: { type: "string" },
        timezone: { type: "string" },
        locale: { type: "string" },
        normalizedDates: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            checkIn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            checkOut: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          },
        },
        resolutionPolicyId: { type: "string" },
        resolutionPolicyVersion: { type: "string" },
      },
      required: ["expressionClass", "trustedNow", "timezone", "locale", "normalizedDates", "resolutionPolicyId", "resolutionPolicyVersion"],
    },
  },
  required: ["classification"],
};