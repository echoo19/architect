/// <reference types="vite/client" />
import type { ArchitectApi } from '@architect/shared';
import type { ArchitectRuntime } from '../../common/runtime';

declare global {
  interface Window {
    /** The typed bridge to the main process, exposed by the preload script. */
    readonly architect: ArchitectApi;
    /** What the main process says about this run, exposed by the preload script. */
    readonly architectRuntime: ArchitectRuntime;
  }
}

export {};
