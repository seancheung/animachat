/* Novel export: plain speaker-labeled transcript (md/epub) and the AI-rewrite pipeline's
 * pure pieces — chapter splitting, transcript rendering, chunking, prompt assembly.
 * The LLM calls and SSE orchestration live in the novel API route. */

import JSZip from "jszip";
import { estimateTokens } from "@/lib/ai/client";
import { chatScene, type ChatContext } from "@/lib/ai/prompts";
import { mentionsToPlain } from "@/lib/mentions";
import { getCharacter, getPersona } from "@/lib/store";
import type { Chat, Message } from "@/lib/types";

export type NovelVoice = "third" | "first";

function contentOf(m: Message): string {
  // mentions are flattened to plain @Name in exports, all roles
  return mentionsToPlain(m.variants[m.activeVariant]?.content ?? "");
}

export async function speakerOf(chat: Chat, m: Message): Promise<string> {
  if (m.role === "narrator") return "Narrator";
  if (m.role === "user") {
    const played = chat.personaCharacterId
      ? chat.storySnapshot?.characters.find((c) => c.id === chat.personaCharacterId)
      : null;
    return played?.name ?? (chat.personaId ? (await getPersona(chat.personaId))?.name ?? "You" : "You");
  }
  return (
    chat.storySnapshot?.characters.find((c) => c.id === m.characterId)?.name ??
    (await getCharacter(m.characterId ?? ""))?.name ??
    chat.nameSnapshots[m.characterId ?? ""] ??
    "???"
  );
}

export interface NovelChapter {
  /** heading — a scene name or "The End"; null for the opening stretch */
  title: string | null;
  messages: Message[];
}

/** Chapter boundaries: a narrator message advancing the scene opens a chapter named after
 *  the scene (the message itself belongs to the new chapter); <the-end/> opens a final
 *  "The End" chapter that any epilogue messages fall into. Markers and empty messages drop. */
export async function splitChapters(chat: Chat, messages: Message[]): Promise<NovelChapter[]> {
  const chapters: NovelChapter[] = [{ title: null, messages: [] }];
  for (const m of messages) {
    if (m.sceneEvent?.sceneId)
      chapters.push({ title: (await chatScene(chat, m.sceneEvent.sceneId))?.name ?? "New scene", messages: [] });
    if (m.role !== "marker" && contentOf(m)) chapters[chapters.length - 1].messages.push(m);
    if (m.sceneEvent?.theEnd) chapters.push({ title: "The End", messages: [] });
  }
  return chapters.filter((c) => c.title !== null || c.messages.length > 0);
}

/** Plain transcript rendering of a chapter's messages, as markdown lines. */
export async function transcriptMd(chat: Chat, messages: Message[]): Promise<string[]> {
  const lines: string[] = [];
  for (const m of messages) {
    const content = contentOf(m);
    if (m.role === "narrator") lines.push(`*${content.replace(/^\*|\*$/g, "")}*`, "");
    else lines.push(`**${await speakerOf(chat, m)}:** ${content}`, "");
  }
  return lines;
}

export async function toMarkdown(chat: Chat, messages: Message[]): Promise<string> {
  const lines: string[] = [`# ${chat.title}`, ""];
  for (const ch of await splitChapters(chat, messages)) {
    if (ch.title) lines.push(`---`, "", `## ${ch.title}`, "");
    lines.push(...(await transcriptMd(chat, ch.messages)));
  }
  return lines.join("\n");
}

/** Pack messages into chunks of roughly `budget` estimated transcript tokens (message-aligned;
 *  a single oversized message still becomes its own chunk). */
export function chunkByTokens(messages: Message[], budget: number): Message[][] {
  const chunks: Message[][] = [];
  let cur: Message[] = [];
  let tokens = 0;
  for (const m of messages) {
    const t = estimateTokens(contentOf(m));
    if (cur.length && tokens + t > budget) {
      chunks.push(cur);
      cur = [];
      tokens = 0;
    }
    cur.push(m);
    tokens += t;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** Speaker-labeled transcript as the rewrite model sees it. */
export async function transcriptForModel(chat: Chat, messages: Message[]): Promise<string> {
  const lines: string[] = [];
  for (const m of messages) {
    lines.push(`${await speakerOf(chat, m)}: ${contentOf(m)}`);
  }
  return lines.join("\n\n");
}

export function buildNovelizeSystem(ctx: ChatContext, voice: NovelVoice): string {
  const world: string[] = [];
  if (ctx.snapshot) world.push(`STORY: ${ctx.snapshot.name}\n${ctx.sub(ctx.snapshot.description)}`);
  else {
    if (ctx.scene) world.push(`SCENE: ${ctx.scene.name}\n${ctx.sub(ctx.scene.setup)}`);
    if (ctx.location) world.push(`LOCATION: ${ctx.location.name}\n${ctx.sub(ctx.location.description)}`);
  }
  const cast = [
    ...(ctx.persona ? [`${ctx.persona.name} (the user's protagonist)`] : []),
    ...ctx.characters.map((c) => c.name),
  ];
  const voiceRule =
    voice === "first" && ctx.persona
      ? `in the first person, past tense — ${ctx.persona.name} narrates as "I"`
      : `in the third person, past tense`;
  return [
    `You rewrite a roleplay chat transcript into polished novel prose.`,
    ...world,
    cast.length ? `CAST: ${cast.join(", ")}` : "",
    `RULES:\n` +
      `- Write in ${ctx.language}, ${voiceRule}.\n` +
      `- In the transcript, a speaker's *asterisks* mark physical actions and "quotes" mark speech; their unmarked text is usually speech — judge from context.\n` +
      `- Keep every spoken line's wording intact (you may normalize punctuation and quoting); dissolve the "Name:" speaker labels into natural attribution; turn actions and Narrator lines into flowing narrative prose.\n` +
      `- Invent no events, dialogue or details, and drop nothing of substance.\n` +
      `- Output only the prose, in paragraphs — no headings, no markdown, no commentary.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Per-chunk user message: the rewritten tail rides along so prose flows across calls. */
export function novelizeUserMessage(tail: string, transcript: string): string {
  return (
    (tail ? `THE NOVEL SO FAR (its ending, shown for continuity — do not repeat it):\n…${tail}\n\n` : "") +
    `TRANSCRIPT TO REWRITE:\n${transcript}`
  );
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mdToXhtml(md: string): string {
  return md
    .split("\n\n")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      if (p.startsWith("# ")) return `<h1>${esc(p.slice(2))}</h1>`;
      if (p.startsWith("## ")) return `<h2>${esc(p.slice(3))}</h2>`;
      if (p === "---") return "<hr/>";
      let html = esc(p);
      html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>");
      return `<p>${html}</p>`;
    })
    .join("\n");
}

export async function toEpub(chat: Chat, md: string): Promise<Buffer> {
  const zip = new JSZip();
  const title = esc(chat.title);
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${chat.id}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z/, "Z")}</meta>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`
  );
  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title></head>
<body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">${title}</a></li></ol></nav></body></html>`
  );
  zip.file(
    "OEBPS/chapter.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${title}</title></head>
<body>
${mdToXhtml(md)}
</body></html>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}
