/**
 * The HTTP API. One handler, used by the local server (bin/serve.mjs) and by
 * the Vercel function (api/index.js). Every answer is JSON, including errors:
 * `{error, code?, …}` with the right status. Nothing answers an HTML page.
 *
 * Routes are [method, path, handler(ctx), options?]. ctx is
 * { req, body, params, query, ip }. options.maxBody overrides the 32 KB body
 * limit (only /api/scan, which carries a photo, needs more). There are no
 * logins: every route is public and rate-limited where it costs anything.
 */

import { HttpError } from "./http.js";
import { StoreError } from "./store.js";
import { clientIp } from "./budget.js";
import * as core from "./routes/core.js";
import * as trip from "./routes/trip.js";

export const MAX_BODY = 32 * 1024;

const routes = [...core.routes, ...trip.routes];

async function readJson(req, max) {
  if ("body" in req) {
    // Vercel's helper parses the body itself (its own limit is 4.5 MB), and
    // throws on broken JSON. Re-check our limit on what it parsed.
    let parsed;
    try {
      parsed = req.body;
    } catch {
      throw new HttpError("The request body isn't valid JSON.", 400, "bad_json");
    }
    if (parsed && typeof parsed === "object" && !Buffer.isBuffer(parsed)) {
      if (Array.isArray(parsed)) throw new HttpError("The request body must be a JSON object.", 400, "bad_json");
      if (Buffer.byteLength(JSON.stringify(parsed)) > max) throw new HttpError("That request is too large.", 413, "too_large");
      return parsed;
    }
    if (parsed !== undefined && parsed !== null && parsed !== "") throw new HttpError("Send the request as JSON.", 400, "bad_json");
    if (parsed === "" || parsed === null) return {};
  }
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > max) throw new HttpError("That request is too large.", 413, "too_large");
    chunks.push(c);
  }
  if (!chunks.length) return {};
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError("The request body isn't valid JSON.", 400, "bad_json");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError("The request body must be a JSON object.", 400, "bad_json");
  return body;
}

function decodeSegment(seg) {
  try {
    return decodeURIComponent(seg);
  } catch {
    throw new HttpError("That address has a broken %-escape in it.", 400, "bad_request");
  }
}

function match(method, path) {
  let pathMatched = false;
  for (const [m, pattern, fn, opts] of routes) {
    const a = pattern.split("/"), b = path.split("/");
    if (a.length !== b.length) continue;
    const params = {};
    if (!a.every((seg, i) => (seg.startsWith(":") ? ((params[seg.slice(1)] = decodeSegment(b[i])), true) : seg === b[i]))) continue;
    pathMatched = true;
    if (m === method) return { fn, params, opts: opts || {} };
  }
  return pathMatched ? { wrongMethod: true } : null;
}

export async function handle(req, res) {
  const send = (status, body, headers = {}) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("referrer-policy", "no-referrer");
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.end(JSON.stringify(body));
  };
  try {
    let url;
    try {
      url = new URL(req.url, "http://local");
    } catch {
      throw new HttpError("That address isn't valid.", 400, "bad_request");
    }
    const hit = match(req.method, url.pathname.replace(/\/$/, ""));
    if (!hit) return send(404, { error: "No such endpoint.", code: "not_found" });
    if (hit.wrongMethod) return send(405, { error: "That method isn't allowed here.", code: "method_not_allowed" });
    const body = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readJson(req, hit.opts.maxBody || MAX_BODY) : {};
    const out = await hit.fn({ req, body, params: hit.params, query: url.searchParams, ip: clientIp(req) });
    return send(200, out);
  } catch (err) {
    const known = err instanceof HttpError || err instanceof StoreError;
    if (!known) console.error("unhandled:", err?.name, String(err?.message || "").slice(0, 300));
    const status = known ? err.status || 400 : 500;
    const body = known
      ? { error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.extra || {}) }
      : { error: "Something went wrong on our side. Please try again.", code: "server_error" };
    if (err instanceof StoreError) body.code = "store_down";
    const headers = body.retryAfter ? { "retry-after": String(body.retryAfter) } : {};
    return send(status, body, headers);
  }
}
