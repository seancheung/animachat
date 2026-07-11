---
name: verify
description: Build, launch and drive AnimaChat end-to-end in an isolated instance to verify a change at the UI surface.
---

# Verifying AnimaChat changes

## Launch an isolated instance (never touch the user's dev server / data)

```bash
npm run build                       # npm start serves the BUILT app — rebuild after every source edit
SP=<scratch dir>; mkdir -p $SP/data
ANIMACHAT_DATA_DIR=$SP/data PORT=3123 npm start &
# starter cast (Mira, Kael, …) seeds automatically on the empty data dir
```

## Mock LLM for generation flows (no API key)

Tiny OpenAI-compatible SSE server on e.g. 3210 answering `POST *…/chat/completions`
with `data: {"choices":[{"delta":{"content":"…"}}]}` chunks then `data: [DONE]`.
Register it via the API, then set it as the default model:

```js
const p = await post("/api/providers", { name: "Mock", type: "openai", baseUrl: "http://localhost:3210/v1", apiKey: "x" });
const m = await post(`/api/providers/${p.id}/models`, { modelId: "mock-1", displayName: "Mock", contextWindow: 32000 });
await put("/api/settings", { defaultModelId: m.id });   // settings is PUT, not PATCH
```

Include an `<emo>name</emo>` prefix and a blank line between paragraphs in the mock
reply to exercise the tag parser and VN pagination.

## Drive with Playwright

`npm i playwright` in the scratch dir (repo has no playwright dep) — chromium is
usually already in `~/Library/Caches/ms-playwright`.

Gotchas:
- **Button `title` props render as `aria-label` + styled Tooltip, not a native
  `title` attribute** → locate with `getByLabel(...)`, not `getByTitle(...)`.
- Create chats/entities through the REST API to skip wizard clicking when the
  wizard itself isn't under test (`POST /api/chats {mode:"casual", characterIds:[…]}`).
- The VN dialogue box is `.vn-dialog`; its pagination chevron is `.animate-bounce`.
- Streaming is fast with the mock (~15 ms/word) — `waitForSelector` on reply text,
  then a short `waitForTimeout` before asserting post-stream state.

Flows worth driving: new-chat wizard → chat page; send + streamed reply in both
chat layouts (side panel / dialogue box); dialogue-box pagination + backlog keys
(←/→); layout switch persistence across reload; picture mode; settings drawer.
