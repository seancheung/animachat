/* Best-effort parser for a truncated JSON prefix — the co-writer's <fields>
 * block while it is still streaming. One pass builds the value as far as the
 * text goes so the client can fill the form live instead of staring at a
 * spinner; the strict JSON.parse of the finished block (with its fixup
 * retries) remains the authoritative apply.
 *
 * Truncation is completed, not repaired: a string cut mid-way is kept as the
 * text so far (that's the typewriter effect on a description field), a key cut
 * mid-way or left without a value is dropped, and unterminated containers are
 * treated as closed. Genuinely malformed input (not merely truncated) returns
 * null — and since the input is always a prefix of the same stream, once it is
 * malformed it stays malformed, so callers can stop parsing.
 */

export interface PartialJsonFrame {
  kind: "object" | "array";
  /** where this container sits in its parent (object key / array index); null for the root */
  at: string | number | null;
}

export interface PartialJson {
  /** best-effort value of the (possibly unterminated) JSON; undefined when no value has started */
  value: unknown;
  /** containers still open at the end of the text, outermost first */
  open: PartialJsonFrame[];
  /** the object key whose value was being written when the text ended, if any */
  openKey: string | null;
  /** a truncated scalar leaf was placed into the value (a string/number still being written) */
  incompleteLeaf: boolean;
}

const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

interface Frame extends PartialJsonFrame {
  container: Record<string, unknown> | unknown[];
  /** object frames: key parsed, value not yet complete */
  pendingKey: string | null;
  /** object frames: key of the last value placed (for openKey when that value was truncated) */
  lastKey: string | null;
}

export function parsePartialJson(text: string): PartialJson | null {
  const n = text.length;
  let i = 0;
  const stack: Frame[] = [];
  let root: unknown;
  let hasRoot = false;
  let incompleteLeaf = false;

  const top = () => stack[stack.length - 1];

  const place = (v: unknown) => {
    const t = top();
    if (!t) {
      root = v;
      hasRoot = true;
    } else if (t.kind === "array") {
      (t.container as unknown[]).push(v);
    } else if (t.pendingKey !== null) {
      (t.container as Record<string, unknown>)[t.pendingKey] = v;
      t.lastKey = t.pendingKey;
      t.pendingKey = null;
    }
  };

  const openContainer = (kind: "object" | "array") => {
    const t = top();
    const at: string | number | null = !t
      ? null
      : t.kind === "array"
        ? (t.container as unknown[]).length
        : t.pendingKey;
    const container = kind === "object" ? {} : [];
    place(container);
    stack.push({ kind, at, container, pendingKey: null, lastKey: null });
  };

  /** Decode a string starting at its opening quote. Returns null on a malformed
   *  escape; complete=false when the text ends before the closing quote. */
  const readString = (from: number): { value: string; end: number; complete: boolean } | null => {
    let s = "";
    let j = from + 1;
    while (j < n) {
      const c = text[j];
      if (c === '"') return { value: s, end: j + 1, complete: true };
      if (c === "\\") {
        if (j + 1 >= n) return { value: s, end: n, complete: false }; // truncated escape — dropped
        const e = text[j + 1];
        if (e === "u") {
          const hex = text.slice(j + 2, j + 6);
          if (hex.length < 4) return { value: s, end: n, complete: false };
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
          s += String.fromCharCode(parseInt(hex, 16));
          j += 6;
        } else {
          const m = ESCAPES[e];
          if (m === undefined) return null;
          s += m;
          j += 2;
        }
      } else {
        s += c;
        j++;
      }
    }
    return { value: s, end: n, complete: false };
  };

  // expecting: a value / an object key / the ":" after a key / "," or a closing bracket
  let mode: "value" | "key" | "colon" | "after" = "value";

  while (i < n) {
    const c = text[i];
    if (c === " " || c === "\n" || c === "\r" || c === "\t") {
      i++;
      continue;
    }
    if (mode === "value") {
      if (c === "{") {
        openContainer("object");
        mode = "key";
        i++;
      } else if (c === "[") {
        openContainer("array");
        i++; // stays in "value": an element or "]" follows
      } else if (c === "]" && top()?.kind === "array") {
        stack.pop(); // empty array (or a trailing comma — tolerated)
        mode = "after";
        i++;
      } else if (c === '"') {
        const s = readString(i);
        if (!s) return null;
        place(s.value);
        if (s.complete) {
          mode = "after";
          i = s.end;
        } else {
          incompleteLeaf = true;
          i = n;
        }
      } else if (c === "-" || (c >= "0" && c <= "9")) {
        const m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
        if (!m) return null;
        const num = Number(m[0]);
        if (i + m[0].length < n) {
          place(num);
          mode = "after";
          i += m[0].length;
        } else {
          // ran to the end of the text — may be cut mid-number
          if (Number.isFinite(num)) {
            place(num);
            incompleteLeaf = true;
          }
          i = n;
        }
      } else if (c === "t" || c === "f" || c === "n") {
        const lit = c === "t" ? "true" : c === "f" ? "false" : "null";
        const seg = text.slice(i, i + lit.length);
        if (seg === lit) {
          place(lit === "true" ? true : lit === "false" ? false : null);
          mode = "after";
          i += lit.length;
        } else if (i + seg.length >= n && lit.startsWith(seg)) {
          i = n; // truncated literal — nothing placed
        } else {
          return null;
        }
      } else {
        return null;
      }
    } else if (mode === "key") {
      if (c === "}") {
        stack.pop();
        mode = "after";
        i++;
      } else if (c === '"') {
        const s = readString(i);
        if (!s) return null;
        if (!s.complete) {
          i = n; // truncated key — dropped
        } else {
          top()!.pendingKey = s.value;
          mode = "colon";
          i = s.end;
        }
      } else {
        return null;
      }
    } else if (mode === "colon") {
      if (c === ":") {
        mode = "value";
        i++;
      } else {
        return null;
      }
    } else {
      const t = top();
      if (!t) break; // complete root — ignore trailing text (e.g. the closing </fields> tag)
      if (c === ",") {
        mode = t.kind === "object" ? "key" : "value";
        i++;
      } else if ((c === "}" && t.kind === "object") || (c === "]" && t.kind === "array")) {
        stack.pop();
        i++;
      } else {
        return null;
      }
    }
  }

  // what's being written into the innermost open object: the key awaiting its
  // value, or the key whose truncated value was just placed
  const t = top();
  const openKey =
    t?.kind === "object" ? (t.pendingKey ?? (incompleteLeaf ? t.lastKey : null)) : null;

  return {
    value: hasRoot ? root : undefined,
    open: stack.map((f) => ({ kind: f.kind, at: f.at })),
    openKey,
    incompleteLeaf,
  };
}

