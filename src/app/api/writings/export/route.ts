import { attachmentDisposition, bad, handler } from "@/lib/api";
import { getFiction, listFictions } from "@/lib/store";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const body = await req.json();
  let items;
  if (body?.all === true) {
    items = await listFictions();
  } else {
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown) => typeof id === "string") : [];
    if (!ids.length) return bad("select at least one fiction");
    items = (await Promise.all(ids.map(getFiction))).filter(Boolean);
  }
  const payload = { kind: "animachat-writings", version: 1, writings: items };
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": attachmentDisposition(`animachat-writings-${stamp}`, "json"),
    },
  });
});
