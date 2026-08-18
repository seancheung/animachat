"use client";

import { useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, History, MessageSquarePlus, SendHorizontal, Square } from "lucide-react";
import { InputBox } from "@/components/app";
import { Markdown } from "@/components/Markdown";
import Button from "@/components/ui/button";
import Popover from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { useGet } from "@/lib/queries";
import { api, streamSse, timestamp, uid } from "@/lib/ui";
import type { Manuscript, ManuscriptMessage, ManuscriptSession } from "@/lib/types";

export default function ManuscriptCharacterChatPage() {
  const { id, characterId } = useParams<{ id: string; characterId: string }>();
  const router = useRouter();
  const { data } = useGet<Manuscript>(`/api/manuscripts/${id}`);
  const [manuscript, setManuscript] = useState<Manuscript | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  if (!manuscript && data) setManuscript(data);
  const character = manuscript?.characters.find((c) => c.id === characterId);
  const sessions = useMemo(
    () => manuscript?.sessions.filter((s) => s.kind === "character" && s.characterId === characterId) ?? [],
    [manuscript?.sessions, characterId]
  );
  const active = sessions.find((s) => s.id === activeId) ?? sessions.at(-1) ?? null;
  if (active && activeId !== active.id) setActiveId(active.id);

  if (!manuscript) return <div className="p-8 text-content-300">Loading…</div>;
  if (!character) return <div className="p-8 text-content-300">Character not found.</div>;
  const currentManuscript = manuscript;
  const currentCharacter = character;

  async function commitSession(session: ManuscriptSession) {
    const nextSessions = currentManuscript.sessions.some((s) => s.id === session.id)
      ? currentManuscript.sessions.map((s) => s.id === session.id ? session : s)
      : [...currentManuscript.sessions, session];
    const next: Manuscript = { ...currentManuscript, sessions: nextSessions };
    setManuscript(next);
    await api.put(`/api/manuscripts/${currentManuscript.id}`, next);
  }

  async function newSession() {
    const t = timestamp();
    const session: ManuscriptSession = {
      id: uid(),
      title: `Chat with ${currentCharacter.name}`,
      kind: "character",
      characterId,
      messages: [],
      createdAt: t,
      updatedAt: t,
    };
    setActiveId(session.id);
    await commitSession(session);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    let session = active;
    if (!session) {
      const t = timestamp();
      session = { id: uid(), title: `Chat with ${currentCharacter.name}`, kind: "character", characterId, messages: [], createdAt: t, updatedAt: t };
      setActiveId(session.id);
    }
    const user: ManuscriptMessage = { role: "user", content: text, createdAt: timestamp() };
    const history = [...session.messages, user];
    session = { ...session, messages: history, updatedAt: timestamp() };
    await commitSession(session);
    setInput("");
    setBusy(true);
    setStreaming("");
    let acc = "";
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      await streamSse("/api/manuscripts/generate", {
        action: "character-chat",
        manuscript,
        characterId,
        messages: history,
      }, (ev) => {
        if (ev.type === "text") { acc += ev.text; setStreaming(acc); }
        else if (ev.type === "error") throw new Error(ev.message);
      }, abort.signal);
      if (acc.trim()) {
        const reply: ManuscriptMessage = { role: "character", content: acc.trim(), createdAt: timestamp() };
        await commitSession({ ...session, messages: [...history, reply], updatedAt: timestamp() });
      }
    } catch (e) {
      if (!abort.signal.aborted) toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setBusy(false);
      setStreaming("");
    }
  }

  return (
    <div className="h-full min-h-0 flex flex-col max-w-4xl mx-auto">
      <header className="px-5 py-3 border-b border-base-400 flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          shape="square"
          title={`Back to ${manuscript.name}`}
          onClick={() => router.push(`/manuscripts/${id}`)}
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 ml-1">
          <div className="font-medium truncate">{character.name}</div>
          <div className="text-xs text-content-400 truncate">Embedded character · {manuscript.name}</div>
        </div>
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
                  title="Start a fresh session without carried history"
                  disabled={busy}
                  onClick={() => { close(); void newSession(); }}
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
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto px-8 py-6 space-y-4">
        {!active?.messages.length && !streaming && (
          <div className="text-center text-content-400 text-sm border border-dashed border-base-400 rounded-lg py-16 px-8">
            Talk directly with {character.name} to explore voice, motivation, secrets, or how they might react. These sessions stay inside this manuscript and never appear in Chats.
          </div>
        )}
        {active?.messages.map((message, index) => (
          <div key={`${message.createdAt}-${index}`} className={message.role === "user" ? "ml-auto max-w-[75%] rounded-lg bg-primary-500 text-primary-content px-4 py-2.5 whitespace-pre-wrap text-sm" : "max-w-[80%] panel px-4 py-3 text-sm"}>
            {message.role === "user" ? message.content : <Markdown text={message.content} />}
          </div>
        ))}
        {streaming && <div className="max-w-[80%] panel px-4 py-3 text-sm"><Markdown text={streaming} streaming /></div>}
      </main>

      <div className="px-8 pb-6">
        <InputBox
          textareaClassName="h-20"
          placeholder={`Message ${character.name}…`}
          value={input}
          onChange={setInput}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
          }}
        >
          <span className="flex-1 text-xs text-content-400 px-1">Enter to send · Shift+Enter for a new line</span>
          {busy ? (
            <Button variant="danger" size="sm" shape="square" title="Stop" onClick={() => abortRef.current?.abort()}><Square /></Button>
          ) : (
            <Button size="sm" shape="square" title="Send" disabled={!input.trim()} onClick={send}><SendHorizontal /></Button>
          )}
        </InputBox>
      </div>
    </div>
  );
}