/**
 * Drop the array element still under construction — the last element of the
 * shallowest open array (only one construction site exists in a linear stream).
 * The form merges identify collection items by name, so a half-written element
 * must never be applied: a truncated identity ("Mir" for "Mira") would mint a
 * spurious duplicate that the authoritative final apply cannot heal (merges
 * update and append, never delete). Mutates and returns `p.value` — each parse
 * builds a fresh value, so nothing shared is touched.
 */
export function dropOpenArrayElement(p: PartialJson): unknown {
  const k = p.open.findIndex((f) => f.kind === "array");
  if (k === -1) return p.value;
  let arr: unknown = p.value;
  for (let j = 1; j <= k; j++) arr = (arr as Record<string | number, unknown>)?.[p.open[j].at as string | number];
  if (!Array.isArray(arr)) return p.value;
  // under construction = a deeper container is open inside it, or the text
  // ended mid-scalar; ended right after "[" or "," = the last element is whole
  if (k < p.open.length - 1 || p.incompleteLeaf) arr.pop();
  return p.value;
}

const IDENTITY_KEYS = new Set(["name", "title", "renameFrom"]);

/**
 * Human label for what the model is writing right now — `Mira — description`,
 * `scenes`, `greeting`… Best-effort from the open path: the innermost open
 * item's name (or the collection's key while the item is still nameless), plus
 * the field being written. Null when there is nothing useful to say.
 */
export function describePartialProgress(p: PartialJson): string | null {
  let name: string | null = null;
  let section: string | null = null;
  let cur: unknown = p.value;
  for (let j = 0; j < p.open.length; j++) {
    const f = p.open[j];
    if (j > 0) cur = (cur as Record<string | number, unknown>)?.[f.at as string | number];
    if (f.kind === "array") {
      name = null; // an enclosing item's name never labels the elements inside
      if (typeof f.at === "string") section = f.at;
    } else if (cur && typeof cur === "object") {
      const o = cur as Record<string, unknown>;
      const nm = [o.name, o.title].find((v) => typeof v === "string" && v.trim());
      if (nm) name = (nm as string).trim();
    }
  }
  // while the name itself is being written it is truncated — don't show it
  const writingIdentity = p.openKey !== null && IDENTITY_KEYS.has(p.openKey);
  const head = writingIdentity ? section : (name ?? section);
  const field = p.openKey && !writingIdentity ? p.openKey : null;
  const parts = [head, field].filter(Boolean) as string[];
  return parts.length ? parts.join(" — ") : null;
}
