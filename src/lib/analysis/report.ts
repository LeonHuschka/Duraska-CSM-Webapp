import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { commentKeys, describeKey, featureKeys, type CommentRead, type ReelFeatures } from "@/lib/analysis/codebook";
import { compare, midpoint, overTime, type Finding, type ScopeStats, type StatReel, type TimeFinding } from "@/lib/analysis/stats";
import type { CohortReel } from "@/lib/analysis/cohorts";

type Db = SupabaseClient<Database>;
const MODEL = "claude-opus-5-5";

export type AnalysisStats = {
  accounts: { id: string; label: string; platform: string; stats: ScopeStats }[];
  all: ScopeStats;
  time: { splitAt: string | null; findings: TimeFinding[] };
  reels: {
    id: string;
    shortcode: string;
    accountId: string;
    cohort: StatReel["cohort"];
    lift: number | null;
    views: number | null;
    postedAt: string | null;
    url: string | null;
    summary: string;
  }[];
};

const Briefing = z.object({
  headline: z.string().describe("One sentence: what winners have in common, as far as the evidence goes."),
  accounts: z
    .array(
      z.object({
        account: z.string().describe("The account label as given."),
        winning_pattern: z
          .string()
          .describe("This account's winning pattern in two to four sentences, from its strong and medium findings only."),
        tell_the_model: z
          .array(z.string())
          .describe("Direct instructions to the creator, one line each, concrete enough to shoot from: outfit, accessory, place, hook, move, length, text."),
        avoid: z.array(z.string()).describe("What winners on this account avoid, from the negative findings. Short lines."),
        worth_testing: z.array(z.string()).describe("Weak findings worth a deliberate test, one line each."),
      })
    )
    .describe("One entry per account that has findings."),
  across_accounts: z.object({
    pattern: z.string().describe("What winners share across accounts — only features that hold in most accounts."),
    tell_the_model: z.array(z.string()),
  }),
  over_time: z.object({
    rising: z.array(z.string()).describe("What newer winners show more than older ones."),
    fading: z.array(z.string()).describe("What worked before and wears off now."),
  }),
  caveats: z.array(z.string()).describe("What limits this reading: few winners, unclear fields, missing data. Short."),
});
export type AnalysisBriefing = z.infer<typeof Briefing>;

const SYSTEM = `You turn a statistical comparison of a creator's reels into a briefing she can shoot from.

The data: for each account, reels were sorted into winners (far above the account's median plays), clean losers (far below) and a small control sample (ordinary reels). Gemini classified every reel blind, against a fixed codebook. For each feature you get how many winners and how many of the rest show it, the median performance multiplier of reels with and without it, a p-value, a q-value (corrected for testing many features) and a confidence label. Across accounts, "accounts agree" says in how many accounts winners show the feature more often.

Rules:
- Build the winning pattern and the instructions only from strong and medium findings. Weak findings go to "worth testing", never into instructions.
- Every instruction must be something the creator can do on the next shoot ("wear the black hairband", "start already turning, eye contact in the first frame", "film in the bathroom, mirror behind"). Combine features that the combinations show work together.
- These are correlations, not proven causes. Say so once in the caveats, not in every line.
- If an account has too few winners for anything strong, say that instead of stretching weak evidence.
- Findings that share a pattern letter rest on the same winner reels: they are one observation (often one look or one concept that worked several times), not separate evidence. Describe each pattern as one look, say how many winner reels it rests on, and do not count its features as independent support for each other.
- Plain English, short lines, no hype.`;

const fmt = (f: Finding, scope: "account" | "all") =>
  `${describeKey(f.key)} — winners ${f.winners.k}/${f.winners.n}, rest ${f.rest.k}/${f.rest.n}` +
  `, median lift ${f.liftWith?.toFixed(1) ?? "?"}× with vs ${f.liftWithout?.toFixed(1) ?? "?"}× without` +
  `, p=${f.p.toFixed(3)} q=${f.q.toFixed(3)}, ${f.confidence ?? "none"}` +
  (scope === "all" && f.accounts ? `, accounts agree ${f.accounts.agree}/${f.accounts.total}` : "") +
  (f.pattern ? `, pattern ${f.pattern}` : "");

const patternLine = (s: ScopeStats) =>
  `Patterns (findings with the same letter rest on the same winners):\n${
    (s.patterns ?? []).map((p) => `- ${p.label}: ${p.winners.length} winner reels, ${p.findings} findings`).join("\n") || "- none"
  }`;

