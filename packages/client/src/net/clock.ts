/**
 * Server clock estimate (contracts/network-protocol.md §5): offset = serverNow − clientNow from `welcome`,
 * then from ping/pong — median of the last 5 samples, discarding samples whose RTT is > 2× the median.
 */
export class ServerClock {
  private samples: Array<{ offset: number; rtt: number }> = [];
  private offsetMs = 0;
  private rttMs = 0;
  private readonly nowFn: () => number;

  constructor(nowFn: () => number = () => Date.now()) {
    this.nowFn = nowFn;
  }

  /** Initial estimate from `welcome` (no RTT known: assume the message is fresh). */
  fromWelcome(serverNow: number): void {
    this.offsetMs = serverNow - this.nowFn();
  }

  /** A pong for a ping sent at client time `sentAt`, answered at server time `serverNow`. */
  addPong(sentAt: number, serverNow: number): void {
    const now = this.nowFn();
    const rtt = Math.max(0, now - sentAt);
    const offset = serverNow - (sentAt + rtt / 2);
    this.samples.push({ offset, rtt });
    if (this.samples.length > 5) this.samples.shift();
    const rtts = this.samples.map((s) => s.rtt).sort((a, b) => a - b);
    const medRtt = rtts[Math.floor(rtts.length / 2)] as number;
    const good = this.samples.filter((s) => s.rtt <= Math.max(2 * medRtt, 1));
    const offs = (good.length ? good : this.samples).map((s) => s.offset).sort((a, b) => a - b);
    this.offsetMs = offs[Math.floor(offs.length / 2)] as number;
    this.rttMs = medRtt;
  }

  serverNow(): number {
    return this.nowFn() + this.offsetMs;
  }

  get offset(): number {
    return this.offsetMs;
  }

  get rtt(): number {
    return this.rttMs;
  }
}
