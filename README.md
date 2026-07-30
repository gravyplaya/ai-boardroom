# AI Boardroom

Multi-agent corporate simulation platform with **JARVIS** as Chief of Staff — chat, voice, vault memory, canvas, and board of specialized AI agents.

**Live:** https://ai-boardroom-nine.vercel.app/

## Features
- **JARVIS chat** — routes directives to specialized board members
- **Voice widget** — Gemini Live API (requires `GEMINI_API_KEY`)
- **Board of Directors** — Architect, Coder, Creative, Analyst, Product, DevOps, Security, QA
- **Obsidian vault** — shared markdown memory, notepad, mind map
- **Implementation canvas** — visual planning board
- **Demo mode** — UI fully works without API keys (chat explains how to enable models)

## Quick start

```bash
npm install
cp .env.example .env   # add GEMINI_API_KEY and/or OPENROUTER_API_KEY
npm start              # http://localhost:8080
```

## Environment

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Primary models + voice |
| `OPENROUTER_API_KEY` | Fallback text models |
| `BOARDROOM_API_KEY` | Optional lock on `/api/execution/*` |
| `ALLOWED_ORIGINS` | Optional CORS allowlist (empty = allow all) |
| `PORT` | Default `8080` |

## Vercel

- Static UI from `public/`
- Serverless Express via `api/index.js` (rewrites `/api/*`)
- Set env vars in the Vercel project dashboard
- After deploy, `/api/status` must return JSON (not HTML)

## Scripts
- `npm start` — production server
- `npm run dev` — watch mode
