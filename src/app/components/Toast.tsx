'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

type Toast = {
  id: number;
  message: string;
  type: 'info' | 'warning' | 'error';
};

let toastId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<number, NodeJS.Timeout>>(new Map());

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timersRef.current.delete(id);
    }, 3000);
    timersRef.current.set(id, timer);
  }, []);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer));
    };
  }, []);

  return { toasts, showToast };
}

export function ToastContainer({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`px-4 py-3 rounded-xl shadow-lg text-sm font-medium backdrop-blur-md animate-slide-in
            ${toast.type === 'error' ? 'bg-red-500/90 text-white' : ''}
            ${toast.type === 'warning' ? 'bg-yellow-500/90 text-white' : ''}
            ${toast.type === 'info' ? 'bg-green-500/90 text-white' : ''}
          `}
        >
          {toast.type === 'error' ? '❌' : toast.type === 'warning' ? '⚠️' : 'ℹ️'}{' '}
          {toast.message}
        </div>
      ))}
    </div>
  );
}
