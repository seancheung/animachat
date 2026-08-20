"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  BookOpenText,
  Check,
  CircleX,
  History,
  MessageSquarePlus,
  Quote,
  Redo2,
  RefreshCw,
  SendHorizontal,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import { InputBox } from "@/components/app";
import { Markdown } from "@/components/Markdown";
import { confirmDialog } from "@/components/confirm";
import Button from "@/components/ui/button";
import Checkbox from "@/components/ui/checkbox";
import Dialog from "@/components/ui/dialog";
import Popover from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import type { CharacterDesignUpdate as CharacterDesignUpdatePayload } from "@/lib/ai/manuscriptCharacterDesign";
import type { ManuscriptChapterEdit } from "@/lib/ai/manuscriptStructured";
import {
  manuscriptSessionMatchesWorkspace,
  manuscriptSelectionMatches,
  retryableManuscriptAssistantTurn,
  truncateManuscriptAssistantAtUserMessage,
} from "@/lib/manuscript";
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

type Action = "assistant" | "settings-assistant" | "character-design";

interface PendingChapterEdit {
  sessionId: string;
  messageCreatedAt: number;
  chapterId: string;
  baseTitle: string;
  baseContent: string;
  proposedTitle: string;
  proposedContent: string;
  summary: string;
  edits: ManuscriptChapterEdit[];
  selection: ManuscriptQuote | null;
}

type ChapterEditProposalDraft = Omit<PendingChapterEdit, "sessionId" | "messageCreatedAt">;

