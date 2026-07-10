"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import {
  ArrowLeft,
  Bookmark,
  Clapperboard,
  Download,
  GitFork,
  MapPin,
  Maximize,
  MessageCircle,
  Rewind,
  ScrollText,
  Settings2,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from "lucide-react";
import { useBlip, useChatAudio } from "@/components/chat/audio";
import { MessageRow } from "@/components/chat/MessageRow";
import { VNStage, type StageEmotions } from "@/components/chat/VNStage";
import { MessageText } from "@/components/MessageText";
import { ModelPicker } from "@/components/ModelPicker";
import { Field, Modal } from "@/components/ui";
import { api, assetUrl, cls, downloadBlob, streamSse } from "@/lib/ui";
import { POV_LABELS, type Character, type Message, type Settings } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const DEFAULT_BLIP = "/defaults/sfx-typewriter.wav";

interface Streaming {
  role: "character" | "narrator";
  characterId: string | null;
  text: string;
  emotion: string | null;
}

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, mutate } = useSWR<any>(`/api/chats/${id}`, api.get);
  const { data: settings } = useSWR<Settings>("/api/settings", api.get);
  const { data: allScenes } = useSWR<any[]>("/api/scenes", api.get);
  const { data: allLocations } = useSWR<any[]>("/api/locations", api.get);

  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [vnMode, setVnMode] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const blip = useBlip();

  const chat = data?.chat;
  const characters: Character[] = useMemo(() => data?.characters ?? [], [data]);
  const messages: Message[] = useMemo(() => data?.messages ?? [], [data]);
  const personaName = data?.persona?.name ?? "You";
  const busy = !!streaming || !!pendingUser;

  useChatAudio({
    bgmUrl: assetUrl(data?.stage?.bgmAsset),
    ambientUrl: assetUrl(data?.stage?.ambientAsset),
    volume,
    muted,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, streaming?.text, pendingUser]);

  /* ---- stage emotions: last emotion per character, streaming overrides ---- */
  const emotions: StageEmotions = useMemo(() => {
    const map: StageEmotions = {};
    for (const m of messages) {
      if (m.role === "character" && m.characterId) {
        map[m.characterId] = m.variants[m.activeVariant]?.emotion ?? "neutral";
      }
    }
    if (streaming?.characterId && streaming.emotion) map[streaming.characterId] = streaming.emotion;
    return map;
  }, [messages, streaming]);

  const speakingId: string | null = useMemo(() => {
    if (streaming) return streaming.characterId;
    if (characters.length < 2) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "character") return m.characterId;
      if (m.role === "user" || m.role === "narrator") return null;
    }
    return null;
  }, [messages, streaming, characters.length]);

  /* ---- generation ---- */
  const generate = useCallback(
    async (body: any) => {
      if (busy) return;
      setError(null);
      if (body.userText) setPendingUser(body.userText);
      const abort = new AbortController();
      abortRef.current = abort;
      let speakerChar: Character | undefined;
      try {
        await streamSse(
          `/api/chats/${id}/generate`,
          body,
          (ev) => {
            if (ev.type === "start") {
              setPendingUser(null);
              void mutate(); // pick up the just-appended user message
              speakerChar = characters.find((c) => c.id === ev.speaker.characterId);
              setStreaming({ role: ev.speaker.role, characterId: ev.speaker.characterId, text: "", emotion: null });
            } else if (ev.type === "text") {
              setStreaming((s) => (s ? { ...s, text: s.text + ev.text } : s));
              if (settings?.typingSfxEnabled && !muted) {
                blip.play(assetUrl(speakerChar?.typingSfxAsset) ?? DEFAULT_BLIP, volume * 0.5);
              }
            } else if (ev.type === "emotion") {
              setStreaming((s) => (s ? { ...s, emotion: ev.name } : s));
            } else if (ev.type === "error") {
              setError(ev.message);
            }
          },
          abort.signal
        );
      } catch (e) {
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        abortRef.current = null;
        setPendingUser(null);
        setStreaming(null);
        void mutate();
      }
    },
    [busy, id, characters, settings, muted, volume, blip, mutate]
  );

  function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text) return;
    setInput("");
    void generate({ mode: "auto", userText: text });
  }

  async function impersonate() {
    if (busy) return;
    setError(null);
    try {
      const { text } = await api.post(`/api/chats/${id}/impersonate`);
      setInput(text);
      inputRef.current?.focus();
    } catch (e: any) {
      setError(e.message);
    }
  }

  /* ---- message operations ---- */
  const patchMessage = async (m: Message, patch: any) => {
    await api.patch(`/api/messages/${m.id}`, patch);
    await mutate();
  };

  const sceneNameFor = (m: Message): string | null => {
    if (m.sceneEvent?.kind === "scene")
      return allScenes?.find((s) => s.id === m.sceneEvent?.sceneId)?.name ?? null;
    if (m.sceneEvent?.kind === "location")
      return allLocations?.find((l) => l.id === m.sceneEvent?.locationId)?.name ?? null;
    return null;
  };

  async function switchScene(kind: "scene" | "location", targetId: string) {
    await api.post(`/api/chats/${id}/messages`, {
      role: "marker",
      sceneEvent: kind === "scene" ? { kind, sceneId: targetId } : { kind, locationId: targetId },
    });
    await mutate();
  }

  if (!data || !chat) return <div className="p-8 text-[var(--text-dim)]">Loading…</div>;

  const lastNonMarker = [...messages].reverse().find((m) => m.role !== "marker");
  const wrapAction = () => {
    const el = inputRef.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const inner = value.slice(a, b) || "action";
    setInput(value.slice(0, a) + `*${inner}*` + value.slice(b));
    el.focus();
  };

  const inputBar = (
    <div className="space-y-2">
      {error && (
        <div className="text-xs text-[var(--danger)] px-1">
          ⚠ {error} {error.includes("No model") && <a className="underline" href="/settings">→ Settings</a>}
        </div>
      )}
      <div className="flex gap-2 items-end">
        <textarea
          ref={inputRef}
          className="input h-16 resize-none"
          placeholder={`Write as ${personaName}… (*asterisks* for actions)`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
            if (e.key === "*" && e.ctrlKey) {
              e.preventDefault();
              wrapAction();
            }
          }}
        />
        <div className="flex flex-col gap-1">
          {busy ? (
            <button className="btn btn-danger" onClick={() => abortRef.current?.abort()}><Square size={13} /> Stop</button>
          ) : (
            <button className="btn btn-primary" disabled={!input.trim()} onClick={() => send()}>Send</button>
          )}
          <div className="flex gap-1">
            <button className="btn btn-sm" title="Wrap selection in *action*" onClick={wrapAction}>*…*</button>
            <button className="btn btn-sm" title="AI drafts your reply" disabled={busy} onClick={impersonate}><Wand2 size={14} /></button>
          </div>
        </div>
      </div>
      <div className="flex gap-1 flex-wrap items-center">
        <button className="btn btn-sm" disabled={busy} title="Let the AI continue" onClick={() => generate({ mode: "auto" })}>
          <SkipForward size={13} /> Continue
        </button>
        {chat.narratorEnabled && (
          <button className="btn btn-sm" disabled={busy} title="Summon the narrator" onClick={() => generate({ mode: "narrator" })}>
            <ScrollText size={13} /> Narrate
          </button>
        )}
        {characters.length > 1 &&
          characters.map((c) => (
            <button key={c.id} className="btn btn-sm" disabled={busy} title={`Make ${c.name} speak`} onClick={() => generate({ mode: "character", characterId: c.id })}>
              <MessageCircle size={13} /> {c.name}
            </button>
          ))}
        <div className="flex-1" />
        <button className="btn btn-sm btn-ghost" title={muted ? "Unmute" : "Mute"} onClick={() => setMuted(!muted)}>
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-20 accent-[var(--accent)]" />
        <button className="btn btn-sm btn-ghost" title="Fullscreen VN mode" onClick={() => setVnMode(true)}><Maximize size={15} /></button>
        <button className="btn btn-sm btn-ghost" title="Chat settings" onClick={() => setDrawer(true)}><Settings2 size={15} /></button>
      </div>
    </div>
  );

  const streamingRow = streaming && (
    <div className="flex gap-3 fade-in">
      <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 bg-[var(--panel-2)] flex items-center justify-center text-sm mt-1">
        {streaming.role === "narrator" ? <ScrollText size={15} /> : (
          characters.find((c) => c.id === streaming.characterId)?.name.slice(0, 1) ?? "?"
        )}
      </div>
      <div className="max-w-[78%]">
        <div className="text-xs text-[var(--text-dim)] mb-0.5">
          {streaming.role === "narrator" ? "Narrator" : characters.find((c) => c.id === streaming.characterId)?.name}
          {streaming.emotion && <span className="chip ml-2">{streaming.emotion}</span>}
        </div>
        <div className={cls("rounded-xl px-3.5 py-2.5 text-[0.925rem] leading-relaxed", streaming.role === "narrator" ? "border border-dashed border-[var(--border)] italic" : "bg-[var(--panel)]")}>
          <MessageText text={streaming.text} streaming />
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col lg:flex-row">
      {/* VN stage — left column on wide screens */}
      <div className="h-64 md:h-80 lg:h-full lg:w-[44%] xl:w-[46%] shrink-0 lg:border-r border-b lg:border-b-0 border-[var(--border)]">
        <VNStage
          characters={characters}
          emotions={emotions}
          speakingId={speakingId}
          backgroundUrl={assetUrl(data.stage?.artworkAsset)}
          tall
        />
      </div>

      {/* chat panel — right column */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div className="px-4 py-1.5 border-b border-[var(--border)] bg-[var(--bg-soft)] flex items-center gap-2 text-sm">
        <button className="btn btn-sm btn-ghost" onClick={() => router.push("/")}><ArrowLeft size={15} /></button>
        <span className="font-medium truncate">{chat.title}</span>
        {data.stage?.scene && <span className="chip"><Clapperboard size={11} /> {data.stage.scene.name}</span>}
        {data.stage?.location && <span className="chip"><MapPin size={11} /> {data.stage.location.name}</span>}
        <span className="flex-1" />
        {chat.language && <span className="chip">{chat.language}</span>}
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            characters={characters}
            personaName={personaName}
            isLast={m.id === lastNonMarker?.id}
            busy={busy}
            sceneName={sceneNameFor(m)}
            onEdit={(patch) => patchMessage(m, patch)}
            onSwipe={(index) => patchMessage(m, { activeVariant: index })}
            onRegen={() => generate({ regenerateMessageId: m.id })}
            onDelete={async () => {
              await api.del(`/api/messages/${m.id}`);
              await mutate();
            }}
            onCheckpoint={async () => {
              const name = prompt("Save state name:", "Checkpoint");
              if (name === null) return;
              await api.post(`/api/chats/${id}/checkpoints`, { messageId: m.id, name });
              await mutate();
            }}
            onPickOption={(text) => send(text)}
          />
        ))}
        {pendingUser && (
          <div className="flex flex-row-reverse gap-3 fade-in opacity-70">
            <div className="w-9 h-9 rounded-full shrink-0 bg-[var(--panel-2)] flex items-center justify-center text-sm mt-1 text-[var(--accent)] font-semibold">
              {personaName.slice(0, 1).toUpperCase()}
            </div>
            <div className="max-w-[78%] rounded-xl px-3.5 py-2.5 bg-[#312a4d] text-[0.925rem]">
              <MessageText text={pendingUser} />
            </div>
          </div>
        )}
        {streamingRow}
      </div>

      <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-soft)]">{inputBar}</div>
      </div>

      {/* -------- fullscreen VN mode -------- */}
      {vnMode && (
        <VnOverlay
          data={data}
          characters={characters}
          emotions={emotions}
          speakingId={speakingId}
          streaming={streaming}
          personaName={personaName}
          busy={busy}
          input={input}
          setInput={setInput}
          send={send}
          generate={generate}
          onExit={() => setVnMode(false)}
        />
      )}

      {/* -------- settings drawer -------- */}
      <Modal open={drawer} onClose={() => setDrawer(false)} title="Chat settings" wide>
        <ChatDrawer
          data={data}
          onPatch={async (patch: any) => {
            await api.patch(`/api/chats/${id}`, patch);
            await mutate();
          }}
          onSwitch={switchScene}
          onCheckpointLoad={async (cpId: string, mode: "truncate" | "fork") => {
            if (mode === "truncate" && !confirm("Rewind the chat to this save state? Later messages are deleted.")) return;
            const res = await api.post(`/api/checkpoints/${cpId}`, { mode });
            if (mode === "fork") router.push(`/chat/${res.chatId}`);
            else {
              await mutate();
              setDrawer(false);
            }
          }}
          onCheckpointDelete={async (cpId: string) => {
            await api.del(`/api/checkpoints/${cpId}`);
            await mutate();
          }}
        />
      </Modal>
    </div>
  );
}

