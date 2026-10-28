import { useState } from 'react';
import { Button, type ButtonProps } from '@architect/ui';
import { PackageOpen } from 'lucide-react';
import { useHasSampleAgent } from '../api/graduates';
import { attempt } from '../lib/notify';
import { openSampleAgent } from './session';

/**
 * The offer to open the ready-made agent that comes with Architect, in the import screen, as the
 * app makes it wherever it offers the sample job. A build without that agent shows nothing.
 */
export function ReadyMadeAgentButton({ size, variant }: Pick<ButtonProps, 'size' | 'variant'>) {
  const offered = useHasSampleAgent();
  const [opening, setOpening] = useState(false);
  if (!offered) return null;

  const open = async () => {
    setOpening(true);
    await attempt("Couldn't open the ready-made agent", openSampleAgent);
    setOpening(false);
  };

  return (
    <Button size={size} variant={variant} loading={opening} onClick={() => void open()}>
      {!opening && <PackageOpen size={15} strokeWidth={1.7} aria-hidden />}
      Try a ready-made agent
    </Button>
  );
}
