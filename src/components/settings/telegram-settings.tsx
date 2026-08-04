"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send, Link2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveTelegramConfig,
  registerWebhook,
} from "@/app/(app)/settings/telegram/actions";
import type { TelegramConfigRow } from "@/app/(app)/settings/telegram/page";

export function TelegramSettings({
  config,
  openLinks,
  botConfigured,
}: {
  config: TelegramConfigRow | null;
  openLinks: number;
  botConfigured: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [hooking, setHooking] = useState(false);
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
          <span className="text-xs text-muted-foreground">
            {openLinks} open inspo links tracked
          </span>
        </div>
      </div>

      {/* How to find ids */}
      <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <Send className="h-3.5 w-3.5" /> Finding the IDs
        </h3>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
          <li>Add the bot to the group and make it an <b>admin</b> (it needs
            &quot;delete messages&quot; and reaction rights).</li>
          <li>Send <code>/id</code> inside the <b>content requests</b> topic —
            the bot replies with the chat and topic ID.</li>
          <li>Do the same inside <b>TALK / INSTRUCTIONS</b> for that topic ID.</li>
          <li>Paste them below and save.</li>
        </ol>
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
