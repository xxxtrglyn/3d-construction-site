import { CHAT } from './constants.ts';

/**
 * Chat moderation baseline (constitution v1.1.0, Principle V; research R16). Pure functions:
 * the server runs them on every message; the blocklist itself never ships to clients.
 */

export type SanitizeResult = { ok: true; text: string } | { ok: false; reason: 'empty' | 'tooLong' };

// control (Cc) and format (Cf: zero-width, bidi overrides, BOM…) characters
const STRIP_RE = new RegExp('[\\p{Cc}\\p{Cf}\\u2028\\u2029]', 'gu');

export function sanitize(input: string, maxLen: number = CHAT.maxLen): SanitizeResult {
  const text = input.normalize('NFC').replace(/\s+/gu, ' ').replace(STRIP_RE, '').replace(/ {2,}/g, ' ').trim();
  if (!text) return { ok: false, reason: 'empty' };
  if ([...text].length > maxLen) return { ok: false, reason: 'tooLong' };
  return { ok: true, text };
}

// ---------------------------------------------------------------- contact info

const TLDS = 'com|net|org|io|gg|vn|xyz|me|co|app|dev|info|biz|tv|ly|link|site|online|store|club|top|ru|cn|uk|de|fr|jp|kr|us|ca|au|in|edu|gov|live|fun|game|games|pro|chat|page|to|cc|ws';
const URL_RES: RegExp[] = [
  /(?:https?|ftp):\/\//i,
  /\bwww\s*(?:\.|dot)\s*[a-z0-9]/i,
  new RegExp(`\\b[a-z0-9][a-z0-9-]{1,}\\s*(?:\\.|\\(dot\\)|\\[dot\\]|\\s+dot\\s+)\\s*(?:${TLDS})\\b`, 'i'),
  /discord(?:app)?\s*(?:\.|dot)\s*(?:gg|com)/i,
  /\b(?:t\.me|bit\.ly|tinyurl)\b/i,
];
const EMAIL_RE = /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\s+at\s+)\s*[a-z0-9-]+\s*(?:\.|\(dot\)|\[dot\]|\s+dot\s+)\s*[a-z]{2,}/i;
const PHONE_RE = /\+?\d(?:[\s.\-()]*\d){6,}/;

/** True when the text contains a link, an email address or a phone number (→ refused, FR-062). */
export function detectContact(input: string): boolean {
  const t = input.normalize('NFKC');
  if (URL_RES.some((r) => r.test(t))) return true;
  if (EMAIL_RE.test(t)) return true;
  return PHONE_RE.test(t);
}

// ---------------------------------------------------------------- blocklist masking

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i', '|': 'i' };
/** look-alike letters accepted inside blocklist terms only (so normal words are not rewritten) */
const TERM_CLASS: Record<string, string> = { u: '[uv]', i: '[il]' };

interface NormChar {
  ch: string;
  /** span in the original string (UTF-16 indices) */
  start: number;
  end: number;
}

/**
 * Lowercase, undo letter substitutions; separators become single spaces. With `strip`, diacritics are
 * removed too (đ→d) so unaccented typing matches; without, accents are kept (NFC) so accented
 * Vietnamese terms do not collide with innocent words ("lồn" ≠ "lớn").
 */
function normalizeChars(input: string, strip = true): NormChar[] {
  const out: NormChar[] = [];
  let i = 0;
  for (const cp of input) {
    const start = i;
    i += cp.length;
    let c = cp.toLowerCase();
    if (strip && c === 'đ') c = 'd';
    c = LEET[c] ?? c;
    c = strip ? c.normalize('NFD').replace(/\p{M}/gu, '') : c.normalize('NFC');
    // '*' stays as a wildcard letter ("f*ck", "sh*t")
    const letters = [...c].filter((x) => x === '*' || /^[\p{L}\p{N}]$/u.test(x));
    if (letters.length) for (const x of letters) out.push({ ch: x, start, end: i });
    else if (out.length && (out[out.length - 1] as NormChar).ch !== ' ') out.push({ ch: ' ', start, end: i });
  }
  while (out.length && (out[out.length - 1] as NormChar).ch === ' ') out.pop();
  return out;
}

