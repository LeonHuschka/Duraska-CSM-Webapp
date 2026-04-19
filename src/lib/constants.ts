export const ACTIVE_PERSONA_COOKIE = "active_persona_id";

export const PLATFORMS = ["instagram", "fansly", "tiktok", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const GLOBAL_ROLES = ["owner", "manager", "model", "va"] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const PERSONA_ROLES = ["owner", "manager", "model", "va"] as const;
export type PersonaRole = (typeof PERSONA_ROLES)[number];

export const REQUEST_STATUSES = [
  "requested",
  "shooted",
  "edited",
  "scheduled",
  "posted",
  "archived",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const ASSET_STAGES = ["raw", "edited", "final"] as const;
export type AssetStage = (typeof ASSET_STAGES)[number];

export const PRIORITIES = ["low", "normal", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const SLOT_STATUSES = ["planned", "ready", "posted", "failed"] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];
