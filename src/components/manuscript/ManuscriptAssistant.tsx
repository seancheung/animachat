"use client";

import { useMemo, useRef, useState } from "react";
import {
  Bot,
  History,
  MessageSquarePlus,
  Quote,
  Redo2,
  SendHorizontal,
  Sparkles,
  Square,
  Undo2,
  WandSparkles,
} from "lucide-react";
import { InputBox } from "@/components/app";
import { Markdown } from "@/components/Markdown";
import Button from "@/components/ui/button";
import Popover from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { streamSse, timestamp, uid } from "@/lib/ui";
import type {
  Manuscript,
  ManuscriptAssistantScope,
  ManuscriptCharacter,
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

export interface CharacterDesignUpdate {
  characterId: string | null;
  character: Partial<ManuscriptCharacter>;
}

type ApplyAction = "continue" | "rewrite" | "settings" | "character";
type ApplyValue = string | SettingsAssistantUpdate | CharacterDesignUpdate;
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
    empty: "Describe a new character in your own words, or name an existing character and explain what you want to change.",
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
  onSaveSessions,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  scope: ManuscriptAssistantScope;
  manuscript: Manuscript;
  chapterId: string;
  quote: ManuscriptQuote | null;
  onClearQuote: () => void;
  onApply: (action: ApplyAction, value: ApplyValue, quote?: ManuscriptQuote | null) => void;
  onSaveSessions: (sessions: ManuscriptSession[]) => void | Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
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
  const abortRef = useRef<AbortController | null>(null);
  const active = assistantSessions.find((session) => session.id === activeId) ?? assistantSessions.at(-1) ?? null;
  const copy = PANEL_COPY[scope];

  async function newSession() {
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
    let acc = "";
    let settingsUpdate: SettingsAssistantUpdate | null = null;
    let characterUpdate: CharacterDesignUpdate | null = null;
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      await streamSse("/api/manuscripts/generate", {
        action,
        manuscript,
        chapterId,
        quote: scope === "manuscript" ? quote?.text : undefined,
        prompt,
        messages: history,
      }, (event) => {
        if (event.type === "text") {
          acc += event.text;
          setStreaming(acc);
        } else if (event.type === "settings-update") {
          settingsUpdate = event.update;
        } else if (event.type === "character-update") {
          characterUpdate = {
            characterId: event.characterId ?? null,
            character: event.character,
          };
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }, abort.signal);

      if (settingsUpdate) onApply("settings", settingsUpdate);
      if (characterUpdate) onApply("character", characterUpdate);

      if (conversational && session && acc.trim()) {
        const reply: ManuscriptMessage = { role: "assistant", content: acc.trim(), createdAt: timestamp() };
        await persistMessages(session, [...history, reply]);
      } else if (action === "continue" && acc.trim()) {
        onApply("continue", acc.trim());
      } else if (action === "rewrite" && acc.trim()) {
        onApply("rewrite", acc.trim(), quote);
        onClearQuote();
      }
    } catch (error) {
      if (!abort.signal.aborted) toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      abortRef.current = null;
      setBusy(false);
      setStreaming("");
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
                  disabled={busy}
                >
                  <MessageSquarePlus /> New
                </Button>
              </div>
              {!assistantSessions.length && (
                <div className="px-2 py-3 text-xs text-content-400">No sessions yet.</div>
              )}
              {assistantSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`w-full rounded-md px-2.5 py-2 text-left text-sm cursor-pointer truncate ${session.id === active?.id ? "bg-base-300 font-medium" : "hover:bg-base-300/60"}`}
                  onClick={() => { setActiveId(session.id); close(); }}
                >
                  {session.title}
                </button>
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
          </div>
        ))}
        {streaming && <div className="text-sm px-1"><Markdown text={streaming} streaming /></div>}
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
