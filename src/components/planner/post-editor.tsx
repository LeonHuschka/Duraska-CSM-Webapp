"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowUpRight, FlaskConical, Loader2, RotateCcw, Send, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { deletePost, postNow, schedulePost, updatePost } from "@/app/(app)/planner/[accountId]/actions";
import type { PlannerCut, PlannerPost } from "@/components/planner/planner-view";
import { dayKey, hhmm, stateOf, STATE_META } from "@/components/planner/planner-utils";

export type EditorTarget =
  | { mode: "new"; cut: PlannerCut; at: Date }
  | { mode: "edit"; post: PlannerPost };

const MAX_CAPTION = 2200;
const MAX_TAGS = 30;

/**
 * One post: the cut playing on the left, when and with what caption on
 * the right. New posts are scheduled from here, planned ones changed,
 * moved, posted right away or taken out.
 */
export function PostEditor({
  accountId,
  target,
  lastCaption,
  canPublish,
  onClose,
  onChanged,
}: {
  accountId: string;
  target: EditorTarget | null;
  lastCaption: string | null;
  canPublish: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [caption, setCaption] = useState("");
  const [trial, setTrial] = useState(false);
  const [feed, setFeed] = useState(true);
  const [busy, start] = useTransition();
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (!target) return;
    const at = target.mode === "new" ? target.at : new Date(target.post.at);
    setDate(dayKey(at));
    setTime(hhmm(at));
    setCaption(target.mode === "edit" ? target.post.caption : "");
    setTrial(target.mode === "edit" ? target.post.trialReel : false);
    setFeed(target.mode === "edit" ? target.post.shareToFeed : true);
    setPublishing(false);
  }, [target]);

  if (!target) return null;
  const post = target.mode === "edit" ? target.post : null;
  const state = post ? stateOf(post) : null;
  const locked = !!post && (state === "posted" || state === "manual" || state === "publishing");
  const video = target.mode === "new" ? target.cut.video : target.post.video;
  const thumb = target.mode === "new" ? target.cut.thumb : target.post.thumb;
  const title = target.mode === "new" ? target.cut.title : target.post.title;
  const variant = target.mode === "new" ? target.cut.variant : target.post.variant;
  const tags = caption.match(/#[^\s#]+/g)?.length ?? 0;
  const when = new Date(`${date}T${time || "00:00"}`);
  const past = when.getTime() < Date.now() - 60_000;
  const tooLong = caption.length > MAX_CAPTION || tags > MAX_TAGS;

  const save = (thenPost: boolean) =>
    start(async () => {
      if (!thenPost && past) return void toast.error("That time has passed — pick a later one or post now");
      const fields = {
        scheduledFor: (thenPost ? new Date() : when).toISOString(),
        caption,
        trialReel: trial,
        shareToFeed: feed,
      };
      let id = post?.id ?? null;
      if (target.mode === "new") {
        const res = await schedulePost({ accountId, assetId: target.cut.id, ...fields });
        if (res.error) return void toast.error(res.error);
        id = res.id ?? null;
      } else {
        const res = await updatePost(target.post.id, fields);
        if (res.error) return void toast.error(res.error);
      }
      if (thenPost && id) {
        setPublishing(true);
        const res = await postNow(id);
        setPublishing(false);
        if (res.error) toast.error(`Not posted: ${res.error}`);
        else if (res.state === "processing") toast.success("Instagram is still processing it — it goes live within minutes");
        else toast.success("Posted 🎉");
      } else {
        toast.success(target.mode === "new" ? `Scheduled for ${when.toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "Saved");
      }
      onChanged();
      onClose();
    });

  const remove = () =>
    start(async () => {
      if (!post) return;
      const res = await deletePost(post.id);
      if (res.error) return void toast.error(res.error);
      toast.success("Taken out of the plan");
      onChanged();
      onClose();
    });

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-3xl gap-0 p-0">
        <DialogHeader className="border-b border-border/50 px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            {title}
            {variant && <span className="text-xs font-normal text-muted-foreground">cut {variant}</span>}
            {state && (
              <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATE_META[state].chip}`}>
                {STATE_META[state].label}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 p-5 sm:grid-cols-[220px_1fr]">
          <div className="mx-auto w-[220px]">
            {video ? (
              <video
                key={video}
                src={video}
                poster={thumb ?? undefined}
                controls
                playsInline
                preload="metadata"
                className="aspect-[9/16] w-full rounded-xl border border-border/50 bg-black object-cover"
              />
            ) : (
              <div className="flex aspect-[9/16] w-full items-center justify-center rounded-xl border border-border/50 bg-muted/20 text-xs text-muted-foreground">
                Video gone
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            {post?.publishError && state === "failed" && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                <p className="font-semibold">Instagram did not take it</p>
                <p className="mt-0.5 opacity-90">{post.publishError}</p>
                <p className="mt-1 opacity-70">Change anything and save, or retry as it is — it goes back in the queue.</p>
              </div>
            )}
            {post?.postUrl && (
              <a
                href={post.postUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/20"
              >
                Open on Instagram <ArrowUpRight className="h-3 w-3" />
              </a>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Day</span>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={locked} className="h-9" />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Time</span>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={locked} className="h-9" />
              </label>
            </div>

            <label className="space-y-1">
              <span className="flex items-baseline justify-between text-[11px] font-medium text-muted-foreground">
                Caption
                <span className={tooLong ? "text-rose-400" : ""}>
                  {caption.length}/{MAX_CAPTION} · {tags}/{MAX_TAGS} #
                </span>
              </span>
              <Textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                disabled={locked}
                rows={7}
                placeholder="Write the caption — hashtags at the end"
                className="resize-none text-sm"
              />
              {!locked && lastCaption && !caption && (
                <button
                  type="button"
                  onClick={() => setCaption(lastCaption)}
                  className="text-[11px] text-primary hover:underline"
                >
                  Use the last caption
                </button>
              )}
            </label>

            <div className="space-y-2">
              <Toggle
                on={trial}
                set={setTrial}
                disabled={locked}
                label={
                  <>
                    <FlaskConical className="h-3.5 w-3.5" /> Trial reel
                  </>
                }
                hint="Shown to non-followers first; joins the profile by itself when it does well."
              />
              <Toggle
                on={feed}
                set={setFeed}
                disabled={locked}
                label="Show in the profile grid"
                hint="Off: only in the Reels tab."
              />
            </div>

            {!locked && (
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                {post && (
                  <Button variant="ghost" size="sm" onClick={remove} disabled={busy} className="text-rose-400 hover:text-rose-300">
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
                  </Button>
                )}
                <div className="ml-auto flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => save(true)}
                    disabled={busy || tooLong || !canPublish || !video}
                    title={canPublish ? "Publish right away" : "Connect Instagram first"}
                  >
                    {publishing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                    {publishing ? "Posting… (up to 2 min)" : "Post now"}
                  </Button>
                  <Button size="sm" onClick={() => save(false)} disabled={busy || tooLong || !date || !time}>
                    {busy && !publishing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    {state === "failed" ? (
                      <>
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Retry
                      </>
                    ) : target.mode === "new" ? (
                      "Schedule"
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Toggle({
  on,
  set,
  label,
  hint,
  disabled,
}: {
  on: boolean;
  set: (v: boolean) => void;
  label: React.ReactNode;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => set(!on)}
      className="flex w-full items-start gap-3 rounded-lg border border-border/50 px-3 py-2 text-left transition-colors hover:bg-muted/30 disabled:opacity-60"
    >
      <span
        className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors ${on ? "bg-primary" : "bg-muted"}`}
      >
        <span className={`h-3 w-3 rounded-full bg-white transition-transform ${on ? "translate-x-3" : ""}`} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-xs font-medium">{label}</span>
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}
