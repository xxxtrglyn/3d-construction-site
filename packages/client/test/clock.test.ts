import { describe, expect, it } from 'vitest';
import { ServerClock } from '../src/net/clock.ts';

describe('ServerClock', () => {
  it('uses welcome as the first estimate', () => {
    let t = 1000;
    const c = new ServerClock(() => t);
    c.fromWelcome(51_000);
    expect(c.serverNow()).toBe(51_000);
    t = 1500;
    expect(c.serverNow()).toBe(51_500);
  });

  it('takes the median offset of recent pongs and ignores slow outliers', () => {
    let t = 0;
    const c = new ServerClock(() => t);
    const truth = 10_000;
    const pong = (sentAt: number, rtt: number): void => {
      t = sentAt + rtt;
      c.addPong(sentAt, sentAt + rtt / 2 + truth);
    };
    pong(0, 100);
    pong(1000, 80);
    pong(2000, 120);
    // an outlier whose reply was delayed one way (asymmetric, big RTT) must not skew the estimate
    t = 3000 + 900;
    c.addPong(3000, 3000 + 890 + truth);
    pong(4000, 90);
    expect(Math.abs(c.offset - truth)).toBeLessThan(2);
    expect(c.rtt).toBeLessThanOrEqual(120);
  });
});
