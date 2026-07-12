"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import {
  ArrowLeft,
  Asterisk,
  Bookmark,
  CameraIcon,
  CameraOffIcon,
  Captions,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Download,
  GitFork,
  MapPin,
  PanelRight,
  Rewind,
  ScrollText,
  SendHorizontal,
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
import { Field, InputBox } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import Alert from "@/components/ui/alert";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import Drawer from "@/components/ui/drawer";
import Input from "@/components/ui/input";
import Progress from "@/components/ui/progress";
import SegmentedControl from "@/components/ui/segmented-control";
import Slider from "@/components/ui/slider";
import Switch from "@/components/ui/switch";
import { stagePanelBackground, stageStyleVars } from "@/lib/stageStyle";
import { api, assetUrl, downloadBlob, streamSse } from "@/lib/ui";
import { cn } from "@/utils/cn";
import { POV_LABELS, type Character, type ChatLayout, type Message, type Pov, type Settings } from "@/lib/types";

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

  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  // picture mode hides the chat UI (panel/dialogue box + stage chip) to enjoy the stage — never persisted
  const [pictureMode, setPictureMode] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const openedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const blip = useBlip();

  const chat = data?.chat;
  // presentation layout — persisted per chat in overrides; the corner button and the settings drawer both write it
  const layout: ChatLayout = chat?.overrides?.layout === "dialogue" ? "dialogue" : "panel";
  const characters: Character[] = useMemo(() => data?.characters ?? [], [data]);
  const messages: Message[] = useMemo(() => data?.messages ?? [], [data]);
  const personaName = data?.persona?.name ?? "You";
  const busy = !!streaming || !!pendingUser;
  // story mode: only the on-stage cast is drawn; casual/immersive show everyone
  const present: string[] | null = data?.stage?.present ?? null;
  const stageCharacters: Character[] = useMemo(
    () => (present ? characters.filter((c) => present.includes(c.id)) : characters),
    [characters, present]
  );

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

  // human-readable stage direction for a narrator message's events
  const charName = (cid: string) =>
    characters.find((c) => c.id === cid)?.name ?? chat?.nameSnapshots?.[cid] ?? "?";
  const sceneNameFor = (m: Message): string | null => {
    const ev = m.sceneEvent;
    if (!ev) return null;
    const parts: string[] = [];
    if (ev.sceneId) {
      const s =
        data?.storyScenes?.find((x: any) => x.id === ev.sceneId) ??
        allScenes?.find((x) => x.id === ev.sceneId);
      parts.push(`Scene: ${s?.name ?? "?"}`);
    }
    if (ev.enter?.length) parts.push(`Enter ${ev.enter.map(charName).join(", ")}`);
    if (ev.leave?.length) parts.push(`Exit ${ev.leave.map(charName).join(", ")}`);
    if (ev.theEnd) parts.push("The End");
    return parts.length ? parts.join(" · ") : null;
  };

  // the narrator always speaks first — fire its opening turn once the empty chat loads
  useEffect(() => {
    if (!data?.chat?.narratorEnabled || messages.length > 0 || busy || openedRef.current) return;
    openedRef.current = true;
    void generate({ mode: "narrator" });
  }, [data, messages.length, busy, generate]);

  if (!data || !chat) return <div className="p-8 text-content-300">Loading…</div>;

  const switchLayout = async (v: ChatLayout) => {
    await api.patch(`/api/chats/${id}`, { overrides: { ...chat.overrides, layout: v } });
    await mutate();
  };

  // active scene/location coloring (location fields win) — gated by the global switch.
  // Per-surface token derivation lives in lib/stageStyle.ts. Styles supply colors only;
  // panel & bubble opacity are system settings.
  const stageStyle = settings?.stageStyleEnabled !== false ? data.stage?.stageStyle : null;
  const styleVars: React.CSSProperties | undefined = stageStyle
    ? (stageStyleVars(stageStyle) as React.CSSProperties)
    : undefined;
  const chatOpacity = settings?.chatPanelOpacity ?? 0.3;
  const panelInline: React.CSSProperties = {
    backgroundColor: stagePanelBackground(stageStyle?.panelBg, chatOpacity),
    ...(styleVars ?? {}),
  };
  const chatOpacityVar = {
    "--chat-opacity": `${Math.round(chatOpacity * 100)}%`,
  } as React.CSSProperties;

  const lastNonMarker = [...messages].reverse().find((m) => m.role !== "marker");

  // scene & location context — lives on the stage (top-left chip); on narrow screens,
  // where the panel covers the stage, it falls back to a strip under the panel header
  const stageBadges = (data.stage?.scene || data.stage?.location) && (
    <>
      {data.stage?.scene && (
        <Badge variant="secondary" rounded className="max-w-56 overflow-hidden">
          <Clapperboard size={11} /> <span className="truncate">{data.stage.scene.name}</span>
        </Badge>
      )}
      {data.stage?.location && (
        <Badge variant="secondary" rounded className="max-w-56 overflow-hidden">
          <MapPin size={11} /> <span className="truncate">{data.stage.location.name}</span>
        </Badge>
      )}
    </>
  );
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
      <InputBox
        textareaRef={inputRef}
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
      >
        <Button variant="ghost" size="sm" shape="square" title="Wrap selection in *action* (Ctrl+*)" onClick={wrapAction}><Asterisk /></Button>
        <Button variant="ghost" size="sm" shape="square" title="AI drafts your reply" disabled={busy} onClick={impersonate}><Wand2 /></Button>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" shape="square" disabled={busy} title="Let the AI continue" onClick={() => generate({ mode: "auto" })}>
          <SkipForward />
        </Button>
        {chat.narratorEnabled && (
          <Button variant="ghost" size="sm" disabled={busy} title="Summon the narrator" onClick={() => generate({ mode: "narrator" })}>
            <ScrollText /> Narrate
          </Button>
        )}
        {busy ? (
          <Button variant="danger" size="sm" shape="square" title="Stop generating" onClick={() => abortRef.current?.abort()}><Square /></Button>
        ) : (
          <Button size="sm" shape="square" title="Send (Enter)" disabled={!input.trim()} onClick={() => send()}><SendHorizontal /></Button>
        )}
      </InputBox>
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
    <div className="h-full relative" style={chatOpacityVar}>
      {/* full-bleed VN stage, sprites centered */}
      <div className="absolute inset-0">
        <VNStage
          characters={stageCharacters}
          emotions={emotions}
          speakingId={speakingId}
          backgroundUrl={assetUrl(data.stage?.artworkAsset)}
          backgroundColor={stageStyle?.stageBg}
          tall
        />
      </div>

      {/* floating header — back button and the stage context chip
          (the chip remounts, and fades in, on scene/location change) */}
      <div className="absolute top-3 left-3 z-20 max-w-[75%] flex items-center gap-2">
        <Button variant="secondary" size="sm" shape="circle" className="shadow-lg shrink-0 opacity-40 hover:opacity-100 transition-opacity" title="Back to chats" onClick={() => router.push("/")}>
          <ArrowLeft />
        </Button>
        {data.ended && <Badge rounded className="shrink-0">The End</Badge>}
        {stageBadges && !pictureMode && (
          <div
            key={`${data.stage?.sceneId ?? ""}:${data.stage?.locationId ?? ""}`}
            className="flex items-center gap-1.5 fade-in"
            style={styleVars}
          >
            {stageBadges}
          </div>
        )}
      </div>

      {/* chat panel — floats over the stage on the right, translucent */}
      {layout === "panel" && !pictureMode && (
      <div
        className={cn(
          "absolute inset-y-0 right-0 z-10 w-full sm:w-104 xl:w-120 flex flex-col sm:border-l border-base-400/60",
          settings?.chatPanelBlur !== false && "backdrop-blur-md"
        )}
        style={panelInline}
      >
      {/* extra top padding on narrow screens clears the floating header, which sits over the full-width panel */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-14 sm:pt-6 space-y-4">
        {messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            characters={characters}
            nameSnapshots={chat.nameSnapshots}
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
            <div className="chip-initial w-9 h-9 rounded-full shrink-0 bg-base-400 flex items-center justify-center text-sm mt-1 font-semibold">
              {personaName.slice(0, 1).toUpperCase()}
            </div>
            <div className="max-w-[78%] rounded-lg px-3.5 py-2.5 bg-primary-500/15 text-[0.925rem]">
              <MessageText text={pendingUser} />
            </div>
          </div>
        )}
        {streamingRow}
      </div>

      {/* corner-button clearance on narrow screens, where the panel spans the full width */}
      <div className="px-4 pt-3 pb-16 sm:pb-3 border-t border-base-400/60">{inputBar}</div>
      </div>
      )}

      {/* -------- dialogue layout — VN dialogue box + input over the stage -------- */}
      {layout === "dialogue" && (
        <DialogueLayout
          data={data}
          styleVars={styleVars}
          characters={characters}
          streaming={streaming}
          personaName={personaName}
          busy={busy}
          error={error}
          hidden={pictureMode}
          input={input}
          setInput={setInput}
          send={send}
          generate={generate}
          impersonate={impersonate}
        />
      )}

      {/* corner controls — layout switch (persisted), settings, picture mode */}
      <div className="absolute bottom-3 left-3 z-20 flex flex-col gap-2 opacity-40 hover:opacity-100 transition-opacity">
        <Button
          variant="secondary"
          size="sm"
          shape="circle"
          className="shadow-lg"
          title={layout === "panel" ? "Switch to dialogue box layout" : "Switch to side panel layout"}
          onClick={() => switchLayout(layout === "panel" ? "dialogue" : "panel")}
        >
          {layout === "panel" ? <Captions /> : <PanelRight />}
        </Button>
        <Button variant="secondary" size="sm" shape="circle" className="shadow-lg" title="Chat settings" onClick={() => setDrawer(true)}>
          <Settings2 />
        </Button>
        <Button
          variant={pictureMode ? undefined : "secondary"}
          size="sm"
          shape="circle"
          className={cn("shadow-lg", pictureMode && busy && "animate-pulse")}
          title={pictureMode ? `Exit picture mode${busy ? " (generating…)" : ""}` : "Picture mode — hide the chat UI"}
          onClick={() => setPictureMode(!pictureMode)}
        >
          {pictureMode ? <CameraOffIcon /> : <CameraIcon />}
        </Button>
      </div>

      {/* -------- settings drawer -------- */}
      <Drawer open={drawer} onOpenChange={setDrawer} title="Chat settings" side="left" size="lg">
        <ChatDrawer
          data={data}
          muted={muted}
          setMuted={setMuted}
          volume={volume}
          setVolume={setVolume}
          onPatch={async (patch: any) => {
            await api.patch(`/api/chats/${id}`, patch);
            await mutate();
          }}
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

