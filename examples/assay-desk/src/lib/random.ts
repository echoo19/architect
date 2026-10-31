/**
 * A seeded random stream (the mulberry32 generator). Nothing in the generator touches
 * Math.random, so a seed always produces the same lab, byte for byte.
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
    let mixed = this.state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  }

  /** A whole number from `min` to `max`, both included. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /**
   * A draw from a normal curve with this mean and spread, made from twelve uniform draws (their
   * sum, less six, is close to normal). Only adds and multiplies, so every machine agrees.
   */
  normal(mean: number, sd: number): number {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += this.next();
    return mean + (sum - 6) * sd;
  }

  /** A float from `min` up to `max`. */
  between(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return at(items, Math.floor(this.next() * items.length));
  }

  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.next() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll < 0) return value;
    }
    return at(entries, entries.length - 1)[0];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const kept = at(result, i);
      result[i] = at(result, j);
      result[j] = kept;
    }
    return result;
  }

  /** `count` different items, in the order drawn. */
  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, count);
  }

  /**
   * An independent stream named by `label`. Each part of the lab draws from its own stream, so
   * a change to how one part is made leaves the others as they were.
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

function at<T>(items: readonly T[], index: number): T {
  if (index < 0 || index >= items.length) {
    throw new Error(`Index ${index} is outside a list of ${items.length}`);
  }
  return items[index] as T;
}
