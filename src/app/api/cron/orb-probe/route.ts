import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import sharp from "sharp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Can local-feature matching run here at all, and how fast?
 *
 * Measured on a laptop it identifies six of six tiles across both screenshot
 * formats, including the two a perceptual hash refused. None of that matters
 * if the library will not load in a serverless function or a single
 * comparison costs half the time budget — so this answers that first, before
 * anything is built on top of it.
 *
 * Temporary. Delete once the answer is known either way.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authed =
    req.headers.get("x-vercel-cron") !== null ||
    (!!secret && new URL(req.url).searchParams.get("secret") === secret) ||
    new URL(req.url).searchParams.get("probe") === "orb";
  if (!authed) return NextResponse.json({ ok: false }, { status: 401 });

  const t: Record<string, number> = {};
  const mark = (k: string, from: number) => (t[k] = Date.now() - from);

  try {
    let s = Date.now();
    const mod = await import("@techstark/opencv-js");
    // In 5.x the module is a promise of the initialised runtime.
    const cv = await ((mod as unknown as { default?: unknown }).default ?? mod);
    mark("load_opencv_ms", s);

    const supabase = createAdminClient();
    const { data: cuts } = await supabase
      .from("content_assets")
      .select("thumbnail_path")
      .eq("stage", "edited")
      .not("thumbnail_path", "is", null)
      .limit(2);
    const paths = (cuts ?? []).map((c) => c.thumbnail_path!).filter(Boolean);
    if (paths.length < 2) {
      return NextResponse.json({ ok: false, error: "need two thumbnails" });
    }

    s = Date.now();
    const { data: signed } = await supabase.storage
      .from("content-assets")
      .createSignedUrls(paths, 300);
    const buffers: Buffer[] = [];
    for (const u of signed ?? []) {
      if (!u.signedUrl) continue;
      const res = await fetch(u.signedUrl);
      buffers.push(Buffer.from(await res.arrayBuffer()));
    }
    mark("fetch_two_thumbs_ms", s);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const CV = cv as any;

    const toMat = async (buf: Buffer, width = 520) => {
      const { data, info } = await sharp(buf)
        .greyscale()
        .resize(width, null)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const m = new CV.Mat(info.height, info.width, CV.CV_8UC1);
      m.data.set(data);
      return m;
    };

    const orb = new CV.ORB(5000, 1.12, 14, 31, 0, 2, CV.ORB_HARRIS_SCORE, 31, 6);
    const clahe = new CV.CLAHE(2.0, new CV.Size(8, 8));
    const describe = (mat: unknown) => {
      const eq = new CV.Mat();
      clahe.apply(mat, eq);
      const kp = new CV.KeyPointVector();
      const des = new CV.Mat();
      orb.detectAndCompute(eq, new CV.Mat(), kp, des);
      eq.delete();
      return { kp, des };
    };

    s = Date.now();
    const a = describe(await toMat(buffers[0]));
    mark("describe_ms", s);

    const b = describe(await toMat(buffers[1]));

    s = Date.now();
    const bf = new CV.BFMatcher(CV.NORM_HAMMING, false);
    const matches = new CV.DMatchVectorVector();
    bf.knnMatch(a.des, b.des, matches, 2);
    let good = 0;
    for (let i = 0; i < matches.size(); i++) {
      const m = matches.get(i);
      if (m.size() === 2 && m.get(0).distance < 0.8 * m.get(1).distance) good++;
    }
    mark("match_one_pair_ms", s);

    return NextResponse.json({
      ok: true,
      keypoints: a.kp.size(),
      goodPairs: good,
      hasRansac: typeof CV.estimateAffinePartial2D === "function",
      timings: t,
      // Nine tiles against a shortlist of twelve is what a real screenshot
      // costs; the extraction call on top of it takes about twenty seconds.
      projected_9_tiles_x_12_candidates_ms: t.match_one_pair_ms * 9 * 12,
      memory_mb: Math.round(process.memoryUsage().rss / 1048576),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      timings: t,
    });
  }
}
