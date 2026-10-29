/**
 * Storage. Two drivers behind the same small async API (Outside's pattern):
 *
 * - Supabase (hosted Postgres), when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   are set. One table, `records`, keyed by (collection, id), each record a
 *   JSON document. Parasol shares this table with another app, so every
 *   collection name must start with `pz_` (checked on every call), and records
 *   are only ever deleted one at a time by exact (collection, id).
 * - A local JSON file, for tests and offline work, whenever PARASOL_STORE names
 *   a file. With no Supabase keys it is data/store.json locally, or
 *   /tmp/parasol-store.json on Vercel ("ephemeral": lost on cold start).
 *
 * What is kept (see PLAN.md section 5), never images and never accounts:
 *   pz_ycache  YouCam scores keyed by sha256(image bytes)
 *   pz_budget  live-scan and unit counters per day and per hashed IP
 *   pz_wx      weather and catalog cache entries
 */

import "./env.js";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const newId = () => randomUUID();

export const COLLECTIONS = ["pz_ycache", "pz_budget", "pz_wx"];

export class StoreError extends Error {
  constructor(message) {
    super(message);
    this.status = 503;
  }
}

function checkCollection(c) {
  if (!COLLECTIONS.includes(c)) throw new StoreError(`Unknown collection "${String(c).slice(0, 40)}". Parasol only uses pz_ collections.`);
}

/* ---------- file driver ---------- */

function fileDriver(file, name) {
  const EMPTY = () => Object.fromEntries(COLLECTIONS.map((c) => [c, {}]));
  let db = null;
  const load = () => {
    if (db) return db;
    try {
      db = existsSync(file) ? { ...EMPTY(), ...JSON.parse(readFileSync(file, "utf8")) } : EMPTY();
    } catch {
      db = EMPTY();
    }
    return db;
  };
  let pending = null;
  const save = () => {
    // Coalesce writes made in the same tick into one.
    if (pending) return pending;
    pending = Promise.resolve().then(() => {
      pending = null;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(db));
      renameSync(`${file}.tmp`, file);
    });
    return pending;
  };
  return {
    name,
    get: async (c, id) => load()[c][id] ?? null,
    put: async (c, rec) => ((load()[c][rec.id] = rec), await save(), rec),
    remove: async (c, id) => (delete load()[c][id], await save()),
    all: async (c, match = {}) => Object.values(load()[c]).filter((r) => Object.entries(match).every(([k, v]) => String(r[k]) === String(v))),
    reset: async () => ((db = EMPTY()), await save()),
  };
}

/* ---------- Supabase driver ---------- */

function supabaseDriver(url, key) {
  const base = `${url.replace(/\/$/, "")}/rest/v1/records`;
  const headers = { apikey: key, "content-type": "application/json" };
  // Legacy JWT keys also want an Authorization header; the newer sb_secret_ keys don't.
  if (key.startsWith("eyJ")) headers.authorization = `Bearer ${key}`;

  async function call(method, query, body, extra = {}) {
    let res;
    try {
      res = await fetch(`${base}?${query}`, { method, headers: { ...headers, ...extra }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      throw new StoreError(`The database didn't answer: ${err.message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new StoreError(`The database answered ${res.status}: ${text.slice(0, 160)}`);
    }
    // Writes with return=minimal answer 201 with an empty body.
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  const enc = encodeURIComponent;

  return {
    name: "supabase",
    async get(c, id) {
      const rows = await call("GET", `collection=eq.${enc(c)}&id=eq.${enc(id)}&select=data`);
      return rows[0]?.data ?? null;
    },
    async put(c, rec) {
      await call("POST", "on_conflict=collection,id", { collection: c, id: rec.id, data: rec, updated_at: new Date().toISOString() }, { prefer: "resolution=merge-duplicates,return=minimal" });
      return rec;
    },
    async remove(c, id) {
      // Exactly one record: both keys must be present and equal.
      if (!id) throw new StoreError("Refusing to delete without an id.");
      await call("DELETE", `collection=eq.${enc(c)}&id=eq.${enc(id)}`, null, { prefer: "return=minimal" });
    },
    async all(c, match = {}) {
      const filters = Object.entries(match).map(([k, v]) => `&data->>${enc(k)}=eq.${enc(String(v))}`).join("");
      const out = [];
      for (let from = 0; ; from += 1000) {
        const rows = await call("GET", `collection=eq.${enc(c)}${filters}&select=data&order=id`, null, { range: `${from}-${from + 999}` });
        out.push(...rows.map((r) => r.data));
        if (rows.length < 1000) return out;
      }
    },
    async reset() {
      throw new StoreError("Refusing to wipe the hosted database from code.");
    },
  };
}

/* ---------- pick one ---------- */

function pick() {
  if (process.env.PARASOL_STORE) return fileDriver(process.env.PARASOL_STORE, "file");
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return supabaseDriver(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (process.env.VERCEL) return fileDriver("/tmp/parasol-store.json", "ephemeral");
  return fileDriver(fileURLToPath(new URL("../data/store.json", import.meta.url)), "file");
}
const driver = pick();

/** "supabase", "file" or "ephemeral". */
export const storeName = driver.name;

export async function get(collection, id) {
  checkCollection(collection);
  return driver.get(collection, String(id));
}

export async function put(collection, record) {
  checkCollection(collection);
  const rec = { ...record, id: record.id || newId() };
  return driver.put(collection, rec);
}

/** Deletes exactly one record, by its exact id. */
export async function remove(collection, id) {
  checkCollection(collection);
  if (typeof id !== "string" || !id) throw new StoreError("Refusing to delete without an exact id.");
  return driver.remove(collection, id);
}

/**
 * Records in a collection that pass `where`. `match` is an optional hint of
 * exact field values the database can filter on first; `where` still decides.
 */
export async function list(collection, where = () => true, match = {}) {
  checkCollection(collection);
  return (await driver.all(collection, match)).filter(where);
}

/** For tests on the file driver: start from empty. */
export async function reset() {
  return driver.reset();
}
