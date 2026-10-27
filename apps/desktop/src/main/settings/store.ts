import type { AppSettings } from '@architect/shared';
import { AppSettingsSchema } from '../../common/schemas';
import { readJsonFile, writeJsonFile } from '../storage/json-file';
import { defaultSettings, settingsFromStored } from './schema';

type Listener = (settings: AppSettings) => void;

/** App settings, kept in memory and persisted as JSON in the user data folder. */
export class SettingsStore {
  private current: AppSettings;
  private readonly listeners = new Set<Listener>();
  /** Writes run one at a time so two quick updates can't land out of order. */
  private writes: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly file: string,
    initial: AppSettings,
  ) {
    this.current = initial;
  }

  /** Opens the store. A missing or corrupt file starts from defaults rather than failing. */
  static async open(file: string): Promise<SettingsStore> {
    let raw: unknown = null;
    try {
      raw = await readJsonFile(file);
    } catch (error) {
      console.warn(`[settings] ${file} could not be read; starting from defaults.`, error);
    }
    return new SettingsStore(file, raw === null ? defaultSettings() : settingsFromStored(raw));
  }

  get(): AppSettings {
    return structuredClone(this.current);
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const write = this.writes.then(async () => {
      const next = AppSettingsSchema.parse({ ...this.current, ...patch });
      await writeJsonFile(this.file, next);
      this.current = next;
      for (const listener of this.listeners) listener(this.get());
      return this.get();
    });
    this.writes = write.catch(() => undefined);
    return write;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
