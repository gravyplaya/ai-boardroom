/**
 * providers.js — Multi-provider LLM catalog
 * Primary stack: NVIDIA NIM (integrate.api.nvidia.com)
 * Fallbacks: OpenRouter free, plus user-supplied OpenAI / Anthropic / Gemini / xAI
 */

import { env } from './env.js';

export const PROVIDERS = {
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    primary: true,
    baseUrl: env('NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1'),
    envKey: 'NVIDIA_API_KEY',
    openAiCompatible: true,
    color: '#76b900',
    description: 'Hosted NIM models — Nemotron, Llama, DeepSeek, Qwen, and more',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    primary: false,
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    openAiCompatible: true,
    color: '#a855f7',
    description: 'Fallback router with free community models',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    primary: false,
    baseUrl: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    openAiCompatible: true,
    color: '#10a37f',
    description: 'GPT-4.1 / GPT-4o / o-series',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    primary: false,
    baseUrl: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
    openAiCompatible: false,
    color: '#d4a27f',
    description: 'Claude models',
  },
  google: {
    id: 'google',
    name: 'Google Gemini',
    primary: false,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envKey: 'GEMINI_API_KEY',
    openAiCompatible: true,
    color: '#4285f4',
    description: 'Gemini via OpenAI-compatible endpoint',
  },
  xai: {
    id: 'xai',
    name: 'xAI Grok',
    primary: false,
    baseUrl: env('XAI_BASE_URL', 'https://api.x.ai/v1'),
    envKey: 'XAI_API_KEY',
    openAiCompatible: true,
    color: '#e8e8e8',
    description: 'Grok models + voice',
  },
};

