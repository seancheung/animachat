/**
 * Streaming parser for the structured tags that ride inside AI chat prose:
 *   <emo>name</emo>            (character messages, prefix)
 *   <options><o>..</o>...</options>  (narrator, trailing)
 *   <next-scene/>              (narrator, trailing)
 *   <enter>name</enter> / <leave>name</leave>  (narrator, inline — stage presence)
 *   <reveal>title</reveal>     (narrator, inline — story secret established as truth)
 *   <the-end/>                 (narrator, trailing — playthrough concluded)
 *
 * Everything fails soft: malformed/unclosed tags flush as plain text.
 */

export type TagEvent =
  | { type: "text"; text: string }
  | { type: "emotion"; name: string }
  | { type: "options"; options: string[] }
  | { type: "nextScene" }
  | { type: "enter"; name: string }
  | { type: "leave"; name: string }
  | { type: "reveal"; name: string }
  | { type: "theEnd" };

const OPENERS = ["<emo>", "<options>", "<next-scene", "<enter>", "<leave>", "<reveal>", "<the-end"];
const MAX_EMO = 120;
const MAX_OPTIONS = 4000;
const MAX_NEXT_SCENE = 40;
const MAX_NAME = 200;

export class TagStreamParser {
  private buf = "";

  feed(chunk: string): TagEvent[] {
    this.buf += chunk;
    return this.drain(false);
  }

  end(): TagEvent[] {
    const events = this.drain(true);
    if (this.buf) {
      events.push({ type: "text", text: this.buf });
      this.buf = "";
    }
    return events;
  }

  private drain(final: boolean): TagEvent[] {
    const events: TagEvent[] = [];
    for (;;) {
      const lt = this.buf.indexOf("<");
      if (lt === -1) {
        if (this.buf) {
          events.push({ type: "text", text: this.buf });
          this.buf = "";
        }
        return events;
      }
      if (lt > 0) {
        events.push({ type: "text", text: this.buf.slice(0, lt) });
        this.buf = this.buf.slice(lt);
      }
      // buf now starts with "<"
      const parsed = this.tryParseTag(final);
      if (parsed === "hold") {
        if (final) {
          // flush the "<" as text and keep going so end() terminates
          events.push({ type: "text", text: "<" });
          this.buf = this.buf.slice(1);
          continue;
        }
        return events;
      }
      if (parsed === "not-a-tag") {
        events.push({ type: "text", text: "<" });
        this.buf = this.buf.slice(1);
        continue;
      }
      events.push(parsed);
    }
  }

  /** Attempt to parse a known tag at the start of buf. Consumes it on success. */
  private tryParseTag(final: boolean): TagEvent | "hold" | "not-a-tag" {
    const b = this.buf;

    if (b.startsWith("<emo>")) {
      const close = b.indexOf("</emo>");
      if (close !== -1) {
        const name = b.slice(5, close).trim().toLowerCase();
        this.buf = b.slice(close + 6);
        return name ? { type: "emotion", name } : "not-a-tag";
      }
      return b.length > MAX_EMO || final ? "not-a-tag" : "hold";
    }

    if (b.startsWith("<options>")) {
      const close = b.indexOf("</options>");
      if (close !== -1) {
        const inner = b.slice(9, close);
        this.buf = b.slice(close + 10);
        const options = [...inner.matchAll(/<o>([\s\S]*?)<\/o>/g)]
          .map((m) => m[1].trim())
          .filter(Boolean);
        if (!options.length) {
          // fallback: split lines / bullets
          for (const line of inner.split("\n")) {
            const t = line.replace(/^\s*[-*\d.)]+\s*/, "").trim();
            if (t) options.push(t);
          }
        }
        return options.length ? { type: "options", options: options.slice(0, 4) } : "not-a-tag";
      }
      return b.length > MAX_OPTIONS || final ? "not-a-tag" : "hold";
    }

    for (const tag of ["enter", "leave", "reveal"] as const) {
      const open = `<${tag}>`;
      if (b.startsWith(open)) {
        const closeTag = `</${tag}>`;
        const close = b.indexOf(closeTag);
        if (close !== -1) {
          const name = b.slice(open.length, close).trim();
          this.buf = b.slice(close + closeTag.length);
          return name ? { type: tag, name } : "not-a-tag";
        }
        return b.length > MAX_NAME || final ? "not-a-tag" : "hold";
      }
    }

    const nextScene = b.match(/^<next-scene\s*\/?\s*>/);
    if (nextScene) {
      this.buf = b.slice(nextScene[0].length);
      return { type: "nextScene" };
    }
    if (/^<next-scene/.test(b) && b.length <= MAX_NEXT_SCENE && !final) return "hold";

    const theEnd = b.match(/^<the-end\s*\/?\s*>/);
    if (theEnd) {
      this.buf = b.slice(theEnd[0].length);
      return { type: "theEnd" };
    }
    if (/^<the-end/.test(b) && b.length <= MAX_NEXT_SCENE && !final) return "hold";

    // could this still become a known opener with more input?
    if (!final && OPENERS.some((o) => o.startsWith(b) && b.length < o.length)) return "hold";
    return "not-a-tag";
  }
}

/** One-shot parse for non-streamed text (imports, edits). */
export function parseTagged(text: string): {
  content: string;
  emotion: string | null;
  options: string[] | null;
  nextScene: boolean;
  enter: string[];
  leave: string[];
  reveal: string[];
  theEnd: boolean;
} {
  const parser = new TagStreamParser();
  const events = [...parser.feed(text), ...parser.end()];
  let content = "";
  let emotion: string | null = null;
  let options: string[] | null = null;
  let nextScene = false;
  const enter: string[] = [];
  const leave: string[] = [];
  const reveal: string[] = [];
  let theEnd = false;
  for (const ev of events) {
    if (ev.type === "text") content += ev.text;
    else if (ev.type === "emotion") emotion = emotion ?? ev.name;
    else if (ev.type === "options") options = ev.options;
    else if (ev.type === "nextScene") nextScene = true;
    else if (ev.type === "enter") enter.push(ev.name);
    else if (ev.type === "leave") leave.push(ev.name);
    else if (ev.type === "reveal") reveal.push(ev.name);
    else if (ev.type === "theEnd") theEnd = true;
  }
  return { content: content.trim(), emotion, options, nextScene, enter, leave, reveal, theEnd };
}
