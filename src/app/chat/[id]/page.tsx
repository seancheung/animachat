"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Asterisk,
  CameraIcon,
  CameraOffIcon,
  Captions,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Download,
  Eye,
  MapPin,
  PanelRight,
  ScrollText,
  SendHorizontal,
  Settings2,
  SkipForward,
  Square,
  VenetianMask,
  Volume2,
  VolumeX,
  Wand2,
} from "lucide-react";
import { MIX, useBlip, useChatAudio, useEmotionSfx } from "@/components/chat/audio";
import { useTypewriter } from "@/components/chat/typewriter";
import { MessageRow } from "@/components/chat/MessageRow";
import { VNStage, type StageEmotions } from "@/components/chat/VNStage";
import { MessageText } from "@/components/MessageText";
import { ModelPicker } from "@/components/ModelPicker";
import { Field, Modal } from "@/components/app";
import { MentionInputBox } from "@/components/chat/MentionInputBox";
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
import { computeStage, resolveStageAssets } from "@/lib/stage";
import { stagePanelBackground, stageStyleVars } from "@/lib/stageStyle";
import { useGet } from "@/lib/queries";
import { api, assetUrl, downloadBlob, streamSse } from "@/lib/ui";
import { cn } from "@/utils/cn";
import {
  DEFAULT_SETTINGS,
  POV_LABELS,
  type Character,
  type ChatLayout,
  type Message,
  type Pov,
  type Settings,
} from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const DEFAULT_BLIP = "/defaults/sfx-typewriter.wav";

/** How long the user's own line holds the dialogue box, however fast the reply lands. */
const MIN_ECHO_MS = 700;

/** The wand turns into a Stop while the AI writes the user's reply into the input —
 *  same swap the Send button does during generation. Stopping keeps the partial draft. */
function ImpersonateButton({
  drafting,
  disabled,
  onClick,
  onStop,
}: {
  drafting: boolean;
  disabled: boolean;
  onClick: () => void;
  onStop: () => void;
}) {
  return drafting ? (
    <Button variant="danger" size="sm" shape="square" title="Stop drafting (keeps what's written)" onClick={onStop}>
      <Square />
    </Button>
  ) : (
    <Button variant="ghost" size="sm" shape="square" disabled={disabled} title="AI drafts your reply" onClick={onClick}>
      <Wand2 />
    </Button>
  );
}

/** One audio channel: the shared mute plus this channel's level (committed on release, so a
 *  drag doesn't PUT settings per pixel). */
function ChannelSlider({
  value,
  muted,
  onChange,
  onMute,
}: {
  value: number;
  muted: boolean;
  onChange: (v: number) => void;
  onMute: () => void;
}) {
  const [v, setV] = useState(value);
  const commit = () => v !== value && onChange(v);
  return (
    <div className="flex items-center gap-2 h-8">
      <Button variant="ghost" size="sm" shape="square" title={muted ? "Unmute" : "Mute"} onClick={onMute}>
        {muted ? <VolumeX /> : <Volume2 />}
      </Button>
      <div className={cn("flex-1 flex items-center", muted && "opacity-50")}>
        <Slider min={0} max={1} step={0.05} value={v} onChange={setV} onPointerUp={commit} onKeyUp={commit} />
      </div>
      <span className="text-sm text-content-300 w-9 text-right">{Math.round(v * 100)}%</span>
    </div>
  );
}

