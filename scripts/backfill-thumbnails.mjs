#!/usr/bin/env node
/**
 * One-shot thumbnail backfill.
 *
 * What it does:
 *   For every content_assets row with thumbnail_path = NULL:
 *     1. Range-download the first ~3 MB of the original (enough for moov atom
 *        + first GOP on fast-start MP4s; for images the whole file)
 *     2. Pipe through `ffmpeg` to extract a frame at ~0.5 s, scaled to
 *        max 480 px wide, encoded as quality-7 JPEG
 *     3. Upload the JPEG to Storage at `<originalpath>.thumb.jpg`
 *     4. Save thumbnail_path on the asset row
 *
 * Why this is fast:
 *   - Range request: bytes per asset go from 50–200 MB → 3 MB
 *   - ffmpeg in C: extracts a frame in <100 ms vs. 1–2 s in browser
 *   - Concurrency 5: bandwidth-bound, scales linearly
 *
 * Run with:
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...  bun run backfill-thumbs
 *
 * The service-role key is required (this script bypasses RLS so it can
 * see every asset). Find it under Supabase Dashboard → Project Settings
 * → API → service_role (secret).
 *
 * Idempotent: assets that already have a thumbnail are skipped. Run as
 * many times as you want.
 */

import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";

// ── Load .env.local manually (no dotenv dep needed) ──────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = pathResolve(__dirname, "..", ".env.local");
try {
  const txt = readFileSync(envPath, "utf8");
  for (const line of txt.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      // Strip optional surrounding quotes
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[m[1]] = val;
    }
  }
} catch {
  /* no .env.local — env may already be set */
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "content-assets";
const CONCURRENCY = 5;
const RANGE_BYTES = 3 * 1024 * 1024; // first 3 MB
const THUMB_MAX_WIDTH = 480;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "✖ Missing env. Need NEXT_PUBLIC_SUPABASE_URL (.env.local) and SUPABASE_SERVICE_ROLE_KEY (export or pass inline)."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── ffmpeg wrapper: stdin = bytes, stdout = JPEG ────────────────────────
function extractFrame(inputBuffer, isVideo) {
  return new Promise((resolve, reject) => {
    const args = isVideo
      ? [
          "-loglevel",
          "error",
          "-i",
          "pipe:0",
          // ffmpeg's `thumbnail` filter scans a window of frames and picks
          // the most representative one — this naturally avoids black
          // fade-in / intro frames that a fixed -ss 0.5 seek often hit.
          "-vf",
          `thumbnail=n=100,scale='min(${THUMB_MAX_WIDTH},iw)':-2`,
          "-frames:v",
          "1",
          "-q:v",
          "5",
          "-f",
          "image2",
          "pipe:1",
        ]
      : [
          "-loglevel",
          "error",
          "-i",
          "pipe:0",
          "-vf",
          `scale='min(${THUMB_MAX_WIDTH},iw)':-2`,
          "-q:v",
          "5",
          "-f",
          "image2",
          "pipe:1",
        ];

    const proc = spawn("ffmpeg", args);
    const out = [];
    const err = [];
    proc.stdout.on("data", (d) => out.push(d));
    proc.stderr.on("data", (d) => err.push(d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0 && out.length) {
        resolve(Buffer.concat(out));
      } else {
        reject(new Error(`ffmpeg exit ${code}: ${Buffer.concat(err).toString()}`));
      }
    });
    proc.stdin.on("error", () => {
      // ffmpeg may close stdin early once it has the frame — that's fine
    });
    proc.stdin.write(inputBuffer);
    proc.stdin.end();
  });
}

function thumbnailPathFor(filePath) {
  const dot = filePath.lastIndexOf(".");
  const slash = filePath.lastIndexOf("/");
  const base = dot > slash ? filePath.slice(0, dot) : filePath;
  return `${base}.thumb.jpg`;
}

// ── Process one asset ───────────────────────────────────────────────────
async function processAsset(asset) {
  const isVideo = (asset.mime_type || "").startsWith("video/");
  const isImage = (asset.mime_type || "").startsWith("image/");
  if (!isVideo && !isImage) return { skipped: true, reason: "not media" };

  // Sign URL (1 h enough for one shot)
  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(asset.file_path, 600);
  if (signErr || !signed?.signedUrl) {
    throw new Error(`sign: ${signErr?.message ?? "no url"}`);
  }

  // Range-download first chunk for videos; full image for images.
  const headers = isVideo ? { Range: `bytes=0-${RANGE_BYTES - 1}` } : {};
  const res = await fetch(signed.signedUrl, { headers });
  if (!res.ok && res.status !== 206) {
    throw new Error(`fetch ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());

  // Extract frame
  const jpeg = await extractFrame(buf, isVideo);

  // Upload thumbnail
  const tPath = thumbnailPathFor(asset.file_path);
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(tPath, jpeg, {
      contentType: "image/jpeg",
      upsert: true,
    });
  if (upErr) throw new Error(`upload: ${upErr.message}`);

  // Save path
  const { error: dbErr } = await supabase
    .from("content_assets")
    .update({ thumbnail_path: tPath })
    .eq("id", asset.id);
  if (dbErr) throw new Error(`db: ${dbErr.message}`);

  return { ok: true, sizeKB: Math.round(jpeg.length / 1024) };
}

// ── Main loop with worker pool ─────────────────────────────────────────
async function main() {
  // REGEN=all reprocesses assets that ALREADY have a thumbnail (to fix
  // black-frame thumbnails). Default only fills missing ones.
  const regenAll = (process.env.REGEN || "").toLowerCase() === "all";
  console.log(
    regenAll
      ? "→ REGEN=all — reprocessing ALL video/image assets…"
      : "→ Querying assets with no thumbnail…"
  );

  // Pull in batches to avoid the 1000-row default cap
  let from = 0;
  const PAGE = 1000;
  const all = [];
  while (true) {
    let q = supabase
      .from("content_assets")
      .select("id, file_path, mime_type, file_name")
      .is("deleted_at", null);
    if (!regenAll) q = q.is("thumbnail_path", null);
    const { data, error } = await q
      .order("uploaded_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`→ ${all.length} assets to backfill`);
  if (all.length === 0) return;

  let done = 0;
  let success = 0;
  let failed = 0;
  let skipped = 0;
  const total = all.length;
  const t0 = Date.now();

  let cursor = 0;
  async function worker(id) {
    while (true) {
      const i = cursor++;
      if (i >= all.length) return;
      const asset = all[i];
      try {
        const r = await processAsset(asset);
        if (r.skipped) skipped++;
        else success++;
      } catch (err) {
        failed++;
        console.warn(
          `  ✖ ${asset.file_name} — ${err.message?.slice(0, 120) ?? err}`
        );
      } finally {
        done++;
        if (done % 5 === 0 || done === total) {
          const elapsed = (Date.now() - t0) / 1000;
          const rate = done / elapsed;
          const eta = Math.round((total - done) / rate);
          process.stdout.write(
            `\r  ${done}/${total} (${success} ok, ${failed} failed, ${skipped} skipped) — ${rate.toFixed(1)}/s, ETA ${eta}s         `
          );
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) => worker(i))
  );
  process.stdout.write("\n");

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `→ Done in ${elapsed}s · ${success} thumbnails created · ${failed} failed · ${skipped} skipped`
  );
}

main().catch((err) => {
  console.error("✖ Fatal:", err);
  process.exit(1);
});
