import express, { type Application, type Request, type Response } from 'express';
import { PROTOCOL_VERSION } from '@hht/shared';
import type { ServerContext } from '../context.ts';
import { matchmake } from './matchmake.ts';

/** Mounts the HTTP API (contracts/http-api.md) on the transport's express app. */
export function mountRoutes(app: Application, ctx: ServerContext): void {
  app.use('/api', express.json({ limit: '1kb' }));
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, protocol: PROTOCOL_VERSION, worlds: [...ctx.worlds.values()].sort((a, b) => a.worldId - b.worldId).map((w) => ({ worldId: w.worldId, players: w.sessions.size })) });
  });
  app.get('/api/metrics', (_req: Request, res: Response) => {
    if (!ctx.cfg.metrics) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(ctx.metrics.snapshot());
  });
  app.post('/api/matchmake', (req: Request, res: Response) => {
    matchmake(ctx, req.body, req.ip ?? 'unknown')
      .then((r) => res.status(r.status).json(r.body))
      .catch((e: unknown) => {
        console.error('[matchmake]', e);
        res.status(500).json({ error: 'internal' });
      });
  });
  // malformed JSON / oversized bodies
  app.use('/api', (err: unknown, _req: Request, res: Response, next: (e?: unknown) => void) => {
    if (err) res.status(400).json({ error: 'invalid' });
    else next();
  });
}
