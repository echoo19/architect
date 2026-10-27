import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyResolvedTheme } from './app/theme';
import './styles.css';

// Before the first paint, so the window never shows the wrong theme.
applyResolvedTheme();

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
