import { AssetStore } from './assets/loader.ts';
import { Game } from './game/Game.ts';
import { initRapier } from './physics/physics.ts';
import { ProfileStore } from './profile/guestProfile.ts';
import { detectQuality } from './render/quality.ts';
import { createRenderContext, UnsupportedGraphicsError } from './render/renderer.ts';
import { Loading } from './ui/loading.ts';

const params = new URLSearchParams(location.search);
const debugMode = params.has('debug') || params.has('e2e') || params.has('perf') || params.has('shot') || import.meta.env.DEV;

let resolveReady!: () => void;
const ready = new Promise<void>((r) => (resolveReady = r));
// expose the ready promise immediately so tests can await it before the debug chunk loads
if (debugMode) (window as unknown as { __hhtReady: Promise<void> }).__hhtReady = ready;

async function boot(): Promise<void> {
  const loading = new Loading();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud') as HTMLElement;
  const quality = detectQuality();
  let ctx;
  try {
    ctx = createRenderContext(canvas, quality);
  } catch (e) {
    if (e instanceof UnsupportedGraphicsError) {
      loading.fail('Your browser or device can’t show 3D graphics (WebGL 2). Try the latest Chrome, Firefox or Safari, or another device.');
      return;
    }
    throw e;
  }
  const profile = new ProfileStore();
  const assets = new AssetStore(`${import.meta.env.BASE_URL}assets/`, { outlines: quality.outlines });
  loading.message('Unloading the trucks…');
  await assets.init();
  const critical = assets.ids('critical');
  const total = assets.bytesOf(critical);
  const progress = new Map<string, number>();
  const report = (): void => loading.progress([...progress.values()].reduce((s, x) => s + x, 0) / Math.max(1, total));
  const physicsReady = initRapier();
  await Promise.all(
    critical.map((id) =>
      assets.load(id, (b) => {
        progress.set(id, b);
        report();
      }),
    ),
  );
  loading.message('Putting on hard hats…');
  await physicsReady;
  const game = new Game(ctx, assets, profile, quality, hud);
  await game.build();
  game.start();
  loading.done();
  resolveReady();

  // stream the rest after the worker is playable (FR-026)
  for (const id of assets.ids('deferred')) void assets.load(id).catch((e) => console.warn('[assets] deferred load failed', id, e));

  if (debugMode) {
    const { installDebugApi } = await import('./debug/debugApi.ts');
    installDebugApi(game, ready, params);
  }
}

boot().catch((e) => {
  console.error(e);
  new Loading().fail('Oops — the construction site didn’t load. Please refresh the page.');
});