/* ================= dialogue layout — VN dialogue box over the stage ================= */

function DialogueLayout({
  data,
  styleVars,
  characters,
  streaming,
  personaName,
  busy,
  error,
  hidden,
  input,
  setInput,
  send,
  generate,
  impersonate,
}: any) {
  const messages: Message[] = data.messages.filter((m: Message) => m.role !== "marker");
  const [idx, setIdx] = useState(messages.length - 1);
  // paragraph page within the shown message — long messages advance VN-style,
  // paragraph by paragraph (display-only; the message itself stays whole)
  const [page, setPage] = useState(0);
  const atEnd = idx >= messages.length - 1;
  const shown: Message | undefined = messages[Math.min(idx, messages.length - 1)];

  const v = shown?.variants[shown.activeVariant];
  const isStreamingShown = !!streaming && atEnd;
  const fullText: string = isStreamingShown ? streaming.text : v?.content ?? "";
  const split = fullText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pages = split.length ? split : [fullText];
  const pageIdx = Math.min(page, pages.length - 1);
  const hasMorePages = !isStreamingShown && pageIdx < pages.length - 1;
  // a streaming reply shows live in full; otherwise the current paragraph page
  const displayText = isStreamingShown ? fullText : pages[pageIdx] ?? "";

  // after a reply streamed in the user has already read it — land on its last
  // page instead of making them click through again; plain navigation starts at 0.
  // The flag is only consumed here: the streamed message arrives (via mutate) after
  // streaming has already flipped back to null, so clearing it on that transition
  // would lose the landing.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (streaming) wasStreaming.current = true;
  }, [streaming]);
  useEffect(() => {
    setIdx(messages.length - 1);
    setPage(wasStreaming.current ? Number.MAX_SAFE_INTEGER : 0);
    wasStreaming.current = false;
  }, [messages.length]);

  const advance = () => {
    if (isStreamingShown) return;
    if (pageIdx < pages.length - 1) setPage(pageIdx + 1);
    else if (!atEnd) {
      setIdx((i: number) => Math.min(i + 1, messages.length - 1));
      setPage(0);
    }
  };
  // backlog: previous page, or the LAST page of the previous message (mirror of advance)
  const retreat = () => {
    if (!isStreamingShown && pageIdx > 0) setPage(pageIdx - 1);
    else if (idx > 0) {
      setIdx(idx - 1);
      setPage(Number.MAX_SAFE_INTEGER);
    }
  };
  // latest-ref so the window listener binds once but always sees fresh page state
  const navRef = useRef({ advance, retreat });
  useEffect(() => {
    navRef.current = { advance, retreat };
  });

  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      const typing =
        document.activeElement?.tagName === "TEXTAREA" || document.activeElement?.tagName === "INPUT";
      if (typing) return;
      if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        navRef.current.advance();
      }
      if (e.key === "ArrowLeft" || e.key === "Backspace") {
        e.preventDefault();
        navRef.current.retreat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidden]);

  // wheel on the stage navigates (VN backlog gesture); wheel over the dialogue
  // box keeps scrolling the box's own overflowing content natively
  const wheelAcc = useRef(0);
  const onStageWheel = (e: React.WheelEvent) => {
    wheelAcc.current += e.deltaY;
    if (wheelAcc.current > 40) {
      navRef.current.advance();
      wheelAcc.current = 0;
    } else if (wheelAcc.current < -40) {
      navRef.current.retreat();
      wheelAcc.current = 0;
    }
  };

  // the box is height-capped and scrolls internally — follow the tail while
  // streaming, start a freshly turned page at its top
  const textRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = textRef.current;
    el?.scrollTo({ top: isStreamingShown ? el.scrollHeight : 0 });
  }, [displayText, isStreamingShown]);
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

  if (hidden) return null; // stays mounted so the backlog position survives picture mode

  return (
    <>
      {/* invisible layer over the stage — wheel steps through the backlog */}
      <div className="absolute inset-0" onWheel={onStageWheel} />
      {!atEnd && (
        <Badge variant="secondary" rounded className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
          history {idx + 1}/{messages.length} — scroll or ←/→
        </Badge>
      )}
      <div
        className="absolute inset-x-0 bottom-0 z-10 mx-auto w-full max-w-3xl px-6 pb-16 sm:pb-5 cursor-pointer select-none"
        style={styleVars}
        onClick={advance}
      >
        {error && (
          <div className="mb-2 cursor-auto" onClick={(e) => e.stopPropagation()}>
            <Alert variant="error" className="py-2">
              {error}{" "}
              {error.includes("No model") && (
                <a className="underline" href="/settings">
                  → Settings
                </a>
              )}
            </Alert>
          </div>
        )}
        <div className="msg-bubble vn-dialog relative flex max-h-[38vh] min-h-28 flex-col rounded-lg border border-base-400 backdrop-blur px-5 py-4 shadow-2xl">
          {speakerName && <div className="vn-speaker text-sm font-semibold mb-1 shrink-0">{speakerName}</div>}
          <div ref={textRef} className="min-h-0 flex-1 overflow-y-auto text-[1.02rem] leading-relaxed">
            <MessageText text={displayText} streaming={isStreamingShown} />
          </div>
          {hasMorePages && (
            <ChevronDown className="absolute right-3 bottom-2 size-4 animate-bounce text-content-300" />
          )}
          {atEnd && !hasMorePages && !busy && v?.options && (
            <div className="flex shrink-0 flex-col items-start gap-1.5 mt-3" onClick={(e) => e.stopPropagation()}>
              {v.options.map((o: string, i: number) => (
                <Button key={i} variant="secondary" size="sm" className="h-auto py-1 text-left whitespace-normal" onClick={() => send(o)}>
                  <ChevronRight /> {o}
                </Button>
              ))}
            </div>
          )}
        </div>
        {atEnd && !hasMorePages && (
          <div className="mt-2 cursor-auto" onClick={(e) => e.stopPropagation()}>
            <InputBox
              textareaClassName="h-10"
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
            >
              <Button variant="ghost" size="sm" shape="square" title="AI drafts your reply" disabled={busy} onClick={impersonate}><Wand2 /></Button>
              <span className="flex-1" />
              <Button variant="ghost" size="sm" shape="square" title="Let the AI continue" disabled={busy} onClick={() => generate({ mode: "auto" })}><SkipForward /></Button>
              {data.chat.narratorEnabled && (
                <Button variant="ghost" size="sm" shape="square" title="Summon the narrator" disabled={busy} onClick={() => generate({ mode: "narrator" })}><ScrollText /></Button>
              )}
              <Button size="sm" shape="square" title="Send (Enter)" disabled={busy || !input.trim()} onClick={() => send()}><SendHorizontal /></Button>
            </InputBox>
          </div>
        )}
      </div>
    </>
  );
}

