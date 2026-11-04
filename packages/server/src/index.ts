import { loadConfig } from './config.ts';
import { startServer } from './server.ts';

const cfg = loadConfig();
const server = await startServer(cfg);
console.log(`[hht] game server on :${server.port} (db ${cfg.db}, max ${cfg.maxPlayers}/world, shift ${cfg.shiftMinutes} min${cfg.devCheats ? ', dev cheats' : ''})`);

let stopping = false;
const stop = (signal: string): void => {
  if (stopping) return;
  stopping = true;
  console.log(`[hht] ${signal}: closing clients (4005) and the database`);
  server.close().then(() => process.exit(0), () => process.exit(1));
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
