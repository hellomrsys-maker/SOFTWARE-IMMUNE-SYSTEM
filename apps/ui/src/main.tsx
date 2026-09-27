import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';

// node: 09 — SIS UI entry point
const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
