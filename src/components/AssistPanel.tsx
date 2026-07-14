"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, FileUp, Paperclip, SendHorizontal, Undo2, X } from "lucide-react";
import { InputBox } from "@/components/app";
import { LibraryPicker, libraryTypeIcon, type LibraryRef } from "@/components/LibraryPicker";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { streamSse } from "@/lib/ui";
import { MessageText } from "./MessageText";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

interface TextFile {
  name: string;
  text: string;
}

/**
 * Chat-style co-writing side panel: discuss with the assistant and it
 * fills/updates the editor's form fields as the conversation progresses.
 */
export function AssistPanel({
  entityType,
  fields,
  onFields,
  onRestore,
  allowFiles = false,
  emptyHint,
}: {
  entityType: string;
  fields: Record<string, unknown>;
  onFields: (partial: Record<string, unknown>) => void;
  /** replace the whole draft state (rewind) — enables the rewind buttons when given */
  onRestore?: (fields: Record<string, unknown>) => void;
  /** offer attaching .txt/.md files, sent as source material with every message */
  allowFiles?: boolean;
  emptyHint?: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // the assistant is writing the held-back fields block (tool-calling into the form)
  const [drafting, setDrafting] = useState(false);
  const [refs, setRefs] = useState<LibraryRef[]>([]);
  const [files, setFiles] = useState<TextFile[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  // draft state as it was BEFORE the user message at that index was sent — rewinds
  // restore the forms along with the conversation (session drafts only, nothing saved)
  const snapshotsRef = useRef(new Map<number, Record<string, unknown>>());

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, drafting]);

  function rewind(i: number) {
    if (busy) return;
    const snap = snapshotsRef.current.get(i);
    if (snap) onRestore?.(snap);
    for (const k of [...snapshotsRef.current.keys()]) if (k > i) snapshotsRef.current.delete(k);
    setMessages(messages.slice(0, i));
    setInput(messages[i].content); // the rewound line is a starting point for a redo
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    snapshotsRef.current.set(messages.length, structuredClone(fieldsRef.current));
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
          attachments: files,
        },
        (ev) => {
          if (ev.type === "text") {
            acc += ev.text;
            setMessages([...history, { role: "assistant", content: acc }]);
          } else if (ev.type === "drafting") {
            setDrafting(true);
          } else if (ev.type === "fields" && ev.fields) {
            setDrafting(false);
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
      setDrafting(false);
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
            {emptyHint ??
              "Describe what you want to create and we'll write it together — the form fills in as we go. e.g. \"a tsundere alchemist who secretly loves stray cats\". Attach library items with the paperclip to build on existing characters and places."}
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "relative group text-sm bg-base-400/60 rounded-md px-3 py-2 ml-6"
                : "text-sm px-1"
            }
          >
            <MessageText text={m.content} streaming={busy && i === messages.length - 1 && m.role === "assistant"} />
            {m.role === "user" && onRestore && !busy && (
              <button
                type="button"
                title="Rewind here — the conversation and the drafts roll back to before this message"
                className="absolute -left-5 top-2.5 text-content-400 opacity-0 group-hover:opacity-70 hover:!opacity-100 cursor-pointer"
                onClick={() => rewind(i)}
              >
                <Undo2 size={13} />
              </button>
            )}
          </div>
        ))}
        {drafting && (
          <div className="text-xs text-content-400 px-1 animate-pulse">
            ✦ writing into the form…
          </div>
        )}
      </div>
      {(refs.length > 0 || files.length > 0) && (
        <div className="flex flex-wrap gap-1 pt-2">
          {refs.map((r) => {
            const Icon = libraryTypeIcon(r.type);
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
          {files.map((f) => (
            <Badge key={f.name} variant="secondary" rounded>
              <FileText size={11} /> {f.name}
              <button
                type="button"
                className="cursor-pointer opacity-60 hover:opacity-100"
                title="Detach"
                onClick={() => setFiles(files.filter((x) => x.name !== f.name))}
              >
                <X size={11} />
              </button>
            </Badge>
          ))}
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
        {allowFiles && (
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            title="Attach text files as source material (.txt, .md)"
            onClick={() => fileRef.current?.click()}
          >
            <FileUp />
          </Button>
        )}
        <span className="flex-1" />
        <Button size="sm" shape="square" title="Send (Enter)" onClick={send} disabled={busy || !input.trim()}>
          <SendHorizontal />
        </Button>
      </InputBox>
      <LibraryPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Attach library items"
        hint="Attached items are sent to the co-writer as background context with every message."
        selection={refs}
        onChange={setRefs}
      />
      {allowFiles && (
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept=".txt,.md,text/plain,text/markdown"
          onChange={async (e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = "";
            const read = await Promise.all(
              picked.map(async (f) => {
                try {
                  return { name: f.name, text: await f.text() };
                } catch {
                  toast.error(`Could not read "${f.name}"`);
                  return null;
                }
              })
            );
            setFiles((prev) => [
              ...prev,
              ...read.filter((f): f is TextFile => !!f?.text && !prev.some((p) => p.name === f!.name)),
            ]);
          }}
        />
      )}
    </div>
  );
}
