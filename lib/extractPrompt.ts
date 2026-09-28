/**
 * Shared invoice-extraction prompt used by every LLM-backed voice provider.
 * The transcript is appended after the prompt.
 */
export const EXTRACTION_PROMPT = [
  'You extract invoice data from a contractor dictating job details into their phone.',
  'Return ONLY a JSON object with this shape:',
  '{"clientName": string, "items": [{"description": string, "quantity": number, "rate": number}], "notes": string}',
  '- clientName: the client or customer name mentioned, or "" if none.',
  '- items: one per distinct piece of work or material. description is short and plain.',
  '  quantity defaults to 1 when not stated. rate is the dollar amount per unit (a number, e.g. 85.5).',
  '  If the speaker states a total line price but no quantity, use quantity 1 and rate = that total.',
  '  If no price is mentioned for an item, use rate 0.',
  '- notes: anything else relevant (dates, addresses, payment terms), or "".',
  '- Never invent prices or quantities that were not stated.',
].join('\n');

/** Normalize a parsed LLM response into a clean invoice shape. */
export function normalizeExtracted(parsed: unknown): {
  clientName: string;
  items: { description: string; quantity: number; rate: number }[];
  notes: string;
} {
  const p = (parsed ?? {}) as {
    clientName?: unknown;
    notes?: unknown;
    items?: unknown;
  };
  return {
    clientName: typeof p.clientName === 'string' ? p.clientName : '',
    notes: typeof p.notes === 'string' ? p.notes : '',
    items: Array.isArray(p.items)
      ? p.items
          .filter((i) => i && typeof (i as { description?: unknown }).description === 'string' && String((i as { description: string }).description).trim())
          .map((i) => {
            const item = i as { description: string; quantity?: unknown; rate?: unknown };
            return {
              description: String(item.description).trim(),
              quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
              rate: Number(item.rate) >= 0 ? Number(item.rate) : 0,
            };
          })
      : [],
  };
}