/* ================= fullscreen VN overlay ================= */

function VnOverlay({
  data,
  characters,
  emotions,
  speakingId,
  streaming,
  personaName,
  busy,
  input,
  setInput,
  send,
  generate,
  onExit,
}: any) {
  const messages: Message[] = data.messages.filter((m: Message) => m.role !== "marker");
  const [idx, setIdx] = useState(messages.length - 1);
  const atEnd = idx >= messages.length - 1;
  const shown: Message | undefined = messages[Math.min(idx, messages.length - 1)];

  useEffect(() => {
    setIdx(messages.length - 1);
  }, [messages.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
      if ((e.key === " " || e.key === "Enter") && document.activeElement?.tagName !== "TEXTAREA" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        setIdx((i: number) => Math.min(i + 1, messages.length - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [messages.length, onExit]);

  const v = shown?.variants[shown.activeVariant];
  const displayText = streaming && atEnd ? streaming.text : v?.content ?? "";
  const speakerName =
    streaming && atEnd
      ? streaming.role === "narrator"
        ? "Narrator"
        : characters.find((c: Character) => c.id === streaming.characterId)?.name
      : shown?.role === "user"
        ? personaName
        : shown?.role === "narrator"
          ? "Narrator"
          : characters.find((c: Character) => c.id === shown?.characterId)?.name;

  return (
    <div className="fixed inset-0 z-40 bg-black flex flex-col">
      <div className="flex-1 relative min-h-0">
        <VNStage characters={characters} emotions={emotions} speakingId={speakingId} backgroundUrl={assetUrl(data.stage?.artworkAsset)} tall />
        <button className="absolute top-3 right-3 btn btn-sm" onClick={onExit}><X size={13} /> Esc</button>
        {!atEnd && (
          <div className="absolute top-3 left-3 chip">history {idx + 1}/{messages.length} — click to advance</div>
        )}
      </div>
      <div
        className="mx-auto w-full max-w-3xl px-6 pb-5 -mt-28 relative z-10 cursor-pointer select-none"
        onClick={() => setIdx((i: number) => Math.min(i + 1, messages.length - 1))}
      >
        <div className="rounded-xl border border-[var(--border)] bg-[rgba(18,16,26,0.92)] backdrop-blur px-5 py-4 min-h-28 shadow-2xl">
          {speakerName && <div className="text-[var(--accent)] text-sm font-semibold mb-1">{speakerName}</div>}
          <div className="text-[1.02rem] leading-relaxed">
            <MessageText text={displayText} streaming={!!streaming && atEnd} />
          </div>
          {atEnd && !busy && v?.options && (
            <div className="flex flex-col items-start gap-1.5 mt-3" onClick={(e) => e.stopPropagation()}>
              {v.options.map((o: string, i: number) => (
                <button key={i} className="btn btn-sm text-left whitespace-normal" onClick={() => send(o)}>
                  ▸ {o}
                </button>
              ))}
            </div>
          )}
        </div>
        {atEnd && (
          <div className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
            <input
              className="input"
              placeholder={`Write as ${personaName}…`}
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && input.trim() && send()}
            />
            <button className="btn btn-primary btn-sm" disabled={busy || !input.trim()} onClick={() => send()}>Send</button>
            <button className="btn btn-sm" disabled={busy} onClick={() => generate({ mode: "auto" })}><SkipForward size={13} /></button>
            {data.chat.narratorEnabled && (
              <button className="btn btn-sm" disabled={busy} onClick={() => generate({ mode: "narrator" })}><ScrollText size={13} /></button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= chat settings drawer ================= */

function ChatDrawer({
  data,
  onPatch,
  onSwitch,
  onCheckpointLoad,
  onCheckpointDelete,
}: any) {
  const chat = data.chat;
  const [title, setTitle] = useState(chat.title);
  const [folder, setFolder] = useState(chat.folder);
  const [tags, setTags] = useState(chat.tags.join(", "));
  const [language, setLanguage] = useState(chat.language);

  return (
    <div className="grid md:grid-cols-2 gap-5">
      <div className="space-y-3">
        <Field label="Title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => onPatch({ title })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Folder">
            <input className="input" value={folder} onChange={(e) => setFolder(e.target.value)} onBlur={() => onPatch({ folder })} />
          </Field>
          <Field label="Tags (comma-separated)">
            <input
              className="input"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              onBlur={() => onPatch({ tags: tags.split(",").map((t: string) => t.trim()).filter(Boolean) })}
            />
          </Field>
        </div>
        <Field label="Model override">
          <ModelPicker value={chat.modelId} onChange={(v) => onPatch({ modelId: v })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Language override">
            <input className="input" placeholder="(global default)" value={language} onChange={(e) => setLanguage(e.target.value)} onBlur={() => onPatch({ language })} />
          </Field>
          <Field label="POV">
            <select className="input" value={chat.pov} onChange={(e) => onPatch({ pov: e.target.value })}>
              <option value="">(global default)</option>
              {Object.entries(POV_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Narrator">
          <select className="input" value={chat.narratorEnabled ? "on" : "off"} onChange={(e) => onPatch({ narratorEnabled: e.target.value === "on" })}>
            <option value="off">Disabled</option>
            <option value="on">Enabled</option>
          </select>
        </Field>
        {Object.keys(data.relationships ?? {}).length > 0 && (
          <Field label="Relationships">
            <div className="space-y-2">
              {data.characters.map((c: Character) => {
                const r = data.relationships[c.id];
                if (!r) return null;
                return (
                  <div key={c.id} className="panel p-2.5">
                    <div className="flex justify-between text-sm">
                      <span>{c.name}</span>
                      <span className="text-[var(--text-dim)]">affinity {r.affinity}</span>
                    </div>
                    <div className="h-1.5 rounded bg-[var(--bg-soft)] mt-1 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[#7c3aed] to-[#f0abfc]" style={{ width: `${(r.affinity + 100) / 2}%` }} />
                    </div>
                    {r.notes && <div className="text-xs text-[var(--text-dim)] mt-1">{r.notes}</div>}
                  </div>
                );
              })}
            </div>
          </Field>
        )}
      </div>

      <div className="space-y-3">
        {chat.mode === "story" && data.story && (
          <Field label={`Story: ${data.story.name}`} hint="switch scenes — recorded in the timeline, rewinds restore them">
            <div className="space-y-1">
              {data.storyScenes.map((s: any, i: number) => (
                <button
                  key={s.id}
                  className={cls("btn btn-sm w-full justify-start", data.stage?.sceneId === s.id && "btn-primary")}
                  onClick={() => onSwitch("scene", s.id)}
                >
                  {i + 1}. {s.name}
                </button>
              ))}
            </div>
          </Field>
        )}
        {chat.mode === "scene" && data.stage?.scene && (
          <Field label="Scene (fixed)">
            <span className="chip"><Clapperboard size={11} /> {data.stage.scene.name}</span>
          </Field>
        )}
        {chat.mode === "location" && data.stage?.location && (
          <Field label="Location (fixed)">
            <span className="chip"><MapPin size={11} /> {data.stage.location.name}</span>
          </Field>
        )}
        <Field label="Save states">
          <div className="space-y-1">
            {data.checkpoints.length === 0 && (
              <div className="text-xs text-[var(--text-dim)]">none — use the bookmark button on any message</div>
            )}
            {data.checkpoints.map((cp: any) => (
              <div key={cp.id} className="flex items-center gap-1 bg-[var(--bg-soft)] rounded-lg px-2 py-1 text-sm">
                <span className="flex-1 truncate inline-flex items-center gap-1"><Bookmark size={12} /> {cp.name}</span>
                <button className="btn btn-sm" title="Rewind here" onClick={() => onCheckpointLoad(cp.id, "truncate")}><Rewind size={13} /> Load</button>
                <button className="btn btn-sm" title="Fork a copy" onClick={() => onCheckpointLoad(cp.id, "fork")}><GitFork size={13} /> Fork</button>
                <button className="btn btn-sm btn-ghost" onClick={() => onCheckpointDelete(cp.id)}><X size={13} /></button>
              </div>
            ))}
          </div>
        </Field>
        <Field label="Export as novel">
          <div className="flex gap-2">
            <button
              className="btn btn-sm"
              onClick={async () => downloadBlob(await fetch(`/api/chats/${chat.id}/novel?format=md`), "chat.md")}
            >
              <Download size={13} /> Markdown
            </button>
            <button
              className="btn btn-sm"
              onClick={async () => downloadBlob(await fetch(`/api/chats/${chat.id}/novel?format=epub`), "chat.epub")}
            >
              <Download size={13} /> EPUB
            </button>
          </div>
        </Field>
      </div>
    </div>
  );
}
