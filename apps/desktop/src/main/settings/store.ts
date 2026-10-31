import { readFile } from 'node:fs/promises';
import { AppSettingsSchema, unreadableClosedNetwork, type AppSettings } from '@architect/shared';
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

  /**
   * Opens the store. A missing file starts from defaults. One that can't be read even after a few
   * tries, or isn't JSON, starts from defaults too, except that a closed network it may hold
   * fails closed (decision 098): on, with no hosts, and saying so in Settings.
   */
  static async open(file: string): Promise<SettingsStore> {
    try {
      const raw = await readSettingsFile(file);
      return new SettingsStore(file, raw === null ? defaultSettings() : settingsFromStored(raw));
    } catch (error) {
      console.warn(`[settings] ${file} could not be read; starting from defaults.`, error);
      const mayHoldNetwork = await readFile(file, 'utf8').then(
        (text) => text.includes('closedNetwork'),
        () => true,
      );
      const { network, problem } = mayHoldNetwork ? unreadableClosedNetwork() : {};
      return new SettingsStore(file, {
        ...defaultSettings(),
        ...(network === undefined ? {} : { closedNetwork: network }),
        ...(problem === undefined ? {} : { closedNetworkProblem: problem }),
      });
    }
  }

  get(): AppSettings {
    return structuredClone(this.current);
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const write = this.writes.then(async () => {
      const merged = AppSettingsSchema.parse({ ...this.current, ...patch });
      // Saving the closed network is the person's answer to what couldn't be read of it.
      const { closedNetworkProblem: _seen, ...written } = merged;
      const next = patch.closedNetwork === undefined ? merged : written;
      await writeJsonFile(this.file, written);
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

/** Errors a reader on Windows sees for a moment while the file is being replaced by a rename. */
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** The file's JSON, null when there is none, tried a few times while it is busy. */
async function readSettingsFile(file: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await readJsonFile(file);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!BUSY.has(code) || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
