'use client';

import { useEffect } from 'react';
import { useUIStore } from '@/store/uiStore';

const toneClasses = {
  success: 'border-green-500/40 bg-green-500/15 text-green-100',
  error: 'border-red-500/40 bg-red-500/15 text-red-100',
  info: 'border-primary/40 bg-primary/15 text-light',
  warning: 'border-yellow-500/40 bg-yellow-500/15 text-yellow-100',
};

export default function NotificationCenter() {
  const { notifications, removeNotification } = useUIStore();

  useEffect(() => {
    const timers = notifications.map((notification) =>
      window.setTimeout(
        () => removeNotification(notification.id),
        notification.duration ?? 5000
      )
    );

    return () => timers.forEach(window.clearTimeout);
  }, [notifications, removeNotification]);

  if (!notifications.length) {
    return null;
  }

  return (
    <div className="fixed right-4 top-20 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`rounded-lg border p-4 text-sm shadow-2xl backdrop-blur ${toneClasses[notification.type]}`}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 leading-5">{notification.message}</div>
            <button
              type="button"
              onClick={() => removeNotification(notification.id)}
              className="rounded px-2 text-lg leading-none text-current opacity-70 hover:opacity-100"
              aria-label="Dismiss notification"
            >
              x
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
