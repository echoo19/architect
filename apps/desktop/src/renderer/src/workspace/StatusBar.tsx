import type { GraduateManifest } from '@architect/shared';
import { StatusDot, Tooltip } from '@architect/ui';
import { HardDrive, Layers } from 'lucide-react';
import { shortModelName } from '../lib/names';
import { currentPlatform, deviceInSentence } from '../lib/platform';

/** The agent's quiet status line: harness version, local model, and the mentor switched off. */
export function StatusBar({ manifest }: { manifest: GraduateManifest }) {
  const mentor = shortModelName(manifest.mentor.label);
  const model = [manifest.student.model, manifest.student.quantization].filter(Boolean).join(' ');
  const item = 'flex min-w-0 items-center gap-1.5 [&_svg]:shrink-0';

  return (
    <p className="mx-auto mb-0 mt-2.5 flex max-w-[720px] flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-fg-muted">
      <span className={item}>
        <Layers size={12} strokeWidth={1.8} aria-hidden />
        Harness v{manifest.harness.version}
      </span>
      <span className={item}>
        <HardDrive size={12} strokeWidth={1.8} aria-hidden />
        <span className="truncate font-mono">{model}</span>
      </span>
      <Tooltip
        content={`${mentor} only taught this agent during training. Chats stay on ${deviceInSentence(
          currentPlatform(),
        )}.`}
      >
        <span tabIndex={0} className={`${item} rounded-xs`}>
          <StatusDot tone="faint" size={6} />
          {mentor}: off
        </span>
      </Tooltip>
    </p>
  );
}