interface Streaming {
  role: "character" | "narrator";
  characterId: string | null;
  text: string;
  emotion: string | null;
  /** the current page has finished typing (dialogue box: waiting for the reader) */
  pageDone: boolean;
  /** there is more text past the current page */
  hasMore: boolean;
  /** regeneration: the message this reply replaces — it reveals in place on that row */
  forMessageId: string | null;
}

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, refetch: mutate } = useGet<any>(`/api/chats/${id}`);
  const { data: settings, refetch: mutateSettings } = useGet<Settings>("/api/settings");
  const queryClient = useQueryClient();

  const [streaming, setStreaming] = useState<Streaming | null>(null);
  // a turn is in flight from the very click: Continue/Narrate carry no user text and the
  // first reply only starts streaming once the orchestrator has picked a speaker
  const [generating, setGenerating] = useState(false);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  // the user's own line, held in the dialogue box until the reply starts arriving
  const [userEcho, setUserEcho] = useState<string | null>(null);
  const echoUntil = useRef(0);
  const echoDropping = useRef(false);
  // the AI is drafting the user's own reply (impersonate) — the input is its output slot,
  // so it stays locked until the draft lands
  const [drafting, setDrafting] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  // picture mode hides the chat UI (panel/dialogue box + stage chip) to enjoy the stage — never persisted
  const [pictureMode, setPictureMode] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const draftAbortRef = useRef<AbortController | null>(null);
  const openedRef = useRef(false);
  // leaving the page (or switching chats) cancels in-flight generation like a Stop press:
  // the server aborts with the dropped request instead of finishing a reply nobody awaits
  useEffect(
    () => () => {
      abortRef.current?.abort();
      draftAbortRef.current?.abort();
      // a fork navigates chat→chat without unmounting — the next chat gets its own opener
      openedRef.current = false;
    },
    [id]
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // typing SFX of whoever is speaking right now (per-character override, else the default blip)
  const blipUrlRef = useRef<string>(DEFAULT_BLIP);
  const blip = useBlip();

  const chat = data?.chat;
  // presentation layout — persisted per chat in overrides; the corner button and the settings drawer both write it
  const layout: ChatLayout = chat?.overrides?.layout === "dialogue" ? "dialogue" : "panel";
  const characters: Character[] = useMemo(() => data?.characters ?? [], [data]);
  const messages: Message[] = useMemo(() => data?.messages ?? [], [data]);
  const personaName = data?.persona?.name ?? "You";
  /** a turn is being generated (drives the Stop button) */
  const busy = generating || !!streaming || !!pendingUser;
  /** …or the AI is writing into the input: either way the user can't act */
  const locked = busy || drafting;

  // the dialogue box's backlog position (null = the live end). It lives up here because the
  // stage has to follow it: walking back through history replays the performance as it was.
  const timeline: Message[] = useMemo(() => messages.filter((m) => m.role !== "marker"), [messages]);
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const browseIdx = layout === "dialogue" && viewIdx !== null && viewIdx < timeline.length - 1 ? viewIdx : null;
  // the user's line owns the dialogue box until the reply appears — while it does, the stage
  // stays quiet too: nobody is speaking yet (the panel shows the reply as it streams, so it
  // keeps switching the sprite the moment the emotion tag lands)
  const echoing = layout === "dialogue" && userEcho !== null;
  // leaving the dialogue layout drops the backlog position — coming back always starts at
  // the live end, unless a show-on-stage jump (which sets viewIdx first) brought us here.
  // Render-time state adjustment (not an effect): react.dev "adjusting state when props change".
  const [prevLayout, setPrevLayout] = useState(layout);
  if (prevLayout !== layout) {
    setPrevLayout(layout);
    if (layout !== "dialogue") setViewIdx(null);
  }

  // the WHOLE stage follows the backlog: browsing recomputes scene, presence, assets and
  // styling as of the message on screen (story mode — elsewhere the stage never changes);
  // at the live end it's the server-resolved stage. Presentation only: the fiction is untouched.
  const viewStage = useMemo(() => {
    if (browseIdx === null || !chat?.storySnapshot) return data?.stage ?? null;
    const st = computeStage(chat, timeline.slice(0, browseIdx + 1));
    return { ...st, ...resolveStageAssets(chat, st) };
  }, [browseIdx, chat, timeline, data?.stage]);

  // story mode: only the on-stage cast is drawn; casual/immersive show everyone
  const present: string[] | null = viewStage?.present ?? null;
  const stageCharacters: Character[] = useMemo(
    () => (present ? characters.filter((c) => present.includes(c.id)) : characters),
    [characters, present]
  );

  /* ---- audio: music and sound effects are separate channels, under one mute ---- */
  const bgmVolume = settings?.bgmVolume ?? DEFAULT_SETTINGS.bgmVolume;
  const sfxVolume = settings?.sfxVolume ?? DEFAULT_SETTINGS.sfxVolume;
  const muted = settings?.audioMuted ?? DEFAULT_SETTINGS.audioMuted;
  // written straight to the global settings (they outlive the chat, like the other
  // presentation knobs); optimistic so a slider drag doesn't wait on the round trip
  const patchAudio = useCallback(
    (patch: Partial<Settings>) => {
      queryClient.setQueryData<Settings>(["/api/settings"], (s) => (s ? { ...s, ...patch } : s));
      void api.put("/api/settings", patch).then(() => mutateSettings());
    },
    [queryClient, mutateSettings]
  );

  useChatAudio({
    bgmUrl: assetUrl(viewStage?.bgmAsset),
    ambientUrl: assetUrl(viewStage?.ambientAsset),
    bgmVolume,
    sfxVolume,
    muted,
  });

  /** Hand the dialogue box back to the AI — but never before the user has had time to read
   *  their own line, or a fast model turns the send into a flicker. */
  const dropEcho = useCallback(() => {
    if (echoDropping.current) return;
    echoDropping.current = true;
    window.setTimeout(
      () => {
        setUserEcho(null);
        echoDropping.current = false;
      },
      Math.max(0, echoUntil.current - Date.now())
    );
  }, []);

  // the provider streams prose in bursts; the typewriter drains them at a steady
  // characters-per-second rate, and the blip follows the reveal rather than the network.
  // In the dialogue box the reveal stops at the end of each page and waits for the reader
  // (picture mode has no dialogue box to click, so it types straight through).
  const [streamPage, setStreamPage] = useState(0);
  const revealedRef = useRef(0);
  const typewriter = useTypewriter({
    speed: settings?.typingSpeed ?? DEFAULT_SETTINGS.typingSpeed,
    paginate: layout === "dialogue" && !pictureMode,
    pageIndex: streamPage,
    onReveal: ({ text, pageDone, hasMore }) => {
      setStreaming((s) => (s ? { ...s, text, pageDone, hasMore } : s));
      if (text) dropEcho(); // the reply has begun to appear — the user's line steps aside
      // only blip on characters actually typed (the reveal also re-emits on page turns)
      if (text.length > revealedRef.current && settings?.typingSfxEnabled && !muted) {
        blip.play(blipUrlRef.current, sfxVolume * MIX.blip);
      }
      revealedRef.current = text.length;
    },
  });

  /* ---- panel scrolling: pinned to the newest message unless the user reads back ---- */
  // "pinned" as a ref (the scroll effect reads it without re-binding) and as state (the
  // jump-to-latest button renders off it)
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  // the opening jump is instant and must happen again whenever the panel remounts
  const landedRef = useRef(false);
  useEffect(() => {
    landedRef.current = false;
  }, [id, layout, pictureMode]);

  const onPanelScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    pinnedRef.current = atBottom;
    setPinned(atBottom);
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = true;
    setPinned(true);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;
    if (!landedRef.current) {
      // opening the chat: land ON the newest message, no visible scroll from the top.
      // A second pass next frame catches avatars/sprites that changed the height.
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => {
        if (pinnedRef.current) el.scrollTop = el.scrollHeight;
      });
      landedRef.current = true;
      pinnedRef.current = true;
      setPinned(true);
      return;
    }
    // afterwards only follow the tail if the user hasn't scrolled back to read
    if (pinnedRef.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, streaming?.text, pendingUser, layout, pictureMode]);

  /* ---- stage emotions: each character's emotion as of the message on screen ---- */
  const emotions: StageEmotions = useMemo(() => {
    const upto = browseIdx ?? timeline.length - 1;
    const map: StageEmotions = {};
    for (let i = 0; i <= upto && i < timeline.length; i++) {
      const m = timeline[i];
      if (m.role === "character" && m.characterId) {
        map[m.characterId] = m.variants[m.activeVariant]?.emotion ?? "neutral";
      }
    }
    // the live reply's emotion only applies at the live end, once it is on screen
    if (browseIdx === null && !echoing && streaming?.characterId && streaming.emotion) {
      map[streaming.characterId] = streaming.emotion;
    }
    return map;
  }, [timeline, streaming, browseIdx, echoing]);

  // one-shot expression SFX on the sfx channel — follows the DISPLAYED emotion, so it
  // fires when the streamed <emo> tag lands, on swipes, and while browsing the backlog
  useEmotionSfx({ characters: stageCharacters, emotions, volume: sfxVolume, muted });

  // Esc leaves picture mode — the way out when the corner buttons are invisible.
  // Capture phase: the drawer's dismiss handler (floating-ui) takes Escape on the document
  // and stops it, so a bubble-phase listener would never see the key. An open dialog still
  // gets first refusal — Escape closes that, not picture mode.
  useEffect(() => {
    if (!pictureMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      setPictureMode(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pictureMode]);

  const speakingId: string | null = useMemo(() => {
    // browsing: whoever is speaking on the page being read (nobody, for user/narrator)
    if (browseIdx !== null) {
      const m = timeline[browseIdx];
      return m?.role === "character" ? m.characterId : null;
    }
    if (echoing) return null; // the user has the floor
    if (streaming) return streaming.characterId;
    if (characters.length < 2) return null;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const m = timeline[i];
      if (m.role === "character") return m.characterId;
      if (m.role === "user" || m.role === "narrator") return null;
    }
    return null;
  }, [timeline, streaming, characters.length, browseIdx, echoing]);

  /* ---- generation ---- */
  const generate = useCallback(
    async (body: any) => {
      if (locked) return;
      setError(null);
      setGenerating(true);
      if (body.userText) {
        setPendingUser(body.userText);
        // the dialogue box shows the user's line straight away, and keeps it for at least
        // MIN_ECHO_MS so an instant reply can't flash it past them
        setUserEcho(body.userText);
        echoUntil.current = Date.now() + MIN_ECHO_MS;
        echoDropping.current = false;
      }
      const abort = new AbortController();
      abortRef.current = abort;
      // Stop on a fully-arrived reply reveals the rest at once, VN skip-style; a reply
      // still streaming is incomplete — the server discards it, and the flushed text
      // clears with the streaming view
      abort.signal.addEventListener("abort", () => typewriter.flush());
      try {
        await streamSse(
          `/api/chats/${id}/generate`,
          body,
          async (ev) => {
            if (ev.type === "start") {
              setPendingUser(null);
              void mutate(); // pick up the just-appended user message
              const speaker = characters.find((c) => c.id === ev.speaker.characterId);
              blipUrlRef.current = assetUrl(speaker?.typingSfxAsset) ?? DEFAULT_BLIP;
              typewriter.reset();
              revealedRef.current = 0;
              setStreamPage(0);
              setStreaming({
                role: ev.speaker.role,
                characterId: ev.speaker.characterId,
                text: "",
                emotion: null,
                pageDone: false,
                hasMore: false,
                forMessageId: body.regenerateMessageId ?? null,
              });
            } else if (ev.type === "text") {
              typewriter.push(ev.text);
            } else if (ev.type === "emotion") {
              // one emotion per message — the FIRST tag wins, as the server stores it.
              // Honouring a stray later tag would swap the sprite mid-message and then
              // snap it back the moment the saved message (tagged with the first) lands.
              setStreaming((s) => (s ? { ...s, emotion: s.emotion ?? ev.name } : s));
            } else if (ev.type === "done") {
              // a turn can queue several speakers — let this reply finish typing first
              await typewriter.finish();
            } else if (ev.type === "error") {
              setError(ev.message);
            }
          },
          abort.signal
        );
        await typewriter.finish();
      } catch (e) {
        typewriter.flush();
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        abortRef.current = null;
        setPendingUser(null);
        dropEcho(); // a turn that produced nothing (error, stop) must still hand the box back
        // pull the saved reply in BEFORE dropping the streaming view: clearing it first
        // leaves the dialogue box a frame with nothing to show but the previous message
        // (the user's own), which reads as a flicker at the end of the reveal
        await mutate().catch(() => {});
        setStreaming(null);
        setGenerating(false);
      }
    },
    [locked, id, characters, mutate, typewriter, dropEcho]
  );

  function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || locked) return; // never clear the box for a send that can't happen
    setInput("");
    void generate({ mode: "auto", userText: text });
  }

  /** The draft streams straight into the input box; Stop keeps what has been written. */
  async function impersonate() {
    if (locked) return;
    setError(null);
    setDrafting(true);
    setInput("");
    const abort = new AbortController();
    draftAbortRef.current = abort;
    let draft = "";
    try {
      await streamSse(
        `/api/chats/${id}/impersonate`,
        {},
        (ev) => {
          if (ev.type === "text") {
            draft += ev.text;
            setInput(draft.trimStart());
          } else if (ev.type === "error") {
            setError(ev.message);
          }
        },
        abort.signal
      );
    } catch (e: any) {
      if (!abort.signal.aborted) setError(e.message);
    } finally {
      draftAbortRef.current = null;
      setInput(draft.trim());
      setDrafting(false);
      // after the re-render that re-enables the box: focus it with the caret after the
      // draft, ready to keep writing (a disabled textarea can't take focus any earlier)
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
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
      const s = data?.storyScenes?.find((x: any) => x.id === ev.sceneId);
      // non-snapshot chats: the server resolves event scene ids to names (sceneNames)
      parts.push(`Scene: ${s?.name ?? data?.sceneNames?.[ev.sceneId] ?? "?"}`);
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

  // jump from the log to the same message performed on the stage: the dialogue-box
  // layout opens with its backlog already positioned there (last message = the live end)
  const showOnStage = (m: Message) => {
    const i = timeline.findIndex((t) => t.id === m.id);
    setViewIdx(i >= 0 && i < timeline.length - 1 ? i : null);
    void switchLayout("dialogue");
  };

  // active scene/location coloring (location fields win) — gated by the global switch.
  // Per-surface token derivation lives in lib/stageStyle.ts. Styles supply colors only;
  // panel & bubble opacity are system settings.
  const stageStyle = settings?.stageStyleEnabled !== false ? viewStage?.stageStyle : null;
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
  const stageBadges = (viewStage?.scene || viewStage?.location) && (
    <>
      {viewStage?.scene && (
        <Badge variant="secondary" rounded className="max-w-56 overflow-hidden">
          <Clapperboard size={11} /> <span className="truncate">{viewStage.scene.name}</span>
        </Badge>
      )}
      {viewStage?.location && (
        <Badge variant="secondary" rounded className="max-w-56 overflow-hidden">
          <MapPin size={11} /> <span className="truncate">{viewStage.location.name}</span>
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
      <MentionInputBox
        mentionNames={stageCharacters.length > 1 ? stageCharacters.map((c) => c.name) : []}
        textareaRef={inputRef}
        placeholder={
          characters.length > 1
            ? `Speak as ${personaName}… (plain text = speech, *asterisks* = actions, @ to address)`
            : `Speak as ${personaName}… (plain text = speech, *asterisks* = actions)`
        }
        value={input}
        disabled={locked}
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
        <Button variant="ghost" size="sm" shape="square" disabled={locked} title="Wrap selection in *action* (Ctrl+*)" onClick={wrapAction}><Asterisk /></Button>
        <ImpersonateButton
          drafting={drafting}
          disabled={locked}
          onClick={impersonate}
          onStop={() => draftAbortRef.current?.abort()}
        />
        <span className="flex-1" />
        <Button variant="ghost" size="sm" shape="square" disabled={locked} title="Let the AI continue" onClick={() => generate({ mode: "auto" })}>
          <SkipForward />
        </Button>
        {chat.narratorEnabled && (
          <Button variant="ghost" size="sm" disabled={locked} title="Summon the narrator" onClick={() => generate({ mode: "narrator" })}>
            <ScrollText /> Narrate
          </Button>
        )}
        {busy ? (
          <Button variant="danger" size="sm" shape="square" title="Stop generating" onClick={() => abortRef.current?.abort()}><Square /></Button>
        ) : (
          <Button size="sm" shape="square" title="Send (Enter)" disabled={locked || !input.trim()} onClick={() => send()}><SendHorizontal /></Button>
        )}
      </MentionInputBox>
    </div>
  );

  // a regeneration reveals IN PLACE on the row it replaces — no phantom row at the tail
  const streamingRow = streaming && !streaming.forMessageId && (
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
          backgroundUrl={assetUrl(viewStage?.artworkAsset)}
          backgroundColor={stageStyle?.stageBg}
          tall
        />
      </div>

      {/* floating header — back button and the stage context chip
          (the chip remounts, and fades in, on scene/location change) */}
      <div className="absolute top-3 left-3 z-20 max-w-[75%] flex items-center gap-2">
        {/* picture mode wants an unobstructed stage: the button fades out entirely and
            comes back under the cursor (opacity doesn't affect hit-testing, so it stays
            exactly where the hand expects it) */}
        <Button
          variant="secondary"
          size="sm"
          shape="circle"
          className={cn(
            "shadow-lg shrink-0 hover:opacity-100 transition-opacity",
            pictureMode ? "opacity-0" : "opacity-40"
          )}
          title="Back to chats"
          onClick={() => router.push("/")}
        >
          <ArrowLeft />
        </Button>
        {viewStage?.ended && <Badge rounded className="shrink-0">The End</Badge>}
        {stageBadges && !pictureMode && (
          <div
            key={`${viewStage?.sceneId ?? ""}:${viewStage?.locationId ?? ""}`}
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
      <div
        ref={scrollRef}
        onScroll={onPanelScroll}
        className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-14 sm:pt-6 space-y-4"
      >
        {messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            characters={characters}
            nameSnapshots={chat.nameSnapshots}
            personaName={personaName}
            isLast={m.id === lastNonMarker?.id}
            busy={busy}
            streaming={streaming?.forMessageId === m.id ? { text: streaming.text, emotion: streaming.emotion } : null}
            sceneName={sceneNameFor(m)}
            onEdit={(patch) => patchMessage(m, patch)}
            onSwipe={(index) => patchMessage(m, { activeVariant: index })}
            onRegen={() => generate({ regenerateMessageId: m.id })}
            onDelete={async () => {
              await api.del(`/api/messages/${m.id}`);
              await mutate();
            }}
            onFork={async () => {
              if (!(await confirmDialog({
                title: "Fork chat",
                message: "Start a new chat from this point? Everything up to this message is copied — this chat stays untouched.",
                confirmLabel: "Fork",
              }))) return;
              const res = await api.post(`/api/chats/${id}/fork`, { messageId: m.id });
              router.push(`/chat/${res.chatId}`);
            }}
            onPickOption={(text) => send(text)}
            onShowOnStage={() => showOnStage(m)}
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

      {/* reading back through the log: one press returns to the newest message */}
      {!pinned && (
        <Button
          variant="secondary"
          size="sm"
          shape="circle"
          className={cn("absolute bottom-24 left-1/2 -translate-x-1/2 z-20 shadow-lg fade-in", busy && "animate-pulse")}
          title={busy ? "Jump to latest (still writing…)" : "Jump to latest"}
          onClick={jumpToLatest}
        >
          <ChevronDown />
        </Button>
      )}

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
          skipTyping={typewriter.skip}
          onTurnPage={() => setStreamPage((p) => p + 1)}
          viewIdx={viewIdx}
          setViewIdx={setViewIdx}
          userEcho={userEcho}
          personaName={personaName}
          busy={locked}
          generating={busy}
          stopGenerating={() => abortRef.current?.abort()}
          drafting={drafting}
          stopDrafting={() => draftAbortRef.current?.abort()}
          inputRef={inputRef}
          error={error}
          hidden={pictureMode}
          input={input}
          setInput={setInput}
          send={send}
          generate={generate}
          impersonate={impersonate}
          mentionNames={stageCharacters.length > 1 ? stageCharacters.map((c) => c.name) : []}
        />
      )}

      {/* corner controls — layout switch (persisted), settings, picture mode, mute.
          In picture mode the whole group hides until the cursor finds it. */}
      <div
        className={cn(
          "absolute bottom-3 left-3 z-20 flex flex-col gap-2 hover:opacity-100 transition-opacity",
          pictureMode ? "opacity-0" : "opacity-40"
        )}
      >
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
        {/* master mute — the per-channel levels live in the settings drawer */}
        <Button
          variant="secondary"
          size="sm"
          shape="circle"
          className="shadow-lg"
          title={muted ? "Unmute" : "Mute music & sound effects"}
          onClick={() => patchAudio({ audioMuted: !muted })}
        >
          {muted ? <VolumeX /> : <Volume2 />}
        </Button>
      </div>

      {/* -------- settings drawer -------- */}
      <Drawer open={drawer} onOpenChange={setDrawer} title="Chat settings" side="left" size="lg">
        <ChatDrawer
          data={data}
          muted={muted}
          bgmVolume={bgmVolume}
          sfxVolume={sfxVolume}
          onAudio={patchAudio}
          onPatch={async (patch: any) => {
            await api.patch(`/api/chats/${id}`, patch);
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
  skipTyping,
  onTurnPage,
  viewIdx,
  setViewIdx,
  userEcho,
  personaName,
  busy,
  generating,
  stopGenerating,
  drafting,
  stopDrafting,
  inputRef,
  error,
  hidden,
  input,
  setInput,
  send,
  generate,
  impersonate,
  mentionNames,
}: any) {
  const messages: Message[] = data.messages.filter((m: Message) => m.role !== "marker");
  // the backlog position is owned by the page (the stage follows it); null = the live end
  const idx: number = viewIdx ?? messages.length - 1;
  const setIdx = (i: number) => setViewIdx(i >= messages.length - 1 ? null : i);
  // paragraph page within the shown message — long messages advance VN-style,
  // paragraph by paragraph (display-only; the message itself stays whole).
  // Mounting mid-backlog (a show-on-stage jump) lands on the jumped message's last
  // page — it was already read in the log, no clicking through it again.
  const [page, setPage] = useState(() => (viewIdx !== null ? Number.MAX_SAFE_INTEGER : 0));
  const atEnd = idx >= messages.length - 1;
  const shown: Message | undefined = messages[Math.min(idx, messages.length - 1)];

  const v = shown?.variants[shown.activeVariant];
  // the user's own line holds the box from the moment they send until the reply appears —
  // it outranks both the streamed reply (still empty) and the message underneath
  const echo: string | null = atEnd && userEcho ? userEcho : null;
  const isStreamingShown = !!streaming && atEnd && !echo;
  const fullText: string = isStreamingShown ? streaming.text : v?.content ?? "";
  const split = fullText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pages = split.length ? split : [fullText];
  // a reply types into the page it belongs to and stops there: the typewriter never turns
  // the page on its own, so the last page revealed is the one being read
  const pageIdx = isStreamingShown ? pages.length - 1 : Math.min(page, pages.length - 1);
  // mid-reveal the chevron means "this page is typed out, there's more waiting"
  const hasMorePages = echo
    ? false
    : isStreamingShown
      ? streaming.pageDone && streaming.hasMore
      : pageIdx < pages.length - 1;
  const displayText = echo ?? pages[pageIdx] ?? "";
  // the input stays put (disabled) for the whole reply — page breaks during a reveal are
  // not the "unread pages" state that parks it, and blinking it in and out jitters the box
  const showInput = atEnd && (!!echo || isStreamingShown || !hasMorePages);

  // after a reply streamed in the user has already read it — land on its last
  // page instead of making them click through again; plain navigation starts at 0.
  // The flag is only consumed here: the streamed message arrives (via mutate) after
  // streaming has already flipped back to null, so clearing it on that transition
  // would lose the landing.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (streaming) wasStreaming.current = true;
  }, [streaming]);
  // reset only when the message count actually changes, not on mount: a show-on-stage
  // jump mounts this layout mid-backlog and must keep its position. Comparing against
  // a ref (not skipping "the first run") stays correct under StrictMode's double-invoke.
  const lastLen = useRef(messages.length);
  useEffect(() => {
    if (messages.length === lastLen.current) return;
    lastLen.current = messages.length;
    setViewIdx(null); // a new reply jumps back to the live end
    setPage(wasStreaming.current ? Number.MAX_SAFE_INTEGER : 0);
    wasStreaming.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const advance = () => {
    if (echo) return; // the user's own line: nothing to advance to until the reply arrives
    // mid-reveal, VN-style: a click first finishes typing this page, the next one turns
    // it — and while the page is still typing there is nothing to turn to yet
    if (isStreamingShown) {
      if (!streaming.pageDone) skipTyping?.();
      else if (streaming.hasMore) onTurnPage?.();
      return;
    }
    if (pageIdx < pages.length - 1) setPage(pageIdx + 1);
    else if (!atEnd) {
      setIdx(Math.min(idx + 1, messages.length - 1));
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
  // leave the backlog in one step, landing on the last page of the latest message so the
  // input is right there (it was already read — no clicking back through it)
  const toLive = () => {
    setViewIdx(null);
    setPage(Number.MAX_SAFE_INTEGER);
  };
  // latest-ref so the window listener binds once but always sees fresh page state
  const navRef = useRef({ advance, retreat, toLive, browsing: !atEnd });
  useEffect(() => {
    navRef.current = { advance, retreat, toLive, browsing: !atEnd };
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

  // Esc leaves the backlog entirely — only while browsing, so it stays free for whatever
  // else wants it at the live end. Capture phase, because the drawer's dismiss handler
  // (floating-ui) takes Escape on the document and stops it before it can bubble; an open
  // dialog still gets first refusal.
  useEffect(() => {
    if (hidden) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !navRef.current.browsing) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      navRef.current.toLive();
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
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
  const speakerName = echo
    ? personaName
    : streaming && atEnd
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
          history {idx + 1}/{messages.length} — scroll or ←/→, Esc to return
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
                  <ChevronRight /> <MessageText text={o} />
                </Button>
              ))}
            </div>
          )}
        </div>
        {showInput && (
          <div className="mt-2 cursor-auto" onClick={(e) => e.stopPropagation()}>
            <MentionInputBox
              mentionNames={mentionNames ?? []}
              textareaRef={inputRef}
              textareaClassName="h-10"
              placeholder={
                mentionNames?.length
                  ? `Speak as ${personaName}… (plain text = speech, *asterisks* = actions, @ to address)`
                  : `Speak as ${personaName}… (plain text = speech, *asterisks* = actions)`
              }
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
              <ImpersonateButton
                drafting={drafting}
                disabled={busy}
                onClick={impersonate}
                onStop={stopDrafting}
              />
              <span className="flex-1" />
              <Button variant="ghost" size="sm" shape="square" title="Let the AI continue" disabled={busy} onClick={() => generate({ mode: "auto" })}><SkipForward /></Button>
              {data.chat.narratorEnabled && (
                <Button variant="ghost" size="sm" shape="square" title="Summon the narrator" disabled={busy} onClick={() => generate({ mode: "narrator" })}><ScrollText /></Button>
              )}
              {generating ? (
                <Button variant="danger" size="sm" shape="square" title="Stop generating" onClick={stopGenerating}><Square /></Button>
              ) : (
                <Button size="sm" shape="square" title="Send (Enter)" disabled={busy || !input.trim()} onClick={() => send()}><SendHorizontal /></Button>
              )}
            </MentionInputBox>
          </div>
        )}
      </div>
    </>
  );
}

/* ================= chat settings drawer ================= */

function NovelExportDialog({ chatId, open, onClose }: { chatId: string; open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<"plain" | "rewrite">("plain");
  const [voice, setVoice] = useState<"third" | "first">("third");
  const [progress, setProgress] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // closing the dialog aborts a running rewrite — nothing keeps generating unseen
  const close = () => {
    abortRef.current?.abort();
    setProgress(null);
    setNotices([]);
    setError(null);
    onClose();
  };

  async function exportAs(format: "md" | "epub") {
    setError(null);
    setNotices([]);
    if (mode === "plain") {
      downloadBlob(await fetch(`/api/chats/${chatId}/novel?format=${format}`), `chat.${format}`);
      return;
    }
    const abort = new AbortController();
    abortRef.current = abort;
    setProgress("Starting…");
    try {
      let finished = false;
      await streamSse(
        `/api/chats/${chatId}/novel`,
        { format, voice },
        (ev) => {
          if (ev.type === "progress")
            setProgress(
              `Rewriting chapter ${ev.chapter}/${ev.total}` +
                (ev.title ? ` — ${ev.title}` : "") +
                (ev.parts > 1 ? ` (part ${ev.part}/${ev.parts})` : "") +
                "…"
            );
          else if (ev.type === "notice")
            setNotices((n) => [...n, `One section kept the plain transcript: ${ev.message}`]);
          else if (ev.type === "done") {
            const blob =
              ev.format === "epub"
                ? new Blob([Uint8Array.from(atob(ev.data), (c) => c.charCodeAt(0))], {
                    type: "application/epub+zip",
                  })
                : new Blob([ev.data], { type: "text/markdown" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = ev.filename;
            a.click();
            URL.revokeObjectURL(a.href);
            finished = true;
          }
        },
        abort.signal
      );
      if (!finished) throw new Error("The rewrite ended before producing a file.");
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }

  const busy = progress !== null;
  return (
    <Modal open={open} onClose={close} title="Export as novel">
      <div className="space-y-4">
        <Field label="Mode">
          <SegmentedControl
            className="w-full"
            size="sm"
            value={mode}
            onChange={(v) => setMode(v)}
            items={[
              { value: "plain", label: "Plain transcript" },
              {
                value: "rewrite",
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Wand2 size={13} /> AI rewrite
                  </span>
                ),
              },
            ]}
          />
          <div className="text-xs text-content-400 pt-1">
            {mode === "plain"
              ? "instant — a speaker-labeled script with chapter headings"
              : "the novelize task model rewrites the chat into book prose, chapter by chapter"}
          </div>
        </Field>
        {mode === "rewrite" && (
          <Field label="Narrative voice">
            <SegmentedControl
              className="w-full"
              size="sm"
              value={voice}
              onChange={(v) => setVoice(v)}
              items={[
                { value: "third", label: "Third person" },
                { value: "first", label: "First person" },
              ]}
            />
          </Field>
        )}
        {error && (
          <Alert variant="error" className="py-2">
            {error}
          </Alert>
        )}
        {notices.length > 0 && (
          <div className="text-xs text-content-400 space-y-0.5">
            {notices.map((n, i) => (
              <div key={i}>{n}</div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => exportAs("md")}>
            <Download /> Markdown
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => exportAs("epub")}>
            <Download /> EPUB
          </Button>
          {busy && (
            <>
              <span className="text-xs text-content-300 flex-1 truncate">{progress}</span>
              <Button variant="danger" size="sm" onClick={() => abortRef.current?.abort()}>
                <Square /> Stop
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ChatDrawer({
  data,
  muted,
  bgmVolume,
  sfxVolume,
  onAudio,
  onPatch,
}: any) {
  const chat = data.chat;
  const [title, setTitle] = useState(chat.title);
  const [folder, setFolder] = useState(chat.folder);
  const [tags, setTags] = useState(chat.tags.join(", "));
  const [novelOpen, setNovelOpen] = useState(false);

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
      <Field label="Music" hint="the scene/location BGM">
        <ChannelSlider
          muted={muted}
          value={bgmVolume}
          onMute={() => onAudio({ audioMuted: !muted })}
          onChange={(v: number) => onAudio({ bgmVolume: v })}
        />
      </Field>
      <Field label="Sound effects" hint="ambient loops and typing blips">
        <ChannelSlider
          muted={muted}
          value={sfxVolume}
          onMute={() => onAudio({ audioMuted: !muted })}
          onChange={(v: number) => onAudio({ sfxVolume: v })}
        />
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
      {/* the player's knowledge: what their played character holds, and what's out in the open */}
      {chat.mode === "story" &&
        (() => {
          const secrets: any[] = chat.storySnapshot?.secrets ?? [];
          const revealed: string[] = data.stage?.revealed ?? [];
          const mine = secrets.filter(
            (s) => chat.personaCharacterId && s.knownBy.includes(chat.personaCharacterId) && !revealed.includes(s.id)
          );
          const open = secrets.filter((s) => revealed.includes(s.id));
          if (!mine.length && !open.length) return null;
          return (
            <Field label="Secrets" hint="what you know that others don't — and what the story has revealed">
              <div className="space-y-1.5">
                {mine.map((s) => (
                  <div key={s.id} className="panel p-2.5 text-xs space-y-0.5">
                    <div className="flex items-center gap-1.5 text-sm text-content-100">
                      <VenetianMask size={13} /> {s.title}
                      <Badge variant="secondary" rounded className="ml-auto">only you know</Badge>
                    </div>
                    <div className="text-content-300">{s.content}</div>
                  </div>
                ))}
                {open.map((s) => (
                  <div key={s.id} className="panel p-2.5 text-xs space-y-0.5">
                    <div className="flex items-center gap-1.5 text-sm text-content-100">
                      <Eye size={13} /> {s.title}
                      <Badge rounded className="ml-auto">revealed</Badge>
                    </div>
                    <div className="text-content-300">{s.content}</div>
                  </div>
                ))}
              </div>
            </Field>
          );
        })()}
      {chat.mode === "immersive" && (data.stage?.scene || data.stage?.location) && (
        <Field label="Setting (fixed)">
          <div className="flex gap-1.5">
            {data.stage?.scene && <Badge variant="secondary" rounded><Clapperboard size={11} /> {data.stage.scene.name}</Badge>}
            {data.stage?.location && <Badge variant="secondary" rounded><MapPin size={11} /> {data.stage.location.name}</Badge>}
          </div>
        </Field>
      )}
      <Field label="Export as novel" hint="a plain speaker-labeled transcript, or an AI rewrite into book prose">
        <Button variant="secondary" size="sm" onClick={() => setNovelOpen(true)}>
          <Download /> Export…
        </Button>
        <NovelExportDialog chatId={chat.id} open={novelOpen} onClose={() => setNovelOpen(false)} />
      </Field>
      <Field
        label="Export chat"
        hint="a self-contained archive (messages, swipes, playthrough assets) — re-import it from the chat list"
      >
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => downloadBlob(await fetch(`/api/chats/${chat.id}/archive`), "chat.zip")}
        >
          <Download /> Archive (.zip)
        </Button>
      </Field>
    </div>
  );
}
