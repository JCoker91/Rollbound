/**
 * Deterministic seeded RNG. Every battle is reproducible from its seed, which is
 * what lets the server re-simulate a fight for idle rewards and lets the client
 * replay the exact same fight as animation.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** mulberry32 — small, fast, good enough for a game. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(minInclusive: number, maxInclusive: number): number {
    return minInclusive + Math.floor(this.next() * (maxInclusive - minInclusive + 1));
  }

  d6(): number {
    return this.int(1, 6);
  }

  roll(count: number): number[] {
    return Array.from({ length: count }, () => this.d6());
  }
}
