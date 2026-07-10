import { bad, handler, ok, type IdParams } from "@/lib/api";
import { AiConfigError, callLlm, resolveModel } from "@/lib/ai/client";
import { buildContext, buildImpersonateRequest } from "@/lib/ai/prompts";

/** Draft the user's next reply in their persona's voice. */
export const POST = handler(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const ctx = buildContext(id);
  try {
    const modelRef = resolveModel("impersonate", ctx.chat);
    const req = buildImpersonateRequest(ctx, modelRef);
    const text = await callLlm({
      modelRef,
      system: req.system,
      messages: req.messages,
      maxTokens: 400,
      feature: "impersonate",
      chatId: id,
    });
    return ok({ text: text.trim() });
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), e instanceof AiConfigError ? 409 : 500);
  }
});
