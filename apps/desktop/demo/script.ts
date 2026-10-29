import type { AppSettings } from '@architect/shared';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import type { LaunchedApp } from '../e2e/app';

/** What a scene's own step gets: the page and app, and a click that moves the drawn pointer. */
export interface StepContext {
  page: Page;
  app: ElectronApplication;
  click(target: Locator): Promise<void>;
}

export type DemoStep =
  | { kind: 'route'; path: string }
  | { kind: 'click'; role: 'button' | 'link' | 'tab' | 'radio' | 'textbox'; name: string }
  | { kind: 'type'; role: 'textbox' | 'searchbox'; name: string; text: string; delayMs?: number }
  | { kind: 'visible'; role: 'heading' | 'button' | 'textbox' | 'link' | 'tab'; name: string }
  | { kind: 'text'; text: string }
  | { kind: 'wait'; ms: number }
  | { kind: 'scroll'; x?: number; y: number }
  | { kind: 'answerFileDialog'; files: string[] }
  | { kind: 'resize'; width: number; height: number }
  /** A step the scene writes itself, for replies it can't name in advance, such as a model's. */
  | { kind: 'run'; label: string; run: (context: StepContext) => Promise<void> };

export interface DemoScene {
  name: string;
  launch?: {
    settings?: Partial<AppSettings>;
    data?: string;
    comparison?: string;
    env?: Record<string, string>;
  };
  /** Install stand-in replies after launch. No production code is changed. */
  setup?: (launched: LaunchedApp) => Promise<void>;
  /** Steps run before the title and not recorded, so the title opens onto the scene's screen. */
  prepare?: DemoStep[];
  /** A folder to copy the app's data to when the scene ends, such as a job drafted on camera. */
  keepData?: string;
  title?: { heading: string; eyebrow?: string; seconds: number };
  steps: DemoStep[];
  speedups?: { fromStep: number; throughStep: number; factor: number }[];
  tailMs?: number;
}

export interface DemoScript {
  scenes: DemoScene[];
  width?: 1440 | 1920;
  height?: 900 | 1200;
  fps?: 30;
  crossfadeSeconds?: number;
}
