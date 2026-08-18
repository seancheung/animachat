"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  History,
  MessageSquarePlus,
  Quote,
  Redo2,
  SendHorizontal,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  WandSparkles,
} from "lucide-react";
import { InputBox } from "@/components/app";
import { Markdown } from "@/components/Markdown";
import { confirmDialog } from "@/components/confirm";
import Button from "@/components/ui/button";
import Checkbox from "@/components/ui/checkbox";
import Popover from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import type { CharacterDesignUpdate as CharacterDesignUpdatePayload } from "@/lib/ai/manuscriptCharacterDesign";
import { streamSse, timestamp, uid } from "@/lib/ui";
import type {
  Manuscript,
  ManuscriptAssistantScope,
  ManuscriptMessage,
  ManuscriptSession,
} from "@/lib/types";

export interface ManuscriptQuote {
  text: string;
  start: number;
  end: number;
}

export interface SettingsAssistantUpdate {
  synopsis?: string;
  style?: string;
}

export type CharacterDesignUpdate = CharacterDesignUpdatePayload;

export interface ManuscriptAssistantActivity {
  stop: () => Promise<void>;
}

type ApplyAction = "continue" | "rewrite" | "settings" | "character";
type ApplyValue = string | SettingsAssistantUpdate | CharacterDesignUpdate[];
type Action = "continue" | "rewrite" | "assistant" | "settings-assistant" | "character-design";

const PANEL_COPY: Record<ManuscriptAssistantScope, {
  title: string;
  empty: string;
  placeholder: string;
}> = {
  manuscript: {
    title: "Manuscript assistant",
    empty: "Ask about the active chapter, add a direction and continue, or select a passage to rewrite.",
    placeholder: "Ask about the manuscript or add direction…",
  },
  characters: {
    title: "Character designer",
    empty: "Describe one or more new characters, or name existing characters and explain what you want to change.",
    placeholder: "Describe the character work you want…",
  },
  settings: {
    title: "Story settings assistant",
    empty: "Describe how you want to create, revise, or refine the synopsis and prose style.",
    placeholder: "Describe the synopsis or style change…",
  },
};

