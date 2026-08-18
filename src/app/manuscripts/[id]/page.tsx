"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  BookOpenText,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  MessagesSquare,
  Plus,
  Settings2,
  Trash2,
  Users,
} from "lucide-react";
import { Field } from "@/components/app";
import { ModelPicker } from "@/components/ModelPicker";
import {
  ManuscriptAssistant,
  type CharacterDesignUpdate,
  type ManuscriptAssistantActivity,
  type ManuscriptQuote,
  type SettingsAssistantUpdate,
} from "@/components/manuscript/ManuscriptAssistant";
import { ManuscriptChatsPanel } from "@/components/manuscript/ManuscriptChatsPanel";
import Button from "@/components/ui/button";
import Collapsible from "@/components/ui/collapsible";
import Input from "@/components/ui/input";
import Select from "@/components/ui/select";
import Textarea from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { confirmDialog } from "@/components/confirm";
import { confirmNavigation, registerNavigationGuard } from "@/lib/navigationGuard";
import { useGet, useInvalidate } from "@/lib/queries";
import { api, timestamp } from "@/lib/ui";
import { emptyManuscript, MANUSCRIPT_PERSPECTIVE_LABELS, normalizeManuscriptChapter, normalizeManuscriptCharacter } from "@/lib/manuscript";
import type { Manuscript, ManuscriptAssistantScope, ManuscriptConversation, ManuscriptPerspective, ManuscriptSession } from "@/lib/types";
import { countWords } from "@/lib/wordCount";

type EditorTab = ManuscriptAssistantScope;
type AutoSaveState = "pristine" | "pending" | "saving" | "saved" | "error";

function manuscriptSnapshot(manuscript: Manuscript): string {
  return JSON.stringify({
    name: manuscript.name,
    synopsis: manuscript.synopsis,
    perspective: manuscript.perspective,
    style: manuscript.style,
    modelId: manuscript.modelId,
    assistantIncludeActiveChapter: manuscript.assistantIncludeActiveChapter,
    chapters: manuscript.chapters,
    characters: manuscript.characters,
    sessions: manuscript.sessions,
    conversations: manuscript.conversations,
    tags: manuscript.tags,
  });
}

