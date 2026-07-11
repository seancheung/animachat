"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import {
  ArrowLeft,
  Bookmark,
  ChevronRight,
  Clapperboard,
  Download,
  GitFork,
  MapPin,
  Maximize,
  PanelRightClose,
  PanelRightOpen,
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
import { Field } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import Alert from "@/components/ui/alert";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import Drawer from "@/components/ui/drawer";
import Input from "@/components/ui/input";
import Progress from "@/components/ui/progress";
import Slider from "@/components/ui/slider";
import Switch from "@/components/ui/switch";
import Textarea from "@/components/ui/textarea";
import { stagePanelBackground, stageStyleVars } from "@/lib/stageStyle";
import { api, assetUrl, downloadBlob, streamSse } from "@/lib/ui";
import { cn } from "@/utils/cn";
import { POV_LABELS, type Character, type Message, type Pov, type Settings } from "@/lib/types";

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
  const [panelHidden, setPanelHidden] = useState(false);
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

  if (!data || !chat) return <div className="p-8 text-content-300">Loading…</div>;

  // active scene/location coloring (location fields win) — gated by the global switch.
  // Per-surface token derivation lives in lib/stageStyle.ts.
  const stageStyle = settings?.stageStyleEnabled !== false ? data.stage?.stageStyle : null;
  const styleVars: React.CSSProperties | undefined = stageStyle
    ? (stageStyleVars(stageStyle) as React.CSSProperties)
    : undefined;
  const panelBg = stageStyle ? stagePanelBackground(stageStyle) : null;
  const panelInline: React.CSSProperties | undefined = stageStyle
    ? { ...(panelBg ? { backgroundColor: panelBg } : {}), ...styleVars }
    : undefined;

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
        <Alert variant="error" className="py-2">
          {error}{" "}
          {error.includes("No model") && (
            <a className="underline" href="/settings">
              → Settings
            </a>
          )}
        </Alert>
      )}
      <div className="flex gap-2 items-end">
        <Textarea
          ref={inputRef}
          className="flex-1 h-16 min-h-16 resize-none"
          placeholder={
            characters.length > 1
              ? `Write as ${personaName}… (*asterisks* for actions, @name/@all to address characters)`
              : `Write as ${personaName}… (*asterisks* for actions)`
          }
          value={input}
          onChange={setInput}
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
            <Button variant="danger" onClick={() => abortRef.current?.abort()}><Square /> Stop</Button>
          ) : (
            <Button disabled={!input.trim()} onClick={() => send()}>Send</Button>
          )}
          <div className="flex gap-1">
            <Button variant="secondary" size="sm" title="Wrap selection in *action*" onClick={wrapAction}>*…*</Button>
            <Button variant="secondary" size="sm" shape="square" title="AI drafts your reply" disabled={busy} onClick={impersonate}><Wand2 /></Button>
          </div>
        </div>
      </div>
      <div className="flex gap-1 flex-wrap items-center">
        <Button variant="secondary" size="sm" disabled={busy} title="Let the AI continue" onClick={() => generate({ mode: "auto" })}>
          <SkipForward /> Continue
        </Button>
        {chat.narratorEnabled && (
          <Button variant="secondary" size="sm" disabled={busy} title="Summon the narrator" onClick={() => generate({ mode: "narrator" })}>
            <ScrollText /> Narrate
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" shape="square" title={muted ? "Unmute" : "Mute"} onClick={() => setMuted(!muted)}>
          {muted ? <VolumeX /> : <Volume2 />}
        </Button>
        <div className="w-24 flex items-center">
          <Slider min={0} max={1} step={0.05} value={volume} onChange={setVolume} />
        </div>
        <Button variant="ghost" size="sm" shape="square" title="Fullscreen VN mode" onClick={() => setVnMode(true)}><Maximize /></Button>
        <Button variant="ghost" size="sm" shape="square" title="Chat settings" onClick={() => setDrawer(true)}><Settings2 /></Button>
      </div>
    </div>
  );

  const streamingRow = streaming && (
    <div className="flex gap-3 fade-in">
      <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 bg-base-400 flex items-center justify-center text-sm mt-1">
        {streaming.role === "narrator" ? <ScrollText size={15} /> : (
          characters.find((c) => c.id === streaming.characterId)?.name.slice(0, 1) ?? "?"
        )}
      </div>
      <div className="max-w-[78%]">
        <div className="text-xs text-content-300 mb-0.5 flex items-center gap-2">
          {streaming.role === "narrator" ? "Narrator" : characters.find((c) => c.id === streaming.characterId)?.name}
          {streaming.emotion && <Badge variant="secondary" rounded>{streaming.emotion}</Badge>}
        </div>
        <div className={cn("rounded-lg px-3.5 py-2.5 text-[0.925rem] leading-relaxed", streaming.role === "narrator" ? "border border-dashed border-base-400 italic" : "msg-bubble")}>
          <MessageText text={streaming.text} streaming />
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full relative">
      {/* full-bleed VN stage, sprites centered */}
      <div className="absolute inset-0">
        <VNStage
          characters={characters}
          emotions={emotions}
          speakingId={speakingId}
          backgroundUrl={assetUrl(data.stage?.artworkAsset)}
          backgroundColor={stageStyle?.background}
          tall
        />
      </div>

      {/* panel hidden — floating button on the stage brings it back */}
      {panelHidden && (
        <Button
          variant="secondary"
          size="sm"
          className="absolute top-3 right-3 z-10 shadow-lg"
          title="Show chat panel"
          onClick={() => setPanelHidden(false)}
        >
          <PanelRightOpen /> Chat{busy ? "…" : ""}
        </Button>
      )}

      {/* chat panel — floats over the stage on the right, translucent */}
      {!panelHidden && (
      <div
        className={cn(
          "absolute inset-y-0 right-0 z-10 w-full sm:w-[26rem] xl:w-[30rem] flex flex-col bg-base-200/45 sm:border-l border-base-400/60",
          settings?.chatPanelBlur !== false && "backdrop-blur-md"
        )}
        style={panelInline}
      >
      <div className="px-4 py-1.5 border-b border-base-400/60 flex items-center gap-2 text-sm">
        <Button variant="ghost" size="sm" shape="square" onClick={() => router.push("/")}><ArrowLeft /></Button>
        <span className="font-medium truncate">{chat.title}</span>
        {data.stage?.scene && <Badge variant="secondary" rounded><Clapperboard size={11} /> {data.stage.scene.name}</Badge>}
        {data.stage?.location && <Badge variant="secondary" rounded><MapPin size={11} /> {data.stage.location.name}</Badge>}
        <span className="flex-1" />
        {chat.language && <Badge variant="secondary" rounded>{chat.language}</Badge>}
        <Button variant="ghost" size="sm" shape="square" title="Hide chat panel" onClick={() => setPanelHidden(true)}><PanelRightClose /></Button>
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
            <div className="w-9 h-9 rounded-full shrink-0 bg-base-400 flex items-center justify-center text-sm mt-1 text-primary-500 font-semibold">
              {personaName.slice(0, 1).toUpperCase()}
            </div>
            <div className="max-w-[78%] rounded-lg px-3.5 py-2.5 bg-primary-500/15 text-[0.925rem]">
              <MessageText text={pendingUser} />
            </div>
          </div>
        )}
        {streamingRow}
      </div>

      <div className="px-4 py-3 border-t border-base-400/60">{inputBar}</div>
      </div>
      )}

      {/* -------- fullscreen VN mode -------- */}
      {vnMode && (
        <VnOverlay
          data={data}
          backgroundColor={stageStyle?.background}
          styleVars={styleVars}
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
      <Drawer open={drawer} onOpenChange={setDrawer} title="Chat settings" size="lg">
        <ChatDrawer
          data={data}
          onPatch={async (patch: any) => {
            await api.patch(`/api/chats/${id}`, patch);
            await mutate();
          }}
          onSwitch={switchScene}
          onCheckpointLoad={async (cpId: string, mode: "truncate" | "fork") => {
            if (mode === "truncate" && !(await confirmDialog({ title: "Rewind chat", message: "Rewind the chat to this save state? Later messages are deleted.", confirmLabel: "Rewind", danger: true }))) return;
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
      </Drawer>
    </div>
  );
}

/* ================= fullscreen VN overlay ================= */

function VnOverlay({
  data,
  backgroundColor,
  styleVars,
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
        <VNStage characters={characters} emotions={emotions} speakingId={speakingId} backgroundUrl={assetUrl(data.stage?.artworkAsset)} backgroundColor={backgroundColor} tall />
        <Button variant="secondary" size="sm" className="absolute top-3 right-3" onClick={onExit}><X /> Esc</Button>
        {!atEnd && (
          <Badge variant="secondary" rounded className="absolute top-3 left-3">
            history {idx + 1}/{messages.length} — click to advance
          </Badge>
        )}
      </div>
      <div
        className="mx-auto w-full max-w-3xl px-6 pb-5 -mt-28 relative z-10 cursor-pointer select-none"
        style={styleVars}
        onClick={() => setIdx((i: number) => Math.min(i + 1, messages.length - 1))}
      >
        <div className="msg-bubble msg-bubble-solid rounded-lg border border-base-400 backdrop-blur px-5 py-4 min-h-28 shadow-2xl">
          {speakerName && <div className="text-primary-500 text-sm font-semibold mb-1">{speakerName}</div>}
          <div className="text-[1.02rem] leading-relaxed">
            <MessageText text={displayText} streaming={!!streaming && atEnd} />
          </div>
          {atEnd && !busy && v?.options && (
            <div className="flex flex-col items-start gap-1.5 mt-3" onClick={(e) => e.stopPropagation()}>
              {v.options.map((o: string, i: number) => (
                <Button key={i} variant="secondary" size="sm" className="h-auto py-1 text-left whitespace-normal" onClick={() => send(o)}>
                  <ChevronRight /> {o}
                </Button>
              ))}
            </div>
          )}
        </div>
        {atEnd && (
          <div className="flex gap-2 mt-2 items-end" onClick={(e) => e.stopPropagation()}>
            <Textarea
              className="flex-1 h-12 min-h-12 resize-none"
              placeholder={`Write as ${personaName}…`}
              value={input}
              disabled={busy}
              onChange={setInput}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && input.trim()) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <Button size="sm" className="h-8" disabled={busy || !input.trim()} onClick={() => send()}>Send</Button>
            <Button variant="secondary" size="sm" shape="square" className="size-8" disabled={busy} onClick={() => generate({ mode: "auto" })}><SkipForward /></Button>
            {data.chat.narratorEnabled && (
              <Button variant="secondary" size="sm" shape="square" className="size-8" disabled={busy} onClick={() => generate({ mode: "narrator" })}><ScrollText /></Button>
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

  return (
    <div className="space-y-4">
      <Field label="Title">
        <Input className="w-full" value={title} onChange={setTitle} onBlur={() => onPatch({ title })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Folder">
          <Input className="w-full" value={folder} onChange={setFolder} onBlur={() => onPatch({ folder })} />
        </Field>
        <Field label="Tags (comma-separated)">
          <Input
            className="w-full"
            value={tags}
            onChange={setTags}
            onBlur={() => onPatch({ tags: tags.split(",").map((t: string) => t.trim()).filter(Boolean) })}
          />
        </Field>
      </div>
      <Field label="Model override">
        <ModelPicker value={chat.modelId} onChange={(v) => onPatch({ modelId: v })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Language">
          <div className="text-sm text-content-200 h-8 flex items-center">
            {chat.language || "(global default)"}
          </div>
        </Field>
        <Field label="POV">
          <div className="text-sm text-content-200 h-8 flex items-center">
            {POV_LABELS[chat.pov as Pov] ?? "(global default)"}
          </div>
        </Field>
      </div>
      <Field label="Narrator">
        <Switch
          value={chat.narratorEnabled}
          onChange={(v) => onPatch({ narratorEnabled: v })}
          label={chat.narratorEnabled ? "Enabled" : "Disabled"}
        />
      </Field>
      {data.characters.length > 1 && (
        <Field
          label="Infinite mentions"
          hint="characters keep passing the turn with @mentions for as long as they like — switching this off stops a running chain after the current reply"
        >
          <Switch
            value={!!chat.overrides?.infiniteMentions}
            onChange={(v) => onPatch({ overrides: { ...chat.overrides, infiniteMentions: v } })}
            label={chat.overrides?.infiniteMentions ? "Unlimited" : "Capped"}
          />
        </Field>
      )}
      {(Object.keys(data.relationships ?? {}).length > 0 ||
        Object.values(data.charRelationships ?? {}).some((l: any) => l.length)) && (
        <Field label="Relationships">
          <div className="space-y-2">
            {data.characters.map((c: Character) => {
              const r = data.relationships?.[c.id];
              const toChars: any[] = data.charRelationships?.[c.id] ?? [];
              if (!r && !toChars.length) return null;
              return (
                <div key={c.id} className="panel p-2.5 space-y-1.5">
                  {r && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span>{c.name}</span>
                        <span className="text-content-300">affinity {r.affinity}</span>
                      </div>
                      <Progress value={(r.affinity + 100) / 2} />
                      {r.notes && <div className="text-xs text-content-300">{r.notes}</div>}
                    </>
                  )}
                  {!r && <div className="text-sm">{c.name}</div>}
                  {toChars.map((cr) => (
                    <div key={cr.otherId} className="text-xs text-content-300">
                      → {cr.otherName}: {cr.affinity}
                      {cr.notes ? ` — ${cr.notes}` : ""}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </Field>
      )}

      {chat.mode === "story" && data.story && (
        <Field label={`Story: ${data.story.name}`} hint="switch scenes — recorded in the timeline, rewinds restore them">
          <div className="space-y-1">
            {data.storyScenes.map((s: any, i: number) => (
              <Button
                key={s.id}
                variant={data.stage?.sceneId === s.id ? "primary" : "secondary"}
                size="sm"
                className="w-full justify-start"
                onClick={() => onSwitch("scene", s.id)}
              >
                {i + 1}. {s.name}
              </Button>
            ))}
          </div>
        </Field>
      )}
      {chat.mode === "scene" && data.stage?.scene && (
        <Field label="Scene (fixed)">
          <Badge variant="secondary" rounded><Clapperboard size={11} /> {data.stage.scene.name}</Badge>
        </Field>
      )}
      {chat.mode === "location" && data.stage?.location && (
        <Field label="Location (fixed)">
          <Badge variant="secondary" rounded><MapPin size={11} /> {data.stage.location.name}</Badge>
        </Field>
      )}
      <Field label="Save states">
        <div className="space-y-1">
          {data.checkpoints.length === 0 && (
            <div className="text-xs text-content-400">none — use the bookmark button on any message</div>
          )}
          {data.checkpoints.map((cp: any) => (
            <div key={cp.id} className="flex items-center gap-1 bg-base-200 rounded-md px-2 py-1 text-sm">
              <span className="flex-1 truncate inline-flex items-center gap-1"><Bookmark size={12} /> {cp.name}</span>
              <Button variant="secondary" size="sm" title="Rewind here" onClick={() => onCheckpointLoad(cp.id, "truncate")}><Rewind /> Load</Button>
              <Button variant="secondary" size="sm" title="Fork a copy" onClick={() => onCheckpointLoad(cp.id, "fork")}><GitFork /> Fork</Button>
              <Button variant="ghost" size="sm" shape="square" onClick={() => onCheckpointDelete(cp.id)}><X /></Button>
            </div>
          ))}
        </div>
      </Field>
      <Field label="Export as novel">
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => downloadBlob(await fetch(`/api/chats/${chat.id}/novel?format=md`), "chat.md")}
          >
            <Download /> Markdown
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => downloadBlob(await fetch(`/api/chats/${chat.id}/novel?format=epub`), "chat.epub")}
          >
            <Download /> EPUB
          </Button>
        </div>
      </Field>
    </div>
  );
}
