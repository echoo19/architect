import type { ReactNode } from 'react';
import type { GraduateSummary } from '@architect/shared';
import { StatusDot } from '@architect/ui';
import { Blend, HardDrive, Layers } from 'lucide-react';
import { capitalized, quantizationLabel, setupName, shortModelName } from '../lib/names';

function Item({ children }: { children: ReactNode }) {
  return <span className="flex min-w-0 items-center gap-1.5 [&_svg]:shrink-0">{children}</span>;
}

/**
 * The agent's quiet status line: its setup, the model it runs on, the adapter llama.cpp applies
 * to every reply when it carries one, and that the mentor isn't connected.
 */
export function StatusBar({ agent }: { agent: GraduateSummary }) {
  const { manifest } = agent;
  const mentor = shortModelName(manifest.mentor.label);
  const student = shortModelName(manifest.student.label);
  const { quantization, adapter } = manifest.student;
  const size = quantization ? quantizationLabel(quantization) : null;

  return (
    <p className="mx-auto mb-0 mt-2.5 flex max-w-[720px] flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-fg-muted">
      <Item>
        <Layers size={12} strokeWidth={1.8} aria-hidden />
        {capitalized(setupName(manifest.harness))}
      </Item>
      <Item>
        <HardDrive size={12} strokeWidth={1.8} aria-hidden />
        <span className="truncate">{[student, size].filter(Boolean).join(' ')}</span>
      </Item>
      {adapter && (
        <Item>
          <Blend size={12} strokeWidth={1.8} aria-hidden />
          {adapter.standIn ? 'Stand-in adapter' : 'LoRA adapter'}
        </Item>
      )}
      <Item>
        <StatusDot tone="faint" size={6} />
        {mentor} not connected
      </Item>
    </p>
  );
}
