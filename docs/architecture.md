# Architecture

## Domain Model

```
┌─────────────┐       ┌──────────────────┐       ┌─────────────────┐
│  auth.users  │──1:1──│  user_profiles   │──M:N──│    personas      │
│  (Supabase)  │       │  global_role     │       │  name, slug      │
└─────────────┘       └──────────────────┘       │  brand_color     │
                              │                   │  platforms (jsonb)│
                              │                   └────────┬─────────┘
                     ┌────────┴────────┐                   │
                     │ persona_members  │───────────────────┘
                     │ role per persona │
                     └─────────────────┘
                              │
         ┌────────────────────┼──────────────────────┐
         │                    │                      │
┌────────┴────────┐  ┌───────┴────────┐  ┌──────────┴──────────┐
│content_requests │  │ activity_log   │  │   schedule_slots    │
│ status, priority│  │ action, payload│  │ platform, caption   │
│ position (float)│  └────────────────┘  │ scheduled_for       │
└────────┬────────┘                      └──────────┬──────────┘
         │                                          │
┌────────┴────────┐                                 │
│ content_assets  │─────────────────────────────────┘
│ stage, file_path│
│ soft-delete     │
└─────────────────┘
```

## Automatic State Transitions

Content requests progress through statuses automatically based on data changes. **Transitions are forward-only** — they never roll a request back to an earlier status.

```
                                   Manual move allowed
                                   at any time (logged)
                                          │
  requested ──→ shooted ──→ edited ──→ scheduled ──→ posted
      │             │           │           │           │
      │   raw asset │  edited   │  slot     │  all      │
      │   uploaded  │  asset    │  created  │  slots    │
      │             │  uploaded │           │  posted   │
      │             │           │           │           │
      └─────────────┘───────────┘           │           │
          Trigger:                          │           │
          on_asset_insert                   │           │
                                 Trigger:   │           │
                                 on_slot_insert         │
                                            Trigger:    │
                                            on_slot_update
```

### Rules

| Event | Condition | Action |
|-------|-----------|--------|
| Asset uploaded (stage=raw) | Request status = "requested" | Set status → "shooted" |
| Asset uploaded (stage=edited) | Request status in ("requested", "shooted") | Set status → "edited" |
| Schedule slot created | Request status in ("requested", "shooted", "edited") | Set status → "scheduled" |
| Slot marked "posted" | ALL slots for this request are "posted" | Set status → "posted" |

### What doesn't trigger transitions

- Uploading a "final" stage asset does not change status
- Manual status changes by users are not overridden
- "archived" status is never touched by triggers

## Permission Model

### Two-level role system

1. **Global role** (`user_profiles.global_role`): Applies across the entire app
   - `owner`: Bypasses all RLS. Can create personas, see everything.
   - `manager`, `model`, `va`: Only access personas they're members of.

2. **Persona role** (`persona_members.role`): Applies within a specific persona
   - `owner`: Manage persona settings and members
   - `manager`: Full content access, no settings access
   - `model`: Upload assets, view requests
   - `va`: Create/edit requests, no delete permissions

### RLS implementation

Three `SECURITY DEFINER` helper functions avoid recursive policy checks:
- `is_owner()` — checks global owner status
- `is_persona_member(persona_id, role?)` — checks membership
- `get_persona_role(persona_id)` — returns the user's role in a persona

Every table uses these functions in its RLS policies.

## Storage

- Bucket: `content-assets` (private)
- Path convention: `personas/{persona_id}/requests/{request_id}/{stage}/{uuid}_{filename}`
- RLS on `storage.objects` parses `persona_id` from the file path
- Files are soft-deleted (`deleted_at` column on `content_assets`)
- Downloads use signed URLs with 1-hour expiry
