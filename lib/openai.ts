/**
 * Voice pipeline: audio file -> Whisper transcription -> GPT-4o-mini structured JSON.
 * Bring-your-own OpenAI key (stored in expo-secure-store via lib/secrets.ts).
 */
import { EXTRACTION_PROMPT, normalizeExtracted } from './extractPrompt';

export interface ExtractedItem {
  description: string;
  quantity: number;
  rate: number; // dollars, may include cents
}

export interface ExtractedInvoice {
  clientName: string;
  items: ExtractedItem[];
  notes: string;
}

const API_BASE = 'https://api.openai.com/v1';

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

/** Send a recorded audio file to Whisper and return the transcript text. */
export async function transcribeAudio(audioUri: string, apiKey: string): Promise<string> {
  const form = new FormData();
  form.append('model', 'whisper-1');
  form.append('file', {
    uri: audioUri,
    name: 'recording.m4a',
    type: 'audio/m4a',
  } as unknown as Blob);

  const res = await fetch(`${API_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Transcription failed (${res.status}). ${describeApiError(res.status, text)}`);
  }
  const json = (await res.json()) as { text?: string };
  return (json.text ?? '').trim();
}

/** Turn a spoken transcript into structured invoice data with GPT-4o-mini. */
export async function extractInvoice(transcript: string, apiKey: string): Promise<ExtractedInvoice> {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: transcript },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Invoice extraction failed (${res.status}). ${describeApiError(res.status, text)}`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? '{}';
  return normalizeExtracted(JSON.parse(content));
}

/** Full pipeline used by the New Invoice screen: transcribe then extract. */
export async function voiceToInvoice(
  audioUri: string,
  apiKey: string,
  onStage?: (stage: 'transcribing' | 'extracting') => void
): Promise<{ transcript: string; extracted: ExtractedInvoice }> {
  onStage?.('transcribing');
  const transcript = await transcribeAudio(audioUri, apiKey);
  if (!transcript) throw new Error('Could not hear anything in that recording. Try again, closer to the mic.');
  onStage?.('extracting');
  const extracted = await extractInvoice(transcript, apiKey);
  return { transcript, extracted };
}

function describeApiError(status: number, body: string): string {
  if (status === 401) return 'Your OpenAI API key was rejected. Check it in Settings.';
  if (status === 429) return 'OpenAI rate limit or billing issue — check your OpenAI account.';
  if (status >= 500) return 'OpenAI had a server problem. Try again in a minute.';
  const snippet = body.slice(0, 160).replace(/\s+/g, ' ');
  return snippet ? `Details: ${snippet}` : 'Check your connection and try again.';
}
