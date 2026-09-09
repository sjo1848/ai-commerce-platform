import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyAdmissionProbe, verifyLiveReadiness } from '../scripts/r2.8-validation-preflight.mjs';
const options = { path: '/__r28-tail-probe?run=offline', version: 'exact-version' };
const event = { truncated: false, outcome: 'ok', scriptVersion: {id: options.version}, event: {request: {url: 'https://staging.invalid' + options.path, method: 'POST'}, response: {status: 403}}, logs: [], exceptions: [] };
const root = { ...event, event: { request: { url: 'https://staging.invalid/', method: 'GET' }, response: { status: 403 } } };
test('admission probe requires complete exact-version 403 with zero application activity', () => {
  assert.equal(verifyAdmissionProbe(JSON.stringify(event), options).modelInferences, 0);
  for (const change of [{truncated:true}, {logs:[{message:['provider reserve']}]}, {exceptions:[{}]}, {logs:undefined}, {scriptVersion:{id:'wrong'}}, {event:{...event.event,response:{status:200}}}]) {
    assert.throws(() => verifyAdmissionProbe(JSON.stringify({...event,...change}), options));
  }
  assert.throws(() => verifyAdmissionProbe('', options), /UNKNOWN/);
  assert.throws(() => verifyAdmissionProbe(JSON.stringify(event).slice(0,-1), options), /UNKNOWN/);
  const diagnosticLog = [{ message: ['{"event":"acp_validation_runtime_identity"}'] }];
  assert.equal(verifyAdmissionProbe(JSON.stringify({ ...event, logs: diagnosticLog }), options).modelInferences, 0);
  assert.equal(verifyAdmissionProbe(`${JSON.stringify({ ...root, event: { ...root.event, response: { status: 200 } } })}\n${JSON.stringify(event)}`, options).modelInferences, 0);
});

test('live readiness requires one exact-version 403 root with complete identity', () => {
  const identity = [{ message: [JSON.stringify({ event: 'acp_validation_runtime_identity', runtimeWorkerVersionId: options.version, method: 'GET', pathname: '/', validationStatus: 'valid', validationNeuronBudgetPresent: true, validationExperimentIdPresent: true, validationRunTokenPresent: true })] }];
  const liveRoot = { ...root, logs: identity };
  assert.equal(verifyLiveReadiness(JSON.stringify(liveRoot), { version: options.version }).liveTailIdentity, true);
  assert.throws(() => verifyLiveReadiness(JSON.stringify({ ...liveRoot, event: { ...liveRoot.event, response: { status: 404 } } }), { version: options.version }), /invalid exact-version/);
  assert.throws(() => verifyLiveReadiness(JSON.stringify({ ...liveRoot, scriptVersion: { id: 'wrong' } }), { version: options.version }), /invalid exact-version/);
  assert.throws(() => verifyLiveReadiness(JSON.stringify({ ...liveRoot, logs: [{ message: [JSON.stringify({ ...JSON.parse(identity[0].message[0]), runtimeWorkerVersionId: 'wrong' })] }] }), { version: options.version }), /MISMATCH/);
  assert.throws(() => verifyLiveReadiness(JSON.stringify({ ...liveRoot, logs: [{ message: [...identity[0].message, JSON.stringify({ ...JSON.parse(identity[0].message[0]), runtimeWorkerVersionId: 'wrong' })] }] }), { version: options.version }), /MISMATCH/);
  assert.throws(() => verifyLiveReadiness(JSON.stringify({ ...liveRoot, logs: [] }), { version: options.version }), /UNKNOWN/);
});

import { redactHistoricalEvidence } from '../scripts/r2.8-redact-historical.mjs';
test('historical evidence redacts nested headers and JSON strings without losing correlation', () => {
  const raw = {trace:'trace',logs:[{headers:{Authorization:'private-a','x-acp-validation-run-token':'private-b'}},JSON.stringify({headers:{'X-Acp-Validation-Run-Token':'private-c'},sessionId:'session'})]};
  const result = JSON.stringify(redactHistoricalEvidence(raw));
  assert.doesNotMatch(result, /private-[abc]/);
  assert.match(result, /session/);
  assert.match(result, /trace/);
});
