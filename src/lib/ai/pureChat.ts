/* Pure-chat normalization (casual mode) — the mechanical half of the mode's contract.
 *
 * Casual chats are online chatting with someone real: no *asterisk* actions, no
 * quotation-mark dialogue formatting, no structured tags. Prompts instruct all of
 * that, but RP-tuned models love `*smiles softly*` — so the rule is ENFORCED here,
 * at the data boundary, in exactly two places (per SPEC):
 *
 *   - at injection time, on greetings & example dialogue (library sheets are shared
 *     across modes and never modified — the transform runs where placeholder
 *     substitution already does);
 *   - on every AI reply before storage — the stored message is the clean form, so
 *     the resent history teaches the convention by example instead of eroding it
 *     (the verbatim model output still lands in raw_outputs). User text is never
 *     transformed.
 *
 * `PureChatStreamFilter` is the best-effort streaming companion (same division of
 * labor as the co-writer's streamed partials vs. the strict final block): it holds
 * back a potential action span until it closes so contraband never flashes on
 * screen, while `toPureChat` on the full text stays authoritative at save time.
 */

/* Structured tags are stripped WHOLE — their payloads are metadata (an emotion
 * name, option texts, a scene/cast name the narration restates), never prose.
 * <mention> is deliberately absent: it is message-text syntax (turn passing),
 * not presentation markup, and stays in the stored text. */
const TAG_ELEMENT_RE = /<(emo|options|next-scene|enter|leave|reveal)>[\s\S]*?<\/\1>|<(?:next-scene|the-end)\s*\/>/gi;
/** Stray unpaired markers a malformed reply may leave behind. */
const TAG_MARKER_RE = /<\/?(?:emo|options|o|next-scene|enter|leave|reveal|the-end)>/gi;

/** A single-asterisk action span within one line: `*walks in*`. Double asterisks
 *  (markdown bold) are left alone — the convention's action marker is single. */
const ACTION_RE = /(?<!\*)\*(?!\*)[^*\n]+?\*(?!\*)/g;

/** A line consisting solely of quoted segments (straight or curly), whitespace between. */
const ALL_QUOTED_LINE_RE = /^\s*(["“][^"“”\n]*["”]\s*)+$/;
const QUOTED_SEGMENT_RE = /["“]([^"“”\n]*)["”]/g;

/**
 * Normalize text to the pure-chat convention: drop structured tags (mentions
 * survive), strip `*…*` action spans, unwrap lines that are entirely quoted
 * dialogue (interior quotes in mixed text survive — quoting someone is
 * legitimate texting), and tidy the whitespace left behind.
 */
export function toPureChat(text: string): string {
  let t = text.replace(TAG_ELEMENT_RE, "").replace(TAG_MARKER_RE, "");
  t = t.replace(ACTION_RE, "");
  const lines = t.split("\n").map((line) => {
    let l = line;
    // a line that is nothing but quoted dialogue loses its wrapping quotes;
    // a mixed line (prose quoting someone) keeps every quote it has
    if (ALL_QUOTED_LINE_RE.test(l)) {
      l = Array.from(l.matchAll(QUOTED_SEGMENT_RE), (m) => m[1].trim())
        .filter(Boolean)
        .join(" ");
    }
    return l.replace(/[ \t]{2,}/g, " ").trim();
  });
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n") // paragraphs keep one blank line, no more
    .trim();
}

/**
 * Streaming companion to {@link toPureChat}: strips `*…*` action spans from a
 * token stream without letting them flash on screen first. A lone `*` is held
 * back until its closing `*` arrives (span dropped), a newline arrives (the `*`
 * was literal — flushed as-is), or the stream ends. Everything else passes
 * through untouched; the full-text transform at save time stays authoritative
 * (quote unwrapping and whitespace tidying need the whole message).
 */
export class PureChatStreamFilter {
  private pending = "";

  feed(chunk: string): string {
    this.pending += chunk;
    let out = "";
    while (this.pending) {
      const star = this.pending.indexOf("*");
      if (star === -1) {
        out += this.pending;
        this.pending = "";
        break;
      }
      out += this.pending.slice(0, star);
      this.pending = this.pending.slice(star);
      // need the character after the `*` to tell an action span from bold `**`
      if (this.pending.length < 2) break;
      if (this.pending[1] === "*") {
        out += "**";
        this.pending = this.pending.slice(2);
        continue;
      }
      const close = this.pending.indexOf("*", 1);
      const newline = this.pending.indexOf("\n", 1);
      if (close !== -1 && (newline === -1 || close < newline)) {
        this.pending = this.pending.slice(close + 1); // the span is dropped whole
      } else if (newline !== -1) {
        // no closing `*` on this line — the asterisk was literal after all
        out += this.pending[0];
        this.pending = this.pending.slice(1);
      } else {
        break; // still ambiguous — wait for more of the stream
      }
    }
    return out;
  }

  /** Flush whatever is still held (an unclosed `*` was literal). */
  end(): string {
    const rest = this.pending;
    this.pending = "";
    return rest;
  }
}
