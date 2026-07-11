"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  BookOpen,
  Clapperboard,
  LibraryBig,
  Mountain,
  Paperclip,
  SendHorizontal,
  UserRound,
  VenetianMask,
  X,
} from "lucide-react";
import { InputBox, Modal } from "@/components/app";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import Checkbox from "@/components/ui/checkbox";
import Input from "@/components/ui/input";
import { api, streamSse } from "@/lib/ui";
import { MessageText } from "./MessageText";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

interface AttachedRef {
  type: string;
  id: string;
  name: string;
}

const REF_TYPES = [
  { type: "character", label: "Characters", url: "/api/characters", Icon: UserRound },
  { type: "persona", label: "Personas", url: "/api/personas", Icon: VenetianMask },
  { type: "location", label: "Locations", url: "/api/locations", Icon: Mountain },
  { type: "scene", label: "Scenes", url: "/api/scenes", Icon: Clapperboard },
  { type: "story", label: "Stories", url: "/api/stories", Icon: BookOpen },
  { type: "lorebook", label: "Lorebooks", url: "/api/lorebooks", Icon: LibraryBig },
] as const;

const refIcon = (type: string) => REF_TYPES.find((t) => t.type === type)?.Icon ?? Paperclip;

/**
 * Chat-style co-writing side panel: discuss with the assistant and it
 * fills/updates the editor's form fields as the conversation progresses.
 */
export function AssistPanel({
  entityType,
  fields,
  onFields,
}: {
  entityType: string;
  fields: Record<string, unknown>;
  onFields: (partial: Record<string, unknown>) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [refs, setRefs] = useState<AttachedRef[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    const history: Msg[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    let acc = "";
    try {
      await streamSse(
        "/api/assist",
        {
          entityType,
          fields: fieldsRef.current,
          messages: history,
          references: refs.map(({ type, id }) => ({ type, id })),
        },
        (ev) => {
          if (ev.type === "text") {
            acc += ev.text;
            setMessages([...history, { role: "assistant", content: acc }]);
          } else if (ev.type === "fields" && ev.fields) {
            onFields(ev.fields);
            acc += acc ? "\n\n✦ Applied to the form." : "✦ Applied to the form.";
            setMessages([...history, { role: "assistant", content: acc }]);
          } else if (ev.type === "error") {
            acc += `\n⚠ ${ev.message}`;
            setMessages([...history, { role: "assistant", content: acc }]);
          }
        }
      );
    } catch (e) {
      setMessages([
        ...history,
        { role: "assistant", content: `⚠ ${e instanceof Error ? e.message : String(e)}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 border-l border-base-400 pl-4">
      <div className="text-xs uppercase tracking-wider text-content-300 mb-2">
        ✦ AI co-writer
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
        {messages.length === 0 && (
          <div className="text-xs text-content-400 leading-relaxed">
            Describe what you want to create and we&apos;ll write it together — the form fills in as
            we go. e.g. &quot;a tsundere alchemist who secretly loves stray cats&quot;. Attach library
            items with the paperclip to build on existing characters and places.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "text-sm bg-base-400/60 rounded-md px-3 py-2 ml-6"
                : "text-sm px-1"
            }
          >
            <MessageText text={m.content} streaming={busy && i === messages.length - 1 && m.role === "assistant"} />
          </div>
        ))}
      </div>
      {refs.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-2">
          {refs.map((r) => {
            const Icon = refIcon(r.type);
            return (
              <Badge key={`${r.type}:${r.id}`} variant="secondary" rounded>
                <Icon size={11} /> {r.name}
                <button
                  type="button"
                  className="cursor-pointer opacity-60 hover:opacity-100"
                  title="Detach"
                  onClick={() => setRefs(refs.filter((x) => !(x.type === r.type && x.id === r.id)))}
                >
                  <X size={11} />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
      <InputBox
        className="mt-2"
        textareaClassName="h-12"
        placeholder="Discuss ideas… (Shift+Enter for a new line)"
        value={input}
        disabled={busy}
        onChange={setInput}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      >
        <Button
          variant="ghost"
          size="sm"
          shape="square"
          title="Attach library items as context"
          onClick={() => setPickerOpen(true)}
        >
          <Paperclip />
        </Button>
        <span className="flex-1" />
        <Button size="sm" shape="square" title="Send (Enter)" onClick={send} disabled={busy || !input.trim()}>
          <SendHorizontal />
        </Button>
      </InputBox>
      <LibraryPicker open={pickerOpen} onClose={() => setPickerOpen(false)} refs={refs} onChange={setRefs} />
    </div>
  );
}

/* ================= library-item picker ================= */

const refKey = (r: { type: string; id: string }) => `${r.type}:${r.id}`;

function PickerSection({
  t,
  open,
  filter,
  refs,
  onChange,
}: {
  t: (typeof REF_TYPES)[number];
  open: boolean;
  filter: string;
  refs: AttachedRef[];
  onChange: (refs: AttachedRef[]) => void;
}) {
  const { data } = useSWR<{ id: string; name: string }[]>(open ? t.url : null, api.get);
  const items = (data ?? []).filter((i) => i.name.toLowerCase().includes(filter));
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-content-300 mb-1 flex items-center gap-1.5">
        <t.Icon size={12} /> {t.label}
      </div>
      <div className="space-y-1">
        {items.map((i) => (
          <Checkbox
            key={i.id}
            className="flex"
            label={i.name}
            value={refs.some((r) => r.type === t.type && r.id === i.id)}
            onChange={(v) =>
              onChange(
                v
                  ? [...refs, { type: t.type, id: i.id, name: i.name }]
                  : refs.filter((r) => refKey(r) !== `${t.type}:${i.id}`)
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

/** Multi-select dialog over the whole library; toggles apply immediately. */
function LibraryPicker({
  open,
  onClose,
  refs,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  refs: AttachedRef[];
  onChange: (refs: AttachedRef[]) => void;
}) {
  const [filter, setFilter] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Attach library items">
      <div className="space-y-3">
        <div className="text-xs text-content-400">
          Attached items are sent to the co-writer as background context with every message.
        </div>
        <Input className="w-full" placeholder="Filter by name…" value={filter} onChange={setFilter} />
        <div className="max-h-[50vh] overflow-y-auto space-y-4 pr-1">
          {REF_TYPES.map((t) => (
            <PickerSection
              key={t.type}
              t={t}
              open={open}
              filter={filter.trim().toLowerCase()}
              refs={refs}
              onChange={onChange}
            />
          ))}
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