/* ================= chat settings drawer ================= */

function ChatDrawer({
  data,
  muted,
  setMuted,
  volume,
  setVolume,
  onPatch,
  onCheckpointLoad,
  onCheckpointDelete,
}: any) {
  const chat = data.chat;
  const [title, setTitle] = useState(chat.title);
  const [folder, setFolder] = useState(chat.folder);
  const [tags, setTags] = useState(chat.tags.join(", "));

  return (
    <div className="space-y-4">
      <Field label="Chat layout" hint="side panel chat log, or a VN dialogue box over the stage — the corner button switches it too">
        <SegmentedControl
          className="w-full"
          size="sm"
          value={chat.overrides?.layout === "dialogue" ? "dialogue" : "panel"}
          onChange={(v) => onPatch({ overrides: { ...chat.overrides, layout: v } })}
          items={[
            { value: "panel", label: (<span className="inline-flex items-center gap-1.5"><PanelRight size={13} /> Side panel</span>) },
            { value: "dialogue", label: (<span className="inline-flex items-center gap-1.5"><Captions size={13} /> Dialogue box</span>) },
          ]}
        />
      </Field>
      <Field label="Volume">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" shape="square" title={muted ? "Unmute" : "Mute"} onClick={() => setMuted(!muted)}>
            {muted ? <VolumeX /> : <Volume2 />}
          </Button>
          <div className="flex-1 flex items-center">
            <Slider min={0} max={1} step={0.05} value={volume} onChange={setVolume} />
          </div>
        </div>
      </Field>
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
      <Field label="Narrator" hint="fixed at creation">
        <div className="text-sm text-content-200 h-8 flex items-center gap-1.5">
          <ScrollText size={14} /> {chat.narratorEnabled ? "Enabled" : "Disabled"}
        </div>
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

      {chat.mode === "story" && data.storyName && (
        <Field
          label={`Playthrough — ${data.storyName}`}
          hint="the narrator advances scenes and directs who is on stage; rewinds restore both"
        >
          <div className="space-y-1">
            {data.storyScenes.map((s: any, i: number) => (
              <div
                key={s.id}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1 text-sm",
                  data.stage?.sceneId === s.id ? "bg-primary-500/15 text-content-100" : "text-content-300"
                )}
              >
                <Clapperboard size={12} /> {i + 1}. {s.name}
                {data.stage?.sceneId === s.id && !data.ended && (
                  <Badge variant="secondary" rounded className="ml-auto">current</Badge>
                )}
              </div>
            ))}
            {data.ended && <Badge rounded>The End — epilogue</Badge>}
            {data.stage?.present && (
              <div className="text-xs text-content-300 pt-1">
                On stage: {data.characters
                  .filter((c: Character) => data.stage.present.includes(c.id))
                  .map((c: Character) => c.name)
                  .join(", ") || "(nobody)"}
              </div>
            )}
          </div>
        </Field>
      )}
      {chat.mode === "immersive" && (data.stage?.scene || data.stage?.location) && (
        <Field label="Setting (fixed)">
          <div className="flex gap-1.5">
            {data.stage?.scene && <Badge variant="secondary" rounded><Clapperboard size={11} /> {data.stage.scene.name}</Badge>}
            {data.stage?.location && <Badge variant="secondary" rounded><MapPin size={11} /> {data.stage.location.name}</Badge>}
          </div>
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
