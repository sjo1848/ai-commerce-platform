#!/usr/bin/env node

const [fromArg, toArg, needleArg = ""] = process.argv.slice(2);
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const service = process.env.WORKER_NAME;

if (!accountId || !apiToken || !service) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and WORKER_NAME are required");
}

const from = Number(fromArg);
const to = Number(toArg);
if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) {
  throw new Error("usage: query-workers-observability.mjs <from-ms> <to-ms> [needle]");
}

const filters = [{
  kind: "filter",
  key: "$metadata.service",
  operation: "eq",
  type: "string",
  value: service,
}];

const body = {
  queryId: `r2-8-4-${Date.now()}`,
  timeframe: { from: Math.floor(from), to: Math.floor(to) },
  view: "events",
  limit: 2000,
  parameters: {
    datasets: [],
    filterCombination: "and",
    filters,
    ...(needleArg ? { needle: { value: needleArg, isRegex: false, matchCase: true } } : {}),
  },
};

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/observability/telemetry/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  },
);

const text = await response.text();
let payload;
try {
  payload = JSON.parse(text);
} catch {
  throw new Error(`Workers Observability query returned non-JSON HTTP ${response.status}`);
}

if (!response.ok || payload?.success === false) {
  const messages = [
    ...(Array.isArray(payload?.errors) ? payload.errors : []),
    ...(Array.isArray(payload?.messages) ? payload.messages : []),
  ]
    .map((item) => item && typeof item === "object" ? String(item.code ?? item.message ?? "api_error") : String(item))
    .slice(0, 5);
  throw new Error(`Workers Observability query failed HTTP ${response.status}${messages.length ? `: ${messages.join(", ")}` : ""}`);
}

process.stdout.write(JSON.stringify(payload));
