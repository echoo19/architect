import type { AppSettings } from '@architect/shared';
import type { LaunchedApp } from '../e2e/app';

export type DemoStep =
  | { kind: 'route'; path: string }
  | { kind: 'click'; role: 'button' | 'link' | 'tab' | 'radio' | 'textbox'; name: string }
  | { kind: 'type'; role: 'textbox' | 'searchbox'; name: string; text: string; delayMs?: number }
  | { kind: 'visible'; role: 'heading' | 'button' | 'textbox' | 'link' | 'tab'; name: string }
  | { kind: 'text'; text: string }
  | { kind: 'wait'; ms: number }
  | { kind: 'scroll'; x?: number; y: number }
  | { kind: 'answerFileDialog'; files: string[] }
  | { kind: 'resize'; width: number; height: number };

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
