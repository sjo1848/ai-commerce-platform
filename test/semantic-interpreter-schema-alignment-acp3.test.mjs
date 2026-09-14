import test from "node:test";
import assert from "node:assert/strict";
import { SEMANTIC_INTERPRETER_OUTPUT_SCHEMA } from "../dist/core/semantic-interpreter-schema.js";

function changesProperties() {
  return SEMANTIC_INTERPRETER_OUTPUT_SCHEMA.properties.taskSemanticChanges.properties;
}

test("semantic patch schema encodes validator-exact set(value) versus clear(no value)", () => {
  for (const [name, schema] of Object.entries(changesProperties())) {
    if (name === "ambiguity") continue;
    assert.ok(Array.isArray(schema.oneOf), `${name} must use explicit patch variants`);
    assert.equal(schema.oneOf.length, 2, `${name} must have set and clear variants only`);

    const setVariant = schema.oneOf.find((variant) => variant.properties?.op?.enum?.includes("set"));
    const clearVariant = schema.oneOf.find((variant) => variant.properties?.op?.enum?.includes("clear"));
    assert.ok(setVariant, `${name} missing set variant`);
    assert.ok(clearVariant, `${name} missing clear variant`);

    assert.deepEqual(setVariant.required, ["op", "value"], `${name} set must require value`);
    assert.equal(setVariant.additionalProperties, false);
    assert.ok(setVariant.properties.value, `${name} set must expose typed value`);

    assert.deepEqual(clearVariant.required, ["op"], `${name} clear must require only op`);
    assert.equal(clearVariant.additionalProperties, false);
    assert.deepEqual(Object.keys(clearVariant.properties), ["op"], `${name} clear must not permit value`);
  }
});

test("temporal normalizedDates schema cannot invite an empty object rejected by the validator", () => {
  const temporal = SEMANTIC_INTERPRETER_OUTPUT_SCHEMA.properties.temporalResolutionProvenance;
  assert.equal(temporal.properties.normalizedDates.minProperties, 1);
  assert.equal(temporal.properties.normalizedDates.additionalProperties, false);
});

test("J01-relevant semantic schema remains authority-free", () => {
  const serialized = JSON.stringify(SEMANTIC_INTERPRETER_OUTPUT_SCHEMA);
  for (const forbidden of ["toolId", "roomId", "bookingId", "operationFingerprint", "dependencyFingerprint", "approvalId", "guestId"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
