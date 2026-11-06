import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

type NetApi = {
  mode: 'net';
  ready: Promise<void>;
  net: {
    connected(): boolean;
    worldId(): number;
    me(): { sessionId: string; netId: number; name: string; crew: { plot: number; role: string } | null; holding: string | null; position: [number, number, number] };
    players(): Array<{ sessionId: string; name: string; hatColor: string; crewPlot: number; crewRole: string; drawn: boolean }>;
    remotePosition(sid: string): [number, number, number] | null;
    plots(): Array<{ index: number; state: string; blueprintId: string; completedStages: number; filledSlots: number; filledA: number; filledB: number; needs: Array<{ type: string; left: number; done: boolean; craneOnly: boolean }>; hostName: string; joinMode: string; crewSize: number; bin: string[]; groundPoured: number; highFilled: number }>;
    chatLog(): Array<{ from: string; channel: string; text: string; shown: boolean }>;
    send(type: string, payload: unknown): void;
    events: EventTarget;
    dev: Record<string, (...a: unknown[]) => void>;
  };
};
export type NetWin = Window & { __hht?: NetApi; __mpEvents?: Array<{ type: string; detail: unknown }> };

const open: BrowserContext[] = [];

/** Close every context opened by openPlayer (software-rendered pages left open starve later tests). */
export async function closePlayers(): Promise<void> {
  await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
}

/** A fresh browser context = a fresh device (own localStorage → own player key). */
export async function openPlayer(browser: Browser, query = 'e2e=1'): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  open.push(ctx);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404|WebSocket/.test(m.text())) errors.push(m.text());
  });
  await page.goto(`/?${query}`);
  await page.bringToFront();
  await page.waitForFunction(() => (window as NetWin).__hht?.mode === 'net', null, { timeout: 45_000 });
  await page.evaluate(() => (window as NetWin).__hht!.ready);
  await expect(page.locator('#loader')).toHaveCount(0, { timeout: 10_000 });
  await page.evaluate(() => {
    const w = window as NetWin;
    w.__mpEvents = [];
    for (const t of ['snap', 'hint', 'binned', 'thanks', 'celebrate', 'emote', 'foreman', 'request', 'requestResult', 'crewNotice', 'slowDown', 'shift', 'summary', 'chat', 'chatRefused', 'chatPaused', 'reportResult']) {
      w.__hht!.net.events.addEventListener(t, (e) => w.__mpEvents!.push({ type: t, detail: (e as CustomEvent).detail }));
    }
  });
  return { page, errors };
}

export const me = (p: Page) => p.evaluate(() => (window as NetWin).__hht!.net.me());
export const players = (p: Page) => p.evaluate(() => (window as NetWin).__hht!.net.players());
export const plots = (p: Page) => p.evaluate(() => (window as NetWin).__hht!.net.plots());
export const mpEvents = (p: Page, type?: string) => p.evaluate((t) => ((window as NetWin).__mpEvents ?? []).filter((e) => !t || e.type === t), type);
export const dev = (p: Page, op: string, ...args: unknown[]) => p.evaluate(([o, a]) => (window as NetWin).__hht!.net.dev[o as string]!(...(a as unknown[])), [op, args] as const);
export const send = (p: Page, type: string, payload: unknown) => p.evaluate(([t, pl]) => (window as NetWin).__hht!.net.send(t as string, pl), [type, payload] as const);
