import { Button, EmptyState } from '@architect/ui';
import { Compass } from 'lucide-react';
import { navigate, paths } from '../lib/router';

export function NotFoundScreen({ path }: { path: string }) {
  return (
    <div className="app-drag flex h-full items-center justify-center bg-ground">
      <EmptyState
        icon={<Compass aria-hidden />}
        title="Nothing lives here"
        description={`Architect has no page at ${path}.`}
        actions={
          <Button variant="primary" size="md" onClick={() => navigate(paths.home())}>
            Go to your agents
          </Button>
        }
      />
    </div>
  );
}
