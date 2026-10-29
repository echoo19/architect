import { renderToString } from 'react-dom/server';
import { App } from './App';

/** The page's markup, so the built file carries the whole page before any script runs. */
export function render(): string {
  return renderToString(<App />);
}
