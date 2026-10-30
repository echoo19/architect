/**
 * What the main process tells every page about the run, through the preload. The renderer reads
 * it before its first frame, so a run for tests and screenshots never animates.
 */
export interface ArchitectRuntime {
  /** The app runs with hidden windows (ARCHITECT_HIDDEN=1): tests and screenshots. */
  readonly hidden: boolean;
}

/** The switch the main process puts in a hidden run's renderer arguments. */
export const HIDDEN_ARGUMENT = '--architect-hidden';

/** The runtime a page is told about, from the arguments its renderer process started with. */
export function runtimeFrom(argv: readonly string[]): ArchitectRuntime {
  return { hidden: argv.includes(HIDDEN_ARGUMENT) };
}
