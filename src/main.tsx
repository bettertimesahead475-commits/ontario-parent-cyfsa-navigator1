import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// BUG FOUND IN AUDIT: this file used to run an unconditional Firestore read
// (doc(db, 'test', 'connection')) on every single page load in production,
// for every user, forever — clearly a one-off manual connectivity check from
// development that got left wired into the real app. It consumed a real
// Firestore read quota on every load, surfaced nothing to the user even on
// failure (just a console.error), and served no actual purpose for real
// traffic. Removed entirely.

// --- Native Android API Proxy Ready ---
// We now use apiFetch helper for clean safe routing in native container layouts
// --------------------------------------------

// --- Service Worker Register for Courtroom Offline Access ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log("[OPA SW] Standard Service Worker registered scope:", reg.scope);
      })
      .catch((err) => {
        console.warn("[OPA SW] Registration omitted or blocked:", err);
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