export function ManuscriptAssistant({
  scope,
  manuscript,
  chapterId,
  quote,
  onClearQuote,
  onApply,
  onPreview,
  onCommitPreview,
  onDiscardPreview,
  onIncludeActiveChapterChange,
  onSaveSessions,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onActivityChange,
}: {
  scope: ManuscriptAssistantScope;
  manuscript: Manuscript;
  chapterId: string;
  quote: ManuscriptQuote | null;
  onClearQuote: () => void;
  onApply: (action: ApplyAction, value: ApplyValue, quote?: ManuscriptQuote | null) => void;
  onPreview: (
    action: "settings" | "character",
    value: SettingsAssistantUpdate | CharacterDesignUpdate[]
  ) => boolean;
  onCommitPreview: () => void;
  onDiscardPreview: () => void;
  onIncludeActiveChapterChange: (value: boolean) => void;
  onSaveSessions: (sessions: ManuscriptSession[]) => void | Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onActivityChange?: (activity: ManuscriptAssistantActivity | null) => void;
}) {
  const assistantSessions = useMemo(
    () => manuscript.sessions.filter(
      (session) => session.kind === "assistant" && (session.scope ?? "manuscript") === scope
    ),
    [manuscript.sessions, scope]
  );
  const [activeId, setActiveId] = useState<string | null>(() => assistantSessions.at(-1)?.id ?? null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [drafting, setDrafting] = useState<{ label?: string | null } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const active = assistantSessions.find((session) => session.id === activeId) ?? assistantSessions.at(-1) ?? null;
  const copy = PANEL_COPY[scope];

  useEffect(() => () => abortRef.current?.abort(), []);

  async function newSession() {
    if (!active?.messages.length) return;
    const t = timestamp();
    const session: ManuscriptSession = {
      id: uid(),
      title: "New session",
      kind: "assistant",
      scope,
      characterId: null,
      messages: [],
      createdAt: t,
      updatedAt: t,
    };
    setActiveId(session.id);
    await onSaveSessions([...manuscript.sessions, session]);
  }

  async function deleteSession(session: ManuscriptSession) {
    if (busy || !(await confirmDialog({
      title: "Delete assistant session",
      message: `Delete “${session.title}”? Its ${session.messages.length.toLocaleString()} message${session.messages.length === 1 ? "" : "s"} will be removed.`,
      confirmLabel: "Delete",
      danger: true,
    }))) return;
    const sessions = manuscript.sessions.filter((item) => item.id !== session.id);
    if (active?.id === session.id) {
      const remaining = sessions.filter(
        (item) => item.kind === "assistant" && (item.scope ?? "manuscript") === scope
      );
      setActiveId(remaining.at(-1)?.id ?? null);
    }
    await onSaveSessions(sessions);
  }

  async function persistMessages(session: ManuscriptSession, messages: ManuscriptMessage[]) {
    const firstUser = messages.find((message) => message.role === "user")?.content.trim();
    const next = {
      ...session,
      title: session.title === "New session" && firstUser ? firstUser.slice(0, 42) : session.title,
      messages,
      updatedAt: timestamp(),
    };
    await onSaveSessions(
      manuscript.sessions.some((item) => item.id === next.id)
        ? manuscript.sessions.map((item) => item.id === next.id ? next : item)
        : [...manuscript.sessions, next]
    );
  }

  async function run(action: Action, prompt = input.trim()) {
    if (busy) return;
    const conversational = action === "assistant" || action === "settings-assistant" || action === "character-design";
    if (conversational && !prompt) return;
    if (action === "rewrite" && !quote?.text.trim()) {
      toast.warning("Select manuscript text before rewriting.");
      return;
    }

    let session = active;
    if (conversational && !session) {
      const t = timestamp();
      session = {
        id: uid(),
        title: "New session",
        kind: "assistant",
        scope,
        characterId: null,
        messages: [],
        createdAt: t,
        updatedAt: t,
      };
      setActiveId(session.id);
      await onSaveSessions([...manuscript.sessions, session]);
    }

    const userMessage: ManuscriptMessage | null = conversational
      ? { role: "user", content: prompt, createdAt: timestamp() }
      : null;
    const history = session ? [...session.messages, ...(userMessage ? [userMessage] : [])] : [];
    if (userMessage && session) await persistMessages(session, history);
    if (conversational) setInput("");

    setBusy(true);
    setStreaming("");
    setDrafting(null);
    let acc = "";
    let previewLanded = false;
    let finalStructuredLanded = false;
    let previewCommitted = false;
    const abort = new AbortController();
    abortRef.current = abort;
    let resolveStopped = () => {};
    const stopped = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });
    onActivityChange?.({
      stop: async () => {
        abort.abort();
        await stopped;
      },
    });

    try {
      await streamSse("/api/manuscripts/generate", {
        action,
        manuscript,
        chapterId,
        quote: scope === "manuscript" ? quote?.text : undefined,
        quoteStart: scope === "manuscript" ? quote?.start : undefined,
        quoteEnd: scope === "manuscript" ? quote?.end : undefined,
        includeActiveChapter: scope === "settings" || scope === "characters"
          ? manuscript.assistantIncludeActiveChapter
          : undefined,
        prompt,
        messages: history,
      }, (event) => {
        if (event.type === "text") {
          acc += event.text;
          setStreaming(acc);
        } else if (event.type === "context-limit") {
          const details = [];
          if (event.chapter) {
            details.push(
              `Using about ${Number(event.chapter.includedTokens).toLocaleString()} of ${Number(event.chapter.originalTokens).toLocaleString()} active-chapter tokens.`
            );
          }
          if (event.omittedHistoryMessages) {
            details.push(`${Number(event.omittedHistoryMessages).toLocaleString()} older chat messages omitted.`);
          }
          toast.warning(details.join(" "));
        } else if (event.type === "drafting") {
          setDrafting({ label: typeof event.label === "string" ? event.label : null });
        } else if (
          (event.type === "settings-update-partial" || event.type === "settings-update")
          && event.update && typeof event.update === "object"
        ) {
          if (onPreview("settings", event.update)) previewLanded = true;
          if (event.type === "settings-update") finalStructuredLanded = true;
          setDrafting(event.type.endsWith("partial")
            ? { label: typeof event.label === "string" ? event.label : null }
            : null);
        } else if (
          (event.type === "character-updates-partial" || event.type === "character-updates")
          && Array.isArray(event.updates)
        ) {
          const updates = event.updates.map((update: CharacterDesignUpdate) => ({
            characterId: update.characterId ?? null,
            character: update.character,
          }));
          if (updates.length && onPreview("character", updates)) previewLanded = true;
          if (event.type === "character-updates") finalStructuredLanded = true;
          setDrafting(event.type.endsWith("partial")
            ? { label: typeof event.label === "string" ? event.label : null }
            : null);
        } else if (event.type === "character-update") {
          const updates = [{
            characterId: event.characterId ?? null,
            character: event.character,
          }];
          if (onPreview("character", updates)) {
            previewLanded = true;
            finalStructuredLanded = true;
          }
          setDrafting(null);
        } else if (event.type === "error") {
          acc += `\n⚠ ${event.message}`;
          setStreaming(acc);
        }
      }, abort.signal);

      if (finalStructuredLanded) {
        onCommitPreview();
        previewCommitted = true;
      } else if (previewLanded) {
        onDiscardPreview();
        previewCommitted = true;
      }
      if (action === "continue" && acc.trim()) {
        onApply("continue", acc.trim());
      } else if (action === "rewrite" && acc.trim()) {
        onApply("rewrite", acc.trim(), quote);
        onClearQuote();
      }
    } catch (error) {
      if (!abort.signal.aborted) toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (previewLanded && !previewCommitted) onDiscardPreview();
      if (conversational && session && (acc.trim() || finalStructuredLanded)) {
        const reply: ManuscriptMessage = {
          role: "assistant",
          content: acc.trim(),
          ...(finalStructuredLanded ? { applied: true } : {}),
          createdAt: timestamp(),
        };
        await persistMessages(session, [...history, reply]);
      }
      abortRef.current = null;
      setBusy(false);
      setStreaming("");
      setDrafting(null);
      onActivityChange?.(null);
      resolveStopped();
    }
  }

  const messages = active?.messages ?? [];
  const sendAction: Action = scope === "settings"
    ? "settings-assistant"
    : scope === "characters" ? "character-design" : "assistant";

  return (
    <aside className="h-full min-h-0 flex flex-col border-l border-base-400 pl-4 pb-4">
      <div className="flex items-center gap-1 mb-2">
        <Bot size={15} className="text-primary-500" />
        <span className="text-xs uppercase tracking-wider text-content-300">{copy.title}</span>
        <span className="flex-1" />
        <Popover
          side="bottom"
          align="end"
          className="w-64 p-1.5"
          content={({ close }) => (
            <>
              <div className="flex items-center px-2 py-1.5">
                <span className="text-xs uppercase tracking-wider text-content-400">Sessions</span>
                <span className="flex-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  title="New session"
                  onClick={() => { close(); void newSession(); }}
                  disabled={busy || !active?.messages.length}
                >
                  <MessageSquarePlus /> New
                </Button>
              </div>
              {!assistantSessions.length && (
                <div className="px-2 py-3 text-xs text-content-400">No sessions yet.</div>
              )}
              {assistantSessions.map((session) => (
                <div
                  key={session.id}
                  className={`flex items-center gap-1 rounded-md pr-1 ${session.id === active?.id ? "bg-base-300 font-medium" : "hover:bg-base-300/60"}`}
                >
                  <button
                    type="button"
                    disabled={busy}
                    className={`min-w-0 flex-1 truncate rounded-md px-2.5 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${busy ? "" : "cursor-pointer"}`}
                    onClick={() => { setActiveId(session.id); close(); }}
                  >
                    {session.title}
                  </button>
                  <Button
                    variant="danger"
                    size="sm"
                    shape="square"
                    title={`Delete session “${session.title}”`}
                    disabled={busy}
                    onClick={() => { close(); void deleteSession(session); }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </>
          )}
        >
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            title={`Sessions${active ? ` — ${active.title}` : ""}`}
          ><History /></Button>
        </Popover>
        <Button variant="ghost" size="sm" shape="square" title="Undo last AI change" disabled={!canUndo || busy} onClick={onUndo}><Undo2 /></Button>
        <Button variant="ghost" size="sm" shape="square" title="Redo AI change" disabled={!canRedo || busy} onClick={onRedo}><Redo2 /></Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
        {!messages.length && !streaming && (
          <div className="text-xs text-content-400 leading-relaxed py-3">{copy.empty}</div>
        )}
        {messages.map((message, index) => (
          <div key={`${message.createdAt}-${index}`} className={message.role === "user" ? "text-sm bg-base-300 rounded-md px-3 py-2 ml-6 whitespace-pre-wrap" : "text-sm px-1"}>
            {message.role === "user" ? message.content : <Markdown text={message.content} />}
            {message.applied && (
              <div className="mt-1.5 has-icon flex items-center gap-1 text-xs text-primary-400/90">
                <Check /> Applied to the manuscript
              </div>
            )}
          </div>
        ))}
        {streaming && <div className="text-sm px-1"><Markdown text={streaming} streaming /></div>}
        {drafting && (
          <div className="flex items-baseline gap-1 px-1 text-xs text-content-400 animate-pulse">
            <span>✦ writing into the manuscript…</span>
            {drafting.label && <span className="truncate text-content-400/70">{drafting.label}</span>}
          </div>
        )}
      </div>

      {scope === "manuscript" && quote && (
        <div className="mt-2 flex items-center gap-1.5 min-w-0 rounded-t-md border border-b-0 border-base-400 bg-base-100 px-2.5 py-1.5 text-xs text-content-300">
          <Quote size={12} className="shrink-0 text-primary-500" />
          <span className="truncate">{quote.text.replace(/\s+/g, " ")}</span>
          <button className="ml-auto shrink-0 opacity-60 hover:opacity-100 cursor-pointer" onClick={onClearQuote}>×</button>
        </div>
      )}
      <InputBox
        className={scope === "manuscript" && quote ? "rounded-t-none" : "mt-2"}
        textareaClassName="h-16"
        placeholder={copy.placeholder}
        value={input}
        onChange={setInput}
        disabled={busy}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void run(sendAction);
          }
        }}
      >
        {scope === "manuscript" && (
          <>
            <Button variant="ghost" size="sm" onClick={() => run("continue", input.trim() || "Continue naturally.")} disabled={busy}>
              <Sparkles /> Continue
            </Button>
            <Button variant="ghost" size="sm" onClick={() => run("rewrite", input.trim() || "Improve this passage.")} disabled={busy || !quote}>
              <WandSparkles /> Rewrite
            </Button>
          </>
        )}
        {(scope === "settings" || scope === "characters") && (
          <Checkbox
            size="sm"
            value={manuscript.assistantIncludeActiveChapter}
            onChange={onIncludeActiveChapterChange}
            disabled={busy}
            label="Include active chapter"
          />
        )}
        <span className="flex-1" />
        {busy ? (
          <Button variant="danger" size="sm" shape="square" title="Stop" onClick={() => abortRef.current?.abort()}><Square /></Button>
        ) : (
          <Button size="sm" shape="square" title="Send" disabled={!input.trim()} onClick={() => run(sendAction)}><SendHorizontal /></Button>
        )}
      </InputBox>
    </aside>
  );
}
