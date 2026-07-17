---
name: verify
description: Build, launch and drive AnimaChat end-to-end in an isolated instance to verify a change at the UI surface.
---

# Verifying AnimaChat changes

## Launch an isolated instance (never touch the user's dev server / data)

Isolation = a throwaway Postgres schema + a throwaway MinIO bucket (the compose
services must be up: `docker compose up -d`). The app runs no DDL — create the
schema and apply ALL migrations (seed included) yourself, and create the bucket
via the SDK (the `animachat` MinIO user may create buckets):

```bash
npm run build                       # npm start serves the BUILT app — rebuild after every source edit
docker compose exec -T postgres psql -U animachat -d animachat -c 'CREATE SCHEMA IF NOT EXISTS vfy'
for f in migrations/*.sql; do docker compose exec -T -e PGOPTIONS='-c search_path=vfy' \
  postgres psql -U animachat -d animachat -q -f - < $f; done   # filename order; 100_seed.sql = starter cast (Mira, Kael, …)
node -e "const{S3Client,CreateBucketCommand}=require('@aws-sdk/client-s3');
new S3Client({endpoint:'http://localhost:9000',region:'us-east-1',forcePathStyle:true,
credentials:{accessKeyId:'animachat',secretAccessKey:'animachat'}})
.send(new CreateBucketCommand({Bucket:'vfy'})).then(()=>console.log('ok'))"
ANIMACHAT_PG_SCHEMA=vfy S3_BUCKET=vfy PORT=3123 npm start &
```

Cleanup afterwards: `DROP SCHEMA vfy CASCADE` and delete the bucket (empty it
first if any uploads happened).

**Proxy gotcha:** the shell env's `http_proxy`/`https_proxy`/`all_proxy`
intercept even localhost — `unset` them (or `curl --noproxy '*'`) before curl
or node scripts that hit the instance. The app's own outbound calls (Node
fetch) ignore these vars, so app → mock LLM works untouched.

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

Mock-server gotchas:
- Key per-speaker replies off the system prompt's `You are <Name>,` marker; the
  history's user lines arrive prefixed `User: ` (mind exact-match assertions).
- Clear the SSE drip timer on **`res.on("close")`**, not `req.on("close")` — in
  modern Node the request stream closes as soon as its body is consumed, so a
  req-close handler kills the timer before the first chunk is ever written.

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
