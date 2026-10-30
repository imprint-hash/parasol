/**
 * Test environment. Import this FIRST in every test file (before src/): it
 * sets fake secrets so src/env.js never reads the real .env values, points
 * the store at a temp file, and returns a tiny HTTP client over the router.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TEST_DIR = mkdtempSync(join(tmpdir(), "parasol-test-"));
export const SECRETS = {
  YOUCAM_API_KEY: "test",
  SHOPIFY_STOREFRONT_TOKEN: "shop-token-SECRET-123",
  SUPABASE_SERVICE_ROLE_KEY: "supabase-SECRET-456",
  PARASOL_SECRET: "parasol-SECRET-789-parasol-SECRET-789",
  CRON_SECRET: "cron-SECRET-000",
};

Object.assign(process.env, SECRETS, {
  PARASOL_STORE: join(TEST_DIR, "store.json"),
  SUPABASE_URL: "",
  YOUCAM_SECRET_KEY: "",
  YOUCAM_POLL_MS: "5",
  YOUCAM_POLL_MAX_MS: "3000",
  LIVE_SCANS: "on",
  LIVE_SCANS_PER_DAY: "15",
  UNITS_FLOOR: "150",
  YOUCAM_SKIN_TONE: "0",
  SHOPIFY_STORE_DOMAIN: "test-shop.myshopify.com",
  SHOPIFY_STORE_PASSWORD: "letmein",
  // Closed port: Shopify is "down" unless a test points this at a stub.
  SHOPIFY_API_URL: "http://127.0.0.1:9/graphql",
});
delete process.env.VERCEL;

/** Starts the router on a random port. Returns {url, call(method, path, body, headers), close}. */
export async function startApp() {
  const { createServer } = await import("node:http");
  const { handle } = await import("../../src/router.js");
  const server = createServer(handle);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  async function call(method, path, body, headers = {}) {
    const res = await fetch(url + path, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, headers: res.headers, body: json, text };
  }
  return { url, call, close: () => new Promise((r) => server.close(r)) };
}
