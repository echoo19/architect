import { Button, EmptyState } from '@architect/ui';
import { Cpu } from 'lucide-react';
import { PlacePage } from '../shell/PlacePage';
import { useUi } from '../state/ui';

/** Compute: where training runs. Today that is this computer and the models set up for it. */
export function ComputeScreen() {
  const openSettings = useUi((state) => state.openSettings);
  return (
    <PlacePage title="Compute">
      <EmptyState
        icon={<Cpu aria-hidden />}
        title="Training runs on this computer"
        description="Hugging Face Jobs and cluster targets are added here when you set one up."
        className="pt-16"
        actions={
          <Button variant="primary" size="md" onClick={() => openSettings('models')}>
            Open model settings
          </Button>
        }
      />
    </PlacePage>
  );
}
