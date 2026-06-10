import { NextRequest, NextResponse } from "next/server";
import { PROVIDERS } from "@/lib/providers/llm-providers-types";

const CACHE_TTL_MS = 300000;
let _cache: { data: any; time: number } | null = null;

const ENV_VAR_MAP: Record<string, string | string[]> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  cohere: 'COHERE_API_KEY',
  together: 'TOGETHER_API_KEY',
  replicate: 'REPLICATE_API_TOKEN',
  portkey: 'PORTKEY_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  zen: 'ZEN_API_KEY',
  pollinations: '',  // free, no key needed
  openrouter: 'OPENROUTER_API_KEY',
  chutes: 'CHUTES_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  groq: 'GROQ_API_KEY',
  deepinfra: 'DEEPINFRA_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  composio: 'COMPOSIO_API_KEY',
  vercel: 'VERCEL_API_KEY',
  livekit: 'LIVEKIT_API_KEY',
  chatanywhere: 'CHATANYWHERE_API_KEY',
  aihubmix: 'AIHUBMIX_API_KEY',
  github: ['GITHUB_MODELS_API_KEY', 'AZURE_OPENAI_API_KEY'],
  ninerouter: 'NINEROUTER_API_KEY',
  kiro: ['QUAZ_API_KEY', 'NINEROUTER_API_KEY'],
  ollama: ['QUAZ_API_KEY', 'NINEROUTER_API_KEY'],
  opencode: ['OPENCODE_HOSTNAME', 'OPENCODE_PORT'],
  'opencode-cli': 'OPENCODE_CLI_BASE_URL',
  amp: 'AMP_BASE_URL',
  codex: 'CODEX_BASE_URL',
  kilocode: 'KILO_BASE_URL',
  pi: 'PI_BASE_URL',
  'claude-code': 'CLAUDE_CODE_BASE_URL',
};

function checkEnv(name: string | string[]): boolean {
  const keys = Array.isArray(name) ? name : [name];
  return keys.some(k => k && !!process.env[k]);
}

function isProviderAvailable(id: string): boolean {
  const entry = ENV_VAR_MAP[id];
  if (entry === '') return true;  // free providers always available
  if (!entry) return false;
  return checkEnv(entry);
}

export async function GET(request: NextRequest) {
  const now = Date.now();
  if (_cache && now - _cache.time < CACHE_TTL_MS) {
    return NextResponse.json(_cache.data, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
    });
  }

  const allProviders = Object.values(PROVIDERS).map(p => ({
    id: p.id,
    name: p.name,
    models: p.models.map((m: any) => (typeof m === 'string' ? m : m.id)),
    subProviders: (p as any).subProviders,
    supportsStreaming: p.supportsStreaming,
    maxTokens: p.maxTokens,
    description: p.description,
    isAvailable: isProviderAvailable(p.id),
  }));

  const sortedProviders = allProviders.sort((a, b) => {
    if (a.isAvailable && !b.isAvailable) return -1;
    if (!a.isAvailable && b.isAvailable) return 1;
    return 0;
  });

  const data = {
    success: true,
    data: {
      providers: sortedProviders,
      defaultProvider: process.env.DEFAULT_LLM_PROVIDER || "mistral",
      defaultModel: process.env.DEFAULT_MODEL || "mistral-large-latest",
    },
  };

  _cache = { data, time: now };

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
  });
}
