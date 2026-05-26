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

# (Optional) restrict CORS to your site only — defaults to "*"
wrangler secret put ALLOWED_ORIGINS
# Paste: https://huichiy.github.io,http://localhost:5173

# Deploy. The URL is printed at the end.
wrangler deploy
```

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
- Gemini 2.5 Flash: 1500 requests/day
- Gemini 2.5 Pro: 50 requests/day

If you outgrow either, swap the worker's upstream URL/model in `src/index.ts`.

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