/** Merges runs of ≥ 3 single-letter tokens ("f u c k", "f.u.c.k") into one word. */
function collapseSpacedLetters(chars: NormChar[]): NormChar[] {
  const tokens: NormChar[][] = [[]];
  for (const c of chars) {
    if (c.ch === ' ') tokens.push([]);
    else (tokens[tokens.length - 1] as NormChar[]).push(c);
  }
  const out: NormChar[] = [];
  let i = 0;
  const sep = (t: NormChar[]): NormChar => ({ ch: ' ', start: (t[0] as NormChar).start, end: (t[0] as NormChar).start });
  while (i < tokens.length) {
    let j = i;
    while (j < tokens.length && (tokens[j] as NormChar[]).length === 1) j++;
    if (j - i >= 3) {
      if (out.length) out.push(sep(tokens[i] as NormChar[]));
      for (let k = i; k < j; k++) out.push(...(tokens[k] as NormChar[]));
      i = j;
    } else {
      const t = tokens[i] as NormChar[];
      if (t.length) {
        if (out.length) out.push(sep(t));
        out.push(...t);
      }
      i++;
    }
  }
  return out;
}

export interface CompiledBlocklist {
  readonly terms: readonly string[];
  /** plain-ASCII terms, matched against the accent-stripped text */
  readonly re: RegExp | null;
  /** accented terms, matched against the accent-preserving text */
  readonly exact: RegExp | null;
}

const isPlain = (t: string): boolean => t === t.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

function termRegex(terms: string[]): RegExp | null {
  if (!terms.length) return null;
  // each letter may repeat ("fuuuck"); spaces inside a term match one or more spaces
  const pats = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((t) => [...t].map((ch) => (ch === ' ' ? ' +' : `(?:${TERM_CLASS[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|\\*)+`)).join(''));
  return new RegExp(`(?<![\\p{L}\\p{N}*])(?:${pats.join('|')})(?![\\p{L}\\p{N}*])`, 'gu');
}

/** Compiles blocklist lines (one term per line, `#` comments) into word-bounded matchers. */
export function compileBlocklist(lines: readonly string[]): CompiledBlocklist {
  const plain: string[] = [];
  const accented: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim().toLowerCase().normalize('NFC');
    if (!line) continue;
    if (isPlain(line)) {
      const norm = collapseSpacedLetters(normalizeChars(line, true)).map((c) => c.ch).join('');
      if (norm && !plain.includes(norm)) plain.push(norm);
    } else {
      const norm = collapseSpacedLetters(normalizeChars(line, false)).map((c) => c.ch).join('');
      if (norm && !accented.includes(norm)) accented.push(norm);
    }
  }
  return { terms: [...plain, ...accented], re: termRegex(plain), exact: termRegex(accented) };
}

/** Normalized form (exposed for duplicate detection and tests). */
export function normalizeForMatch(input: string): string {
  return collapseSpacedLetters(normalizeChars(input)).map((c) => c.ch).join('');
}

function findSpans(input: string, re: RegExp | null, strip: boolean, spans: Array<[number, number]>): void {
  if (!re) return;
  const chars = collapseSpacedLetters(normalizeChars(input, strip));
  const norm = chars.map((c) => c.ch).join('');
  re.lastIndex = 0;
  for (const m of norm.matchAll(re)) {
    const a = chars[m.index as number] as NormChar;
    const b = chars[(m.index as number) + m[0].length - 1] as NormChar;
    spans.push([a.start, b.end]);
  }
}

/** Replaces blocklisted words (with their variants) by ♥, keeping the rest of the text. */
export function maskBlocked(input: string, list: CompiledBlocklist): { text: string; masked: boolean } {
  const spans: Array<[number, number]> = [];
  findSpans(input, list.re, true, spans);
  findSpans(input, list.exact, false, spans);
  if (!spans.length) return { text: input, masked: false };
  spans.sort((x, y) => x[0] - y[0]);
  const merged: Array<[number, number]> = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else merged.push([sp[0], sp[1]]);
  }
  let out = '';
  let i = 0;
  for (const [st, e] of merged) {
    out += input.slice(i, st);
    out += [...input.slice(st, e)].map((c) => (/\s/u.test(c) ? c : '♥')).join('');
    i = e;
  }
  out += input.slice(i);
  return { text: out, masked: true };
}
