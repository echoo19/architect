/// <reference types="vite/client" />
import type { ArchitectApi } from '@architect/shared';

declare global {
  interface Window {
    /** The typed bridge to the main process, exposed by the preload script. */
    readonly architect: ArchitectApi;
  }
}

export {};
