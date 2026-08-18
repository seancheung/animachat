"use client";

import { useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MessageSquarePlus, SendHorizontal, Square } from "lucide-react";
import { InputBox } from "@/components/app";
import { Markdown } from "@/components/Markdown";
import Button from "@/components/ui/button";
import Select from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useGet } from "@/lib/queries";
import { api, streamSse, timestamp, uid } from "@/lib/ui";
import type { Fiction, FictionMessage, FictionSession } from "@/lib/types";

export default function FictionCharacterChatPage() {
  const { id, characterId } = useParams<{ id: string; characterId: string }>();
  const router = useRouter();
  const { data } = useGet<Fiction>(`/api/writings/${id}`);
  const [fiction, setFiction] = useState<Fiction | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  if (!fiction && data) setFiction(data);
  const character = fiction?.characters.find((c) => c.id === characterId);
  const sessions = useMemo(
    () => fiction?.sessions.filter((s) => s.kind === "character" && s.characterId === characterId) ?? [],
    [fiction?.sessions, characterId]
  );
  const active = sessions.find((s) => s.id === activeId) ?? sessions.at(-1) ?? null;
  if (active && activeId !== active.id) setActiveId(active.id);

  if (!fiction) return <div className="p-8 text-content-300">Loading…</div>;
  if (!character) return <div className="p-8 text-content-300">Character not found.</div>;
  const currentFiction = fiction;
  const currentCharacter = character;

  async function commitSession(session: FictionSession) {
    const nextSessions = currentFiction.sessions.some((s) => s.id === session.id)
      ? currentFiction.sessions.map((s) => s.id === session.id ? session : s)
      : [...currentFiction.sessions, session];
    const next: Fiction = { ...currentFiction, sessions: nextSessions };
    setFiction(next);
    await api.put(`/api/writings/${currentFiction.id}`, next);
  }

  async function newSession() {
    const t = timestamp();
    const session: FictionSession = {
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
    const user: FictionMessage = { role: "user", content: text, createdAt: timestamp() };
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
      await streamSse("/api/writings/generate", {
        action: "character-chat",
        fiction,
        characterId,
        messages: history,
      }, (ev) => {
        if (ev.type === "text") { acc += ev.text; setStreaming(acc); }
        else if (ev.type === "error") throw new Error(ev.message);
      }, abort.signal);
      if (acc.trim()) {
        const reply: FictionMessage = { role: "character", content: acc.trim(), createdAt: timestamp() };
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
        <Button variant="ghost" size="sm" onClick={() => router.push(`/writing/${id}`)}><ArrowLeft /> {fiction.name}</Button>
        <div className="ml-2">
          <div className="font-medium">{character.name}</div>
          <div className="text-xs text-content-400">Embedded character · private fiction chat</div>
        </div>
        <span className="flex-1" />
        <div className="w-64">
          <Select
            className="w-full"
            value={active?.id ?? null}
            onChange={setActiveId}
            options={sessions.map((s) => ({ value: s.id, label: s.title }))}
            placeholder="No session"
          />
        </div>
        <Button variant="secondary" title="Start a fresh session (no carried history)" onClick={newSession} disabled={busy}>
          <MessageSquarePlus /> New session
        </Button>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto px-8 py-6 space-y-4">
        {!active?.messages.length && !streaming && (
          <div className="text-center text-content-400 text-sm border border-dashed border-base-400 rounded-lg py-16 px-8">
            Talk directly with {character.name} to explore voice, motivation, secrets, or how they might react. These sessions stay inside this fiction and never appear in Chats.
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
