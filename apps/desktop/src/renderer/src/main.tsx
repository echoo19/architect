import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionProvider } from '@architect/ui';
import { App } from './app/App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');

createRoot(root).render(
  <StrictMode>
    {/* A run for tests and screenshots never animates, so a capture never shows a frame between. */}
    <MotionProvider instant={window.architectRuntime.hidden}>
      <App />
    </MotionProvider>
  </StrictMode>,
);
