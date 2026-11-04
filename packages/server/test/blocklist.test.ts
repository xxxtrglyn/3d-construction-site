import { describe, expect, it } from 'vitest';
import { maskBlocked } from '@hht/shared';
import { loadConfig } from '../src/config.ts';
import { Blocklist } from '../src/systems/blocklist.ts';

// Guards the shipped lists: a too-broad ignore rule once kept them out of git, so a fresh checkout
// ran chat with an empty blocklist (constitution Principle V).
describe('shipped chat blocklist', () => {
  const bl = new Blocklist(loadConfig({}).blocklistDir);

  it('loads the English and Vietnamese starter lists from the default directory', () => {
    expect(bl.list.terms.length).toBeGreaterThan(50);
    expect(maskBlocked('what the f*ck', bl.list).masked).toBe(true);
    expect(maskBlocked('đụ má', bl.list).masked).toBe(true);
  });

  it('leaves everyday construction and Vietnamese chat alone', () => {
    for (const t of ['screw this beam on', 'hooker on the crane', 'pass the brick', 'lon bia', 'đeo mũ bảo hộ', 'các bạn ơi']) {
      expect(maskBlocked(t, bl.list).masked, t).toBe(false);
    }
  });
});
