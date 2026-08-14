'use client';

import { useEffect, useState } from 'react';

/**
 * Registers the service worker and shows a live offline banner.
 * Client-side only; renders nothing while online.
 */
export function PwaSetup({ offlineText }: { offlineText: string }) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* registration failure is non-fatal */
      });
    }
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="status"
      className="no-print sticky top-0 z-30 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-white"
    >
      {offlineText}
    </div>
  );
}
