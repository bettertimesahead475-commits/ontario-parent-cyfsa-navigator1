// Stage 10 slice 8: MUST stay the first import. It removes an invitation token (#t=...) from the URL
// before App.tsx and its telemetry packages are even evaluated. See src/utils/invitationFragment.ts.
import './utils/invitationFragment';
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
// Staging domains (*.pages.dev) must NEVER register a service worker to prevent
// stale-chunk caching and white screens across rapid staging deployments.
if ("serviceWorker" in navigator) {
  const isStaging = typeof window !== "undefined" && 
    (window.location.hostname.includes("pages.dev") || window.location.hostname === "localhost");
  if (isStaging) {
    // Proactively clear existing service workers and caches on staging
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const reg of registrations) {
        reg.unregister().then(() => {
          console.log("[OPA SW] Staging: Unregistered existing service worker scope:", reg.scope);
        });
      }
    });
    if ("caches" in window) {
      caches.keys().then((keys) => {
        for (const key of keys) {
          caches.delete(key);
        }
      });
    }
  } else {
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
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
