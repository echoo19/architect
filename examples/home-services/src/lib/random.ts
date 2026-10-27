/**
 * Seeded pseudo-random numbers (mulberry32). The generator never uses Math.random, so one seed
 * always produces the same company, byte for byte.
 */
export class Random {
  private readonly seed: number;
  private state: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** A float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  /** An integer in [min, max], both included. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return itemAt(items, Math.floor(this.next() * items.length));
  }

  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.next() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll < 0) return value;
    }
    return itemAt(entries, entries.length - 1)[0];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const swap = itemAt(result, i);
      result[i] = itemAt(result, j);
      result[j] = swap;
    }
    return result;
  }

  /**
   * An independent stream named by `label`. Each part of the company draws from its own stream,
   * so changing how one part is generated leaves the others as they were.
   */
  fork(label: string): Random {
    let hash = (0x811c9dc5 ^ this.seed) >>> 0;
    for (let i = 0; i < label.length; i++) {
      hash = Math.imul(hash ^ label.charCodeAt(i), 0x01000193) >>> 0;
    }
    hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
    hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
    return new Random((hash ^ (hash >>> 16)) >>> 0);
  }
}

function itemAt<T>(items: readonly T[], index: number): T {
  if (index < 0 || index >= items.length) {
    throw new Error(`Index ${index} is outside a list of ${items.length}`);
  }
  return items[index] as T;
}
