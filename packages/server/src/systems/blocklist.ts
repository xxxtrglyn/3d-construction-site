import { readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { compileBlocklist, type CompiledBlocklist } from '@hht/shared';

/** Loads every *.txt in the blocklist directory and hot-reloads on change (research R16). Server-only. */
export class Blocklist {
  list: CompiledBlocklist = compileBlocklist([]);
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    this.reload();
    try {
      this.watcher = watch(dir, () => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.reload(), 200);
      });
      this.watcher.unref();
    } catch {
      /* directory missing: chat runs with an empty list */
    }
  }

  reload(): void {
    try {
      const lines: string[] = [];
      for (const f of readdirSync(this.dir)) if (f.endsWith('.txt')) lines.push(...readFileSync(join(this.dir, f), 'utf8').split(/\r?\n/));
      this.list = compileBlocklist(lines);
    } catch (e) {
      console.warn('[chat] blocklist not loaded:', (e as Error).message);
    }
  }

  close(): void {
    this.watcher?.close();
    if (this.timer) clearTimeout(this.timer);
  }
}

let shared: Blocklist | null = null;
export function blocklistFor(dir: string): Blocklist {
  shared ??= new Blocklist(dir);
  return shared;
}
export function closeBlocklist(): void {
  shared?.close();
  shared = null;
}
