"use client";

import { Fragment, useMemo } from "react";

/**
 * What unmarked text means in this message. The convention is role-dependent:
 * a character writes prose and quotes their speech, while the user types into a chat box —
 * so their bare line is what they said (their actions go in *asterisks*).
 */
export type PlainAs = "speech" | "narration";

type Kind = "dialogue" | "action" | "narration";

/** *actions*, "speech" (straight or curly). The trailing marker is optional, so a message is
 *  styled correctly while it is still being typed out. Built per call: a shared /g regex
 *  carries its own lastIndex, which two renders would trip over. */
const markup = () => /(\*[^*\n]+\*?)|("[^"\n]*"?)|(“[^”\n]*”?)/g;

/**
 * Renders roleplay prose in the shared convention: `*asterisks*` = actions/descriptions,
 * `"quotes"` = spoken words, everything else narration (or speech, in the user's own
 * messages). The markers are display syntax, not content: the asterisks and quote marks are
 * stripped, and each kind gets its own style — dialogue is the voice, narration the prose,
 * actions the muted stage directions.
 *
 * `mode="plain"` renders text verbatim, for chats that aren't roleplay (the co-writing
 * assistant, whose quotes are its own and must not be eaten).
 */
export function MessageText({
  text,
  streaming,
  plainAs = "narration",
  mode = "roleplay",
}: {
  text: string;
  streaming?: boolean;
  plainAs?: PlainAs;
  mode?: "roleplay" | "plain";
}) {
  const parts = useMemo(() => {
    if (mode === "plain") return [{ kind: "narration" as Kind, text }];
    const plainKind: Kind = plainAs === "speech" ? "dialogue" : "narration";
    const tokens: { kind: Kind; text: string }[] = [];
    const re = markup();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last) tokens.push({ kind: plainKind, text: text.slice(last, m.index) });
      const t = m[0];
      if (t.startsWith("*")) {
        tokens.push({ kind: "action", text: t.replace(/^\*|\*$/g, "") });
      } else {
        tokens.push({ kind: "dialogue", text: t.replace(/^["“]|["”]$/g, "") });
      }
      last = m.index + t.length;
    }
    if (last < text.length) tokens.push({ kind: plainKind, text: text.slice(last) });
    return tokens;
  }, [text, plainAs, mode]);

  return (
    <span className={`whitespace-pre-wrap${streaming ? " caret" : ""}`}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          <span className={`msg-${p.kind}`}>{p.text}</span>
        </Fragment>
      ))}
    </span>
  );
}
