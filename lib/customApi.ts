/**
 * Custom API provider: the phone transcribes speech on-device (free), then the
 * user's own API builds the invoice. Any endpoint that speaks the OpenAI
 * chat-completions format works: OpenRouter, Groq, DeepSeek, Together, xAI,
 * Mistral, a self-hosted model, etc.
 *
 * Config: base URL (e.g. https://openrouter.ai/api/v1), API key, model name.
 */
import type { ExtractedInvoice } from './openai';
import { EXTRACTION_PROMPT, normalizeExtracted } from './extractPrompt';

export interface CustomApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Turn a transcript into structured invoice data via the user's custom endpoint. */
export async function extractInvoiceWithCustomApi(
  transcript: string,
  config: CustomApiConfig
): Promise<ExtractedInvoice> {
  const base = config.baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: transcript },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Custom API failed (${res.status}). ${describeError(res.status, text)}`);
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  let content = json.choices?.[0]?.message?.content ?? '{}';
  // Some models wrap JSON in code fences despite response_format.
  content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return normalizeExtracted(JSON.parse(content));
  } catch {
    throw new Error('Custom API did not return valid invoice JSON. Check the model and try again.');
  }
}

function describeError(status: number, body: string): string {
  if (status === 401 || status === 403) return 'Your custom API key was rejected. Check it in Settings.';
  if (status === 404) return 'Endpoint or model not found — check the base URL and model name in Settings.';
  if (status === 429) return 'Rate limit hit — wait a minute and try again.';
  if (status >= 500) return 'The API had a server problem. Try again in a minute.';
  const snippet = body.slice(0, 160).replace(/\s+/g, ' ');
  return snippet ? `Details: ${snippet}` : 'Check the base URL, key, and model in Settings.';
}
