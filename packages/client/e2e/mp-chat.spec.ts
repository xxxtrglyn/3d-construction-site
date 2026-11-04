import { expect, test } from '@playwright/test';
import { dev, me, openPlayer } from './mp-helpers.ts';
import { closePlayers } from './mp-helpers.ts';

// two software-rendered pages per test: allow time to load both
test.describe.configure({ timeout: 150_000 });
test.afterEach(closePlayers);

type Win = Window & { __hht: { net: { chatLog(): Array<{ text: string; shown: boolean }> } } };

test('nearby chat with bubble and log; links refused; hide all chat; typing never moves the worker', async ({ browser }) => {
  const a = await openPlayer(browser);
  const b = await openPlayer(browser);
  await dev(a.page, 'unlockChat');
  await dev(a.page, 'teleport', 3, 0, 10);
  await dev(b.page, 'teleport', 5, 0, 10);
  await a.page.waitForTimeout(500);
  await a.page.locator('#game').focus();
  await a.page.keyboard.press('Enter');
  await expect(a.page.getByTestId('chat-box')).toBeVisible();
  const before = (await me(a.page)).position;
  await a.page.getByTestId('chat-input').type('need bricks wasd');
  await a.page.waitForTimeout(400);
  const after = (await me(a.page)).position;
  expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeLessThan(0.05);
  await a.page.keyboard.press('Enter');
  await expect.poll(() => b.page.evaluate(() => (window as unknown as Win).__hht.net.chatLog().map((l) => l.text)), { timeout: 5000 }).toContain('need bricks wasd');
  await expect(b.page.locator('.lbl .bubble.chat')).toHaveText('need bricks wasd', { timeout: 5000 });
  await a.page.getByTestId('chat-input').fill('see www.example.com');
  await a.page.keyboard.press('Enter');
  await expect(a.page.getByTestId('chat-box').locator('.hint')).toHaveText(/Links and contact info/, { timeout: 5000 });
  // B hides all chat
  await b.page.locator('.hud-top button').first().click();
  await b.page.getByRole('button', { name: /Hide all chat/ }).click();
  await b.page.keyboard.press('Escape');
  await a.page.waitForTimeout(2100);
  await a.page.getByTestId('chat-input').fill('second message');
  await a.page.keyboard.press('Enter');
  await expect.poll(() => b.page.evaluate(() => (window as unknown as Win).__hht.net.chatLog().find((l) => l.text === 'second message')?.shown), { timeout: 5000 }).toBe(false);
  await expect(b.page.getByTestId('chat-log')).toBeHidden();
});
