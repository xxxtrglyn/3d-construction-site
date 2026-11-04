import { MACHINE_KINDS, SITE, machineId, parkedState, type PieceTypeId } from '@hht/shared';
import type { AssetStore } from '../assets/loader.ts';
import { MachineRenderer, type MachineDraw } from '../machines/MachineRenderer.ts';
import type { MachinePose } from '../machines/rig.ts';
import type { QualitySettings } from '../render/quality.ts';
import type { RenderContext } from '../render/renderer.ts';
import type { PieceRenderer } from '../world/pieceRenderer.ts';
import { CrowdPerfScene } from './crowdScene.ts';

/**
 * `?perf=machines` (feature 003, research M12): the `?perf=crowd` scene (100 workers, 12 towers)
 * plus all 48 machines posed mid-action — hooks lowered with pieces, forks raised with pallets,
 * buckets curled, drums turning — measured against `render.machines`. Offline.
 */
export class MachinesPerfScene extends CrowdPerfScene {
  private machines!: MachineRenderer;
  private readonly draws: MachineDraw[] = [];
  private t = 0;

  constructor(ctx: RenderContext, assets: AssetStore, quality: QualitySettings, hudRoot: HTMLElement) {
    super(ctx, assets, quality, hudRoot);
  }

  override async build(): Promise<void> {
    await super.build();
    this.machines = new MachineRenderer(this.assets, { outlines: this.quality.outlines, shadows: this.quality.tier === 'high', nearDist: 20 });
    this.ctx.scene.add(this.machines.group);
    const hookTypes: PieceTypeId[] = ['panel', 'bell', 'beam', 'brick'];
    for (const spots of SITE.machines) {
      for (const k of MACHINE_KINDS) {
        const s = parkedState(machineId(spots.plot, k), spots);
        const pose: MachinePose = { id: s.id, kind: k, x: s.x, z: s.z, yaw: s.yaw, p1: s.p1, p2: s.p2, p3: s.p3 };
        if (k === 'crane') {
          pose.p1 += 0.6;
          pose.p3 = 5 + (spots.plot % 4);
        } else if (k === 'excavator') {
          pose.p1 = -0.5;
          pose.p2 = 1.1;
        } else if (k === 'forklift') pose.p1 = 0.55;
        this.draws.push({
          pose, spots,
          hook: k === 'crane' ? hookTypes[spots.plot % hookTypes.length]! : null,
          pallet: k === 'forklift' ? ['brick', 'brick', 'brick', 'brick'] : [],
        });
      }
    }
  }

  protected override drawExtra(dt: number, pieces: PieceRenderer): void {
    this.t += dt;
    for (const d of this.draws) if (d.pose.kind === 'mixer') d.pose.p1 = (this.t * 6) % (Math.PI * 2);
    this.machines.draw(this.draws, this.ctx.camera.position, (t, m) => pieces.add(t, m), (t) => pieces.halfHeight.get(t) ?? 0.15);
  }

  static override readonly WAIT_FOR = [...CrowdPerfScene.WAIT_FOR, ...MACHINE_KINDS.flatMap((k) => [`machine-${k}`, `machine-${k}-lod1`])];
}