function ChapterEditDiff({ proposal }: { proposal: PendingChapterEdit }) {
  return (
    <div className="space-y-3">
      {proposal.edits.map((edit, index) => {
        const before = edit.operation === "rename-chapter"
          ? proposal.baseTitle
          : edit.operation === "replace-selection"
            ? proposal.selection?.text ?? ""
            : edit.operation === "replace"
              ? edit.oldText
              : edit.operation === "append" ? "" : edit.anchor;
        const after = edit.operation === "rename-chapter" ? edit.title : edit.text;
        const label = edit.operation === "rename-chapter"
          ? "Rename chapter"
          : edit.operation === "append"
            ? "Append at chapter end"
            : edit.operation === "replace-selection"
              ? "Replace selected passage"
              : edit.operation === "replace"
                ? after ? "Replace text" : "Delete text"
                : edit.operation === "insert-before" ? "Insert before text" : "Insert after text";
        const insertedBefore = edit.operation === "insert-before";
        const insertedAfter = edit.operation === "insert-after";
        const beforeContext = edit.operation === "replace" || insertedBefore || insertedAfter
          ? edit.beforeContext ?? ""
          : "";
        const afterContext = edit.operation === "replace" || insertedBefore || insertedAfter
          ? edit.afterContext ?? ""
          : "";
        return (
          <section key={index} className="overflow-hidden rounded-md border border-base-400">
            <div className="bg-base-300 px-3 py-1.5 text-xs font-medium text-content-300">
              {index + 1}. {label}
            </div>
            <div className="grid grid-cols-2 border-t border-base-400">
              <div className="min-w-0 border-r border-base-400">
                <div className="border-b border-base-400 bg-error/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-error">
                  Before
                </div>
                <pre className="max-h-56 min-h-20 overflow-auto whitespace-pre-wrap bg-base-100 px-3 py-2 font-mono text-xs">
                  {beforeContext && <span className="text-content-300">{beforeContext}</span>}
                  {before
                    ? <span className={insertedBefore || insertedAfter ? "text-content-300" : "text-error"}>{before}</span>
                    : <span className="italic text-content-400">Chapter end</span>}
                  {afterContext && <span className="text-content-300">{afterContext}</span>}
                </pre>
              </div>
              <div className="min-w-0">
                <div className="border-b border-base-400 bg-success/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-success">
                  After
                </div>
                <pre className="max-h-56 min-h-20 overflow-auto whitespace-pre-wrap bg-base-100 px-3 py-2 font-mono text-xs">
                  {beforeContext && <span className="text-content-300">{beforeContext}</span>}
                  {insertedBefore && <span className="text-success">{after}</span>}
                  {(insertedBefore || insertedAfter) && <span className="text-content-300">{before}</span>}
                  {insertedAfter && <span className="text-success">{after}</span>}
                  {!insertedBefore && !insertedAfter && (after
                    ? <span className="text-success">{after}</span>
                    : <span className="italic text-content-400">Deleted</span>)}
                  {afterContext && <span className="text-content-300">{afterContext}</span>}
                </pre>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

const PANEL_COPY: Record<ManuscriptAssistantScope, {
  title: string;
  empty: string;
  placeholder: string;
}> = {
  manuscript: {
    title: "Manuscript assistant",
    empty: "Ask about the active chapter or describe edits anywhere in it. Every proposed change is reviewed before it is applied.",
    placeholder: "Ask about the manuscript or describe an edit…",
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
  onAcceptChapterEdit,
  onPreview,
  onCommitPreview,
  onDiscardPreview,
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
  onAcceptChapterEdit: (
    chapterId: string,
    baseTitle: string,
    baseContent: string,
    proposedTitle: string,
    proposedContent: string
  ) => boolean;
  onPreview: (
    action: "settings" | "character",
    value: SettingsAssistantUpdate | CharacterDesignUpdate[]
  ) => boolean;
  onCommitPreview: () => void;
  onDiscardPreview: () => void;
  onSaveSessions: (sessions: ManuscriptSession[]) => void | Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onActivityChange?: (activity: ManuscriptAssistantActivity | null) => void;
}) {
  const assistantSessions = useMemo(
    () => manuscript.sessions.filter(
      (session) => manuscriptSessionMatchesWorkspace(session, scope, chapterId)
    ),
    [chapterId, manuscript.sessions, scope]
  );
  const [activeId, setActiveId] = useState<string | null>(() => assistantSessions.at(-1)?.id ?? null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [drafting, setDrafting] = useState<{ label?: string | null } | null>(null);
  const [draftChapterIds, setDraftChapterIds] = useState<string[]>([]);
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false);
  const [pickedChapterIds, setPickedChapterIds] = useState<string[]>([]);
  const [pendingProposal, setPendingProposal] = useState<PendingChapterEdit | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const proposalRef = useRef<ChapterEditProposalDraft | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const active = assistantSessions.find((session) => session.id === activeId) ?? assistantSessions.at(-1) ?? null;
  const copy = PANEL_COPY[scope];

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const viewport = messagesViewportRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active?.messages.length, streaming, drafting]);

  async function newSession() {
    if (!active?.messages.length) return;
    const t = timestamp();
    const session: ManuscriptSession = {
      id: uid(),
      title: "New session",
      kind: "assistant",
      scope,
      characterId: null,
      chapterId: scope === "manuscript" ? chapterId : null,
      chapterIds: [],
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
        (item) => manuscriptSessionMatchesWorkspace(item, scope, chapterId)
      );
      setActiveId(remaining.at(-1)?.id ?? null);
    }
    await onSaveSessions(sessions);
  }

  async function deleteUserMessage(index: number) {
    if (!active || busy || pendingProposal) return;
    const messages = truncateManuscriptAssistantAtUserMessage(active.messages, index);
    if (messages === active.messages) return;
    const following = active.messages.length - index - 1;
    if (!(await confirmDialog({
      title: "Delete user message",
      message: following
        ? `Delete this message and the ${following.toLocaleString()} message${following === 1 ? "" : "s"} after it?`
        : "Delete this message?",
      confirmLabel: "Delete",
      danger: true,
    }))) return;
    const firstUser = messages.find((message) => message.role === "user")?.content.trim();
    const next = {
      ...active,
      title: firstUser ? firstUser.slice(0, 42) : "New session",
      messages,
      updatedAt: timestamp(),
    };
    await onSaveSessions(manuscript.sessions.map(
      (session) => session.id === active.id ? next : session
    ));
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

  async function updateAttachedChapters(chapterIds: string[]) {
    if (!active) {
      setDraftChapterIds(chapterIds);
      return;
    }
    const next = { ...active, chapterIds, updatedAt: timestamp() };
    await onSaveSessions(manuscript.sessions.map(
      (session) => session.id === active.id ? next : session
    ));
  }

  function openChapterPicker() {
    setPickedChapterIds(active?.chapterIds ?? draftChapterIds);
    setChapterPickerOpen(true);
  }

  async function savePickedChapters() {
    await updateAttachedChapters(pickedChapterIds);
    setChapterPickerOpen(false);
  }

  async function run(
    action: Action,
    prompt = input.trim(),
    retryHistory?: ManuscriptMessage[]
  ) {
    if (busy || pendingProposal) return;
    if (!prompt) return;

    let session = active;
    if (!session) {
      const t = timestamp();
      session = {
        id: uid(),
        title: "New session",
        kind: "assistant",
        scope,
        characterId: null,
        chapterId: scope === "manuscript" ? chapterId : null,
        chapterIds: draftChapterIds,
        messages: [],
        createdAt: t,
        updatedAt: t,
      };
      setActiveId(session.id);
      await onSaveSessions([...manuscript.sessions, session]);
    }

    const history = retryHistory ?? (session
      ? [...session.messages, { role: "user" as const, content: prompt, createdAt: timestamp() }]
      : []);
    if (session) await persistMessages(session, history);
    if (!retryHistory) setInput("");

    setBusy(true);
    setStreaming("");
    setDrafting(null);
    proposalRef.current = null;
    let acc = "";
    let previewLanded = false;
    let finalStructuredLanded = false;
    let previewCommitted = false;
    let retryableFailure = false;
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
        chapterIds: session?.chapterIds ?? draftChapterIds,
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
              `Using about ${Number(event.chapter.includedTokens).toLocaleString()} of ${Number(event.chapter.originalTokens).toLocaleString()} ${scope === "manuscript" ? "active-chapter" : "attached-chapter"} tokens.`
            );
          }
          if (event.omittedHistoryMessages) {
            details.push(`${Number(event.omittedHistoryMessages).toLocaleString()} older chat messages omitted.`);
          }
          toast.warning(details.join(" "));
        } else if (event.type === "drafting") {
          setDrafting({ label: typeof event.label === "string" ? event.label : null });
        } else if (
          event.type === "manuscript-edit"
          && typeof event.summary === "string"
          && Array.isArray(event.edits)
          && typeof event.proposedTitle === "string"
          && typeof event.proposedContent === "string"
        ) {
          const chapter = manuscript.chapters.find((item) => item.id === chapterId)
            ?? manuscript.chapters[0];
          if (chapter) {
            proposalRef.current = {
              chapterId: chapter.id,
              baseTitle: chapter.title,
              baseContent: chapter.content,
              proposedTitle: event.proposedTitle,
              proposedContent: event.proposedContent,
              summary: event.summary,
              edits: event.edits as ManuscriptChapterEdit[],
              selection: quote,
            };
          }
          setDrafting(null);
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
        } else if (event.type === "structured-error") {
          const message = typeof event.message === "string"
            ? event.message
            : "I produced malformed structured data, so no changes were applied.";
          acc += `${acc.trim() ? "\n\n" : ""}${message}`;
          retryableFailure = true;
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
    } catch (error) {
      if (!abort.signal.aborted) toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (previewLanded && !previewCommitted) onDiscardPreview();
      // The SSE callback mutates this ref, which TypeScript cannot observe across the await.
      const proposal = proposalRef.current as ChapterEditProposalDraft | null;
      if (session && (acc.trim() || finalStructuredLanded || proposal)) {
        const replyCreatedAt = timestamp();
        const reply: ManuscriptMessage = {
          role: "assistant",
          content: acc.trim() || proposal?.summary || "Proposed chapter edits.",
          ...(finalStructuredLanded ? { applied: true } : {}),
          ...(retryableFailure ? { retryable: true } : {}),
          createdAt: replyCreatedAt,
        };
        await persistMessages(session, [...history, reply]);
        if (proposal) {
          setPendingProposal({
            ...proposal,
            sessionId: session.id,
            messageCreatedAt: replyCreatedAt,
          });
        }
      }
      proposalRef.current = null;
      abortRef.current = null;
      setBusy(false);
      setStreaming("");
      setDrafting(null);
      onActivityChange?.(null);
      resolveStopped();
    }
  }

  function retryLastMessage() {
    if (!active || busy || pendingProposal) return;
    const retry = retryableManuscriptAssistantTurn(active.messages);
    if (!retry) return;
    void run(sendAction, retry.prompt, retry.history);
  }

  async function markProposalDecision(
    proposal: PendingChapterEdit,
    decision: "accepted" | "rejected"
  ) {
    const sessions = manuscript.sessions.map((session) => {
      if (session.id !== proposal.sessionId) return session;
      return {
        ...session,
        messages: session.messages.map((message) => {
          if (message.createdAt !== proposal.messageCreatedAt || message.role !== "assistant") {
            return message;
          }
          const rest = { ...message };
          delete rest.applied;
          delete rest.rejected;
          return decision === "accepted"
            ? { ...rest, applied: true }
            : { ...rest, rejected: true };
        }),
        updatedAt: timestamp(),
      };
    });
    await onSaveSessions(sessions);
  }

  async function acceptProposal() {
    if (!pendingProposal) return;
    if (!onAcceptChapterEdit(
      pendingProposal.chapterId,
      pendingProposal.baseTitle,
      pendingProposal.baseContent,
      pendingProposal.proposedTitle,
      pendingProposal.proposedContent
    )) return;
    if (
      pendingProposal.selection
      && !manuscriptSelectionMatches(
        pendingProposal.proposedContent,
        pendingProposal.selection
      )
    ) {
      onClearQuote();
    }
    await markProposalDecision(pendingProposal, "accepted");
    setPendingProposal(null);
  }

  async function rejectProposal() {
    if (!pendingProposal) return;
    await markProposalDecision(pendingProposal, "rejected");
    setPendingProposal(null);
  }

  const messages = active?.messages ?? [];
  const sendAction: Action = scope === "settings"
    ? "settings-assistant"
    : scope === "characters" ? "character-design" : "assistant";
  const attachedChapterIds = (active?.chapterIds ?? draftChapterIds).filter(
    (id) => scope !== "manuscript" || id !== chapterId
  );

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

      <div ref={messagesViewportRef} className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
        {!messages.length && !streaming && (
          <div className="text-xs text-content-400 leading-relaxed py-3">{copy.empty}</div>
        )}
        {messages.map((message, index) => message.role === "user" ? (
          <div key={`${message.createdAt}-${index}`} className="group ml-6 text-sm">
            <div className="mb-0.5 flex items-center justify-end gap-1 text-[11px] text-content-400">
              <span>You</span>
              <Button
                variant="danger"
                size="sm"
                shape="square"
                className="size-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                title="Delete this message and all messages after it"
                disabled={busy || !!pendingProposal}
                onClick={() => void deleteUserMessage(index)}
              >
                <Trash2 />
              </Button>
            </div>
            <div className="rounded-md bg-base-300 px-3 py-2 whitespace-pre-wrap">
              {message.content}
            </div>
          </div>
        ) : (
          <div key={`${message.createdAt}-${index}`} className="text-sm px-1">
            <Markdown text={message.content} />
            {message.applied && (
              <div className="mt-1.5 has-icon flex items-center gap-1 text-xs text-primary-400/90">
                <Check /> Applied to the manuscript
              </div>
            )}
            {message.rejected && (
              <div className="mt-1.5 has-icon flex items-center gap-1 text-xs text-content-400">
                <CircleX /> Rejected
              </div>
            )}
            {message.retryable && index === messages.length - 1 && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                disabled={busy || !!pendingProposal}
                onClick={retryLastMessage}
              >
                <RefreshCw /> Retry
              </Button>
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
        <Button
          variant="ghost"
          size="sm"
          title={`Attach chapters${attachedChapterIds.length ? ` (${attachedChapterIds.length})` : ""}`}
          disabled={busy}
          onClick={openChapterPicker}
        >
          <BookOpenText />
          {attachedChapterIds.length || null}
        </Button>
        <span className="flex-1" />
        {busy ? (
          <Button variant="danger" size="sm" shape="square" title="Stop" onClick={() => abortRef.current?.abort()}><Square /></Button>
        ) : (
          <Button size="sm" shape="square" title="Send" disabled={!input.trim()} onClick={() => run(sendAction)}><SendHorizontal /></Button>
        )}
      </InputBox>

      <Dialog
        open={!!pendingProposal}
        title="Review chapter edits"
        description={pendingProposal?.summary}
        size="lg"
        closable={false}
        dismissable={false}
        footer={pendingProposal ? (
          <>
            <Button variant="secondary" onClick={() => void rejectProposal()}>Reject</Button>
            <Button onClick={() => void acceptProposal()}>Accept changes</Button>
          </>
        ) : null}
      >
        {pendingProposal && <ChapterEditDiff proposal={pendingProposal} />}
      </Dialog>

      <Dialog
        open={chapterPickerOpen}
        onOpenChange={setChapterPickerOpen}
        title="Attach chapters"
        description={scope === "manuscript"
          ? `The active chapter is always included as full content. Other selected chapters are injected as ${manuscript.chapterContextMode === "full" ? "full content" : "summaries"}; empty ${manuscript.chapterContextMode === "full" ? "chapters" : "summaries"} are skipped.`
          : `Selected chapters are injected as ${manuscript.chapterContextMode === "full" ? "full content" : "summaries"}. Empty ${manuscript.chapterContextMode === "full" ? "chapters" : "summaries"} are skipped.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setChapterPickerOpen(false)}>Cancel</Button>
            <Button onClick={() => void savePickedChapters()}>Save attachments</Button>
          </>
        }
      >
        <div className="space-y-1">
          {manuscript.chapters.map((chapter) => (
            <div key={chapter.id} className="rounded-md px-2.5 py-2 hover:bg-base-300/60">
              <Checkbox
                className="w-full"
                disabled={scope === "manuscript" && chapter.id === chapterId}
                value={scope === "manuscript" && chapter.id === chapterId
                  ? true
                  : pickedChapterIds.includes(chapter.id)}
                onChange={(checked) => setPickedChapterIds((current) => checked
                  ? [...current, chapter.id]
                  : current.filter((id) => id !== chapter.id))}
                label={(
                  <span className="font-medium">
                    {chapter.title}
                    {scope === "manuscript" && chapter.id === chapterId && (
                      <span className="ml-1.5 font-normal text-content-400">Active · full content</span>
                    )}
                  </span>
                )}
              />
            </div>
          ))}
        </div>
      </Dialog>
    </aside>
  );
}
