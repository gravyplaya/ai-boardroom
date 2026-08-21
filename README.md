# AI Boardroom v2.2

Multi-agent boardroom with **streaming chat**, multi-provider LLMs, and **Grok Voice Agent**.

## Highlights
- **Board sessions** — JARVIS brief → parallel seats → challenge → Decision Packet → vault minutes
- **Streaming** SSE chat with stop / regenerate / copy (Direct mode)
- **NVIDIA NIM** primary · OpenRouter free fallback · OpenAI / Claude / Gemini / xAI
- Per-board-member model assignment
- Grok Voice Agent (ephemeral tokens, tools, MCP config)
- Setup checklist · local-only attach · vault · mind map · canvas
- Agent activity monitor (real in-process task log)
- Security headers, write jails, scrubbed code-exec env

## Quick start
```bash
npm install
cp .env.example .env   # optional
npm start              # http://localhost:8080
```

Open **Settings** → paste **NVIDIA** (and/or **xAI**) keys → Save → chat.

## Optional env
| Key | Purpose |
|-----|---------|
| `NVIDIA_API_KEY` | Primary NIM models |
| `XAI_API_KEY` | Grok text + Voice Agent |
| `OPENROUTER_API_KEY` | Free-model fallback |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | Extra providers |
| `BOARDROOM_API_KEY` | Locks tools/execution when set |
| `ALLOWED_ORIGINS` | CORS allowlist |

Browser keys in Settings override empty server keys for that session.
