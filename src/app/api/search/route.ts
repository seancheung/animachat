import { handler, ok } from "@/lib/api";
import { searchMessages } from "@/lib/store";

export const GET = handler(async (req: Request) => {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return ok([]);
  return ok(
    searchMessages(q).map(({ message, chat }) => ({
      chatId: chat.id,
      chatTitle: chat.title,
      messageId: message.id,
      role: message.role,
      snippet: (message.variants[message.activeVariant]?.content ?? "").slice(0, 200),
      createdAt: message.createdAt,
    }))
  );
});
