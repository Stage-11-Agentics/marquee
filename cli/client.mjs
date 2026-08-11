/** Small dependency-free HTTP client for the public Marquee API. */

export function baseUrl(value) {
  const raw = value ?? process.env.MARQUEE_URL;
  if (!raw) throw new Error("a Marquee URL is required; pass --url or set MARQUEE_URL");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("--url must be an absolute http(s) URL");
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("--url must be an absolute http(s) URL");
  return parsed.toString().replace(/\/$/, "");
}
export function bearerToken(value) {
  const token = value ?? process.env.MARQUEE_TOKEN;
  if (!token) throw new Error("a scoped API token is required; pass --token or set MARQUEE_TOKEN");
  if (/\s/.test(token)) throw new Error("--token must not contain whitespace");
  return token;
}

function apiPath(path) {
  return path.startsWith("/") ? path : `/${path}`;
}

function errorMessage(payload, status) {
  const message = payload?.error?.message ?? payload?.message;
  return message ? `Marquee API ${status}: ${message}` : `Marquee API request failed (${status})`;
}

export class MarqueeClient {
  constructor({ url, token, fetchImpl = fetch } = {}) {
    this.url = baseUrl(url);
    this.token = bearerToken(token);
    this.fetchImpl = fetchImpl;
  }

  async request(path, { method = "GET", query, body } = {}) {
    const target = new URL(apiPath(path), `${this.url}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === "") continue;
        target.searchParams.set(key, String(value));
      }
    }
    const response = await this.fetchImpl(target, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        if (!response.ok) throw new Error(errorMessage(null, response.status));
        throw new Error(`Marquee API returned non-JSON content (${response.status})`);
      }
    }
    if (!response.ok) throw new Error(errorMessage(payload, response.status));
    return payload;
  }

  get(path, options) {
    return this.request(path, { ...options, method: "GET" });
  }

  post(path, body, options) {
    return this.request(path, { ...options, method: "POST", body });
  }
}
