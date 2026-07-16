import { handler, ok } from "@/lib/api";
import { usageReport } from "@/lib/store";

export const GET = handler(async (req: Request) => {
  const days = Number(new URL(req.url).searchParams.get("days")) || 30;
  return ok(await usageReport(Date.now() - days * 24 * 3600 * 1000));
});
