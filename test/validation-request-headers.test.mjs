import assert from "node:assert/strict";
import test from "node:test";
import {
  VALIDATION_RUN_TOKEN_HEADER,
  validationRequestHeaders,
  VERSION_OVERRIDE_HEADER,
} from "../scripts/validation-request-headers.mjs";

test("absent validation token adds no validation header and preserves request headers", () => {
  const original = { "content-type": "application/json", "x-request-id": "request-1" };
  const headers = validationRequestHeaders(original, {});

  assert.deepEqual(headers, original);
  assert.equal(headers[VALIDATION_RUN_TOKEN_HEADER], undefined);
  assert.notStrictEqual(headers, original);
});

test("an unset GitHub secret value adds no validation header", () => {
  const headers = validationRequestHeaders({ "content-type": "application/json" }, { ACP_VALIDATION_RUN_TOKEN: "" });

  assert.equal(headers[VALIDATION_RUN_TOKEN_HEADER], undefined);
});

test("a whitespace-only validation token is absent and cannot preserve a caller-supplied validation header", () => {
  const headers = validationRequestHeaders(
    { "content-type": "application/json", "X-Acp-Validation-Run-Token": "caller-token" },
    { ACP_VALIDATION_RUN_TOKEN: " \t\n " },
  );

  assert.equal(headers[VALIDATION_RUN_TOKEN_HEADER], undefined);
  assert.equal(Object.keys(headers).some((name) => name.toLowerCase() === VALIDATION_RUN_TOKEN_HEADER), false);
  assert.equal(headers["content-type"], "application/json");
});

test("present validation token is confined to the validation header and preserves request headers", () => {
  const token = "test-validation-token";
  const headers = validationRequestHeaders(
    {
      "content-type": "application/json",
      "Idempotency-Key": "request-2",
      "X-ACP-VALIDATION-RUN-TOKEN": "caller-token",
    },
    { ACP_VALIDATION_RUN_TOKEN: token },
  );
  const logRecord = { headerNames: Object.keys(headers) };

  assert.equal(headers[VALIDATION_RUN_TOKEN_HEADER], token);
  assert.equal(headers["content-type"], "application/json");
  assert.equal(headers["Idempotency-Key"], "request-2");
  assert.equal(headers["X-ACP-VALIDATION-RUN-TOKEN"], undefined);
  assert.equal(Object.keys(headers).filter((name) => name.toLowerCase() === VALIDATION_RUN_TOKEN_HEADER).length, 1);
  assert.deepEqual(Object.values(headers).filter((value) => value === token), [token]);
  assert.equal(JSON.stringify(logRecord).includes(token), false);
});

test("exact validation runs pin every request to the configured Worker Version", () => {
  const headers = validationRequestHeaders(
    { [VERSION_OVERRIDE_HEADER]: 'ai-commerce-agent-core="old"', "x-request-id": "request-3" },
    { R28_VERSION_ID: "new-version", R28_WORKER_NAME: "ai-commerce-agent-core" },
  );
  assert.equal(headers[VERSION_OVERRIDE_HEADER], 'ai-commerce-agent-core="new-version"');
  assert.equal(Object.keys(headers).filter((name) => name.toLowerCase() === VERSION_OVERRIDE_HEADER.toLowerCase()).length, 1);
});
