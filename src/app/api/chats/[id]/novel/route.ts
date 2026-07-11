import JSZip from "jszip";
import { bad, handler, type IdParams } from "@/lib/api";
import { chatScene } from "@/lib/ai/prompts";
import { getChat, getCharacter, getPersona, listMessages } from "@/lib/store";
import type { Chat, Message } from "@/lib/types";

function speakerOf(chat: Chat, m: Message): string {
  if (m.role === "user") {
    const played = chat.personaCharacterId
      ? chat.storySnapshot?.characters.find((c) => c.id === chat.personaCharacterId)
      : null;
    return played?.name ?? (chat.personaId ? getPersona(chat.personaId)?.name ?? "You" : "You");
  }
  if (m.role === "narrator") return "";
  return (
    chat.storySnapshot?.characters.find((c) => c.id === m.characterId)?.name ??
    getCharacter(m.characterId ?? "")?.name ??
    chat.nameSnapshots[m.characterId ?? ""] ??
    "???"
  );
}

function toMarkdown(chat: Chat): string {
  const lines: string[] = [`# ${chat.title}`, ""];
  for (const m of listMessages(chat.id)) {
    const content = m.variants[m.activeVariant]?.content ?? "";
    // a narrator message that advances the story opens a new chapter
    if (m.sceneEvent?.sceneId) {
      const s = chatScene(chat, m.sceneEvent.sceneId);
      lines.push(`---`, "", `## ${s?.name ?? "New scene"}`, "");
    }
    if (m.role === "marker" || !content) continue;
    if (m.role === "narrator") lines.push(`*${content.replace(/^\*|\*$/g, "")}*`, "");
    else lines.push(`**${speakerOf(chat, m)}:** ${content}`, "");
    if (m.sceneEvent?.theEnd) lines.push(`---`, "", `## The End`, "");
  }
  return lines.join("\n");
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

async function toEpub(chat: Chat, md: string): Promise<Buffer> {
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

export const GET = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const chat = getChat(id);
  if (!chat) return bad("Chat not found", 404);
  const format = new URL(req.url).searchParams.get("format") === "epub" ? "epub" : "md";
  const md = toMarkdown(chat);
  const safe = chat.title.replace(/[^\w\d-]+/g, "-").slice(0, 60) || "chat";
  if (format === "md") {
    return new Response(md, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${safe}.md"`,
      },
    });
  }
  const epub = await toEpub(chat, md);
  return new Response(new Uint8Array(epub), {
    headers: {
      "content-type": "application/epub+zip",
      "content-disposition": `attachment; filename="${safe}.epub"`,
    },
  });
});
