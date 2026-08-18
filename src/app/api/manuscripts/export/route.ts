import { attachmentDisposition, bad, handler } from "@/lib/api";
import { getManuscript, listManuscripts } from "@/lib/store";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const body = await req.json();
  let items;
  if (body?.all === true) {
    items = await listManuscripts();
  } else {
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown) => typeof id === "string") : [];
    if (!ids.length) return bad("select at least one manuscript");
    items = (await Promise.all(ids.map(getManuscript))).filter(Boolean);
  }
  const payload = { kind: "animachat-manuscripts", version: 1, manuscripts: items };
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": attachmentDisposition(`animachat-manuscripts-${stamp}`, "json"),
    },
  });
});
