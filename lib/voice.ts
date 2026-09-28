/**
 * Voice provider abstraction.
 *
 * Three ways to turn speech into an invoice:
 *  - ondevice: phone's built-in speech recognition (free, no key) + local regex parser.
 *  - gemini:   phone's speech recognition (free) + Gemini Flash parses the transcript (free tier key).
 *  - openai:   recorded audio -> Whisper -> GPT-4o-mini (paid key + billing).
 */
import { getSetting, setSetting } from './db';
import { getApiKey as getOpenAIKey } from './secrets';
import { getCustomApiSecrets, getGeminiKey } from './secrets';

export type VoiceProvider = 'ondevice' | 'openai' | 'gemini' | 'custom';

export interface ProviderInfo {
  id: VoiceProvider;
  name: string;
  blurb: string;
  needsKey: boolean;
}

export const VOICE_PROVIDERS: ProviderInfo[] = [
  {
    id: 'ondevice',
    name: 'On-device (free)',
    blurb: "Your phone listens and GoonBill figures out the invoice. No key, no cost.",
    needsKey: false,
  },
  {
    id: 'gemini',
    name: 'Google Gemini (free tier)',
    blurb: 'Your phone listens, Gemini builds the invoice. Free API key from Google AI Studio.',
    needsKey: true,
  },
  {
    id: 'openai',
    name: 'OpenAI (paid)',
    blurb: 'Whisper transcription + GPT-4o-mini. Most accurate. Needs billing on your OpenAI account.',
    needsKey: true,
  },
  {
    id: 'custom',
    name: 'Custom API',
    blurb: 'Your phone listens, your API builds the invoice. Any OpenAI-compatible endpoint (OpenRouter, Groq, DeepSeek, xAI…).',
    needsKey: true,
  },
];

const PROVIDER_KEY = 'voice_provider';

export function getVoiceProvider(): VoiceProvider {
  const v = getSetting(PROVIDER_KEY, 'ondevice');
  return v === 'openai' || v === 'gemini' || v === 'custom' ? v : 'ondevice';
}

export function setVoiceProvider(p: VoiceProvider): void {
  setSetting(PROVIDER_KEY, p);
}

export function getProviderInfo(id: VoiceProvider): ProviderInfo {
  return VOICE_PROVIDERS.find((p) => p.id === id) ?? VOICE_PROVIDERS[0];
}

/** True when the selected provider can be used right now (key present if one is needed). */
export async function isVoiceReady(): Promise<boolean> {
  const p = getVoiceProvider();
  if (p === 'ondevice') return true;
  if (p === 'openai') return !!(await getOpenAIKey());
  if (p === 'gemini') return !!(await getGeminiKey());
  return !!(await getCustomApiSecrets());
}

/** Short label for the settings screen, e.g. "On-device (free)". */
export function providerLabel(): string {
  return getProviderInfo(getVoiceProvider()).name;
}
