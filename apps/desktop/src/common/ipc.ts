import type { ArchitectApi } from '@architect/shared';

/**
 * The shape of the bridge between the renderer and the main process. Every method of
 * `ArchitectApi` maps to one channel named `<domain>:<method>`. Request methods use
 * `ipcRenderer.invoke`; `on…` methods subscribe to events the main process sends.
 */

export type Domain = keyof ArchitectApi;

type MethodOf<D extends Domain> = Extract<keyof ArchitectApi[D], string>;

export type EventMethod<D extends Domain> = {
  [M in MethodOf<D>]: M extends `on${string}` ? M : never;
}[MethodOf<D>];

export type InvokeMethod<D extends Domain> = Exclude<MethodOf<D>, EventMethod<D>>;

export type EventDomain = {
  [D in Domain]: [EventMethod<D>] extends [never] ? never : D;
}[Domain];

export type InvokeArgs<D extends Domain, M extends InvokeMethod<D>> = ArchitectApi[D][M] extends (
  ...args: infer A
) => unknown
  ? A
  : never;

export type EventPayload<
  D extends EventDomain,
  M extends EventMethod<D>,
> = ArchitectApi[D][M] extends (listener: (payload: infer P) => void) => unknown ? P : never;

/*
 * Written out in full so the compiler checks them against ArchitectApi: a method added to the
 * contract fails to compile here until it is listed, and a typo can't slip in.
 */
const INVOKE_METHODS: { [D in Domain]: Record<InvokeMethod<D>, true> } = {
  app: { info: true, openProviderPage: true },
  settings: { get: true, update: true },
  secrets: { status: true, set: true, clear: true },
  connections: {
    testMentor: true,
    testStudent: true,
    listModels: true,
    detectLocal: true,
    add: true,
    remove: true,
    signIn: true,
    cancelSignIn: true,
  },
  ollama: { status: true, pull: true, install: true },
  files: { pick: true },
  jobs: {
    list: true,
    get: true,
    save: true,
    createSample: true,
    importFile: true,
    exportFile: true,
    draftStart: true,
    draftReply: true,
  },
  runs: {
    start: true,
    pause: true,
    resume: true,
    stop: true,
    retest: true,
    get: true,
    list: true,
    trace: true,
    roundDiff: true,
  },
  mentoring: {
    lessons: true,
    interventions: true,
    experiments: true,
    progress: true,
    capabilities: true,
    categories: true,
    answer: true,
  },
  reports: { get: true, list: true },
  graduates: {
    list: true,
    accept: true,
    versions: true,
    history: true,
    acceptVersion: true,
    rejectVersion: true,
    promote: true,
    rollback: true,
    installation: true,
    bind: true,
    verify: true,
    reviewExport: true,
    exportPackage: true,
    exportFolder: true,
    inspectPackage: true,
    importPackage: true,
    importFolder: true,
    remove: true,
    settings: true,
    updateSettings: true,
  },
  workspace: {
    listChats: true,
    createChat: true,
    messages: true,
    send: true,
    stop: true,
    decide: true,
  },
};

const EVENT_METHODS: { [D in EventDomain]: Record<EventMethod<D>, true> } = {
  settings: { onChange: true },
  ollama: { onPullProgress: true },
  runs: { onEvent: true },
  workspace: { onEvent: true },
};

export const DOMAINS = Object.keys(INVOKE_METHODS) as Domain[];

export function invokeMethods<D extends Domain>(domain: D): InvokeMethod<D>[] {
  return Object.keys(INVOKE_METHODS[domain]) as InvokeMethod<D>[];
}

export function eventMethods(domain: Domain): string[] {
  return domain in EVENT_METHODS ? Object.keys(EVENT_METHODS[domain as EventDomain]) : [];
}

export function channel(domain: Domain, method: string): string {
  return `${domain}:${method}`;
}

/** Every request channel, for registering a dispatcher on each one at startup. */
export function invokeChannels(): string[] {
  return DOMAINS.flatMap((domain) =>
    invokeMethods(domain).map((method) => channel(domain, method)),
  );
}

/**
 * Handlers never throw across the bridge: Electron rewrites thrown errors into
 * "Error invoking remote method …" text. They resolve with this envelope instead.
 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } };

export function isIpcResult(value: unknown): value is IpcResult<unknown> {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false;
  if (value.ok === true) return 'value' in value;
  if (value.ok !== false || !('error' in value)) return false;
  const error = value.error;
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  );
}
