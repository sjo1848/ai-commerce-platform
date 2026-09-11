#!/usr/bin/env node

const [fromArg, toArg, needleArg = ""] = process.argv.slice(2);
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_OBSERVABILITY_API_TOKEN;
const service = process.env.WORKER_NAME;

if (!accountId || !apiToken || !service) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_OBSERVABILITY_API_TOKEN and WORKER_NAME are required");
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
  const endpoint = "https://api.cloudflare.com/client/v4/accounts/[redacted]/workers/observability/telemetry/query";
  const sanitize = (value) => {
    let sanitized = String(value)
      .replaceAll(accountId, "[redacted]")
      .replaceAll(apiToken, "[redacted]")
      .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
      .replace(/(?:token|authorization|api[_-]?key)[=:]\s*[^\s,;]+/gi, "[redacted]");
    if (needleArg) sanitized = sanitized.replaceAll(needleArg, "[redacted]");
    return sanitized;
  };
  const safePrimitive = (value) => value === null ||
    ["string", "number", "boolean"].includes(typeof value);
  const responseErrors = [
    ...(Array.isArray(payload?.errors) ? payload.errors : []),
    ...(Array.isArray(payload?.messages) ? payload.messages : []),
  ];
  const metadata = responseErrors
    .filter((item) => item && typeof item === "object")
    .slice(0, 5)
    .map((item) => ({
      ...(safePrimitive(item.code) ? { code: sanitize(item.code) } : {}),
      ...(safePrimitive(item.message) ? { message: sanitize(item.message) } : {}),
      ...(safePrimitive(item.documentation_url) ? { documentation_url: sanitize(item.documentation_url) } : {}),
    }))
    .filter((item) => Object.keys(item).length > 0);
  const messages = [
    ...metadata.map((item) => item.code ?? item.message ?? "api_error"),
  ]
    .map((item) => sanitize(item))
    .slice(0, 5);
  throw new Error(`Workers Observability query failed ${JSON.stringify({ endpoint, status: response.status, errors: metadata })}${messages.length ? `: ${messages.join(", ")}` : ""}`);
}

process.stdout.write(JSON.stringify(payload));
