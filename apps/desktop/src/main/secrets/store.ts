import { z } from 'zod';
import { readJsonFile, writeJsonFile } from '../storage/json-file';
import { isSecretRef, SECRET_REF_NAMES, SECRET_REFS, type SecretRef } from './refs';

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
  ) {}

  /** Opens the store. A file that can't be read starts empty and is replaced on the next save. */
  static async open(file: string, cipher: Cipher): Promise<SecretStore> {
    let stored: Stored = {};
    try {
      const raw = await readJsonFile(file);
      const parsed = StoredFileSchema.safeParse(raw ?? {});
      if (parsed.success) {
        stored = Object.fromEntries(
          Object.entries(parsed.data).filter(([ref]) => isSecretRef(ref)),
        ) as Stored;
      } else {
        console.warn(`[secrets] ${file} isn't in the expected shape; starting with no keys.`);
      }
    } catch (error) {
      console.warn(`[secrets] ${file} could not be read; starting with no keys.`, error);
    }
    return new SecretStore(file, cipher, stored);
  }

  /** Which keys are saved. */
  status(): Record<SecretRef, boolean> {
    return Object.fromEntries(
      SECRET_REF_NAMES.map((ref) => [ref, this.stored[ref] !== undefined]),
    ) as Record<SecretRef, boolean>;
  }

  async set(ref: string, value: string): Promise<void> {
    const known = knownRef(ref);
    const key = value.trim();
    if (key.length === 0) throw new Error(`The ${SECRET_REFS[known]} key is empty.`);
    if (key.length > MAX_KEY_LENGTH) {
      throw new Error(`That is too long to be a ${SECRET_REFS[known]} key.`);
    }
    const problem = await this.cipher.unavailableReason();
    if (problem) throw new Error(`Architect can't save keys on this computer: ${problem}.`);
    const ciphertext = (await this.cipher.encrypt(key)).toString('base64');
    await this.save((stored) => ({ ...stored, [known]: ciphertext }));
  }

  async clear(ref: string): Promise<void> {
    const known = knownRef(ref);
    await this.save((stored) => {
      const next = { ...stored };
      delete next[known];
      return next;
    });
  }

  /** A key's value, for connection tests and the engine only. */
  async get(ref: string): Promise<string | undefined> {
    if (!isSecretRef(ref)) return undefined;
    const ciphertext = this.stored[ref];
    if (ciphertext === undefined) return undefined;
    let decrypted: { value: string; stale: boolean };
    try {
      decrypted = await this.cipher.decrypt(Buffer.from(ciphertext, 'base64'));
    } catch (error) {
      throw new Error(
        `The saved ${SECRET_REFS[ref]} key can't be decrypted on this computer. Enter it again in Settings.`,
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
        console.warn(`[secrets] The ${SECRET_REFS[ref]} key could not be re-encrypted.`, error);
      });
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