/** The cohorts of today joined with what Gemini saw, counted. */
export async function buildStats(supabase: Db, personaId: string, cohorts: CohortReel[]): Promise<AnalysisStats> {
  const [{ data: rows }, { data: accounts }] = await Promise.all([
    supabase
      .from("reel_analyses")
      .select("id, account_id, shortcode, post_url, posted_at, views, features, comment_read")
      .eq("persona_id", personaId)
      .eq("status", "done"),
    supabase.from("accounts").select("id, handle, display_name, platform").eq("persona_id", personaId),
  ]);
  const current = new Map(cohorts.map((c) => [`${c.accountId}|${c.shortcode}`, c]));
  const reels: StatReel[] = [];
  const listed: AnalysisStats["reels"] = [];
  for (const r of rows ?? []) {
    const c = current.get(`${r.account_id}|${r.shortcode}`);
    const f = r.features as unknown as ReelFeatures | null;
    if (!c || !f) continue; // no longer in a cohort: kept, but not counted
    const keys = featureKeys(f);
    commentKeys(r.comment_read as unknown as CommentRead | null).forEach((k) => keys.add(k));
    reels.push({ id: r.id, shortcode: r.shortcode, accountId: r.account_id, cohort: c.cohort, lift: c.lift, postedAt: r.posted_at, keys });
    listed.push({
      id: r.id,
      shortcode: r.shortcode,
      accountId: r.account_id,
      cohort: c.cohort,
      lift: c.lift,
      views: c.views,
      postedAt: r.posted_at,
      url: r.post_url,
      summary: f.summary,
    });
  }

  const label = (a: { handle: string; display_name: string | null }) => {
    const h = a.handle.replace(/^@/, "");
    return a.display_name || (/^https?:\/\//.test(h) ? "Facebook page" : `@${h}`);
  };
  const perAccount = (accounts ?? [])
    .filter((a) => reels.some((r) => r.accountId === a.id))
    .map((a) => ({ id: a.id, label: label(a), platform: a.platform, stats: compare(reels.filter((r) => r.accountId === a.id)) }));
  // Comment features only exist for winners; across accounts they would
  // only ever read as "winners have comments", so they stay per account.
  const all = compare(
    reels.map((r) => ({ ...r, keys: new Set(Array.from(r.keys).filter((k) => !k.startsWith("comments."))) })),
    { byAccount: true }
  );

  const splitAt = midpoint(reels);
  const watched = Array.from(
    new Set([...all.positive, ...all.negative, ...perAccount.flatMap((a) => a.stats.positive)].map((f) => f.key))
  ).filter((k) => !k.startsWith("comments.") && !k.includes(" + "));
  const time = splitAt ? overTime(reels, watched, splitAt).filter((t) => t.trend !== "steady") : [];

  return {
    accounts: perAccount,
    all,
    time: { splitAt, findings: time },
    reels: listed.sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0)),
  };
}

/** Claude writes the briefing from the counted findings and the winners' own descriptions. */
export async function writeBriefing(stats: AnalysisStats, summaries: Map<string, string>): Promise<AnalysisBriefing> {
  const parts: string[] = [];
  for (const a of stats.accounts) {
    const s = a.stats;
    parts.push(
      `## ${a.label} (${a.platform}) — ${s.winners} winners, ${s.losers} losers, ${s.controls} control`,
      patternLine(s),
      `Winner features:\n${s.positive.slice(0, 20).map((f) => `- ${fmt(f, "account")}`).join("\n") || "- none"}`,
      `Combinations:\n${s.combos.map((f) => `- ${fmt(f, "account")}`).join("\n") || "- none"}`,
      `Winners avoid:\n${s.negative.slice(0, 8).map((f) => `- ${fmt(f, "account")}`).join("\n") || "- none"}`,
      `Winners, as described:\n${stats.reels
        .filter((r) => r.accountId === a.id && r.cohort === "winner")
        .slice(0, 8)
        .map((r) => `- ${r.lift?.toFixed(1)}×: ${summaries.get(r.id) ?? r.summary}`)
        .join("\n")}`
    );
  }
  parts.push(
    `## All accounts — ${stats.all.winners} winners, ${stats.all.losers} losers, ${stats.all.controls} control`,
    patternLine(stats.all),
    `Winner features:\n${stats.all.positive.slice(0, 20).map((f) => `- ${fmt(f, "all")}`).join("\n") || "- none"}`,
    `Combinations:\n${stats.all.combos.map((f) => `- ${fmt(f, "all")}`).join("\n") || "- none"}`,
    `Winners avoid:\n${stats.all.negative.slice(0, 8).map((f) => `- ${fmt(f, "all")}`).join("\n") || "- none"}`,
    `## Over time (split at ${stats.time.splitAt?.slice(0, 10) ?? "n/a"}; gap = share of winners minus share of the rest)`,
    stats.time.findings
      .map((t) => `- ${describeKey(t.key)}: ${t.trend}, gap before ${t.before.gap.toFixed(2)} → recent ${t.recent.gap.toFixed(2)}`)
      .join("\n") || "- nothing changed clearly"
  );

  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    // The numbers are already decided; this only puts them into words, and has to fit one invocation.
    output_config: { effort: "medium", format: betaZodOutputFormat(Briefing) },
    system: SYSTEM,
    messages: [{ role: "user", content: parts.join("\n\n") }],
  }, { signal: AbortSignal.timeout(240_000) });
  if (response.stop_reason === "refusal") throw new Error("briefing refused");
  if (!response.parsed_output) throw new Error(`no briefing (stop: ${response.stop_reason})`);
  return response.parsed_output;
}

/** A richer line per winner for the briefing: hook and overlay with the summary. */
export async function winnerSummaries(supabase: Db, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data } = await supabase.from("reel_analyses").select("id, features, comment_read").in("id", ids);
  for (const r of data ?? []) {
    const f = r.features as unknown as ReelFeatures | null;
    if (!f) continue;
    const c = r.comment_read as unknown as CommentRead | null;
    out.set(
      r.id,
      [
        f.summary,
        `hook: ${f.hook.first_seconds}`,
        f.audio_text.overlay_text ? `text: "${f.audio_text.overlay_text}"` : null,
        c?.reacting_to.length ? `viewers react to: ${c.reacting_to.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    );
  }
  return out;
}
