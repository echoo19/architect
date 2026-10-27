const RELEASED: unique symbol = Symbol('mentor released');
const issued = new WeakSet<object>();

/**
 * Proof that the mentor was released, which the vault requires before it opens the locked test.
 * The brand key is private to this module, so the type can't be written elsewhere, and proofs
 * are also checked against the set this module issued, so a cast can't forge one.
 */
export interface MentorReleased {
  readonly [RELEASED]: true;
  readonly releasedAt: string;
}

/**
 * Runs `dispose`, which ends whatever could still reach the mentor, and only then issues the
 * proof. If it fails, no proof is issued.
 */
export async function releaseMentor(session: {
  dispose(): void | Promise<void>;
}): Promise<MentorReleased> {
  await session.dispose();
  const proof: MentorReleased = Object.freeze({
    [RELEASED]: true as const,
    releasedAt: new Date().toISOString(),
  });
  issued.add(proof);
  return proof;
}

export function isMentorReleased(value: unknown): value is MentorReleased {
  return (
    typeof value === 'object' &&
    value !== null &&
    issued.has(value) &&
    (value as MentorReleased)[RELEASED] === true
  );
}
