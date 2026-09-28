/**
 * Gemini path: the phone transcribes speech on-device (free), then Gemini Flash
 * turns the transcript into structured invoice JSON. Uses the free-tier-friendly
 * generateContent endpoint — no audio upload, just text.
 */
import type { ExtractedInvoice } from './openai';
import { EXTRACTION_PROMPT, normalizeExtracted } from './extractPrompt';

const MODEL = 'gemini-2.5-flash';

/** Turn a transcript into structured invoice data with Gemini Flash. */
export async function extractInvoiceWithGemini(
  transcript: string,
  apiKey: string
): Promise<ExtractedInvoice> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${EXTRACTION_PROMPT}\n\nTranscript:\n${transcript}` }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini extraction failed (${res.status}). ${describeError(res.status, text)}`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const content = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '{}';
  return normalizeExtracted(JSON.parse(content));
}

function describeError(status: number, body: string): string {
  if (status === 400) return 'Your Gemini API key was rejected. Check it in Settings.';
  if (status === 429) return 'Gemini rate limit hit — wait a minute and try again.';
  if (status >= 500) return 'Google had a server problem. Try again in a minute.';
  const snippet = body.slice(0, 160).replace(/\s+/g, ' ');
  return snippet ? `Details: ${snippet}` : 'Check your connection and try again.';
}
