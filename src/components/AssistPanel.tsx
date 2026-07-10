"use client";

import { useEffect, useRef, useState } from "react";
import { streamSse } from "@/lib/ui";
import { MessageText } from "./MessageText";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

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
        { entityType, fields: fieldsRef.current, messages: history },
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
    <div className="flex flex-col h-full min-h-0 border-l border-[var(--border)] pl-4">
      <div className="text-xs uppercase tracking-wider text-[var(--text-dim)] mb-2">
        ✦ AI co-writer
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
        {messages.length === 0 && (
          <div className="text-xs text-[var(--text-dim)] leading-relaxed">
            Describe what you want to create and we&apos;ll write it together — the form fills in as
            we go. e.g. &quot;a tsundere alchemist who secretly loves stray cats&quot;
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "text-sm bg-[var(--panel-2)] rounded-lg px-3 py-2 ml-6"
                : "text-sm px-1"
            }
          >
            <MessageText text={m.content} streaming={busy && i === messages.length - 1 && m.role === "assistant"} />
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-2">
        <input
          className="input"
          placeholder="Discuss ideas…"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
        />
        <button className="btn btn-primary btn-sm" onClick={send} disabled={busy || !input.trim()}>
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
