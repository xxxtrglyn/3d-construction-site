import { describe, expect, it } from 'vitest';
import { EntityBuffer, delayForInterval, type Pose } from '../src/net/interpolation.ts';

const pose = (x: number): Pose => ({ x, y: 0, z: 0, yaw: 0, anim: 1, carry: null, emoting: false });
const out = (): Pose => pose(0);

describe('EntityBuffer', () => {
  it('maps update intervals to the tier delays 100/180/320 ms', () => {
    expect(delayForInterval(50)).toBe(100);
    expect(delayForInterval(100)).toBe(180);
    expect(delayForInterval(250)).toBe(320);
  });

  it('renders tier-1 entities 100 ms behind the server clock', () => {
    const b = new EntityBuffer();
    for (let i = 0; i <= 20; i++) b.push(1000 + i * 50, pose(i)); // x = 1 per 50 ms
    const o = out();
    expect(b.sample(1000 + 500, o)).toBe(true);
    expect(o.x).toBeCloseTo((500 - 100) / 50, 5);
  });

  it('settles on the tier-3 delay for 4 Hz entities without jumping', () => {
    const b = new EntityBuffer();
    let t = 0;
    for (let i = 0; i < 40; i++) {
      b.push((t += 250), pose(i));
      b.updateDelay(250);
    }
    expect(b.delay).toBeGreaterThan(300);
    // tier change back to 20 Hz: the delay eases, never more than a small step per frame
    let prev = b.delay;
    for (let i = 0; i < 60; i++) {
      b.push((t += 50), pose(40 + i));
      b.updateDelay(16);
      expect(Math.abs(b.delay - prev)).toBeLessThan(15);
      prev = b.delay;
    }
  });

  it('extrapolates at most 200 ms past the newest sample, then holds', () => {
    const b = new EntityBuffer();
    b.push(0, pose(0));
    b.push(50, pose(1));
    const o = out();
    b.sample(50 + 100 + 100, o); // 100 ms ahead (delay 100)
    expect(o.x).toBeCloseTo(3, 5);
    b.sample(50 + 100 + 1000, o); // far ahead → capped at 200 ms
    expect(o.x).toBeCloseTo(5, 5);
  });

  it('interpolates yaw along the short arc', () => {
    const b = new EntityBuffer();
    b.push(0, { ...pose(0), yaw: Math.PI * 2 - 0.1 });
    b.push(50, { ...pose(0), yaw: 0.1 });
    const o = out();
    b.sample(25 + 100, o);
    expect(Math.abs(Math.sin(o.yaw))).toBeLessThan(0.01);
  });
});
