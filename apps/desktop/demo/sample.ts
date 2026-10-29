import { fileURLToPath } from 'node:url';
import { stubEngine, SAMPLE, SAMPLE_ENGINE } from '../e2e/fixtures';
import type { DemoScript } from './script';

const sampleFile = fileURLToPath(new URL('../../../README.md', import.meta.url));

const script: DemoScript = {
  width: 1440,
  height: 900,
  fps: 30,
  crossfadeSeconds: 0.35,
  scenes: [
    {
      name: 'Describe a job',
      launch: { settings: { onboarded: true, theme: 'dark' } },
      setup: async ({ app }) => stubEngine(app, SAMPLE_ENGINE),
      title: { eyebrow: '01 / DESCRIBE', heading: 'Start with the work', seconds: 1.2 },
      steps: [
        { kind: 'resize', width: 1440, height: 900 },
        { kind: 'route', path: '/new' },
        { kind: 'visible', role: 'heading', name: 'What should your agent do?' },
        { kind: 'text', text: 'What should your agent do?' },
        {
          kind: 'type',
          role: 'textbox',
          name: 'Describe the job',
          text: 'Help our service desk close out the day.',
          delayMs: 58,
        },
        { kind: 'answerFileDialog', files: [sampleFile] },
        { kind: 'click', role: 'button', name: 'Attach files' },
        { kind: 'wait', ms: 450 },
      ],
      tailMs: 400,
    },
    {
      name: 'Review the job',
      launch: { settings: { onboarded: true, theme: 'dark' } },
      setup: async ({ app }) => stubEngine(app, SAMPLE_ENGINE),
      title: { eyebrow: '02 / DEFINE', heading: 'Make the scope clear', seconds: 1.2 },
      steps: [
        { kind: 'route', path: `/jobs/${SAMPLE.jobId}/define` },
        { kind: 'visible', role: 'heading', name: 'Service desk' },
        { kind: 'scroll', y: 470 },
        { kind: 'wait', ms: 1600 },
        { kind: 'scroll', y: -470 },
        { kind: 'wait', ms: 400 },
      ],
      speedups: [{ fromStep: 3, throughStep: 3, factor: 4 }],
      tailMs: 450,
    },
  ],
};

export default script;
