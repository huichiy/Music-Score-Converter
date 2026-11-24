# OCR Worker

A tiny Cloudflare Worker that fronts Google Gemini's vision API for the Jianpu Converter app, so the production site can offer OCR without exposing the API key in the JS bundle.

## Why this exists

The main app is static (GitHub Pages, no backend). If we baked a Gemini key into the build, anyone could `Ctrl+F` it out of `dist/assets/index-XXX.js` and burn through the free quota in hours.

This Worker holds the key as a Cloudflare secret. The app POSTs OpenAI-shaped chat completions; the Worker translates to Gemini's format, attaches the key, and returns the response in OpenAI shape so the app's existing adapter code doesn't care.

Users who don't want to use the shared Worker can use **BYOK** in the app's OCR Settings — that path calls the provider (Gemini, Anthropic, OpenAI, Groq, or any OpenAI-compatible endpoint) directly from their browser.

## One-time setup

```bash
cd worker/

# Install wrangler globally (or use npx)
npm install -g wrangler

# Sign in to Cloudflare (opens a browser)
wrangler login

# Paste your Google AI Studio key when prompted
# Get one at: https://aistudio.google.com/apikey
wrangler secret put GEMINI_API_KEY

# Deploy. The URL is printed at the end.
# Allowed origins come from [vars] ALLOWED_ORIGINS in wrangler.toml — edit them
# there; they are not secret.
wrangler deploy
```

**Re-run `wrangler deploy` after every change** to `src/index.ts` or `wrangler.toml`
— editing the repo does not touch the live Worker. (Only secrets, like rotating
`GEMINI_API_KEY`, apply instantly.)

If you earlier created `ALLOWED_ORIGINS` as a *secret*, remove it first, or it
will clash with the var: `wrangler secret delete ALLOWED_ORIGINS`.

## What the Worker enforces

| Rule | Behaviour |
|---|---|
| Origin | When `ALLOWED_ORIGINS` is set (it is, in `wrangler.toml`), any other `Origin` — or none — gets **403**. Unset or `*` means open (local `wrangler dev` only). |
| Model | Forced to an allowlist (`gemini-3.6-flash`). Whatever the client asks for, including Pro or 3.8 Flash, becomes 3.6 Flash — the shared key has no Pro quota, and 3.8 Flash is often busy at peak. |
| Output size | `max_tokens` is clamped to 32768. Gemini counts its thinking against this cap; 8192 cut a dense 40-bar page off after 9-10 bars; a test at 40000 returned 36-39. |
| Request size | Bodies over 15 MB get **413**. |
| Payload | Must contain at least one PNG / JPEG / WebP / GIF image; this is not a general-purpose LLM endpoint. Malformed content parts (`null`, an `image_url` part with no `image_url`) are ignored, not an error. |
| Bad answers | An empty, safety-blocked or truncated Gemini reply becomes an error with a Chinese message the app shows as-is, never a blank "result". |
| Upstream errors | Gemini **429** → 识别额度已用完或请求太频繁… and **503 / 524** → 识别模型正忙… (upstream status kept); any other status passes the first 400 characters of Gemini's own text. |

## Add a rate-limiting rule (do this)

The `Origin` check stops other *websites* from using your key from a browser.
It does **not** stop a script: `curl -H "Origin: https://huichiy.github.io" …`
sets any Origin it likes. So the Origin check is a seatbelt, not a lock, and the
real cap on abuse is rate limiting:

1. Cloudflare dashboard → **Security → WAF → Rate limiting rules** (this needs the
   Worker on a route/custom domain of a zone you own — a bare `*.workers.dev`
   URL has no zone; for that case use Cloudflare's Workers **Rate Limiting**
   binding instead, configured in `wrangler.toml`).
2. Rule of thumb: **POST** requests to the Worker, about **10 per minute per IP**,
   action **Block** for a minute or two. A person uploading scores never gets
   near that.
3. For the first few weeks, glance at the usage page in Google AI Studio to
   confirm nobody else is spending your free quota.

After deploy, copy the printed URL (e.g. `https://jianpu-ocr.your-name.workers.dev`)
and set it in the main app's build environment:

```bash
# In the repo root, NOT worker/
echo "VITE_OCR_WORKER_URL=https://jianpu-ocr.your-name.workers.dev" >> .env.production
```

(Or set it as a GitHub Actions secret if you build via CI.)

## Free tier limits

Cloudflare Workers free plan:
- 100 000 requests per day
- 10ms CPU per invocation (more than enough for proxying)

Gemini free tier (Google AI Studio):
- Gemini 3.6 Flash has a free quota (Google changes the numbers, so check the usage page in AI Studio rather than trusting a figure written here). When it runs out, users get the 429 message above and can switch to their own key in the app.
- Pro models have no free quota — which is why the Worker never forwards them

If you outgrow either, change the upstream URL or `ALLOWED_MODELS` in `src/index.ts` (and redeploy). The old 2.5 Flash is routed to the weaker 3.5 Flash-Lite from 2026-12-01, so do not go back to it.

## Update or rotate the key

```bash
wrangler secret put GEMINI_API_KEY
# (re-paste new value; redeploy not required, secrets are live-applied)
```

## Local development

```bash
wrangler dev
# Serves the worker at http://localhost:8787
```

Point the main app at it by setting `VITE_OCR_WORKER_URL=http://localhost:8787` in `.env.local`.

## Tear down

```bash
wrangler delete
```

Removes the Worker; the GitHub repo's history retains the source if you want to redeploy later.
