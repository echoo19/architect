import { z } from 'zod';
import { readJsonFile, writeJsonFile } from '../storage/json-file';
import { isSecretRef, SECRET_REF_NAMES, secretLabel, type SecretRef } from './refs';

/** Encryption by the operating system's key store. */
export interface Cipher {
  /** Why nothing can be encrypted on this computer, or null when it can. */
  unavailableReason(): Promise<string | null>;
  encrypt(value: string): Promise<Buffer>;
  /** `stale` means the key store has a newer key, so the value should be encrypted again. */
  decrypt(data: Buffer): Promise<{ value: string; stale: boolean }>;
}

/** Longer than any real API key, short enough to catch a paste of the wrong thing. */
const MAX_KEY_LENGTH = 4096;

const StoredFileSchema = z.record(z.string(), z.string());

type Stored = Partial<Record<SecretRef, string>>;

/**
 * API keys, encrypted by the operating system's key store and saved as base64 ciphertext. A key
 * is decrypted only when a connection test or the engine needs it; the renderer can learn which
 * keys are saved, never their values.
 */
export class SecretStore {
  /** Saves run one at a time, so two quick changes can't land out of order. */
  private writes: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
    private stored: Stored,
    /** Why the keys file can't be used; while set, nothing reads keys from it or writes to it. */
    private readonly unreadable: string | null,
  ) {}

  /**
   * Opens the store. Only a missing file means no keys yet. A file that can't be read or isn't
   * in the expected shape is left exactly as it is, and every use of the store says why, so a
   * save never replaces keys that are still in there.
   */
  static async open(file: string, cipher: Cipher): Promise<SecretStore> {
    let raw: unknown;
    try {
      raw = await readJsonFile(file);
    } catch (error) {
      return SecretStore.unusable(
        file,
        cipher,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (raw === null) return new SecretStore(file, cipher, {}, null);
    const parsed = StoredFileSchema.safeParse(raw);
    if (!parsed.success) return SecretStore.unusable(file, cipher, "it isn't a list of saved keys");
    const stored = Object.fromEntries(
      Object.entries(parsed.data).filter(([ref]) => isSecretRef(ref)),
    ) as Stored;
    return new SecretStore(file, cipher, stored, null);
  }

  private static unusable(file: string, cipher: Cipher, why: string): SecretStore {
    const problem = `The saved keys in ${file} can't be read (${why}), so Architect won't change that file. Fix it, or move it away to start with no keys, then restart Architect.`;
    console.warn(`[secrets] ${problem}`);
    return new SecretStore(file, cipher, {}, problem);
  }

  /** Which keys are saved. */
  status(): Record<SecretRef, boolean> {
    this.ensureReadable();
    return Object.fromEntries(
      SECRET_REF_NAMES.map((ref) => [ref, this.stored[ref] !== undefined]),
    ) as Record<SecretRef, boolean>;
  }

  async set(ref: string, value: string): Promise<void> {
    this.ensureReadable();
    const known = knownRef(ref);
    const key = value.trim();
    if (key.length === 0) throw new Error(`The ${secretLabel(known)} key is empty.`);
    if (key.length > MAX_KEY_LENGTH) {
      throw new Error(`That is too long to be a ${secretLabel(known)} key.`);
    }
    const problem = await this.cipher.unavailableReason();
    if (problem) throw new Error(`Architect can't save keys on this computer: ${problem}.`);
    const ciphertext = (await this.cipher.encrypt(key)).toString('base64');
    await this.save((stored) => ({ ...stored, [known]: ciphertext }));
  }

  async clear(ref: string): Promise<void> {
    this.ensureReadable();
    const known = knownRef(ref);
    await this.save((stored) => {
      const next = { ...stored };
      delete next[known];
      return next;
    });
  }

  /** A key's value, for connection tests and the engine only. */
  async get(ref: string): Promise<string | undefined> {
    this.ensureReadable();
    if (!isSecretRef(ref)) return undefined;
    const ciphertext = this.stored[ref];
    if (ciphertext === undefined) return undefined;
    let decrypted: { value: string; stale: boolean };
    try {
      decrypted = await this.cipher.decrypt(Buffer.from(ciphertext, 'base64'));
    } catch (error) {
      throw new Error(
        `The saved ${secretLabel(ref)} key can't be decrypted on this computer. Enter it again in Settings.`,
        { cause: error },
      );
    }
    if (decrypted.stale) this.reencrypt(ref, ciphertext, decrypted.value);
    return decrypted.value;
  }

  /** Re-saves a key under the key store's newer key, unless it changed in the meantime. */
  private reencrypt(ref: SecretRef, previous: string, value: string): void {
    this.cipher
      .encrypt(value)
      .then((fresh) =>
        this.save((stored) =>
          stored[ref] === previous ? { ...stored, [ref]: fresh.toString('base64') } : stored,
        ),
      )
      .catch((error: unknown) => {
        console.warn(`[secrets] The ${secretLabel(ref)} key could not be re-encrypted.`, error);
      });
  }

  private ensureReadable(): void {
    if (this.unreadable !== null) throw new Error(this.unreadable);
  }

  private save(change: (stored: Stored) => Stored): Promise<void> {
    const write = this.writes.then(async () => {
      const next = change(this.stored);
      await writeJsonFile(this.file, next);
      this.stored = next;
    });
    this.writes = write.catch(() => undefined);
    return write;
  }
}

function knownRef(ref: string): SecretRef {
  if (!isSecretRef(ref)) throw new Error(`Architect has no key called "${ref}".`);
  return ref;
}
