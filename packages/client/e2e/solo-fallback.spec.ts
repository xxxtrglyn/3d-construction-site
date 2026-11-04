import { expect, test } from '@playwright/test';

test('no world reachable → solo within 6 s, then "Join others" once the server answers', async ({ page }) => {
  let block = true;
  await page.route('**/api/**', (route) => (block ? route.abort() : route.continue()));
  const t0 = Date.now();
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('solo-banner')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => (window as unknown as { __hht?: { mode: string } }).__hht?.mode === 'solo', null, { timeout: 30_000 });
  expect(Date.now() - t0).toBeLessThan(6000 + 9000); // matchmake timeout 6 s + asset load in software rendering
  block = false;
  await expect(page.getByTestId('join-others')).toBeVisible({ timeout: 15_000 });
});

test('?solo=1 never touches the server', async ({ page }) => {
  const netRequests: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/|\/ws\//.test(r.url())) netRequests.push(r.url());
  });
  await page.goto('/?e2e=1&solo=1');
  await page.waitForFunction(() => (window as unknown as { __hht?: { mode: string } }).__hht?.mode === 'solo', null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  expect(netRequests).toEqual([]);
});
