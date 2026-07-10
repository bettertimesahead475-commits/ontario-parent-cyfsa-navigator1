import { useCallback, useEffect } from 'react';

const RESET_CHANNEL_NAME = 'opa-app-reset';

export const useAppReset = () => {
  const resetAll = useCallback(async () => {
    // 1. Clear LocalStorage
    localStorage.clear();

    // 2. Clear SessionStorage
    sessionStorage.clear();

    // 3. Clear Caches (Service Workers, etc.)
    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      } catch (e) {
        console.warn('Failed to clear caches', e);
      }
    }

    // 3.5 Clear IndexedDB (Firestore caches)
    if ('indexedDB' in window && window.indexedDB.databases) {
      try {
        const dbs = await window.indexedDB.databases();
        await Promise.all(dbs.map(db => {
          return new Promise<void>((resolve) => {
            if (db.name) {
              const req = window.indexedDB.deleteDatabase(db.name);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
              req.onblocked = () => resolve();
            } else {
              resolve();
            }
          });
        }));
      } catch (e) {
        console.warn('Failed to clear IndexedDB caches:', e);
      }
    }

    // 4. Broadcast to other tabs to reload so they drop their in-memory state
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(RESET_CHANNEL_NAME);
      channel.postMessage('reset');
      channel.close();
    }

    // 5. Force a hard reload to clear all component-specific local state and in-memory caches
    window.location.reload();
  }, []);

  return { resetAll };
};

export const useGlobalResetListener = () => {
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    
    const channel = new BroadcastChannel(RESET_CHANNEL_NAME);
    channel.onmessage = (event) => {
      if (event.data === 'reset') {
        window.location.reload();
      }
    };
    return () => {
      channel.close();
    };
  }, []);
};