/** Curated NVIDIA NIM chat models (used when live catalog fetch fails) */
export const NVIDIA_CURATED_MODELS = [
  { id: 'nvidia/llama-3.3-nemotron-super-49b-v1', name: 'Nemotron Super 49B', tier: 'flagship' },
  { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B Instruct', tier: 'flagship' },
  { id: 'nvidia/llama-3.1-nemotron-51b-instruct', name: 'Nemotron 51B Instruct', tier: 'balanced' },
  { id: 'nvidia/nemotron-mini-4b-instruct', name: 'Nemotron Mini 4B', tier: 'fast' },
  { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', tier: 'flagship' },
  { id: 'meta/llama-3.1-405b-instruct', name: 'Llama 3.1 405B', tier: 'flagship' },
  { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', tier: 'balanced' },
  { id: 'meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B', tier: 'fast' },
  { id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1', tier: 'reasoning' },
  { id: 'deepseek-ai/deepseek-v3.1', name: 'DeepSeek V3.1', tier: 'flagship' },
  { id: 'qwen/qwen2.5-72b-instruct', name: 'Qwen 2.5 72B', tier: 'flagship' },
  { id: 'qwen/qwen2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B', tier: 'code' },
  { id: 'qwen/qwen2.5-7b-instruct', name: 'Qwen 2.5 7B', tier: 'fast' },
  { id: 'mistralai/mistral-large-2-instruct', name: 'Mistral Large 2', tier: 'flagship' },
  { id: 'mistralai/mixtral-8x22b-instruct-v0.1', name: 'Mixtral 8x22B', tier: 'balanced' },
  { id: 'google/gemma-2-27b-it', name: 'Gemma 2 27B', tier: 'balanced' },
  { id: 'microsoft/phi-4', name: 'Phi-4', tier: 'fast' },
  { id: 'microsoft/phi-3.5-moe-instruct', name: 'Phi-3.5 MoE', tier: 'balanced' },
  { id: '01-ai/yi-large', name: 'Yi Large', tier: 'flagship' },
  { id: 'nvidia/nv-embedqa-e5-v5', name: 'NV EmbedQA (embed only)', tier: 'embed', chat: false },
];

/** OpenRouter free-tier fallbacks */
export const OPENROUTER_FREE_MODELS = [
  { id: 'nvidia/llama-3.1-nemotron-70b-instruct:free', name: 'Nemotron 70B (free)', tier: 'free' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (free)', tier: 'free' },
  { id: 'meta-llama/llama-3.1-8b-instruct:free', name: 'Llama 3.1 8B (free)', tier: 'free' },
  { id: 'google/gemma-2-9b-it:free', name: 'Gemma 2 9B (free)', tier: 'free' },
  { id: 'qwen/qwen-2.5-72b-instruct:free', name: 'Qwen 2.5 72B (free)', tier: 'free' },
  { id: 'qwen/qwen-2.5-coder-32b-instruct:free', name: 'Qwen Coder 32B (free)', tier: 'free' },
  { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (free)', tier: 'free' },
  { id: 'deepseek/deepseek-chat-v3-0324:free', name: 'DeepSeek Chat V3 (free)', tier: 'free' },
  { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B (free)', tier: 'free' },
  { id: 'openrouter/auto', name: 'OpenRouter Auto', tier: 'auto' },
];

export const OPENAI_MODELS = [
  { id: 'gpt-4.1', name: 'GPT-4.1', tier: 'flagship' },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', tier: 'fast' },
  { id: 'gpt-4o', name: 'GPT-4o', tier: 'flagship' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', tier: 'fast' },
  { id: 'o3-mini', name: 'o3-mini', tier: 'reasoning' },
  { id: 'o4-mini', name: 'o4-mini', tier: 'reasoning' },
];

export const ANTHROPIC_MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', tier: 'flagship' },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', tier: 'flagship' },
  { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', tier: 'fast' },
];

export const GOOGLE_MODELS = [
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', tier: 'flagship' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', tier: 'fast' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', tier: 'fast' },
];

export const XAI_MODELS = [
  { id: 'grok-3', name: 'Grok 3', tier: 'flagship' },
  { id: 'grok-3-mini', name: 'Grok 3 Mini', tier: 'fast' },
  { id: 'grok-2-latest', name: 'Grok 2', tier: 'balanced' },
];

/** Default board member → preferred NVIDIA model */
export const DEFAULT_ROLE_MODELS = {
  jarvis: { provider: 'nvidia', model: 'nvidia/llama-3.1-nemotron-70b-instruct' },
  architect: { provider: 'nvidia', model: 'nvidia/llama-3.3-nemotron-super-49b-v1' },
  coder: { provider: 'nvidia', model: 'qwen/qwen2.5-coder-32b-instruct' },
  creative: { provider: 'nvidia', model: 'meta/llama-3.3-70b-instruct' },
  analyst: { provider: 'nvidia', model: 'deepseek-ai/deepseek-r1' },
  product: { provider: 'nvidia', model: 'meta/llama-3.1-70b-instruct' },
  devops: { provider: 'nvidia', model: 'qwen/qwen2.5-coder-32b-instruct' },
  security: { provider: 'nvidia', model: 'deepseek-ai/deepseek-v3.1' },
  qa: { provider: 'nvidia', model: 'microsoft/phi-4' },
};

export const VOICE_PROVIDERS = {
  gemini: {
    id: 'gemini',
    name: 'Gemini Live',
    envKey: 'GEMINI_API_KEY',
    description: 'Google Gemini Live bidirectional audio',
  },
  openai: {
    id: 'openai',
    name: 'ChatGPT Voice (Realtime)',
    envKey: 'OPENAI_API_KEY',
    description: 'OpenAI Realtime API voice',
  },
  xai: {
    id: 'xai',
    name: 'Grok Voice',
    envKey: 'XAI_API_KEY',
    description: 'xAI Grok realtime voice',
  },
};

export function getServerKey(providerId) {
  const p = PROVIDERS[providerId];
  if (!p) return null;
  return env(p.envKey) || null;
}

export function resolveKey(providerId, clientKeys = {}) {
  if (clientKeys && clientKeys[providerId]) return String(clientKeys[providerId]).trim();
  return getServerKey(providerId);
}

export function catalogForProvider(providerId) {
  switch (providerId) {
    case 'nvidia':
      return NVIDIA_CURATED_MODELS.filter((m) => m.chat !== false);
    case 'openrouter':
      return OPENROUTER_FREE_MODELS;
    case 'openai':
      return OPENAI_MODELS;
    case 'anthropic':
      return ANTHROPIC_MODELS;
    case 'google':
      return GOOGLE_MODELS;
    case 'xai':
      return XAI_MODELS;
    default:
      return [];
  }
}

export function staticModelCatalog() {
  return Object.values(PROVIDERS).map((p) => ({
    ...p,
    configured: !!getServerKey(p.id),
    models: catalogForProvider(p.id),
  }));
}

export default {
  PROVIDERS,
  NVIDIA_CURATED_MODELS,
  OPENROUTER_FREE_MODELS,
  DEFAULT_ROLE_MODELS,
  VOICE_PROVIDERS,
  getServerKey,
  resolveKey,
  catalogForProvider,
  staticModelCatalog,
};
