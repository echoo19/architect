import type { ReactNode } from 'react';
import type { GraduateSummary } from '@architect/shared';
import { Blend, HardDrive, Layers } from 'lucide-react';
import { activeVersionName, agentModelName } from '../lib/names';

function Item({ children }: { children: ReactNode }) {
  return <span className="flex min-w-0 items-center gap-1.5 [&_svg]:shrink-0">{children}</span>;
}

/**
 * The agent's quiet status line: the version that answers, as the Teaching tab names it, the
 * model it runs on here, and the trained weights llama.cpp applies to every reply when it
 * carries any. That its chats stay private is said where something could leave: in Teach this.
 */
export function StatusBar({ agent }: { agent: GraduateSummary }) {
  const { manifest } = agent;
  const { adapter } = manifest.student;

  return (
    <p className="mx-auto mb-0 mt-2.5 flex max-w-[720px] flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-fg-muted">
      <Item>
        <Layers size={12} strokeWidth={1.8} aria-hidden />
        {activeVersionName(agent)}
      </Item>
      <Item>
        <HardDrive size={12} strokeWidth={1.8} aria-hidden />
        <span className="truncate">{agentModelName(manifest.student)}</span>
      </Item>
      {adapter && (
        <Item>
          <Blend size={12} strokeWidth={1.8} aria-hidden />
          {adapter.standIn ? 'Stand-in trained weights' : 'Trained weights'}
        </Item>
      )}
    </p>
  );
}
