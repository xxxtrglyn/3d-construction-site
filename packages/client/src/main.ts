import { AssetStore } from './assets/loader.ts';
import { MatchmakeFailure, matchmake, serverHealthy, type Matchmade } from './net/matchmake.ts';
import { ProfileStore } from './profile/guestProfile.ts';
import { detectQuality, type QualitySettings } from './render/quality.ts';
import { createRenderContext, UnsupportedGraphicsError, type RenderContext } from './render/renderer.ts';
import { Loading } from './ui/loading.ts';
import { showModal, showSoloBanner } from './ui/screens.ts';

const params = new URLSearchParams(location.search);
const debugMode = params.has('debug') || params.has('e2e') || params.has('perf') || params.has('shot') || import.meta.env.DEV;
/** `?solo=1` (and the perf/shot art scenes) always run the single-player game without connecting (FR-051). */
const soloRequested = (params.has('solo') && params.get('solo') !== '0') || params.get('perf') === '1' || params.has('shot');

let resolveReady!: () => void;
const ready = new Promise<void>((r) => (resolveReady = r));
// expose the ready promise immediately so tests can await it before the debug chunk loads
if (debugMode) (window as unknown as { __hhtReady: Promise<void> }).__hhtReady = ready;

/** Assets only one boot mode needs (budgets.json → modes). */
const SOLO_ONLY = new Set(['lot']);
const NET_ONLY = (id: string): boolean => id === 'site' || id === 'foreman' || id === 'props-mp' || id === 'worker-lod1' || id === 'pieces-lod1' || id.startsWith('clock-tower-lod1-');

interface Boot {
  loading: Loading;
  ctx: RenderContext;
  hud: HTMLElement;
  quality: QualitySettings;
  profile: ProfileStore;
  assets: AssetStore;
}

async function loadCritical(b: Boot, mode: 'solo' | 'net'): Promise<void> {
  const critical = b.assets.ids('critical').filter((id) => (mode === 'solo' ? !NET_ONLY(id) : !SOLO_ONLY.has(id)));
  const total = b.assets.bytesOf(critical);
  const progress = new Map<string, number>();
  const report = (): void => b.loading.progress([...progress.values()].reduce((s, x) => s + x, 0) / Math.max(1, total));
  await Promise.all(critical.map((id) => b.assets.load(id, (n) => {
    progress.set(id, n);
    report();
  })));
}

function streamDeferred(b: Boot, mode: 'solo' | 'net'): void {
  for (const id of b.assets.ids('deferred')) {
    if (mode === 'solo' && NET_ONLY(id)) continue;
    void b.assets.load(id).catch((e) => console.warn('[assets] deferred load failed', id, e));
  }
}

/** The 001 single-player game. Rapier and all solo code load only here (dynamic import). */
async function bootSolo(b: Boot, fallback: boolean): Promise<void> {
  b.loading.message('Unloading the trucks…');
  const [{ Game }] = await Promise.all([import('./game/Game.ts'), loadCritical(b, 'solo')]);
  b.loading.message('Putting on hard hats…');
  const game = new Game(b.ctx, b.assets, b.profile, b.quality, b.hud);
  await game.build();
  game.start();
  b.loading.done();
  resolveReady();
  streamDeferred(b, 'solo');
  if (fallback) {
    // FR-050: offer "Join others" once a world is reachable again
    const banner = showSoloBanner(b.hud, () => {
      const url = new URL(location.href);
      url.searchParams.delete('solo');
      location.href = url.toString();
    });
    const poll = async (): Promise<void> => {
      if (await serverHealthy()) banner.setJoinable(true);
      else window.setTimeout(() => void poll(), 10_000);
    };
    window.setTimeout(() => void poll(), 10_000);
  }
  if (debugMode) {
    const { installDebugApi } = await import('./debug/debugApi.ts');
    installDebugApi(game, ready, params);
  }
}

