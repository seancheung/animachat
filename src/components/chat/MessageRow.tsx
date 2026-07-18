"use client";

import { memo, useState } from "react";
import {
  Captions,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  GitFork,
  Pencil,
  RefreshCw,
  ScrollText,
  Trash2,
} from "lucide-react";
import { MessageText } from "@/components/MessageText";
import { confirmDialog } from "@/components/confirm";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import Select from "@/components/ui/select";
import Textarea from "@/components/ui/textarea";
import { assetUrl } from "@/lib/ui";
import { cn } from "@/utils/cn";
import { EMOTIONS, type Character, type Message } from "@/lib/types";

/** Hover timestamp: time for today, date + time when older. */
function fmtReceived(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  const date =
    d.getFullYear() === now.getFullYear()
      ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : d.toLocaleDateString(undefined, { dateStyle: "short" });
  return `${date}, ${time}`;
}

export const MessageRow = memo(function MessageRow({
  message,
  characters,
  nameSnapshots,
  personaName,
  humanNarrator,
  isLast,
  busy,
  streaming,
  sceneName,
  pureChat,
  fadeIn = true,
  onEdit,
  onSwipe,
  onRegen,
  onDelete,
  onFork,
  onPickOption,
  onShowOnStage,
}: {
  message: Message;
  characters: Character[];
  /** characterId -> name at chat creation; display fallback for deleted characters */
  nameSnapshots?: Record<string, string>;
  personaName: string;
  /** the USER plays the narrator — narrator messages are theirs (editable, never regenerable) */
  humanNarrator?: boolean;
  isLast: boolean;
  busy: boolean;
  /** a regeneration of THIS message is streaming — reveal it in place of the current variant */
  streaming?: { text: string; emotion: string | null } | null;
  /** stage direction derived from the message's events ("Scene: X · Enter Y · The End") */
  sceneName?: string | null;
  /** pure chat (casual): paragraph breaks render as separate texting bubbles
   *  (display-only — the stored message stays whole, edits work on the raw text),
   *  and there is no emotion to edit */
  pureChat?: boolean;
  /** false = mount without the fade-in entrance — a saved reply replacing its own
   *  streaming row is already on screen and must not blink into place */
  fadeIn?: boolean;
  onEdit: (patch: { content?: string; emotion?: string | null }) => Promise<void>;
  onSwipe: (index: number) => Promise<void>;
  onRegen: () => void;
  onDelete: () => Promise<void>;
  /** fork a new chat from this point (non-destructive — this chat is untouched) */
  onFork: () => Promise<void>;
  onPickOption: (text: string) => void;
  /** jump to this message performed on the VN stage (dialogue-box layout) */
  onShowOnStage?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftEmotion, setDraftEmotion] = useState<string>("");

  if (message.role === "marker") {
    // legacy manual switches from pre-playthrough chats — display only
    return (
      <div className="text-center my-2 fade-in">
        <Badge variant="secondary" rounded>
          <Clapperboard size={11} /> {sceneName ?? "scene change"}
        </Badge>
      </div>
    );
  }

  const v = message.variants[message.activeVariant];
  if (!v) return null;
  const char = message.role === "character" ? characters.find((c) => c.id === message.characterId) : null;
  const name =
    message.role === "user"
      ? personaName
      : message.role === "narrator"
        ? "Narrator"
        : char?.name ?? nameSnapshots?.[message.characterId ?? ""] ?? "???";
  const emotionChoices = [
    ...EMOTIONS,
    ...(char?.customExpressions.map((e) => e.name) ?? []),
  ];

  return (
    <div className={cn("group flex gap-3", fadeIn && "fade-in", message.role === "user" && "flex-row-reverse")}>
      <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 bg-base-400 flex items-center justify-center text-sm mt-1">
        {message.role === "narrator" ? (
          <ScrollText size={15} className="text-content-300" />
        ) : char?.avatarAsset ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(char.avatarAsset)!} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="chip-initial font-semibold">{name.slice(0, 1).toUpperCase()}</span>
        )}
      </div>

      <div className={cn("max-w-[78%] min-w-0", message.role === "user" && "text-right")}>
        <div className="text-xs text-content-300 mb-0.5 flex items-center gap-2">
          <span className={cn(message.role === "user" && "ml-auto")}>{name}</span>
          {message.role === "character" && (streaming ? streaming.emotion : v.emotion) && (
            <Badge variant="secondary" rounded>{streaming ? streaming.emotion : v.emotion}</Badge>
          )}
        </div>

        {pureChat && !editing ? (
          // texting bubbles: line breaks split the message into separate texts —
          // purely display, like the dialogue box's pagination (the raw text is edited whole)
          <div className={cn("flex flex-col gap-1", message.role === "user" ? "items-end" : "items-start")}>
            {(streaming ? streaming.text : v.content)
              .split(/\n+/)
              .map((p) => p.trim())
              .filter(Boolean)
              .map((bubble, i, arr) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-lg px-3.5 py-2.5 text-[0.925rem] leading-relaxed text-left max-w-full",
                    message.role === "user" ? "bg-primary-500/15" : "msg-bubble"
                  )}
                >
                  <MessageText text={bubble} streaming={!!streaming && i === arr.length - 1} />
                </div>
              ))}
          </div>
        ) : (
        <div
          className={cn(
            "rounded-lg px-3.5 py-2.5 text-[0.925rem] leading-relaxed text-left",
            message.role === "user"
              ? "bg-primary-500/15"
              : message.role === "narrator"
                ? "bg-transparent border border-dashed border-base-400 italic"
                : "msg-bubble"
          )}
        >
          {editing ? (
            <div className="space-y-2 min-w-[280px]">
              <Textarea className="w-full h-32 text-sm" value={draft} onChange={setDraft} />
              {message.role === "character" && !pureChat && (
                <Select
                  value={draftEmotion}
                  onChange={setDraftEmotion}
                  options={emotionChoices.map((e) => ({ value: e, label: e }))}
                />
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    await onEdit({ content: draft, ...(message.role === "character" && !pureChat ? { emotion: draftEmotion || null } : {}) });
                    setEditing(false);
                  }}
                >
                  Save
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : streaming ? (
            <MessageText text={streaming.text} streaming />
          ) : (
            <MessageText text={v.content} />
          )}
        </div>
        )}

        {/* stage direction carried by a narrator message (scene advance, enter/leave, the end) */}
        {!editing && message.role === "narrator" && sceneName && (
          <div className="mt-1.5">
            <Badge variant="secondary" rounded>
              <Clapperboard size={11} /> {sceneName}
            </Badge>
          </div>
        )}

        {/* narrator options on the newest message */}
        {!editing && isLast && !busy && v.options && v.options.length > 0 && (
          <div className="flex flex-col items-start gap-1.5 mt-2">
            {v.options.map((o, i) => (
              <Button key={i} variant="secondary" size="sm" className="h-auto py-1 text-left whitespace-normal" onClick={() => onPickOption(o)}>
                <ChevronRight /> <MessageText text={o} />
              </Button>
            ))}
          </div>
        )}

        {!streaming && (
        <div
          className={cn(
            "flex items-center gap-0.5 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-xs",
            message.role === "user" && "justify-end"
          )}
        >
          {/* received time — the active variant's: a swipe arrived later than the original */}
          <span
            className="text-content-300 px-1 select-none"
            title={new Date(v.createdAt ?? message.createdAt).toLocaleString()}
          >
            {fmtReceived(v.createdAt ?? message.createdAt)}
          </span>
          {/* alternatives live on the tail only — appending a message freezes the rest;
              while a follow-up is being generated the freeze is imminent, so don't offer them */}
          {isLast && !busy && message.variants.length > 1 && (
            <span className="flex items-center gap-0.5 mr-1 text-content-300">
              <Button variant="ghost" size="sm" shape="square" disabled={message.activeVariant === 0 || busy} onClick={() => onSwipe(message.activeVariant - 1)}><ChevronLeft /></Button>
              {message.activeVariant + 1}/{message.variants.length}
              <Button variant="ghost" size="sm" shape="square" disabled={message.activeVariant >= message.variants.length - 1 || busy} onClick={() => onSwipe(message.activeVariant + 1)}><ChevronRight /></Button>
            </span>
          )}
          {onShowOnStage && (
            <Button variant="ghost" size="sm" shape="square" title="Show on stage (dialogue box)" onClick={onShowOnStage}><Captions /></Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            title="Edit in place"
            disabled={busy}
            onClick={() => {
              setDraft(v.content);
              setDraftEmotion(v.emotion ?? "neutral");
              setEditing(true);
            }}
          >
            <Pencil />
          </Button>
          {isLast && (message.role === "character" || (message.role === "narrator" && !humanNarrator)) && (
            <Button variant="ghost" size="sm" shape="square" title="Regenerate (adds a swipe)" disabled={busy} onClick={onRegen}><RefreshCw /></Button>
          )}
          <Button variant="ghost" size="sm" shape="square" title="Fork a new chat from here" disabled={busy} onClick={onFork}><GitFork /></Button>
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            title="Delete"
            disabled={busy}
            onClick={async () => {
              if (await confirmDialog({ title: "Delete message", message: "Delete this message?", confirmLabel: "Delete", danger: true })) await onDelete();
            }}
          >
            <Trash2 />
          </Button>
        </div>
        )}
      </div>
    </div>
  );
},
// every streamed token re-renders the chat page; rows skip when their data props are
// unchanged. Handlers are deliberately left out of the comparison: everything they
// close over that can change is mirrored in a compared prop (message objects get a new
// identity on every refetch, and `busy` mirrors the page's locked state).
(prev, next) =>
  prev.message === next.message &&
  prev.characters === next.characters &&
  prev.nameSnapshots === next.nameSnapshots &&
  prev.personaName === next.personaName &&
  prev.humanNarrator === next.humanNarrator &&
  prev.isLast === next.isLast &&
  prev.busy === next.busy &&
  prev.streaming === next.streaming &&
  prev.sceneName === next.sceneName &&
  prev.pureChat === next.pureChat &&
  prev.fadeIn === next.fadeIn);
