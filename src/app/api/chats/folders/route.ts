import { handler, ok } from "@/lib/api";
import { listChatFolders } from "@/lib/store";

export const GET = handler(async () => ok({ folders: await listChatFolders() }));
