"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { GripVertical, History, MessageSquarePlus, SendHorizontal, Square, X } from "lucide-react";
import { motion, useDragControls, useReducedMotion } from "motion/react";
import { InputBox } from "@/components/app";
import { Markdown } from "@/components/Markdown";
import Button from "@/components/ui/button";
import Popover from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { streamSse, timestamp, uid } from "@/lib/ui";
import type { Manuscript, ManuscriptMessage, ManuscriptSession } from "@/lib/types";

export function CharacterChatPanel({
  manuscript,
  characterId,
  dragConstraints,
  onSaveSession,
  onClose,
}: {
  manuscript: Manuscript;
  characterId: string;
  dragConstraints: RefObject<Element | null>;
  onSaveSession: (session: ManuscriptSession) => void;
  onClose: () => void;
}) {
  const character = manuscript.characters.find((item) => item.id === characterId);
  const sessions = useMemo(
    () => manuscript.sessions.filter(
      (session) => session.kind === "character" && session.characterId === characterId
    ),
    [manuscript.sessions, characterId]
  );
  const [activeId, setActiveId] = useState<string | null>(() => sessions.at(-1)?.id ?? null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const dragControls = useDragControls();
  const reduceMotion = useReducedMotion();
  const active = sessions.find((session) => session.id === activeId) ?? sessions.at(-1) ?? null;

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!dragging) return;
    const previous = document.body.style.userSelect;
    const previousWebkit = document.body.style.webkitUserSelect;
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
    return () => {
      document.body.style.userSelect = previous;
      document.body.style.webkitUserSelect = previousWebkit;
    };
  }, [dragging]);

  if (!character) return null;

  function newSession() {
    const t = timestamp();
    const session: ManuscriptSession = {
      id: uid(),
      title: "New session",
      kind: "character",
      characterId,
      messages: [],
      createdAt: t,
      updatedAt: t,
    };
    setActiveId(session.id);
    onSaveSession(session);
  }

  function persistMessages(session: ManuscriptSession, messages: ManuscriptMessage[]) {
    const firstUser = messages.find((message) => message.role === "user")?.content.trim();
    onSaveSession({
      ...session,
      title: session.title === "New session" && firstUser ? firstUser.slice(0, 42) : session.title,
      messages,
      updatedAt: timestamp(),
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    let session = active;
    if (!session) {
      const t = timestamp();
      session = {
        id: uid(),
        title: "New session",
        kind: "character",
        characterId,
        messages: [],
        createdAt: t,
        updatedAt: t,
      };
      setActiveId(session.id);
    }

    const userMessage: ManuscriptMessage = {
      role: "user",
      content: text,
      createdAt: timestamp(),
    };
    const history = [...session.messages, userMessage];
    const pendingSession = { ...session, messages: history, updatedAt: timestamp() };
    persistMessages(pendingSession, history);
    setInput("");
    setBusy(true);
    setStreaming("");

    let accumulated = "";
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      await streamSse("/api/manuscripts/generate", {
        action: "character-chat",
        manuscript,
        characterId,
        messages: history,
      }, (event) => {
        if (event.type === "text") {
          accumulated += event.text;
          setStreaming(accumulated);
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }, abort.signal);

      if (accumulated.trim()) {
        const reply: ManuscriptMessage = {
          role: "character",
          content: accumulated.trim(),
          createdAt: timestamp(),
        };
        persistMessages(pendingSession, [...history, reply]);
      }
    } catch (error) {
      if (!abort.signal.aborted) toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      abortRef.current = null;
      setBusy(false);
      setStreaming("");
    }
  }

  return (
    <motion.aside
      className="absolute top-16 right-4 bottom-4 z-40 flex w-[min(420px,calc(100%-2rem))] flex-col overflow-hidden rounded-xl border border-base-400 bg-base-100 shadow-(--shadow-overlay)"
      initial={reduceMotion ? false : { opacity: 0, scale: 0.97, x: 20 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, scale: 0.97, x: 20 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
      drag
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={dragConstraints}
      dragElastic={0.05}
      dragMomentum={false}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => setDragging(false)}
      aria-label={`Chat with ${character.name}`}
    >
      <header className="flex items-center gap-2 border-b border-base-400 px-3 py-2.5">
        <div
          className="flex min-w-0 flex-1 touch-none select-none cursor-grab items-center gap-2 active:cursor-grabbing"
          aria-label="Drag character chat"
          onPointerDown={(event) => {
            event.preventDefault();
            dragControls.start(event);
          }}
        >
          <GripVertical size={15} className="shrink-0 text-content-400" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{character.name}</div>
            <div className="truncate text-[11px] text-content-400">Private character chat</div>
          </div>
        </div>
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
                  title="Start a fresh session without carried history"
                  disabled={busy}
                  onClick={() => { close(); newSession(); }}
                >
                  <MessageSquarePlus /> New
                </Button>
              </div>
              {!sessions.length && (
                <div className="px-2 py-3 text-xs text-content-400">No sessions yet.</div>
              )}
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`w-full cursor-pointer truncate rounded-md px-2.5 py-2 text-left text-sm ${session.id === active?.id ? "bg-base-300 font-medium" : "hover:bg-base-300/60"}`}
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
          >
            <History />
          </Button>
        </Popover>
        <Button variant="ghost" size="sm" shape="square" title="Close character chat" onClick={onClose}>
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!active?.messages.length && !streaming && (
          <div className="rounded-lg border border-dashed border-base-400 px-5 py-10 text-center text-sm text-content-400">
            Talk with {character.name} about their voice, motivations, secrets, or reactions while you work on the manuscript.
          </div>
        )}
        {active?.messages.map((message, index) => (
          <div
            key={`${message.createdAt}-${index}`}
            className={message.role === "user"
              ? "ml-auto max-w-[85%] rounded-lg bg-primary-500 px-3 py-2 text-sm text-primary-content whitespace-pre-wrap"
              : "max-w-[90%] rounded-lg bg-base-200 px-3 py-2.5 text-sm"}
          >
            {message.role === "user" ? message.content : <Markdown text={message.content} />}
          </div>
        ))}
        {streaming && (
          <div className="max-w-[90%] rounded-lg bg-base-200 px-3 py-2.5 text-sm">
            <Markdown text={streaming} streaming />
          </div>
        )}
      </div>

      <div className="px-3 pb-3">
        <InputBox
          textareaClassName="h-20"
          placeholder={`Message ${character.name}…`}
          value={input}
          onChange={setInput}
          disabled={busy}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        >
          <span className="flex-1 px-1 text-xs text-content-400">Enter to send · Shift+Enter for a new line</span>
          {busy ? (
            <Button variant="danger" size="sm" shape="square" title="Stop" onClick={() => abortRef.current?.abort()}>
              <Square />
            </Button>
          ) : (
            <Button size="sm" shape="square" title="Send" disabled={!input.trim()} onClick={() => void send()}>
              <SendHorizontal />
            </Button>
          )}
        </InputBox>
      </div>
    </motion.aside>
  );
}
