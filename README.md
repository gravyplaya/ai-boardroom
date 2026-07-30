# AI Boardroom v2

Multi-agent corporate simulation with **JARVIS** as Chief of Staff.

**Primary LLM stack: [NVIDIA NIM](https://build.nvidia.com)** (`https://integrate.api.nvidia.com/v1`)  
**Fallback:** OpenRouter free models · optional OpenAI / Claude / Gemini / Grok keys

## Features
- 9 board members with **per-role model assignment**
- Settings UI for all provider API keys (stored in browser localStorage)
- Interactive chat composer with **waveform** (Gemini/Grok-style)
- Voice: **Gemini Live**, **ChatGPT Realtime**, **Grok Voice**
- Vault notepad, mind map (search/filter), implementation canvas
- Demo mode when no keys are set

## Quick start
```bash
npm install
cp .env.example .env   # optional server-side keys
npm start              # http://localhost:8080
```

Open **Settings** (gear) → paste **NVIDIA_API_KEY** → Save → chat.

## Env (optional server defaults)
| Key | Purpose |
|-----|---------|
| `NVIDIA_API_KEY` | Primary NIM models |
| `OPENROUTER_API_KEY` | Free-model fallback |
| `OPENAI_API_KEY` | GPT + ChatGPT voice |
| `ANTHROPIC_API_KEY` | Claude |
| `GEMINI_API_KEY` | Gemini + Live voice |
| `XAI_API_KEY` | Grok + Grok voice |

Client keys in Settings override empty server keys for that browser session.
