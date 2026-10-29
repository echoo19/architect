import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '@architect/ui';

interface ErrorBoundaryState {
  error: Error | null;
}

/** Catches a crash in any screen and offers a reload instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[renderer] A screen crashed.', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="app-drag flex h-full items-center justify-center bg-ground">
        <ErrorState
          title="Something went wrong"
          message="This screen stopped working. Reload it to carry on."
          {...(error.message ? { details: error.message } : {})}
          onRetry={() => window.location.reload()}
          retryLabel="Reload"
        />
      </div>
    );
  }
}
