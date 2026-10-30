import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionProvider } from '@architect/ui';
import { Film } from './Film';
import { install } from './seek';
import './film.css';

/** Sets the page up for the renderer once the pictures are in it. */
function Boot() {
  useEffect(() => {
    install();
  }, []);
  return null;
}

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');

// Every transition of the product's own components completes at once: the film moves nothing on
// its own clock, only by being asked for a time.
createRoot(root).render(
  <MotionProvider instant>
    <Film />
    <div
      id="film-cover"
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10,
        background: 'var(--ui-ground)',
        pointerEvents: 'none',
      }}
    />
    <Boot />
  </MotionProvider>,
);
