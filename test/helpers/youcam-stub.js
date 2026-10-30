/**
 * A fake YouCam S2S API for offline tests. It speaks the same shapes the real
 * one does (captured on 29 Oct 2026, see scratch/SPIKES.md): file upload →
 * signed PUT URL, task start → task_id, polled until success or error.
 *
 * Set process.env.YOUCAM_BASE_URL = stub.url and YOUCAM_API_KEY = "test"
 * (and YOUCAM_POLL_MS = "5") BEFORE importing anything from src/.
 *
 * `stub.state` controls behaviour per test:
 *   units          balance returned by /client/credit
 *   faces          faces found by the Fitzpatrick pre-process (default 1)
 *   scale          Fitzpatrick result (default "V")
 *   skinError      e.g. "error_src_face_too_small": the skin task ends in error
 *   fitzError      the Fitzpatrick run ends in error
 *   startStatus    HTTP status for task starts (e.g. 500, 429)
 *   pollsBeforeDone how many "running" polls before the end (default 1)
 *   neverFinish    tasks stay "running" forever
 *   skinTypes      {whole, t_zone, u_zone} skin_type values (default Oily/Oily/Normal… see below)
 *   scores         ui_score per metric
 * `stub.calls` lists every request ({method, path}); `stub.started` counts
 * task starts per feature; `stub.uploadedBytes` counts PUT bytes (the bytes
 * themselves are not kept).
 */

import { createServer } from "node:http";

export const DEFAULT_SCORES = { oiliness: 52, moisture: 71, acne: 88, redness: 35, pore: 66, age_spot: 90, texture: 75, radiance: 80 };

