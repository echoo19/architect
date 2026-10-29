import { useState } from 'react';
import { Button, Tooltip, type ButtonProps } from '@architect/ui';
import { PackageOpen } from 'lucide-react';
import { useHasSampleAgent } from '../api/graduates';
import { attempt } from '../lib/notify';
import { openSampleAgent } from './session';

/**
 * The offer to open the ready-made agent that comes with Architect, in the import screen, beside
 * the offer of the sample job: one is watched being made, this one is already made. A build
 * without that agent shows nothing.
 */
export function ReadyMadeAgentButton({ size }: Pick<ButtonProps, 'size'>) {
  const offered = useHasSampleAgent();
  const [opening, setOpening] = useState(false);
  if (!offered) return null;

  const open = async () => {
    setOpening(true);
    await attempt("Couldn't open the ready-made agent", openSampleAgent);
    setOpening(false);
  };

  return (
    <Tooltip content="Open an agent that is already trained, and start using it" side="bottom">
      <Button size={size} loading={opening} onClick={() => void open()}>
        {!opening && <PackageOpen size={15} strokeWidth={1.7} aria-hidden />}
        Try a ready-made agent
      </Button>
    </Tooltip>
  );
}
