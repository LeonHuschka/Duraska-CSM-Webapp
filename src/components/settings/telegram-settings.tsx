"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  Send,
  Link2,
  AlertTriangle,
  CheckCircle2,
  Activity,
  KeyRound,
  ShieldCheck,
  FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveTelegramConfig,
  registerWebhook,
  webhookStatus,
  testBotToken,
  auditEnv,
  simulatePipeline,
} from "@/app/(app)/settings/telegram/actions";
import type { TelegramConfigRow } from "@/app/(app)/settings/telegram/page";

export function TelegramSettings({
  config,
  openLinks,
  staleLinks,
  botConfigured,
  isOwner,
}: {
  config: TelegramConfigRow | null;
  openLinks: number;
  staleLinks: number;
  botConfigured: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [hooking, setHooking] = useState(false);
  const [checking, setChecking] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [sim, setSim] = useState<
    { step: string; ok: boolean; detail: string }[] | null
  >(null);
  const [env, setEnv] = useState<
    { name: string; ok: boolean; detail: string }[] | null
  >(null);
  const [f, setF] = useState({
    chat_id: config?.chat_id?.toString() ?? "",
    requests_thread_id: config?.requests_thread_id?.toString() ?? "",
    talk_thread_id: config?.talk_thread_id?.toString() ?? "",
    model_username: config?.model_username ?? "",
    va_username: config?.va_username ?? "",
    manager_username: config?.manager_username ?? "",
    posts_per_day: config?.posts_per_day ?? 2,
    min_ready_to_post: config?.min_ready_to_post ?? 6,
    min_open_links: config?.min_open_links ?? 10,
    max_unedited: config?.max_unedited ?? 15,
    weekly_reel_target: config?.weekly_reel_target?.toString() ?? "",
    screenshot_senders: (config?.screenshot_senders ?? []).join(", "),
  });

  const set = (k: keyof typeof f, v: string | number) =>
    setF((prev) => ({ ...prev, [k]: v }));

  async function handleSave() {
    setSaving(true);
    try {
      const res = await saveTelegramConfig({
        ...f,
        posts_per_day: Number(f.posts_per_day) || 2,
        min_ready_to_post: Number(f.min_ready_to_post) || 6,
        min_open_links: Number(f.min_open_links) || 10,
        max_unedited: Number(f.max_unedited) || 15,
      });
      if (res.error) toast.error(res.error);
      else {
        toast.success("Telegram settings saved");
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleTestToken() {
    setTesting(true);
    try {
      const res = await testBotToken();
      if (res.error) toast.error(res.error, { duration: 10000 });
      else toast.success(`Token OK — connected as @${res.username}`);
    } finally {
      setTesting(false);
    }
  }

  async function handleStatus() {
    setChecking(true);
    try {
      const res = await webhookStatus();
      if (res.error) {
        toast.error(res.error);
        setStatus(null);
      } else {
        setStatus(res.info ?? {});
      }
    } finally {
      setChecking(false);
    }
  }

  async function handleAudit() {
    setAuditing(true);
    try {
      const res = await auditEnv();
      setEnv(res.checks ?? null);
      const broken = (res.checks ?? []).filter((c) => !c.ok).length;
      if (broken === 0) toast.success("All secrets check out");
      else toast.error(`${broken} of ${res.checks?.length} secrets are wrong`);
    } finally {
      setAuditing(false);
    }
  }

  async function handleSimulate() {
    setSimulating(true);
    try {
      const res = await simulatePipeline();
      if (res.error) {
        toast.error(res.error, { duration: 10000 });
        setSim(null);
        return;
      }
      setSim(res.steps ?? null);
      const broken = (res.steps ?? []).filter((s) => !s.ok).length;
      if (broken === 0) toast.success("Pipeline works end to end");
      else toast.error(`${broken} step(s) failed`);
    } finally {
      setSimulating(false);
    }
  }

  async function handleWebhook() {
    setHooking(true);
    try {
      const res = await registerWebhook(window.location.origin);
      if (res.error) toast.error(res.error);
      else toast.success("Webhook registered");
    } finally {
      setHooking(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Status */}
      <div className="rounded-xl border border-border/50 bg-card p-4">
        <div className="flex items-center gap-2">
          {botConfigured ? (
            <CheckCircle2 className="h-4 w-4 text-green-400" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          )}
          <h2 className="text-sm font-medium">
            {botConfigured ? "Bot token configured" : "Bot token missing"}
          </h2>
        </div>
        {!botConfigured && (
          <p className="mt-1 text-xs text-muted-foreground">
            Set <code>TELEGRAM_BOT_TOKEN</code> and{" "}
            <code>TELEGRAM_WEBHOOK_SECRET</code> in the Vercel project env, then
            redeploy.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleWebhook}
            disabled={hooking || !botConfigured}
            className="gap-1.5"
          >
            {hooking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
            Register webhook
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleTestToken}
            disabled={testing || !botConfigured}
            className="gap-1.5"
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <KeyRound className="h-3.5 w-3.5" />
            )}
            Test token
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleStatus}
            disabled={checking || !botConfigured}
            className="gap-1.5"
          >
            {checking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Activity className="h-3.5 w-3.5" />
            )}
            Check status
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleAudit}
            disabled={auditing}
            className="gap-1.5"
          >
            {auditing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            Check secrets
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSimulate}
            disabled={simulating}
            className="gap-1.5"
          >
            {simulating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FlaskConical className="h-3.5 w-3.5" />
            )}
            Simulate
          </Button>
          <span className="text-xs text-muted-foreground">
            {openLinks} open inspo links tracked
            {staleLinks > 0 && (
              <span className="text-amber-400">
                {" "}· {staleLinks} untouched for 2+ weeks
              </span>
            )}
          </span>
        </div>

        {/* Every secret here is write-only once it's in the host. Without
            this, a pasted instruction line is indistinguishable from a key. */}
        {env && (
          <dl className="mt-3 space-y-1 rounded-lg bg-muted/30 p-3 text-[11px]">
            {env.map((c) => (
              <div key={c.name} className="flex items-start gap-2">
                {c.ok ? (
                  <CheckCircle2 className="mt-px h-3 w-3 shrink-0 text-green-400" />
                ) : (
                  <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-amber-400" />
                )}
                <code className="shrink-0 text-muted-foreground">{c.name}</code>
                <span className={c.ok ? "text-muted-foreground" : "text-amber-300"}>
                  {c.detail}
                </span>
              </div>
            ))}
          </dl>
        )}

        {/* A dry run through the real webhook. Nothing reaches the group:
            the synthetic message id matches no real message, so the
            reactions simply fail, and every row is deleted afterwards. */}
        {sim && (
          <ol className="mt-3 space-y-2 rounded-lg bg-muted/30 p-3 text-[11px]">
            {sim.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                {s.ok ? (
                  <CheckCircle2 className="mt-px h-3 w-3 shrink-0 text-green-400" />
                ) : (
                  <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-amber-400" />
                )}
                <div>
                  <div className="font-medium">{s.step}</div>
                  <div className="whitespace-pre-wrap text-muted-foreground">
                    {s.detail}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}

        {/* Telegram's own view of the webhook — the fastest way to see why
            nothing is arriving (wrong URL, no webhook, delivery errors). */}
        {status && (
          <dl className="mt-3 space-y-1 rounded-lg bg-muted/30 p-3 text-[11px]">
            <StatusRow
              label="Webhook URL"
              value={(status.url as string) || "— not registered —"}
              bad={!status.url}
            />
            <StatusRow
              label="Pending updates"
              value={String(status.pending_update_count ?? 0)}
            />
            {!!status.last_error_message && (
              <StatusRow
                label="Last error"
                value={String(status.last_error_message)}
                bad
              />
            )}
          </dl>
        )}
      </div>

      {/* How to find ids */}
      <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <Send className="h-3.5 w-3.5" /> Finding the IDs
        </h3>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
          <li>
            In BotFather: <code>/setprivacy</code> → pick the bot →{" "}
            <b>Disable</b>.
            <span className="block text-amber-400/90">
              Required. With privacy mode on (the default) the bot cannot see
              normal messages — it would never notice your Instagram links.
            </span>
          </li>
          <li>Add the bot to the group and make it an <b>admin</b> (it needs
            &quot;delete messages&quot; and reaction rights).</li>
          <li>Click <b>Register webhook</b> above.</li>
          <li>Send <code>/id</code> inside the <b>content requests</b> topic —
            the bot replies with the chat and topic ID.</li>
          <li>Do the same inside <b>TALK / INSTRUCTIONS</b> for that topic ID.</li>
          <li>Paste them below and save.</li>
        </ol>
        <p className="mt-3 text-[11px] font-medium">In the group</p>
        <ol className="mt-1 space-y-1 text-[11px] text-muted-foreground [&>li]:list-decimal [&>li]:ml-4">
          <li>
            Any reaction on an inspo link = <b>filmed</b>.
          </li>
          <li>
            💔 = <b>the post is gone</b>. The bot deletes the message and drops
            the link. This is the only way dead links get cleaned up right
            now: Instagram shows this server the same login wall for a live
            reel and a deleted one, so the automatic check is switched off.
          </li>
        </ol>
        <p className="mt-2 text-[11px] text-muted-foreground/70">
          If <code>/id</code> stays silent, hit <b>Check status</b> above — it
          shows Telegram&apos;s own view of the webhook and any delivery error.
        </p>
      </div>

      {/* Wiring */}
      <div className="space-y-4 rounded-xl border border-border/50 bg-card p-4">
        <h2 className="text-sm font-medium">Group wiring</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Chat ID" value={f.chat_id} onChange={(v) => set("chat_id", v)} placeholder="-100…" />
          <Field label="Requests topic ID" value={f.requests_thread_id} onChange={(v) => set("requests_thread_id", v)} placeholder="e.g. 12" />
          <Field label="Talk topic ID" value={f.talk_thread_id} onChange={(v) => set("talk_thread_id", v)} placeholder="e.g. 4" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Model @" value={f.model_username} onChange={(v) => set("model_username", v)} placeholder="username" />
          <Field label="VA @" value={f.va_username} onChange={(v) => set("va_username", v)} placeholder="username" />
          <Field label="Manager @" value={f.manager_username} onChange={(v) => set("manager_username", v)} placeholder="username" />
        </div>
      </div>

      {/* Who may submit screenshots */}
      <div className="rounded-xl border border-border/50 bg-card p-4">
        <h2 className="text-sm font-medium">Screenshot senders</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Only these @handles have their pictures read. Leave empty and every
          photo posted in a topic gets analysed, by anyone.
        </p>
        <Input
          value={f.screenshot_senders}
          onChange={(e) => set("screenshot_senders", e.target.value)}
          placeholder="lyza, another_va"
          disabled={saving}
          className="mt-3 h-10"
        />
      </div>

      {/* Weekly goal — owner only, it's what the model is measured against */}
      {isOwner && (
        <div className="space-y-3 rounded-xl border border-border/50 bg-card p-4">
          <div>
            <h2 className="text-sm font-medium">Model&apos;s weekly goal</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              How many reels she should shoot per week. Leave empty to derive it
              automatically from live accounts × posts per day × 7.
            </p>
          </div>
          <div className="sm:max-w-[200px]">
            <Field
              label="Reels per week"
              type="number"
              value={f.weekly_reel_target}
              onChange={(v) => set("weekly_reel_target", v)}
              placeholder="auto"
            />
          </div>
        </div>
      )}

      {/* Thresholds */}
      <div className="space-y-4 rounded-xl border border-border/50 bg-card p-4">
        <div>
          <h2 className="text-sm font-medium">Alert thresholds</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Checked twice a day. At most one alert per 12h so the group
            doesn&apos;t get spammed.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Posts / day" type="number" value={String(f.posts_per_day)} onChange={(v) => set("posts_per_day", v)} />
          <Field label="Min ready to post" type="number" value={String(f.min_ready_to_post)} onChange={(v) => set("min_ready_to_post", v)} />
          <Field label="Min open links" type="number" value={String(f.min_open_links)} onChange={(v) => set("min_open_links", v)} />
          <Field label="Max unedited" type="number" value={String(f.max_unedited)} onChange={(v) => set("max_unedited", v)} />
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Save settings
      </Button>
    </div>
  );
}

function StatusRow({
  label,
  value,
  bad = false,
}: {
  label: string;
  value: string;
  bad?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={`min-w-0 flex-1 break-all ${bad ? "text-red-400" : "text-foreground"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 text-sm"
      />
    </div>
  );
}