async function bootNet(b: Boot, mm: Matchmade): Promise<void> {
  b.loading.message('Finding your construction site…');
  const [{ NetPlay }, { NetConnection }] = await Promise.all([import('./game/NetPlay.ts'), import('./net/connection.ts'), loadCritical(b, 'net')]);
  const conn = new NetConnection(mm);
  await conn.connect(mm);
  b.loading.message('Putting on hard hats…');
  const game = new NetPlay(b.ctx, b.assets, b.profile, b.quality, b.hud, conn);
  await game.build();
  game.start();
  b.loading.done();
  resolveReady();
  streamDeferred(b, 'net');
  if (debugMode) {
    const { installNetDebugApi } = await import('./debug/netDebugApi.ts');
    installNetDebugApi(game, ready, params);
  }
}

/** `?perf=crowd`: offline 100-worker + 12-tower scene for the perf budget check (no server). */
async function bootCrowdPerf(b: Boot): Promise<void> {
  b.loading.message('Gathering the crowd…');
  const [{ CrowdPerfScene }] = await Promise.all([import('./debug/crowdScene.ts'), loadCritical(b, 'net')]);
  await Promise.all(CrowdPerfScene.WAIT_FOR.map((id) => b.assets.load(id)));
  const scene = new CrowdPerfScene(b.ctx, b.assets, b.quality, b.hud);
  await scene.build();
  scene.showFps = params.has('debug');
  scene.start();
  b.loading.done();
  resolveReady();
  const api = {
    mode: 'perf' as const,
    ready,
    render: () => {
      const i = b.ctx.renderer.info;
      return { drawCalls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries, frameMsMedian: scene.medianFrameMs() };
    },
    /** Per-group draw/triangle breakdown of visible meshes (perf investigations). */
    breakdown: () => {
      const out: Record<string, { meshes: number; tris: number; shadow: number }> = {};
      b.ctx.scene.traverseVisible((o) => {
        const m = o as import('three').Mesh;
        if (!m.isMesh) return;
        const inst = (m as import('three').InstancedMesh).isInstancedMesh ? (m as import('three').InstancedMesh).count : 1;
        if (!inst) return;
        const g = m.geometry;
        const tris = ((g.index ? g.index.count : g.attributes.position!.count) / 3) * inst;
        let top: import('three').Object3D = m;
        while (top.parent && top.parent !== b.ctx.scene) top = top.parent;
        const key = `${top.name || top.type}${m.userData.isOutline ? ':outline' : ''}`;
        const e = (out[key] ??= { meshes: 0, tris: 0, shadow: 0 });
        e.meshes++;
        e.tris += tris;
        if (m.castShadow) e.shadow += tris;
      });
      return out;
    },
  };
  (window as unknown as { __hht: typeof api; __hhtPerfReady: boolean }).__hht = api;
  window.setTimeout(() => ((window as unknown as { __hhtPerfReady: boolean }).__hhtPerfReady = true), 1500);
}

function requestedWorld(profile: ProfileStore): number | null {
  const w = Number(params.get('w'));
  if (Number.isInteger(w) && w > 0) return w;
  return profile.get().lastWorld;
}

async function boot(): Promise<void> {
  const loading = new Loading();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud') as HTMLElement;
  const quality = detectQuality();
  let ctx: RenderContext;
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
  const b: Boot = { loading, ctx, hud, quality, profile, assets };
  const manifest = assets.init();
  if (params.get('perf') === 'crowd') {
    await manifest;
    await bootCrowdPerf(b);
    return;
  }
  if (soloRequested) {
    await manifest;
    await bootSolo(b, false);
    return;
  }
  loading.message('Calling the Foreman…');
  let mm: Matchmade;
  try {
    [mm] = await Promise.all([matchmake(profile.get(), requestedWorld(profile)), manifest]);
  } catch (e) {
    await manifest;
    if (e instanceof MatchmakeFailure && e.kind === 'protocol') {
      loading.done();
      showModal(hud, 'A new version is ready', 'Tap to reload and keep building.', 'Reload', () => location.reload());
      return;
    }
    console.warn('[net] no world reachable, starting solo', e);
    await bootSolo(b, true);
    return;
  }
  try {
    await bootNet(b, mm);
  } catch (e) {
    console.warn('[net] joining the world failed, starting solo', e);
    await bootSolo(b, true);
  }
}

boot().catch((e) => {
  console.error(e);
  new Loading().fail('Oops — the construction site didn’t load. Please refresh the page.');
});
