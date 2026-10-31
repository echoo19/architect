import { useSyncExternalStore } from 'react';

/** Every screen the app can show. The hash holds the path, e.g. `#/runs/run_1/train`. */
export type Route =
  /** The Lab: what needs the person, what runs, what just finished and what it cost. */
  | { name: 'home' }
  | { name: 'fields' }
  | { name: 'field'; jobId: string }
  | { name: 'experiments' }
  /** Designing an experiment, on a field of the library when one is named. */
  | { name: 'experiment-new'; jobId?: string }
  | { name: 'experiment'; experimentId: string }
  /** Models, with one version's panel open when `open` names it (`graduateId:version`). */
  | { name: 'models'; open?: string }
  | { name: 'compute' }
  | { name: 'welcome' }
  | { name: 'chat'; graduateId: string; chatId: string }
  | { name: 'new' }
  | { name: 'import' }
  | { name: 'define'; jobId: string }
  | { name: 'train'; runId: string }
  | { name: 'report'; runId: string }
  /** What an improvement of an agent changed, and whether its new version may be promoted. */
  | { name: 'improvement'; runId: string }
  | { name: 'not-found'; path: string };

const segment = (value: string) => encodeURIComponent(value);

export const paths = {
  home: () => '/',
  fields: () => '/fields',
  field: (jobId: string) => `/fields/${segment(jobId)}`,
  experiments: () => '/experiments',
  newExperiment: (jobId?: string) =>
    jobId === undefined ? '/experiments/new' : `/experiments/new/${segment(jobId)}`,
  experiment: (experimentId: string) => `/experiments/${segment(experimentId)}`,
  models: (open?: string) => (open === undefined ? '/models' : `/models/${segment(open)}`),
  compute: () => '/compute',
  welcome: () => '/welcome',
  chat: (graduateId: string, chatId: string) =>
    `/agents/${segment(graduateId)}/chats/${segment(chatId)}`,
  newAgent: () => '/new',
  importAgent: () => '/import',
  define: (jobId: string) => `/jobs/${segment(jobId)}/define`,
  train: (runId: string) => `/runs/${segment(runId)}/train`,
  report: (runId: string) => `/runs/${segment(runId)}/report`,
  improvement: (runId: string) => `/runs/${segment(runId)}/improvement`,
};

function decode(parts: string[]): string[] | null {
  try {
    return parts.map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
}

export function parsePath(path: string): Route {
  const parts = path.split('/').filter(Boolean);
  const decoded = decode(parts);
  if (!decoded) return { name: 'not-found', path };
  const [first, id, third, fourth] = decoded;
  const exactly = (count: number) => decoded.length === count;

  if (decoded.length === 0) return { name: 'home' };
  if (first === 'welcome' && exactly(1)) return { name: 'welcome' };
  if (first === 'new' && exactly(1)) return { name: 'new' };
  if (first === 'import' && exactly(1)) return { name: 'import' };
  if (first === 'fields' && exactly(1)) return { name: 'fields' };
  if (first === 'fields' && id && exactly(2)) return { name: 'field', jobId: id };
  if (first === 'experiments' && exactly(1)) return { name: 'experiments' };
  if (first === 'experiments' && id === 'new' && exactly(2)) return { name: 'experiment-new' };
  if (first === 'experiments' && id === 'new' && third && exactly(3)) {
    return { name: 'experiment-new', jobId: third };
  }
  if (first === 'experiments' && id && exactly(2)) {
    return { name: 'experiment', experimentId: id };
  }
  if (first === 'models' && exactly(1)) return { name: 'models' };
  if (first === 'models' && id && exactly(2)) return { name: 'models', open: id };
  if (first === 'compute' && exactly(1)) return { name: 'compute' };
  if (first === 'agents' && third === 'chats' && id && fourth && exactly(4)) {
    return { name: 'chat', graduateId: id, chatId: fourth };
  }
  if (first === 'jobs' && third === 'define' && id && exactly(3)) {
    return { name: 'define', jobId: id };
  }
  if (first === 'runs' && id && exactly(3)) {
    if (third === 'train') return { name: 'train', runId: id };
    if (third === 'report') return { name: 'report', runId: id };
    if (third === 'improvement') return { name: 'improvement', runId: id };
  }
  return { name: 'not-found', path };
}

/** The path part of a location hash: `#/new` → `/new`, an empty hash → `/`. */
export function pathFromHash(hash: string): string {
  const path = hash.replace(/^#/, '');
  return path.startsWith('/') ? path : `/${path}`;
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (options.replace) {
    window.location.replace(`#${path}`);
  } else {
    window.location.hash = path;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parsePath(pathFromHash(hash));
}