export default function ManuscriptEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const invalidate = useInvalidate();
  const isNew = id === "new";
  const { data } = useGet<Manuscript>(`/api/manuscripts/${id}`, { enabled: !isNew });
  const [form, setForm] = useState<Manuscript | null>(null);
  const formRef = useRef<Manuscript | null>(null);
  const [tab, setTab] = useState<EditorTab>("manuscript");
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [quote, setQuote] = useState<ManuscriptQuote | null>(null);
  const [rightPanel, setRightPanel] = useState<"assistant" | "chats" | null>("assistant");
  const [saveState, setSaveState] = useState<AutoSaveState>("pristine");
  const lastSavedSnapshotRef = useRef<string | null>(null);
  const createdIdRef = useRef<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const assistantActivityRef = useRef<ManuscriptAssistantActivity | null>(null);
  const mountedRef = useRef(true);
  const reduceMotion = useReducedMotion();
  const undoRef = useRef<Manuscript[]>([]);
  const redoRef = useRef<Manuscript[]>([]);
  const aiPreviewActiveRef = useRef(false);
  const aiPreviewBaselineRef = useRef<Manuscript | null>(null);
  const aiPreviewCreatedIdsRef = useRef<string[]>([]);
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const hasUnsavedManuscript = () => {
      const current = formRef.current;
      return current !== null && (
        !createdIdRef.current
        || lastSavedSnapshotRef.current !== manuscriptSnapshot(current)
      );
    };

    const unregister = registerNavigationGuard(async () => {
      if (!hasUnsavedManuscript()) return true;
      return confirmDialog({
        title: "Leave without saving?",
        message: "This manuscript is not saved yet. If you leave now, your latest changes may be lost.",
        confirmLabel: "Leave",
        danger: true,
      });
    });

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedManuscript()) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      unregister();
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    if (isNew) {
      if (formRef.current) return;
      const blank = emptyManuscript();
      const t = blank.chapters[0].createdAt;
      const draft: Manuscript = { id: "", ...blank, createdAt: t, updatedAt: t };
      formRef.current = draft;
      lastSavedSnapshotRef.current = manuscriptSnapshot(draft);
      createdIdRef.current = null;
      setSaveState("pristine");
      setForm(draft);
      return;
    }
    if (!data) return;

    const current = formRef.current;
    if (current) {
      const baseline = lastSavedSnapshotRef.current;
      const hasLocalChanges = baseline !== null && manuscriptSnapshot(current) !== baseline;
      if (hasLocalChanges || data.updatedAt <= current.updatedAt) return;
    }

    formRef.current = data;
    lastSavedSnapshotRef.current = manuscriptSnapshot(data);
    createdIdRef.current = data.id;
    setSaveState("saved");
    setForm(data);
  }, [data, isNew]);

  useEffect(() => {
    if (!form) return;
    // Structured assistant fields render as an in-memory preview while the JSON
    // block streams. Persist only after the final validated payload is committed.
    if (aiPreviewActiveRef.current) return;
    const snapshot = manuscriptSnapshot(form);

    if (lastSavedSnapshotRef.current === null) {
      lastSavedSnapshotRef.current = snapshot;
      createdIdRef.current = form.id || null;
      setSaveState(form.id ? "saved" : "pristine");
      return;
    }
    if (snapshot === lastSavedSnapshotRef.current) {
      setSaveState(createdIdRef.current ? "saved" : "pristine");
      return;
    }

    setSaveState("pending");
    const timer = window.setTimeout(() => {
      const draft = structuredClone(form);
      const requestedSnapshot = manuscriptSnapshot(draft);

      saveQueueRef.current = saveQueueRef.current.then(async () => {
        setSaveState("saving");
        const existingId = draft.id || createdIdRef.current;
        const payload = existingId ? { ...draft, id: existingId } : draft;
        try {
          const saved = existingId
            ? await api.put<Manuscript>(`/api/manuscripts/${existingId}`, payload)
            : await api.post<Manuscript>("/api/manuscripts", payload);
          if (!mountedRef.current) return;
          const savedSnapshot = manuscriptSnapshot(saved);
          lastSavedSnapshotRef.current = savedSnapshot;
          createdIdRef.current = saved.id;
          queryClient.setQueryData([`/api/manuscripts/${saved.id}`], saved);

          setForm((current) => {
            if (!current) return current;
            const currentWithIdentity = current.id ? current : {
              ...current,
              id: saved.id,
              createdAt: saved.createdAt,
              updatedAt: saved.updatedAt,
            };
            if (manuscriptSnapshot(currentWithIdentity) === requestedSnapshot) {
              formRef.current = saved;
              return saved;
            }
            formRef.current = currentWithIdentity;
            return currentWithIdentity;
          });

          if (!existingId) router.replace(`/manuscripts/${saved.id}`);
          void invalidate("/api/manuscripts");
          setSaveState(manuscriptSnapshot(formRef.current ?? saved) === savedSnapshot ? "saved" : "pending");
        } catch (error) {
          setSaveState("error");
          toast.error(error instanceof Error ? error.message : String(error));
        }
      });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [form, invalidate, isNew, queryClient, router]);

  if (!form) return <div className="p-8 text-content-300">Loading…</div>;
  const currentForm = form;

  const activeChapter = currentForm.chapters.find((c) => c.id === activeChapterId) ?? currentForm.chapters[0];
  if (activeChapter && activeChapterId !== activeChapter.id) setActiveChapterId(activeChapter.id);

  const patch = (partial: Partial<Manuscript>) => setForm((current) => {
    if (!current) return current;
    const next = { ...current, ...partial };
    formRef.current = next;
    return next;
  });
  const commitAi = (next: Manuscript, previous: Manuscript) => {
    undoRef.current.push(structuredClone(previous));
    redoRef.current = [];
    formRef.current = next;
    setForm(next);
    setHistoryState({ undo: undoRef.current.length, redo: 0 });
  };

  function structuredAiNext(
    previous: Manuscript,
    action: "settings" | "character",
    value: SettingsAssistantUpdate | CharacterDesignUpdate[],
    createdIds?: string[]
  ): Manuscript | null {
    const next = structuredClone(previous);
    if (action === "settings" && !Array.isArray(value)) {
      if (typeof value.synopsis === "string") next.synopsis = value.synopsis;
      if (typeof value.style === "string") next.style = value.style;
      return next;
    }
    if (action !== "character" || !Array.isArray(value)) return null;
    const missingUpdate = value.find(
      (update) => update.characterId
        && !next.characters.some((character) => character.id === update.characterId)
    );
    if (missingUpdate) return null;
    let createIndex = 0;
    for (const update of value) {
      const index = update.characterId
        ? next.characters.findIndex((character) => character.id === update.characterId)
        : -1;
      if (index >= 0) {
        const existing = next.characters[index];
        next.characters[index] = normalizeManuscriptCharacter({ ...existing, ...update.character, id: existing.id });
      } else {
        const generated = normalizeManuscriptCharacter({
          ...update.character,
          id: createdIds?.[createIndex],
        });
        if (createdIds && !createdIds[createIndex]) createdIds[createIndex] = generated.id;
        next.characters.push(generated);
        createIndex++;
      }
    }
    return next;
  }

  function previewStructuredAi(
    action: "settings" | "character",
    value: SettingsAssistantUpdate | CharacterDesignUpdate[]
  ) {
    const current = formRef.current ?? currentForm;
    if (!aiPreviewBaselineRef.current) {
      aiPreviewBaselineRef.current = structuredClone(current);
      aiPreviewCreatedIdsRef.current = [];
      aiPreviewActiveRef.current = true;
    }
    const next = structuredAiNext(
      aiPreviewBaselineRef.current,
      action,
      value,
      aiPreviewCreatedIdsRef.current
    );
    if (!next) return false;
    formRef.current = next;
    setForm(next);
    return true;
  }

  function commitStructuredAiPreview() {
    const baseline = aiPreviewBaselineRef.current;
    const current = formRef.current;
    aiPreviewBaselineRef.current = null;
    aiPreviewCreatedIdsRef.current = [];
    aiPreviewActiveRef.current = false;
    if (!baseline || !current || manuscriptSnapshot(baseline) === manuscriptSnapshot(current)) return;
    const baselineWithIdentity = !baseline.id && current.id
      ? { ...baseline, id: current.id, createdAt: current.createdAt, updatedAt: current.updatedAt }
      : baseline;
    undoRef.current.push(structuredClone(baselineWithIdentity));
    redoRef.current = [];
    setHistoryState({ undo: undoRef.current.length, redo: 0 });
    // A fresh object retriggers autosave now that preview suppression is lifted.
    setForm({ ...current });
  }

  function discardStructuredAiPreview() {
    const baseline = aiPreviewBaselineRef.current;
    const current = formRef.current;
    aiPreviewBaselineRef.current = null;
    aiPreviewCreatedIdsRef.current = [];
    aiPreviewActiveRef.current = false;
    if (!baseline) return;
    const baselineWithIdentity = !baseline.id && current?.id
      ? { ...baseline, id: current.id, createdAt: current.createdAt, updatedAt: current.updatedAt }
      : baseline;
    formRef.current = baselineWithIdentity;
    setForm(baselineWithIdentity);
  }

  function applyAi(
    action: "continue" | "rewrite" | "settings" | "character",
    value: string | SettingsAssistantUpdate | CharacterDesignUpdate[],
    selected?: ManuscriptQuote | null
  ) {
    const previous = formRef.current ?? currentForm;
    const next = structuredClone(previous);
    const targetChapter = next.chapters.find((chapter) => chapter.id === activeChapter?.id) ?? next.chapters[0];
    if (action === "continue" && targetChapter && typeof value === "string") {
      next.chapters = next.chapters.map((c) => c.id === targetChapter.id ? {
        ...c,
        content: `${c.content}${c.content && !c.content.endsWith("\n") ? "\n\n" : ""}${value}`,
        updatedAt: Date.now(),
      } : c);
    } else if (action === "rewrite" && targetChapter && typeof value === "string" && selected) {
      const chapter = next.chapters.find((c) => c.id === targetChapter.id)!;
      let { start, end } = selected;
      if (chapter.content.slice(start, end) !== selected.text) {
        start = chapter.content.indexOf(selected.text);
        end = start < 0 ? -1 : start + selected.text.length;
      }
      if (start < 0 || end < 0) return toast.error("The selected text changed before the rewrite finished.");
      chapter.content = chapter.content.slice(0, start) + value + chapter.content.slice(end);
      chapter.updatedAt = timestamp();
    } else if ((action === "settings" || action === "character") && typeof value === "object") {
      const structured = structuredAiNext(
        previous,
        action,
        value as SettingsAssistantUpdate | CharacterDesignUpdate[]
      );
      if (!structured) return toast.error("The manuscript changed before the assistant finished. No assistant changes were applied.");
      commitAi(structured, previous);
      return;
    } else return;
    commitAi(next, previous);
  }

  const undo = () => {
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current.push(structuredClone(formRef.current ?? currentForm));
    formRef.current = previous;
    setForm(previous);
    setHistoryState({ undo: undoRef.current.length, redo: redoRef.current.length });
  };
  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(structuredClone(formRef.current ?? currentForm));
    formRef.current = next;
    setForm(next);
    setHistoryState({ undo: undoRef.current.length, redo: redoRef.current.length });
  };

  const saveSessions = async (sessions: ManuscriptSession[]) => {
    const next = { ...(formRef.current ?? currentForm), sessions };
    formRef.current = next;
    setForm(next);
  };

  const saveConversation = (conversation: ManuscriptConversation, create = false) => {
    setForm((current) => {
      if (!current) return current;
      const exists = current.conversations.some((item) => item.id === conversation.id);
      if (!exists && !create) return current;
      const conversations = exists
        ? current.conversations.map((item) => item.id === conversation.id ? conversation : item)
        : [...current.conversations, conversation];
      const next = { ...current, conversations };
      formRef.current = next;
      return next;
    });
  };

  const navigateAway = async (href: string) => {
    if (await confirmNavigation()) router.push(href);
  };

  const confirmAssistantTransition = async (destination: "tabs" | "chapters" | "panels") => {
    const activity = assistantActivityRef.current;
    if (!activity) return true;
    const confirmed = await confirmDialog({
      title: "Assistant is still working",
      message: `Switching ${destination} will stop the current response. The unfinished response won’t be applied.`,
      confirmLabel: "Stop and switch",
      danger: true,
    });
    if (!confirmed) return false;
    await activity.stop();
    return true;
  };

  const switchTab = async (nextTab: EditorTab) => {
    if (nextTab === tab || !(await confirmAssistantTransition("tabs"))) return;
    setTab(nextTab);
  };

  const switchChapter = async (chapterId: string) => {
    if (chapterId === activeChapter?.id || !(await confirmAssistantTransition("chapters"))) return;
    setActiveChapterId(chapterId);
    setQuote(null);
  };

  const switchRightPanel = async (nextPanel: "assistant" | "chats" | null) => {
    if (
      nextPanel === rightPanel
      || (rightPanel === "assistant" && !(await confirmAssistantTransition("panels")))
    ) return;
    setRightPanel(nextPanel);
  };

  const addChapter = async () => {
    if (!(await confirmAssistantTransition("chapters"))) return;
    const chapter = normalizeManuscriptChapter({ title: `Chapter ${form.chapters.length + 1}` });
    patch({ chapters: [...form.chapters, chapter] });
    setActiveChapterId(chapter.id);
    setQuote(null);
  };

  const removeChapter = async (chapterId: string) => {
    if (form.chapters.length === 1) return toast.warning("A manuscript needs at least one chapter.");
    const chapter = form.chapters.find((c) => c.id === chapterId);
    if (!(await confirmDialog({ title: "Delete chapter", message: `Delete “${chapter?.title}” and all its content?`, confirmLabel: "Delete", danger: true }))) return;
    const chapters = form.chapters.filter((c) => c.id !== chapterId);
    const nextActiveChapterId = activeChapter?.id === chapterId
      ? chapters[0]?.id ?? null
      : activeChapter?.id ?? chapters[0]?.id ?? null;
    if (
      nextActiveChapterId !== activeChapter?.id
      && !(await confirmAssistantTransition("chapters"))
    ) return;
    patch({ chapters });
    setActiveChapterId(nextActiveChapterId);
    setQuote(null);
  };

  const moveChapter = (chapterId: string, direction: number) => {
    const chapters = [...form.chapters];
    const i = chapters.findIndex((c) => c.id === chapterId);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= chapters.length) return;
    [chapters[i], chapters[j]] = [chapters[j], chapters[i]];
    patch({ chapters });
  };

  return (
    <div className="h-full min-h-0 flex flex-col">
      <header className="px-5 py-3 border-b border-base-400 flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm" shape="square" title="Back to Manuscripts" onClick={() => void navigateAway("/studio?type=manuscripts")}><ArrowLeft /></Button>
        <input
          className="min-w-0 max-w-2xl flex-1 bg-transparent px-1 text-xl font-semibold tracking-tight text-content-100 outline-none placeholder:text-content-400 focus-visible:text-primary-500"
          value={form.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Untitled manuscript"
          aria-label="Manuscript title"
        />
        <span className="flex-1" />
        <div
          className={`flex items-center gap-1.5 px-2 text-xs ${saveState === "error" ? "text-error" : "text-content-400"}`}
          role="status"
          aria-live="polite"
        >
          {saveState === "saving" ? <LoaderCircle size={13} className="animate-spin" /> : saveState === "saved" ? <Check size={13} /> : null}
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : saveState === "pristine" ? "Not saved yet" : "Unsaved changes"}
        </div>
        <Button
          variant={rightPanel === "assistant" ? "secondary" : "ghost"}
          shape="square"
          title={rightPanel === "assistant" ? "Close assistant panel" : "Open assistant panel"}
          aria-pressed={rightPanel === "assistant"}
          onClick={() => void switchRightPanel(rightPanel === "assistant" ? null : "assistant")}
        ><Bot /></Button>
        <Button
          variant={rightPanel === "chats" ? "secondary" : "ghost"}
          shape="square"
          title={rightPanel === "chats" ? "Close chat panel" : "Open chat panel"}
          aria-pressed={rightPanel === "chats"}
          onClick={() => void switchRightPanel(rightPanel === "chats" ? null : "chats")}
        ><MessagesSquare /></Button>
      </header>

      <motion.div
        className="flex-1 min-h-0 grid grid-cols-[220px_minmax(0,1fr)_auto] px-4 pt-4"
      >
        <aside className="min-h-0 overflow-y-auto border-r border-base-400 pr-3 mr-4">
          <div className="space-y-1 pb-3 border-b border-base-400">
            <button
              type="button"
              aria-pressed={tab === "manuscript"}
              onClick={() => void switchTab("manuscript")}
              className={`w-full h-9 px-2.5 rounded-md flex items-center gap-2 text-sm cursor-pointer transition-colors ${tab === "manuscript" ? "bg-base-300 text-content-100 font-medium" : "text-content-300 hover:bg-base-300/60 hover:text-content-100"}`}
            >
              <BookOpenText size={15} /> Manuscript
              <span className="ml-auto text-xs text-content-400">{form.chapters.length}</span>
            </button>
            <button
              type="button"
              aria-pressed={tab === "characters"}
              onClick={() => void switchTab("characters")}
              className={`w-full h-9 px-2.5 rounded-md flex items-center gap-2 text-sm cursor-pointer transition-colors ${tab === "characters" ? "bg-base-300 text-content-100 font-medium" : "text-content-300 hover:bg-base-300/60 hover:text-content-100"}`}
            >
              <Users size={15} /> Characters
              <span className="ml-auto text-xs text-content-400">{form.characters.length}</span>
            </button>
            <button
              type="button"
              aria-pressed={tab === "settings"}
              onClick={() => void switchTab("settings")}
              className={`w-full h-9 px-2.5 rounded-md flex items-center gap-2 text-sm cursor-pointer transition-colors ${tab === "settings" ? "bg-base-300 text-content-100 font-medium" : "text-content-300 hover:bg-base-300/60 hover:text-content-100"}`}
            >
              <Settings2 size={15} /> Settings
            </button>
          </div>

          {tab === "manuscript" && <>
            <div className="flex items-center mt-4 mb-2">
              <span className="text-[11px] uppercase tracking-wider text-content-400">Chapters</span>
              <span className="flex-1" />
              <Button
                variant="ghost" size="sm" shape="square" title="Add chapter"
                onClick={() => void addChapter()}
              ><Plus /></Button>
            </div>
            <div className="space-y-1">
              {form.chapters.map((chapter, i) => (
                <div key={chapter.id} className={`group rounded-md p-2 cursor-pointer ${activeChapter?.id === chapter.id ? "bg-primary-500/8 text-content-100" : "text-content-300 hover:bg-base-300/60 hover:text-content-100"}`} onClick={() => void switchChapter(chapter.id)}>
                  <div className="text-sm truncate">{chapter.title}</div>
                  <div className="text-[11px] text-content-400 mt-1 flex items-center">
                    {countWords(chapter.content).toLocaleString()} words
                    <span className="flex-1" />
                    <span className="opacity-0 group-hover:opacity-100 flex" onClick={(e) => e.stopPropagation()}>
                      <button className="p-0.5 cursor-pointer hover:text-content-100" title="Move up" onClick={() => moveChapter(chapter.id, -1)} disabled={i === 0}><ChevronUp size={13} /></button>
                      <button className="p-0.5 cursor-pointer hover:text-content-100" title="Move down" onClick={() => moveChapter(chapter.id, 1)} disabled={i === form.chapters.length - 1}><ChevronDown size={13} /></button>
                      <button className="p-0.5 cursor-pointer hover:text-error" title="Delete" onClick={() => removeChapter(chapter.id)}><Trash2 size={13} /></button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>}
        </aside>

        {tab === "settings" ? (
          <main className="min-h-0 overflow-y-auto w-full max-w-4xl mx-auto pr-2">
            <div className="space-y-8 pb-10">
              <div>
                <h2 className="text-lg font-semibold">Project settings</h2>
                <p className="text-sm text-content-400 mt-1">Story guidance and AI defaults used throughout this manuscript.</p>
              </div>

              <section className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium">Narrative direction</h3>
                  <p className="text-xs text-content-400 mt-0.5">Set the narrative viewpoint and model for this project.</p>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <Field label="Perspective">
                    <Select
                      className="w-full"
                      value={form.perspective}
                      onChange={(perspective) => patch({ perspective: perspective as ManuscriptPerspective })}
                      options={Object.entries(MANUSCRIPT_PERSPECTIVE_LABELS).map(([value, label]) => ({ value, label }))}
                    />
                  </Field>
                  <Field label="AI model" hint="Overrides the Manuscript model from system settings for this project only.">
                    <ModelPicker value={form.modelId} onChange={(modelId) => patch({ modelId })} placeholder="(Manuscript default model)" />
                  </Field>
                </div>
              </section>

              <section className="space-y-4 border-t border-base-400 pt-6">
                <div>
                  <h3 className="text-sm font-medium">Story foundation</h3>
                  <p className="text-xs text-content-400 mt-0.5">Edit these directly or describe the change to the settings assistant.</p>
                </div>
                <Field label="Synopsis" hint="The assistant uses this as the project’s story compass.">
                  <Textarea className="w-full min-h-44" value={form.synopsis} onChange={(synopsis) => patch({ synopsis })} placeholder="What is this manuscript about?" />
                </Field>
                <Field label="Prose style" hint="Voice, diction, rhythm, imagery, dialogue, and constraints.">
                  <Textarea className="w-full min-h-48" value={form.style} onChange={(style) => patch({ style })} placeholder="Describe the prose style…" />
                </Field>
              </section>

              <section className="space-y-4 border-t border-base-400 pt-6">
                <div>
                  <h3 className="text-sm font-medium">Organization</h3>
                  <p className="text-xs text-content-400 mt-0.5">Tags are used to organize manuscripts in Studio.</p>
                </div>
                <Field label="Tags" hint="Comma-separated">
                  <Input className="w-full" value={form.tags.join(", ")} onChange={(value) => patch({ tags: value.split(",").map((item) => item.trim()).filter(Boolean) })} />
                </Field>
              </section>
            </div>
          </main>
        ) : tab === "manuscript" ? (
            <main className="min-h-0 h-full w-full overflow-hidden">
              {activeChapter && (
                <div className="h-full min-h-0 flex flex-col">
                  <div className="mx-auto w-full max-w-[72ch] shrink-0 px-7 pt-7 pb-5">
                    <div className="flex items-baseline gap-4">
                      <input
                        className="min-w-0 flex-1 bg-transparent text-[26px] leading-tight font-semibold tracking-tight text-content-100 outline-none placeholder:text-content-400"
                        value={activeChapter.title}
                        aria-label="Chapter title"
                        placeholder="Untitled chapter"
                        onChange={(e) => patch({ chapters: form.chapters.map((c) => c.id === activeChapter.id ? { ...c, title: e.target.value, updatedAt: Date.now() } : c) })}
                      />
                      <span className="shrink-0 text-xs tabular-nums text-content-400">
                        {countWords(activeChapter.content).toLocaleString()} words
                      </span>
                    </div>
                  </div>
                  <textarea
                    className="mx-auto block h-full min-h-0 w-full max-w-[72ch] flex-1 resize-none overflow-y-auto border-0 bg-transparent px-7 pb-16 text-[17px] leading-8 text-content-100 outline-none font-[Georgia,serif] placeholder:text-content-400/70 selection:bg-primary-500/20"
                    value={activeChapter.content}
                    aria-label="Chapter content"
                    placeholder="Begin the chapter…"
                    spellCheck
                    onChange={(e) => patch({ chapters: form.chapters.map((c) => c.id === activeChapter.id ? { ...c, content: e.target.value, updatedAt: Date.now() } : c) })}
                    onSelect={(e) => {
                      const target = e.currentTarget;
                      if (target.selectionEnd > target.selectionStart) setQuote({
                        text: target.value.slice(target.selectionStart, target.selectionEnd),
                        start: target.selectionStart,
                        end: target.selectionEnd,
                      });
                    }}
                  />
                </div>
              )}
            </main>
        ) : (
          <main className="min-h-0 overflow-y-auto max-w-4xl w-full mx-auto pr-2">
              <div className="space-y-3 pb-8">
                <div className="flex items-center">
                  <div>
                    <h2 className="font-semibold">Embedded characters</h2>
                    <p className="text-xs text-content-400 mt-0.5">These character sheets belong only to this manuscript and can be interviewed in private sessions.</p>
                  </div>
                  <span className="flex-1" />
                  <Button onClick={() => patch({ characters: [...form.characters, normalizeManuscriptCharacter()] })}><Plus /> Add character</Button>
                </div>
                {!form.characters.length && <div className="border border-dashed border-base-400 rounded-md text-center text-sm text-content-400 p-10">No embedded characters yet. Add one here or ask the assistant to create one.</div>}
                {form.characters.map((character, i) => (
                  <Collapsible
                    key={character.id}
                    bordered
                    defaultValue={i === 0}
                    title={<span className="flex-1 truncate">{character.name}</span>}
                    chevron={() => <span className="flex items-center pr-2 gap-1">
                      <Button variant="ghost" size="sm" shape="square" title="Remove character" onClick={() => patch({ characters: form.characters.filter((c) => c.id !== character.id), conversations: form.conversations.filter((conversation) => !conversation.characterIds.includes(character.id)) })}><Trash2 /></Button>
                    </span>}
                  >
                    <div className="space-y-3 pt-2">
                      <Field label="Name"><Input className="w-full" value={character.name} onChange={(name) => patch({ characters: form.characters.map((c) => c.id === character.id ? { ...c, name } : c) })} /></Field>
                      <Field label="Description"><Textarea className="w-full" value={character.description} onChange={(description) => patch({ characters: form.characters.map((c) => c.id === character.id ? { ...c, description } : c) })} /></Field>
                      <Field label="Personality"><Textarea className="w-full" value={character.personality} onChange={(personality) => patch({ characters: form.characters.map((c) => c.id === character.id ? { ...c, personality } : c) })} /></Field>
                      <Field label="Example dialogue"><Textarea className="w-full" value={character.voice} onChange={(voice) => patch({ characters: form.characters.map((c) => c.id === character.id ? { ...c, voice } : c) })} placeholder={'*brief action* "A representative line of dialogue."'} /></Field>
                      <Field label="Appearance"><Textarea className="w-full" value={character.appearance} onChange={(appearance) => patch({ characters: form.characters.map((c) => c.id === character.id ? { ...c, appearance } : c) })} /></Field>
                    </div>
                  </Collapsible>
                ))}
              </div>
          </main>
        )}

        <motion.div
          className="h-full min-h-0 overflow-hidden"
          initial={false}
          animate={{
            width: rightPanel ? 380 : 0,
            marginLeft: rightPanel ? 16 : 0,
            opacity: rightPanel ? 1 : 0,
            x: rightPanel ? 0 : 24,
          }}
          transition={{
            duration: reduceMotion ? 0 : 0.28,
            ease: [0.22, 1, 0.36, 1],
          }}
          aria-hidden={!rightPanel}
          inert={!rightPanel}
          style={{ pointerEvents: rightPanel ? "auto" : "none" }}
        >
          <div className="h-full min-h-0 w-[380px]">
            {rightPanel === "assistant" && (
              <ManuscriptAssistant
                key={tab}
                scope={tab}
                manuscript={form}
                chapterId={activeChapter?.id ?? ""}
                quote={tab === "manuscript" ? quote : null}
                onClearQuote={() => setQuote(null)}
                onApply={applyAi}
                onPreview={previewStructuredAi}
                onCommitPreview={commitStructuredAiPreview}
                onDiscardPreview={discardStructuredAiPreview}
                onIncludeActiveChapterChange={(assistantIncludeActiveChapter) => patch({ assistantIncludeActiveChapter })}
                onSaveSessions={saveSessions}
                canUndo={historyState.undo > 0}
                canRedo={historyState.redo > 0}
                onUndo={undo}
                onRedo={redo}
                onActivityChange={(activity) => {
                  assistantActivityRef.current = activity;
                }}
              />
            )}
            <div className={rightPanel === "chats" ? "h-full min-h-0" : "hidden"}>
              <ManuscriptChatsPanel
                manuscript={form}
                chapterId={activeChapter?.id ?? ""}
                onSaveConversation={saveConversation}
              />
            </div>
          </div>
        </motion.div>
      </motion.div>

    </div>
  );
}
