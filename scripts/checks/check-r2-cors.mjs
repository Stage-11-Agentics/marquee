#!/usr/bin/env node

const productionOrigin = process.env.MARQUEE_CORS_PRODUCTION_ORIGIN ?? "https://marquee.stage11.dev";
const wrongOrigin = process.env.MARQUEE_CORS_WRONG_ORIGIN ?? "https://not-allowed.example";
const probeUrl = process.env.MARQUEE_R2_CORS_URL;

if (!probeUrl) {
  throw new Error("MARQUEE_R2_CORS_URL is required; point it at an object path in the deployed R2 bucket.");
}

const parsedProbeUrl = new URL(probeUrl);
if (parsedProbeUrl.protocol !== "https:") {
  throw new Error("MARQUEE_R2_CORS_URL must use https:// for a deployed R2 check.");
}

async function preflight(origin) {
  return fetch(parsedProbeUrl, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type,if-none-match",
    },
  });
}

function header(response, name) {
  return response.headers.get(name)?.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean) ?? [];
}

function requireIncludes(values, expected, label) {
  if (!values.includes(expected.toLowerCase())) {
    throw new Error(`${label} must include ${expected}; received ${values.join(", ") || "(none)"}.`);
  }
}

const allowed = await preflight(productionOrigin);
if (!allowed.ok) {
  throw new Error(`Production-origin R2 preflight failed with HTTP ${allowed.status}.`);
}
if (allowed.headers.get("access-control-allow-origin") !== productionOrigin) {
  throw new Error("Production-origin R2 preflight did not return the exact allowed origin.");
}
requireIncludes(header(allowed, "access-control-allow-methods"), "PUT", "Access-Control-Allow-Methods");
requireIncludes(header(allowed, "access-control-allow-headers"), "content-type", "Access-Control-Allow-Headers");
requireIncludes(header(allowed, "access-control-allow-headers"), "if-none-match", "Access-Control-Allow-Headers");

const rejected = await preflight(wrongOrigin);
if (rejected.headers.get("access-control-allow-origin") === wrongOrigin) {
  throw new Error(`R2 preflight incorrectly allowed the deliberately wrong origin ${wrongOrigin}.`);
}

console.log(JSON.stringify({
  command: "check:r2-cors",
  status: "pass",
  probeUrl: parsedProbeUrl.origin + parsedProbeUrl.pathname,
  productionOrigin,
  productionPreflight: {
    status: allowed.status,
    allowOrigin: allowed.headers.get("access-control-allow-origin"),
    allowMethods: header(allowed, "access-control-allow-methods"),
    allowHeaders: header(allowed, "access-control-allow-headers"),
  },
  wrongOrigin: {
    origin: wrongOrigin,
    status: rejected.status,
    allowOrigin: rejected.headers.get("access-control-allow-origin"),
  },
}));
