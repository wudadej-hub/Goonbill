/**
 * Local invoice parser for the on-device voice provider.
 *
 * No network, no key: turns a speech-recognition transcript into invoice data
 * with regex heuristics. It won't be as clever as an LLM, but the review screen
 * lets the user fix anything before saving.
 */
import type { ExtractedInvoice, ExtractedItem } from './openai';

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100,
};

const FILLER = new Set([
  'plus', 'and', 'for', 'the', 'a', 'an', 'to', 'invoice', 'bill', 'please',
  'uh', 'um', 'okay', 'ok',
]);

function wordsToNumbers(text: string): string {
  return text.replace(
    /\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/gi,
    (m) => {
      const w = m.toLowerCase();
      if (w === 'a' || w === 'an') return '1';
      return String(NUMBER_WORDS[w] ?? m);
    }
  );
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Pull a client name out of "…for John Smith…" style phrasing. */
function extractClient(text: string): { client: string; rest: string } {
  const m = text.match(/\bfor\s+([a-z'’-]+(?:\s+[a-z'’-]+){0,2})/i);
  if (!m) return { client: '', rest: text };
  let name = m[1].trim();
  // Trim trailing price/time/filler words the regex may have swallowed.
  name = name.replace(/\s+(?:\d[\d.,]*|dollars?|bucks?|hours?|hour|and|plus|or)+$/i, '').trim();
  if (!name || FILLER.has(name.toLowerCase())) return { client: '', rest: text };
  // Remove only "for <name>", leaving any swallowed filler words ("and", "plus")
  // in place so clause splitting still works.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rest = text
    .replace(new RegExp(`\\bfor\\s+${escaped}`, 'i'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { client: titleCase(name), rest };
}

/** All dollar amounts mentioned in a clause. */
function findPrices(clause: string): number[] {
  const out: number[] = [];
  const re = /\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:dollars?|bucks?)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clause)) !== null) {
    // Skip bare numbers that are clearly hours ("2 hours") — handled separately.
    const after = clause.slice(m.index + m[0].length, m.index + m[0].length + 8);
    if (!/\$/.test(m[0]) && !/dollar|buck/i.test(m[0]) && /\bhours?\b/i.test(after)) continue;
    out.push(parseFloat(m[1]));
  }
  return out;
}

function stripPrices(clause: string): string {
  return clause
    .replace(/\$?\s*\d+(?:\.\d{1,2})?\s*(?:dollars?|bucks?)?/gi, ' ')
    .replace(/\bat\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function meaningfulWords(clause: string): string {
  return clause
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w.toLowerCase()))
    .join(' ');
}

export function parseTranscriptLocal(raw: string): ExtractedInvoice {
  const items: ExtractedItem[] = [];
  if (!raw.trim()) return { clientName: '', items, notes: '' };

  const text = wordsToNumbers(raw);
  const { client, rest } = extractClient(text);

  // Split into clauses on punctuation and on "plus"/"and".
  const clauses = rest
    .split(/[,.;]+|\s+plus\s+|\s+and\s+/i)
    .map((c) => c.trim())
    .filter(Boolean);

  let pendingDesc = '';
  for (const clause of clauses) {
    // "X hours (of) labour at $Y (an hour)"
    const hours = clause.match(/(\d+(?:\.\d+)?)\s*hours?(?:\s+of)?\s*(labou?r|labor|work)?/i);
    if (hours) {
      const qty = parseFloat(hours[1]);
      const atRate = clause.match(/\bat\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
      const prices = findPrices(clause);
      const rate = atRate ? parseFloat(atRate[1]) : prices[0] ?? 0;
      const kind = hours[2] ? titleCase(hours[2]) : 'Labour';
      items.push({ description: kind, quantity: qty > 0 ? qty : 1, rate });
      pendingDesc = '';
      continue;
    }

    const prices = findPrices(clause);
    const desc = titleCase(meaningfulWords(stripPrices(clause)));
    if (prices.length > 0) {
      const description = desc || pendingDesc || 'Work';
      items.push({ description, quantity: 1, rate: prices[0] });
      pendingDesc = '';
    } else if (desc.length > 2) {
      // Description now, price may follow in the next clause.
      pendingDesc = desc;
    }
  }

  return { clientName: client, items, notes: '' };
}
