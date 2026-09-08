import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyAdmissionProbe } from '../scripts/r2.8-validation-preflight.mjs';
const options = { path: '/__r28-tail-probe?run=offline', version: 'exact-version' };
const event = { truncated: false, outcome: 'ok', scriptVersion: {id: options.version}, event: {request: {url: 'https://staging.invalid' + options.path, method: 'POST'}, response: {status: 403}}, logs: [], exceptions: [] };
test('admission probe requires complete exact-version 403 with zero application activity', () => {
  assert.equal(verifyAdmissionProbe(JSON.stringify(event), options).modelInferences, 0);
  for (const change of [{truncated:true}, {logs:[{message:['provider reserve']}]}, {exceptions:[{}]}, {logs:undefined}, {scriptVersion:{id:'wrong'}}, {event:{...event.event,response:{status:200}}}]) {
    assert.throws(() => verifyAdmissionProbe(JSON.stringify({...event,...change}), options));
  }
  assert.throws(() => verifyAdmissionProbe('', options), /UNKNOWN/);
  assert.throws(() => verifyAdmissionProbe(JSON.stringify(event).slice(0,-1), options), /UNKNOWN/);
});

import { redactHistoricalEvidence } from '../scripts/r2.8-redact-historical.mjs';
test('historical evidence redacts nested headers and JSON strings without losing correlation', () => {
  const raw = {trace:'trace',logs:[{headers:{Authorization:'private-a','x-acp-validation-run-token':'private-b'}},JSON.stringify({headers:{'X-Acp-Validation-Run-Token':'private-c'},sessionId:'session'})]};
  const result = JSON.stringify(redactHistoricalEvidence(raw));
  assert.doesNotMatch(result, /private-[abc]/);
  assert.match(result, /session/);
  assert.match(result, /trace/);
});
