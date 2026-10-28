import type { ReactNode } from 'react';
import type { GraduateSummary } from '@architect/shared';
import { StatusDot, Tooltip } from '@architect/ui';
import { HardDrive, Layers } from 'lucide-react';
import {
  capitalized,
  mentorIntro,
  quantizationLabel,
  setupName,
  shortModelName,
} from '../lib/names';
import { currentPlatform, deviceInSentence } from '../lib/platform';

/** One item of the status line, explained in a tooltip on hover or focus. */
function Item({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <Tooltip content={<span className="block max-w-64 text-pretty">{hint}</span>}>
      <span tabIndex={0} className="flex min-w-0 items-center gap-1.5 rounded-xs [&_svg]:shrink-0">
        {children}
      </span>
    </Tooltip>
  );
}

/** The agent's quiet status line: its version, the model it runs on, and the mentor switched off. */
export function StatusBar({ agent }: { agent: GraduateSummary }) {
  const { manifest } = agent;
  const mentor = shortModelName(manifest.mentor.label);
  const student = shortModelName(manifest.student.label);
  const { model, quantization } = manifest.student;
  const device = deviceInSentence(currentPlatform());
  const size = quantization ? quantizationLabel(quantization) : null;

  return (
    <p className="mx-auto mb-0 mt-2.5 flex max-w-[720px] flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-fg-muted">
      <Item
        hint={`The instructions, skills and tools ${agent.name} uses: ${setupName(manifest.harness.version, false)}, written by ${mentor} during training.`}
      >
        <Layers size={12} strokeWidth={1.8} aria-hidden />
        {capitalized(setupName(manifest.harness.version, false))}
      </Item>
      <Item
        hint={`${model}, through Ollama on ${device}.${
          size ? ` ${size} means the model is compressed to fit in memory.` : ''
        }`}
      >
        <HardDrive size={12} strokeWidth={1.8} aria-hidden />
        <span className="truncate">
          {[student, size, `on ${device}`].filter(Boolean).join(', ')}
        </span>
      </Item>
      <Item hint={`${mentor} only coached this agent during training. Chats stay on ${device}.`}>
        <StatusDot tone="faint" size={6} />
        {mentorIntro(mentor)}: off
      </Item>
    </p>
  );
}
