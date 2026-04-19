# Content Hub

Self-hosted content management webapp for scheduling social media content across AI-generated personas.

## Tech Stack

- **Framework:** Next.js 14 (App Router, TypeScript)
- **Styling:** Tailwind CSS + shadcn/ui
- **Backend:** Supabase (Postgres, Auth, Storage)
- **Forms:** react-hook-form + zod

## Local Setup

### Prerequisites

- [Bun](https://bun.sh) or Node.js 18+
- [Supabase CLI](https://supabase.com/docs/guides/cli)

### 1. Clone and install

```bash
cd content-hub
bun install
```

### 2. Start Supabase locally

```bash
supabase start
```

This outputs your local Supabase URL and anon key.

### 3. Configure environment

```bash
cp .env.local.example .env.local
```

Edit `.env.local` with your Supabase URL and anon key from step 2.

### 4. Apply migrations and seed data

```bash
supabase db reset
```

This applies all migrations in `supabase/migrations/` and runs `supabase/seed.sql`.

**Demo credentials:** `owner@demo.local` / `password123`

### 5. Start the dev server

```bash
bun run dev
```

Visit [http://localhost:3000](http://localhost:3000).

### 6. Promote your first real user to owner

After signing up via the UI, run in the Supabase SQL Editor:

```sql
UPDATE public.user_profiles SET global_role = 'owner' WHERE id = '<your-user-id>';
```

## Deploy to Vercel

1. Push to a Git repo
2. Import in Vercel
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as environment variables
4. Deploy

## Adding a New Persona

1. Log in as a global owner
2. Navigate to the Dashboard
3. Click "Create Persona" (or go to Settings > Personas)
4. Fill in name, slug, brand color
5. The creator is automatically added as the persona owner

## Permission Model

### Global roles (in `user_profiles.global_role`)

- **owner** — bypasses all RLS checks, can create personas, manage everything
- **manager / model / va** — only access personas they're members of

### Persona roles (in `persona_members.role`)

- **owner** — full access to persona settings, can manage members
- **manager** — can manage content, cannot change persona settings
- **model** — can upload assets and view requests
- **va** — can create/edit requests, cannot delete

### How permissions work

Row Level Security (RLS) on every table. Helper functions `is_owner()`, `is_persona_member()`, and `get_persona_role()` run as `security definer` to avoid recursive RLS. The persona switcher stores the active persona ID in a cookie, and all queries are scoped to that persona.

## Project Structure

```
src/
├── app/
│   ├── (auth)/          # Login, signup, email confirmation
│   ├── (app)/           # Protected app (dashboard, settings)
│   └── layout.tsx       # Root layout with font + toaster
├── components/
│   ├── ui/              # shadcn/ui components
│   ├── auth/            # Login/signup forms
│   ├── layout/          # Sidebar, top bar, persona switcher
│   └── personas/        # Persona settings, members, dialogs
├── hooks/               # React context (persona provider)
├── lib/
│   ├── supabase/        # Client factories (browser, server, middleware)
│   ├── types/           # Database types
│   ├── validations/     # Zod schemas
│   ├── constants.ts     # Shared constants
│   └── utils.ts         # Utility functions
└── middleware.ts         # Auth middleware
supabase/
├── migrations/          # SQL migrations (applied in order)
└── seed.sql             # Demo data
```
