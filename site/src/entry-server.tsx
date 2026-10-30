import { renderToString } from 'react-dom/server';
import { App } from './App';
import { DownloadPage } from './DownloadPage';
import { ResultsPage } from './ResultsPage';

/** The home page's markup, so the built file carries the whole page before any script runs. */
export function render(): string {
  return renderToString(<App />);
}

/** The results page's markup, for the same reason. */
export function renderResults(): string {
  return renderToString(<ResultsPage />);
}

/** The download page's markup. */
export function renderDownload(): string {
  return renderToString(<DownloadPage />);
}
