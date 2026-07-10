import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Firebase Connection Test
import { doc, getDocFromServer } from 'firebase/firestore';
import { db } from './firebase';

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

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
