import { describe, expect, it } from 'vitest';
import { compileBlocklist, detectContact, maskBlocked, normalizeForMatch, sanitize } from '../src/index.ts';
import corpus from './fixtures/chat-corpus.json' with { type: 'json' };

describe('sanitize', () => {
  it('strips control, zero-width and bidi characters and collapses whitespace', () => {
    expect(sanitize('  hi​  there‮\n\tfriend\u0007 ')).toEqual({ ok: true, text: 'hi there friend' });
  });
  it('rejects empty and over-long text (80 characters)', () => {
    expect(sanitize(' ​ ')).toEqual({ ok: false, reason: 'empty' });
    expect(sanitize('a'.repeat(80)).ok).toBe(true);
    expect(sanitize('a'.repeat(81))).toEqual({ ok: false, reason: 'tooLong' });
    expect(sanitize('é'.repeat(80)).ok).toBe(true); // counted by characters, NFC
  });
});

describe('detectContact (SC-013)', () => {
  it('refuses 100 % of the contact corpus', () => {
    const missed = corpus.contact.filter((t) => !detectContact(t));
    expect(missed).toEqual([]);
  });
  it('has no false positives on normal game phrases', () => {
    const flagged = corpus.clean.filter((t) => detectContact(t));
    expect(flagged).toEqual([]);
  });
});

describe('maskBlocked (SC-013)', () => {
  const list = compileBlocklist(['# test list', ...corpus.blocklist, '']);
  it('masks 100 % of blocklist terms and their variants', () => {
    const unmasked = corpus.masked.filter((t) => !maskBlocked(t, list).masked);
    expect(unmasked).toEqual([]);
  });
  it('keeps clean text untouched (no Scunthorpe problem)', () => {
    const changed = corpus.clean.filter((t) => maskBlocked(t, list).masked);
    expect(changed).toEqual([]);
  });
  it('keeps the surrounding text and replaces the matched span with ♥', () => {
    expect(maskBlocked('oh shit, the bell', list).text).toBe('oh ♥♥♥♥, the bell');
    expect(maskBlocked('well f.u.c.k that', list).text).toBe('well ♥♥♥♥♥♥♥ that');
    expect(maskBlocked('đụ má mày', list).text).toBe('♥♥ ♥♥ mày');
  });
  it('normalizes diacritics and substitutions', () => {
    expect(normalizeForMatch('ĐỤ  Má')).toBe('du ma');
    expect(normalizeForMatch('$h1t')).toBe('shit');
    expect(normalizeForMatch('f . u . c . k')).toBe('fuck');
  });
  it('an empty list masks nothing', () => {
    expect(maskBlocked('anything', compileBlocklist(['# nothing'])).masked).toBe(false);
  });
});
