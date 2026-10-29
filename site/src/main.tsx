import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');

const page = (
  <StrictMode>
    <App />
  </StrictMode>
);

// The built page arrives with its markup already in place; the dev server's does not.
if (root.firstElementChild) hydrateRoot(root, page);
else createRoot(root).render(page);
