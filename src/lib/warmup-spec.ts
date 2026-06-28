/**
 * Warm-up content spec.
 *
 * Encodes the day-by-day plan for warming up a new social account so the
 * platform treats it as a real, organically-growing person before it gets
 * pushed into the "great pond" (normal posting rotation).
 *
 * Source spec (Facebook / Instagram, SFW persona, US target):
 *   Day 1            — account creation only, no content
 *   Day 2            — 1 profile photo + 1 banner + 1 bio
 *   Days 3–5         — 1 feed photo/day + 3 stories/day, 0 reels
 *   Day 6+           — keep feed + stories, ramp reels:
 *                       Day 6: 1 reel, +1 every 2 days, until 10 reels/day,
 *                       then hold at 10 (steady state = graduation).
 *
 * The ramp reaches 10 reels/day on day 24, which we treat as the end of
 * the warm-up window — at that point the account has "proven itself" and
 * can graduate.
 */

export type AssetKind =
  | "profile_photo"
  | "banner"
  | "bio"
  | "feed_photo"
  | "story"
  | "reel";

export type WarmupPlatform = "facebook" | "instagram";

export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  profile_photo: "Profile Photo",
  banner: "Banner / Cover",
  bio: "Bio Text",
  feed_photo: "Feed Photo",
  story: "Story",
  reel: "Reel",
};

export const ASSET_KIND_EMOJI: Record<AssetKind, string> = {
  profile_photo: "🧑",
  banner: "🖼️",
  bio: "✍️",
  feed_photo: "📷",
  story: "📱",
  reel: "🎬",
};

// How many days the warm-up plan spans (ramp reaches 10 reels on day 24).
export const WARMUP_DURATION_DAYS = 24;

// Stories per day during the daily-content phase.
const STORIES_PER_DAY = 3;

/** Reels target for a given day number (1-based). 0 before day 6. */
export function reelsForDay(day: number): number {
  if (day < 6) return 0;
  // +1 every 2 days starting at day 6 (=1), capped at 10.
  const n = Math.floor((day - 6) / 2) + 1;
  return Math.min(n, 10);
}

export interface PlannedSlot {
  day_number: number;
  position: number;
  asset_kind: AssetKind;
  /** Hint text shown to the model for this slot (caption guidance, etc.) */
  notes?: string;
}

/**
 * Generate the full ordered slot list for an account's warm-up.
 * Platform is accepted so FB / IG can diverge later; cadence is currently
 * identical for both.
 */
export function generateWarmupSlots(
  platform: WarmupPlatform
): PlannedSlot[] {
  void platform; // FB / IG cadence is currently identical; param kept for future divergence
  const slots: PlannedSlot[] = [];

  for (let day = 1; day <= WARMUP_DURATION_DAYS; day++) {
    let pos = 0;
    const push = (kind: AssetKind, notes?: string) =>
      slots.push({ day_number: day, position: pos++, asset_kind: kind, notes });

    if (day === 1) {
      // Account creation only — no content. (No slots; the day still shows
      // up in the UI as an instruction card.)
      continue;
    }

    if (day === 2) {
      push("profile_photo", "Face-visible. Clear, friendly, natural.");
      push("banner", "Cover image — lifestyle/aesthetic, no text overlays.");
      push("bio", "Short, natural, NO links during week 1.");
      continue;
    }

    // Day 3+: daily feed photo + stories
    push(
      "feed_photo",
      day < 8
        ? "Casual. 1 short hook line. No links. Optionally 1 question to drive comments."
        : "Casual hook line. Soft CTA ('link in bio') allowed from week 2+."
    );

    for (let s = 0; s < STORIES_PER_DAY; s++) {
      push("story", "Casual in-the-moment vibe. 2–3/day is fine.");
    }

    // Day 6+: reels ramp
    const reels = reelsForDay(day);
    for (let r = 0; r < reels; r++) {
      push(
        "reel",
        "Visually distinct — vary outfit/angle/scene. No identical reposts."
      );
    }
  }

  return slots;
}

/** Human-readable phase label for a day, for the planner UI. */
export function phaseForDay(day: number): string {
  if (day === 1) return "Account creation";
  if (day === 2) return "Profile setup";
  if (day >= 3 && day <= 5) return "Daily photos";
  return "Reel ramp-up";
}

/** Daily target summary string, e.g. "1 feed · 3 stories · 2 reels". */
export function dailyTargetSummary(day: number): string {
  if (day === 1) return "Account creation only — no content";
  if (day === 2) return "Profile photo · Banner · Bio";
  const reels = reelsForDay(day);
  const parts = ["1 feed", `${STORIES_PER_DAY} stories`];
  if (reels > 0) parts.push(`${reels} reel${reels > 1 ? "s" : ""}`);
  return parts.join(" · ");
}
