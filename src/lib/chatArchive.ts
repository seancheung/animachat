import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { ASSETS_DIR } from "./db";
import { assetIdsOf, writeVerifiedAsset } from "./bundle";
import {
  appendMessage,
  getAsset,
  getChat,
  getCharacter,
  inTransaction,
  listMessages,
  registerAsset,
  saveChat,
  updateMessage,
} from "./store";
import type { Chat, Message } from "./types";

interface ChatArchive {
  app: "animachat";
  kind: "chat";
  version: 1;
  chat: Chat;
  messages: Message[];
  assets: { id: string; filename: string; mime: string }[];
}

/**
 * Export a chat as a self-contained zip: the chat row, all messages (variants,
 * stage events), and — for playthroughs — the snapshot's assets.
 * Casual/immersive chats reference the library by id and degrade fail-soft on
 * import elsewhere (names come from the snapshot completed below).
 * (Archives from before the fork feature may carry a `checkpoints` field — ignored.)
 */
export async function exportChatArchive(chatId: string): Promise<Buffer> {
  const chat = getChat(chatId);
  if (!chat) throw new Error("Chat not found");

  // complete the name snapshots so the archive shows names without the library
  const nameSnapshots = { ...chat.nameSnapshots };
  for (const cid of chat.characterIds) {
    const c = getCharacter(cid);
    if (c) nameSnapshots[cid] = c.name;
  }

  const assetIds = new Set<string>();
  const snap = chat.storySnapshot;
  if (snap) {
    for (const c of snap.characters) for (const a of assetIdsOf("character", c)) assetIds.add(a);
    for (const e of snap.scenes) for (const a of assetIdsOf("scene", e.scene)) assetIds.add(a);
    for (const l of snap.locations) for (const a of assetIdsOf("location", l)) assetIds.add(a);
  }

  const zip = new JSZip();
  const assets: ChatArchive["assets"] = [];
  for (const aid of assetIds) {
    const meta = getAsset(aid);
    const file = path.join(ASSETS_DIR, aid);
    if (meta && fs.existsSync(file)) {
      zip.file(`assets/${aid}`, fs.readFileSync(file));
      assets.push({ id: aid, filename: meta.filename, mime: meta.mime });
    }
  }

  const manifest: ChatArchive = {
    app: "animachat",
    kind: "chat",
    version: 1,
    chat: { ...chat, nameSnapshots },
    messages: listMessages(chatId),
    assets,
  };
  zip.file("chat.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * Import a chat archive as a NEW chat (fresh chat & message ids). The rolling
 * summary is not carried over — the memory pass simply re-summarizes old
 * history on the next turn.
 */
export async function importChatArchive(buf: Buffer): Promise<Chat> {
  const zip = await JSZip.loadAsync(buf);
  const mf = zip.file("chat.json");
  if (!mf) throw new Error("Not an AnimaChat chat archive: chat.json missing");
  const manifest = JSON.parse(await mf.async("string")) as ChatArchive;
  if (manifest.app !== "animachat" || manifest.kind !== "chat")
    throw new Error("Not an AnimaChat chat archive");
  if ((manifest.version ?? 1) > 1)
    throw new Error(`This chat archive uses format version ${manifest.version} — made by a newer AnimaChat`);

  // assets are content-addressed — identical files land on the same id
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  for (const a of manifest.assets ?? []) {
    const f = zip.file(`assets/${a.id}`);
    if (!f || !/^[a-f0-9]{32}$/.test(a.id)) continue;
    const data = await f.async("nodebuffer");
    if (!writeVerifiedAsset(a.id, data)) continue;
    registerAsset(a.id, a.filename, a.mime, data.length);
  }

  // atomic: a malformed message mid-archive must not leave a half-imported chat
  return inTransaction(() => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...chatFields } = manifest.chat ?? ({} as Chat);
    const chat = saveChat(chatFields);

    for (const m of manifest.messages ?? []) {
      const first = m.variants?.[0];
      const saved = appendMessage({
        chatId: chat.id,
        role: m.role,
        characterId: m.characterId ?? null,
        content: first?.content ?? "",
        emotion: first?.emotion ?? null,
        options: first?.options ?? null,
        sceneEvent: m.sceneEvent ?? null,
      });
      // restore the full variant set (swipes) and the active pick verbatim;
      // archives from before the raw_outputs table carried raw model output
      // inside variants — debug data that doesn't travel, so drop it
      if (Array.isArray(m.variants))
        updateMessage(saved.id, {
          variants: m.variants.map(({ raw: _raw, ...v }: { raw?: unknown } & Message["variants"][number]) => v),
          activeVariant: m.activeVariant ?? 0,
        });
    }
    return chat;
  });
}
