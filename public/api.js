// Small JSON client for /api. Errors arrive as {error, code?} with a status.

export class ApiError extends Error {
  constructor(message, status, code, data = {}) {
    super(message);
    this.status = status;
    this.code = code || null;
    this.data = data;
  }
}

export async function api(path, { method = "GET", body, timeout = 30000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (err) {
    clearTimeout(t);
    if (err.name === "AbortError") throw new ApiError("This is taking too long. Please try again.", 0, "timeout");
    throw new ApiError("Can't reach Parasol. Check your connection and try again.", 0, "offline");
  }
  clearTimeout(t);
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const msg = data.error || (res.status === 501 ? "This part of Parasol isn't ready yet." : "Something went wrong. Please try again.");
    throw new ApiError(msg, res.status, data.code || (res.status === 501 ? "not_ready" : null), data);
  }
  return data;
}

let configP = null;
/** GET /api/config, once per page. Never throws. */
export function config() {
  configP ||= api("/api/config").catch(() => ({ liveScans: false, storePassword: null, shopDomain: null, testCard: null, disclaimer: null }));
  return configP;
}

export const demoScan = (persona, kind = "baseline") => api("/api/demo/scan", { method: "POST", body: { persona, kind } });
export const liveScan = (image) => api("/api/scan", { method: "POST", body: { image, consent: true, consentVersion: 1 }, timeout: 130000 });
export const forecast = (profile, trip) => api("/api/forecast", { method: "POST", body: { profile, trip }, timeout: 60000 });
export const kit = (profile, needs, carryOn) => api("/api/kit", { method: "POST", body: { profile, needs, carryOn } });
export const cart = (lines) => api("/api/cart", { method: "POST", body: { lines } });
export const places = (q) => api(`/api/places?q=${encodeURIComponent(q)}`, { timeout: 10000 });
export const compare = (body) => api("/api/rescan/compare", { method: "POST", body });
export const deleteMyData = (deleteTokens) => api("/api/my-data", { method: "DELETE", body: { deleteTokens } });
