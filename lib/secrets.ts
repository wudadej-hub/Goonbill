import * as SecureStore from 'expo-secure-store';

const KEY = 'goonbill_openai_key';
const GEMINI_KEY = 'goonbill_gemini_key';
const CUSTOM_KEY = 'goonbill_custom_api';

async function getStored(k: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(k);
  } catch {
    return null;
  }
}

async function setStored(k: string, value: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) {
    await SecureStore.deleteItemAsync(k);
  } else {
    await SecureStore.setItemAsync(k, trimmed);
  }
}

export async function getApiKey(): Promise<string | null> {
  return getStored(KEY);
}

export async function setApiKey(key: string): Promise<void> {
  return setStored(KEY, key);
}

export async function hasApiKey(): Promise<boolean> {
  const key = await getApiKey();
  return !!key;
}

export async function getGeminiKey(): Promise<string | null> {
  return getStored(GEMINI_KEY);
}

export async function setGeminiKey(key: string): Promise<void> {
  return setStored(GEMINI_KEY, key);
}

export interface CustomApiSecrets {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export async function getCustomApiSecrets(): Promise<CustomApiSecrets | null> {
  const raw = await getStored(CUSTOM_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CustomApiSecrets>;
    if (parsed.baseUrl && parsed.apiKey && parsed.model) {
      return { baseUrl: parsed.baseUrl, apiKey: parsed.apiKey, model: parsed.model };
    }
    return null;
  } catch {
    return null;
  }
}

export async function setCustomApiSecrets(cfg: CustomApiSecrets): Promise<void> {
  const baseUrl = cfg.baseUrl.trim().replace(/\/+$/, '');
  const apiKey = cfg.apiKey.trim();
  const model = cfg.model.trim();
  if (!baseUrl || !apiKey || !model) {
    await SecureStore.deleteItemAsync(CUSTOM_KEY);
    return;
  }
  await SecureStore.setItemAsync(CUSTOM_KEY, JSON.stringify({ baseUrl, apiKey, model }));
}
