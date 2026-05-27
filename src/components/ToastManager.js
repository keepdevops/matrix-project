import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import Button from './Button';
import '../styles/Toast.css';

const ToastContext = createContext(null);

let _uid = 0;
const nextId = () => ++_uid;

const DURATIONS = { success: 4000, info: 4000, warn: 6000, error: 8000 };
const ICONS = { success: '✓', error: '✕', warn: '⚠', info: 'ℹ' };

function Toast({ id, message, type, onDismiss }) {
  return (
    <div className={`toast toast--${type}`} role="status" aria-live="polite">
      <span className="toast-icon">{ICONS[type]}</span>
      <span className="toast-msg">{message}</span>
      <Button variant="ghost" size="xs" className="toast-close" onClick={() => onDismiss(id)} aria-label="Dismiss">✕</Button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message, type = 'info', duration) => {
    const id = nextId();
    const ms = duration ?? DURATIONS[type] ?? 4000;
    setToasts(prev => {
      const next = [...prev, { id, message, type }];
      return next.length > 3 ? next.slice(next.length - 3) : next;
    });
    timers.current[id] = setTimeout(() => dismiss(id), ms);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="toast-container" aria-label="Notifications">
        {toasts.map(t => (
          <Toast key={t.id} {...t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
