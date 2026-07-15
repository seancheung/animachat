/**
 * Streaming parser for the structured tags that ride inside AI chat prose:
 *   <emo>name</emo>            (character messages, prefix)
 *   <options><o>..</o>...</options>  (narrator, trailing)
 *   <next-scene/>              (narrator, trailing; targeted form
 *                               <next-scene>Scene Name</next-scene> names the
 *                               chosen road at an authored branch point)
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
  | { type: "nextScene"; name?: string }
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
        if (!name) return "not-a-tag"; // empty body: leave buf untouched so it flushes as text
        this.buf = b.slice(close + 6);
        return { type: "emotion", name };
      }
      return b.length > MAX_EMO || final ? "not-a-tag" : "hold";
    }

    if (b.startsWith("<options>")) {
      const close = b.indexOf("</options>");
      if (close !== -1) {
        const inner = b.slice(9, close);
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
        if (!options.length) return "not-a-tag"; // empty block: leave buf untouched so it flushes as text
        this.buf = b.slice(close + 10);
        return { type: "options", options: options.slice(0, 4) };
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
          if (!name) return "not-a-tag"; // empty body: leave buf untouched so it flushes as text
          this.buf = b.slice(close + closeTag.length);
          return { type: tag, name };
        }
        return b.length > MAX_NAME || final ? "not-a-tag" : "hold";
      }
    }

    const nextSceneBare = b.match(/^<next-scene\s*\/\s*>/);
    if (nextSceneBare) {
      this.buf = b.slice(nextSceneBare[0].length);
      return { type: "nextScene" };
    }
    const nextSceneOpen = b.match(/^<next-scene\s*>/);
    if (nextSceneOpen) {
      // paired form carries the chosen road's name at an authored branch point
      const close = b.indexOf("</next-scene>");
      if (close !== -1) {
        const name = b.slice(nextSceneOpen[0].length, close).trim();
        this.buf = b.slice(close + "</next-scene>".length);
        return name ? { type: "nextScene", name } : { type: "nextScene" };
      }
      if (b.length > nextSceneOpen[0].length + MAX_NAME || final) {
        // no closing tag in sight — it was the bare form models already emit
        this.buf = b.slice(nextSceneOpen[0].length);
        return { type: "nextScene" };
      }
      return "hold";
    }
    if (/^<next-scene/.test(b) && b.length <= MAX_NEXT_SCENE && !final) return "hold";

    const theEndSelf = b.match(/^<the-end\s*\/\s*>/);
    if (theEndSelf) {
      this.buf = b.slice(theEndSelf[0].length);
      return { type: "theEnd" };
    }
    const theEndOpen = b.match(/^<the-end\s*>/);
    if (theEndOpen) {
      // models sometimes emit the paired form <the-end>…</the-end>; consume the
      // whole pair so the close tag doesn't leak into the prose
      const close = b.indexOf("</the-end>");
      if (close !== -1) {
        this.buf = b.slice(close + "</the-end>".length);
        return { type: "theEnd" };
      }
      if (b.length > theEndOpen[0].length + MAX_NAME || final) {
        this.buf = b.slice(theEndOpen[0].length);
        return { type: "theEnd" };
      }
      return "hold";
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
  /** the targeted form's payload (branch point) — null on the bare tag */
  nextSceneTarget: string | null;
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
  let nextSceneTarget: string | null = null;
  const enter: string[] = [];
  const leave: string[] = [];
  const reveal: string[] = [];
  let theEnd = false;
  for (const ev of events) {
    if (ev.type === "text") content += ev.text;
    else if (ev.type === "emotion") emotion = emotion ?? ev.name;
    else if (ev.type === "options") options = ev.options;
    else if (ev.type === "nextScene") {
      nextScene = true;
      nextSceneTarget = nextSceneTarget ?? ev.name ?? null;
    } else if (ev.type === "enter") enter.push(ev.name);
    else if (ev.type === "leave") leave.push(ev.name);
    else if (ev.type === "reveal") reveal.push(ev.name);
    else if (ev.type === "theEnd") theEnd = true;
  }
  return { content: content.trim(), emotion, options, nextScene, nextSceneTarget, enter, leave, reveal, theEnd };
}
