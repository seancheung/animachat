"use client";

import { useState } from "react";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  MapPin,
  Pencil,
  RefreshCw,
  ScrollText,
  Trash2,
} from "lucide-react";
import { MessageText } from "@/components/MessageText";
import { assetUrl, cls } from "@/lib/ui";
import { EMOTIONS, type Character, type Message } from "@/lib/types";

export function MessageRow({
  message,
  characters,
  personaName,
  isLast,
  busy,
  sceneName,
  onEdit,
  onSwipe,
  onRegen,
  onDelete,
  onCheckpoint,
  onPickOption,
}: {
  message: Message;
  characters: Character[];
  personaName: string;
  isLast: boolean;
  busy: boolean;
  sceneName?: string | null;
  onEdit: (patch: { content?: string; emotion?: string | null }) => Promise<void>;
  onSwipe: (index: number) => Promise<void>;
  onRegen: () => void;
  onDelete: () => Promise<void>;
  onCheckpoint: () => Promise<void>;
  onPickOption: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftEmotion, setDraftEmotion] = useState<string>("");

  if (message.role === "marker") {
    return (
      <div className="text-center my-2 fade-in">
        <span className="chip">
          {message.sceneEvent?.kind === "scene" ? <Clapperboard size={11} /> : <MapPin size={11} />}{" "}
          {sceneName ?? "scene change"}
        </span>
      </div>
    );
  }

  const v = message.variants[message.activeVariant];
  if (!v) return null;
  const char = message.role === "character" ? characters.find((c) => c.id === message.characterId) : null;
  const name = message.role === "user" ? personaName : message.role === "narrator" ? "Narrator" : char?.name ?? "???";
  const emotionChoices = [
    ...EMOTIONS,
    ...(char?.customExpressions.map((e) => e.name) ?? []),
  ];

  return (
    <div className={cls("group flex gap-3 fade-in", message.role === "user" && "flex-row-reverse")}>
      <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 bg-[var(--panel-2)] flex items-center justify-center text-sm mt-1">
        {message.role === "narrator" ? (
          <ScrollText size={15} className="text-[var(--text-dim)]" />
        ) : char?.avatarAsset ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(char.avatarAsset)!} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-[var(--accent)] font-semibold">{name.slice(0, 1).toUpperCase()}</span>
        )}
      </div>

      <div className={cls("max-w-[78%] min-w-0", message.role === "user" && "text-right")}>
        <div className="text-xs text-[var(--text-dim)] mb-0.5 flex items-center gap-2">
          <span className={cls(message.role === "user" && "ml-auto")}>{name}</span>
          {message.role === "character" && v.emotion && <span className="chip">{v.emotion}</span>}
        </div>

        <div
          className={cls(
            "rounded-xl px-3.5 py-2.5 text-[0.925rem] leading-relaxed text-left",
            message.role === "user"
              ? "bg-[#312a4d]"
              : message.role === "narrator"
                ? "bg-transparent border border-dashed border-[var(--border)] italic"
                : "bg-[var(--panel)]"
          )}
        >
          {editing ? (
            <div className="space-y-2 min-w-[280px]">
              <textarea className="input h-32 text-sm" value={draft} onChange={(e) => setDraft(e.target.value)} />
              {message.role === "character" && (
                <select className="input w-auto" value={draftEmotion} onChange={(e) => setDraftEmotion(e.target.value)}>
                  {emotionChoices.map((e) => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
              )}
              <div className="flex gap-2">
                <button
                  className="btn btn-sm btn-primary"
                  onClick={async () => {
                    await onEdit({ content: draft, ...(message.role === "character" ? { emotion: draftEmotion || null } : {}) });
                    setEditing(false);
                  }}
                >
                  Save
                </button>
                <button className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <MessageText text={v.content} />
          )}
        </div>

        {/* narrator options on the newest message */}
        {!editing && isLast && !busy && v.options && v.options.length > 0 && (
          <div className="flex flex-col items-start gap-1.5 mt-2">
            {v.options.map((o, i) => (
              <button key={i} className="btn btn-sm text-left whitespace-normal" onClick={() => onPickOption(o)}>
                ▸ {o}
              </button>
            ))}
          </div>
        )}

        <div
          className={cls(
            "flex items-center gap-0.5 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-xs",
            message.role === "user" && "justify-end"
          )}
        >
          {message.variants.length > 1 && (
            <span className="flex items-center gap-0.5 mr-1 text-[var(--text-dim)]">
              <button className="btn btn-sm btn-ghost" disabled={message.activeVariant === 0 || busy} onClick={() => onSwipe(message.activeVariant - 1)}><ChevronLeft size={14} /></button>
              {message.activeVariant + 1}/{message.variants.length}
              <button className="btn btn-sm btn-ghost" disabled={message.activeVariant >= message.variants.length - 1 || busy} onClick={() => onSwipe(message.activeVariant + 1)}><ChevronRight size={14} /></button>
            </span>
          )}
          <button
            className="btn btn-sm btn-ghost"
            title="Edit in place"
            onClick={() => {
              setDraft(v.content);
              setDraftEmotion(v.emotion ?? "neutral");
              setEditing(true);
            }}
          >
            <Pencil size={13} />
          </button>
          {(message.role === "character" || message.role === "narrator") && (
            <button className="btn btn-sm btn-ghost" title="Regenerate (adds a swipe)" disabled={busy} onClick={onRegen}><RefreshCw size={13} /></button>
          )}
          <button className="btn btn-sm btn-ghost" title="Save state here" onClick={onCheckpoint}><Bookmark size={13} /></button>
          <button className="btn btn-sm btn-ghost" title="Delete" disabled={busy} onClick={() => confirm("Delete this message?") && onDelete()}><Trash2 size={13} /></button>
        </div>
      </div>
    </div>
  );
}
