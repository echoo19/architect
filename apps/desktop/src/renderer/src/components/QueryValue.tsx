import type { ReactNode } from 'react';
import { Button, SettingsValue, Skeleton } from '@architect/ui';
import { RotateCw } from 'lucide-react';
import type { QueryState } from '../api/query';
import { problemOf } from '../lib/problems';

export function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="xs" onClick={onClick}>
      <RotateCw size={13} aria-hidden />
      Retry
    </Button>
  );
}

/**
 * The right side of a row whose value comes over the bridge: a skeleton while loading, a retry
 * button after a failure (the row shows the message), and the value once it arrives.
 */
export function QueryValue<T>({
  query,
  children,
}: {
  query: QueryState<T>;
  children: (data: T) => ReactNode;
}) {
  if (query.status === 'loading') return <Skeleton shape="pill" className="h-4 w-24" />;
  if (query.status === 'error') return <RetryButton onClick={query.reload} />;
  return <SettingsValue>{children(query.data)}</SettingsValue>;
}

/**
 * What to show under a row's label when its value failed to load: the plain cause when the
 * failure has one, else its own message.
 */
export function errorOf(query: QueryState<unknown>): string | undefined {
  if (query.status !== 'error') return undefined;
  return problemOf(query.error)?.cause ?? query.error.message;
}
