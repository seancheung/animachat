/**
 * Mention syntax in stored USER message text: `<mention>Name</mention>` addresses one
 * character, `<mention/>` addresses everyone present. The server writes the tags when a
 * sent message contains @Name/@all for an exactly-matching present character (the input's
 * @-picker inserts exact names); the UI renders them as highlighted chips, and prompt
 * assembly/exports flatten them back to plain @Name so models never see the markup.
 * This is user-message syntax — unrelated to the AI-output tag stream (`lib/ai/tags.ts`).
 */

export const MENTION_TAG_RE = /<mention\s*\/>|<mention>([^<]*)<\/mention>/gi;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Wrap word-anchored @Name / @all occurrences in mention tags (names longest-first,
 *  case-insensitive; the tag stores the canonical name). Unmatched @text stays text. */
export function tagMentions(text: string, names: string[]): string {
  let out = text.replace(/(^|\s)@all(?![\p{L}\p{N}_])/giu, "$1<mention/>");
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    if (!name.trim()) continue;
    out = out.replace(
      new RegExp(`(^|\\s)@${escapeRe(name)}(?![\\p{L}\\p{N}_])`, "giu"),
      `$1<mention>${name}</mention>`
    );
  }
  return out;
}

/** Who a message addresses via mention tags. */
export function parseMentions(text: string): { all: boolean; names: string[] } {
  let all = false;
  const names: string[] = [];
  for (const m of text.matchAll(MENTION_TAG_RE)) {
    if (m[1] === undefined) all = true;
    else if (m[1].trim() && !names.includes(m[1].trim())) names.push(m[1].trim());
  }
  return { all, names };
}

/** Mention tags → plain @Name / @all — for prompts, summaries and exports. */
export function mentionsToPlain(text: string): string {
  return text.replace(MENTION_TAG_RE, (_t, name) => (name === undefined ? "@all" : `@${name}`));
}

/** Split PLAIN input text on word-anchored exact @Name/@all runs (pre-send form) —
 *  drives the input's chip highlighting; the matched text keeps its typed characters
 *  so an overlay renders with identical glyph metrics. */
export function splitAtMentions(
  text: string,
  names: string[]
): { mention: boolean; text: string }[] {
  const pattern = ["all", ...names]
    .filter((n) => n.trim())
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join("|");
  if (!pattern || !text.includes("@")) return [{ mention: false, text }];
  const re = new RegExp(`(^|\\s)(@(?:${pattern}))(?![\\p{L}\\p{N}_])`, "giu");
  const parts: { mention: boolean; text: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index + m[1].length;
    if (start > last) parts.push({ mention: false, text: text.slice(last, start) });
    parts.push({ mention: true, text: m[2] });
    last = start + m[2].length;
  }
  if (last < text.length) parts.push({ mention: false, text: text.slice(last) });
  return parts;
}

export type MentionPart = { type: "text"; text: string } | { type: "mention"; name: string | null };

/** Split text into plain segments and mention chips (name null = everyone) for rendering. */
export function splitMentions(text: string): MentionPart[] {
  const parts: MentionPart[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_TAG_RE)) {
    if (m.index > last) parts.push({ type: "text", text: text.slice(last, m.index) });
    parts.push({ type: "mention", name: m[1] === undefined ? null : m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}
