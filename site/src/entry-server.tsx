import { renderToString } from 'react-dom/server';
import { App } from './App';
import { RESULTS } from './results';

/** The page's markup, so the built file carries the whole page before any script runs. */
export function render(): string {
  return renderToString(<App />);
}

/** Whether the measured results are in, which the build reports when they are not. */
export const resultsAreIn = RESULTS !== null;
