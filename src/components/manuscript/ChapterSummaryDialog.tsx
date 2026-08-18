"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Square, Trash2 } from "lucide-react";
import { confirmDialog } from "@/components/confirm";
import Button from "@/components/ui/button";
import Dialog from "@/components/ui/dialog";
import Textarea from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { isManuscriptChapterSummaryStale } from "@/lib/manuscript";
import { streamSse } from "@/lib/ui";
import type { Manuscript, ManuscriptChapter } from "@/lib/types";

export function ChapterSummaryDialog({
  manuscript,
  chapter,
  open,
  onOpenChange,
  onSave,
}: {
  manuscript: Manuscript;
  chapter: ManuscriptChapter | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (chapterId: string, summary: string) => void;
}) {
  if (!open || !chapter) return null;
  return (
    <ChapterSummaryDialogInner
      key={chapter.id}
      manuscript={manuscript}
      chapter={chapter}
      onOpenChange={onOpenChange}
      onSave={onSave}
    />
  );
}

function ChapterSummaryDialogInner({
  manuscript,
  chapter,
  onOpenChange,
  onSave,
}: {
  manuscript: Manuscript;
  chapter: ManuscriptChapter;
  onOpenChange: (open: boolean) => void;
  onSave: (chapterId: string, summary: string) => void;
}) {
  const [draft, setDraft] = useState(chapter.summary);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  function changeOpen(next: boolean) {
    if (!next) abortRef.current?.abort();
    onOpenChange(next);
  }

  function save(summary = draft) {
    const value = summary.trim();
    onSave(chapter.id, value);
    setDraft(value);
  }

  async function generate() {
    if (busy) return;
    if (!chapter.content.trim()) {
      toast.warning("Add chapter content before generating a summary.");
      return;
    }
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy(true);
    setDraft("");
    let generated = "";
    try {
      await streamSse("/api/manuscripts/generate", {
        action: "chapter-summary",
        manuscript,
        chapterId: chapter.id,
      }, (event) => {
        if (event.type === "text") {
          generated += event.text;
          setDraft(generated);
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }, abort.signal);
      if (generated.trim()) save(generated);
      else if (!abort.signal.aborted) toast.error("The model returned an empty summary.");
    } catch (error) {
      if (!abort.signal.aborted) toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  async function deleteSummary() {
    if (busy || (!chapter.summary && !draft)) return;
    if (chapter.summary && !(await confirmDialog({
      title: "Delete chapter summary",
      message: `Delete the summary for “${chapter.title}”?`,
      confirmLabel: "Delete",
      danger: true,
    }))) return;
    onSave(chapter.id, "");
    setDraft("");
  }

  const stale = isManuscriptChapterSummaryStale(chapter);
  const changed = draft.trim() !== chapter.summary;

  return (
    <Dialog
      open
      onOpenChange={changeOpen}
      title={`Summary — ${chapter.title}`}
      description="Edit the summary directly or generate a new one from the current chapter content."
      size="lg"
      dismissable={!busy}
      footer={(
        <>
          <Button
            variant="danger"
            onClick={() => void deleteSummary()}
            disabled={busy || (!chapter.summary && !draft)}
          >
            <Trash2 /> Delete
          </Button>
          <span className="flex-1" />
          <Button variant="secondary" onClick={() => changeOpen(false)} disabled={busy}>Close</Button>
          <Button onClick={() => save()} disabled={busy || !changed}>Save summary</Button>
        </>
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        {chapter.summary ? (
          <span className={`rounded-full px-2 py-0.5 text-xs ${stale ? "bg-warning/15 text-warning" : "bg-success/15 text-success"}`}>
            {stale ? "Stale — chapter content has changed" : "Current"}
          </span>
        ) : (
          <span className="rounded-full bg-base-300 px-2 py-0.5 text-xs text-content-400">No summary</span>
        )}
        <span className="flex-1" />
        {busy ? (
          <Button variant="danger" size="sm" onClick={() => abortRef.current?.abort()}>
            <Square /> Stop
          </Button>
        ) : (
          <Button size="sm" onClick={() => void generate()} disabled={!chapter.content.trim()}>
            <Sparkles /> {chapter.summary ? "Regenerate" : "Generate"}
          </Button>
        )}
      </div>
      <Textarea
        className="min-h-72 w-full"
        value={draft}
        onChange={setDraft}
        disabled={busy}
        placeholder="No summary yet. Write one here or generate it from the chapter."
      />
    </Dialog>
  );
}
