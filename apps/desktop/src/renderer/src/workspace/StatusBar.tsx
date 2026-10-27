import type { ReactNode } from 'react';
import type { GraduateManifest } from '@architect/shared';
import { StatusDot, Tooltip } from '@architect/ui';
import { HardDrive, Layers } from 'lucide-react';
import { shortModelName } from '../lib/names';
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

/** The agent's quiet status line: harness version, local model, and the mentor switched off. */
export function StatusBar({ manifest }: { manifest: GraduateManifest }) {
  const mentor = shortModelName(manifest.mentor.label);
  const { model, quantization } = manifest.student;
  const device = deviceInSentence(currentPlatform());

  return (
    <p className="mx-auto mb-0 mt-2.5 flex max-w-[720px] flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-fg-muted">
      <Item
        hint={`Version ${manifest.harness.version} of the instructions, skills and tools ${mentor} wrote for this agent.`}
      >
        <Layers size={12} strokeWidth={1.8} aria-hidden />
        Harness v{manifest.harness.version}
      </Item>
      <Item
        hint={`The model it runs on, through Ollama on ${device}.${
          quantization ? ` ${quantization} is how the model is compressed to fit.` : ''
        }`}
      >
        <HardDrive size={12} strokeWidth={1.8} aria-hidden />
        <span className="truncate font-mono">
          {[model, quantization].filter(Boolean).join(' ')}
        </span>
      </Item>
      <Item hint={`${mentor} only taught this agent during training. Chats stay on ${device}.`}>
        <StatusDot tone="faint" size={6} />
        {mentor}: off
      </Item>
    </p>
  );
}