export async function startYoucamStub() {
  const state = { units: 900, faces: 1, scale: "V", pollsBeforeDone: 1, skinTypes: { whole: "Combination", t_zone: "Oily", u_zone: "Normal" }, scores: { ...DEFAULT_SCORES } };
  const calls = [];
  const started = {};
  const tasks = new Map();
  let seq = 0;
  let uploadedBytes = 0;
  let url;

  const json = (res, status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

  function resultFor(feature) {
    if (feature === "skin-analysis") {
      if (state.skinError) return { error: state.skinError };
      const mask = (m) => [`https://yce-us.s3-accelerate.amazonaws.com/ttl30/x/${m}_output.png?X-Amz-Date=${amzNow()}&X-Amz-Expires=7200&X-Amz-Signature=abc`];
      const output = Object.entries(state.scores).map(([type, ui]) => ({ type, ui_score: ui, raw_score: ui, mask_urls: mask(type), url: null }));
      for (const [region, v] of Object.entries(state.skinTypes)) if (v) output.push({ type: "skin_type", region: region === "whole" ? "whole" : region, skin_type: v, mask_urls: mask(`skin_type_${region}`), url: null });
      output.push({ type: "all", score: 74.5, url: null }, { type: "skin_age", score: 31, url: null }, { type: "resize_image", mask_urls: ["https://yce-us.s3-accelerate.amazonaws.com/x/resize_image.jpg"], url: null });
      return { results: { output } };
    }
    if (feature === "fitzpatrick-scale-analyzer/pre-process") {
      return { results: { timed: 1000, result: Array.from({ length: state.faces }, (_, i) => ({ left: 0.2 + i * 0.3, top: 0.1, width: 0.3, height: 0.6 })) } };
    }
    if (feature === "fitzpatrick-scale-analyzer") {
      if (state.fitzError) return { error: state.fitzError };
      return { results: { timed: 3000, fitzpatrick_scale: state.scale } };
    }
    if (feature === "skin-tone-analysis") return { results: { color: { skin_color: "#8D5524" }, face_quality: { has_face: true } } };
    if (feature === "skin-simulation") return { results: { url: `${url}/sim.jpg` } };
    return { error: "unknown_internal_error" };
  }

  const server = createServer(async (req, res) => {
    const u = new URL(req.url, "http://stub");
    calls.push({ method: req.method, path: u.pathname });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);

    if (req.method === "PUT" && u.pathname.startsWith("/upload/")) {
      uploadedBytes += raw.length;
      return res.writeHead(200).end();
    }
    if (req.headers.authorization !== "Bearer test") return json(res, 401, { status: 401, error_code: "InvalidApiKey" });
    if (req.method === "GET" && u.pathname === "/s2s/v1.0/client/credit") return json(res, 200, { status: 200, results: [{ id: 1, type: "ApiPaygToken", amount: state.units, expiry: Date.now() + 1e10 }] });

    let m = /^\/s2s\/v2\.0\/file\/([a-z-]+)$/.exec(u.pathname);
    if (req.method === "POST" && m) {
      const body = JSON.parse(raw.toString() || "{}");
      const f = body.files?.[0];
      const id = `file-${++seq}`;
      return json(res, 200, { status: 200, data: { files: [{ content_type: f?.content_type, file_name: f?.file_name, file_id: id, requests: [{ method: "PUT", url: `${url}/upload/${id}`, headers: { "Content-Type": f?.content_type } }] }] } });
    }
    m = /^\/s2s\/v2\.0\/task\/(.+)$/.exec(u.pathname);
    if (req.method === "POST" && m) {
      if (state.startStatus) return json(res, state.startStatus, { status: state.startStatus, error_code: state.startStatus === 400 ? "CreditInsufficiency" : "ServerError" });
      const feature = m[1];
      const body = JSON.parse(raw.toString() || "{}");
      if (!body.src_file_id && !body.src_file_url) return json(res, 400, { status: 400, error_code: "InvalidParameters" });
      started[feature] = (started[feature] || 0) + 1;
      const id = `task-${++seq}`;
      tasks.set(id, { feature, polls: 0, body });
      return json(res, 200, { status: 200, data: { task_id: id } });
    }
    m = /^\/s2s\/v2\.0\/task\/(.+)\/(task-\d+)$/.exec(u.pathname);
    if (req.method === "GET" && m) {
      const t = tasks.get(m[2]);
      if (!t) return json(res, 400, { status: 400, error_code: "InvalidTaskId" });
      t.polls++;
      if (state.neverFinish || t.polls <= state.pollsBeforeDone) return json(res, 200, { status: 200, data: { task_status: "running" } });
      const r = resultFor(t.feature);
      if (r.error) return json(res, 200, { status: 200, data: { task_status: "error", error: r.error, error_message: "stub" } });
      return json(res, 200, { status: 200, data: { task_status: "success", ...r } });
    }
    if (u.pathname === "/sim.jpg") return res.writeHead(200, { "content-type": "image/jpeg" }).end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    return json(res, 404, { status: 404 });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    state,
    calls,
    started,
    get uploadedBytes() {
      return uploadedBytes;
    },
    /** Number of skin-analysis runs (the 14-unit call). */
    get skinRuns() {
      return started["skin-analysis"] || 0;
    },
    reset() {
      calls.length = 0;
      uploadedBytes = 0;
      for (const k of Object.keys(started)) delete started[k];
      Object.assign(state, { units: 900, faces: 1, scale: "V", pollsBeforeDone: 1, skinError: undefined, fitzError: undefined, startStatus: undefined, neverFinish: false, skinTypes: { whole: "Combination", t_zone: "Oily", u_zone: "Normal" }, scores: { ...DEFAULT_SCORES } });
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function amzNow(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/* ---------- tiny test images (headers only; nobody decodes the pixels) ---------- */

let n = 0;
/** A JPEG whose SOF0 says width × height. Each call differs (COM segment), so hashes differ. */
export function fakeJpeg(width = 800, height = 1000, tag = `img-${++n}-${Math.random()}`) {
  const com = Buffer.from(tag);
  const comSeg = Buffer.concat([Buffer.from([0xff, 0xfe]), u16(com.length + 2), com]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.concat([Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]), u16(height), u16(width), Buffer.from([0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01])]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00, 0x12, 0x34]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, comSeg, sof, sos, Buffer.from([0xff, 0xd9])]);
}

/** A PNG whose IHDR says width × height. */
export function fakePng(width = 800, height = 1000) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.concat([u32(13), Buffer.from("IHDR"), u32(width), u32(height), Buffer.from([8, 2, 0, 0, 0]), u32(0)]);
  const iend = Buffer.concat([u32(0), Buffer.from("IEND"), u32(0xae426082)]);
  return Buffer.concat([sig, ihdr, Buffer.from(`tEXt${Math.random()}`), iend]);
}

export const dataUrl = (buf, type = "image/jpeg") => `data:${type};base64,${buf.toString("base64")}`;

function u16(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(v);
  return b;
}
function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v >>> 0);
  return b;
}
