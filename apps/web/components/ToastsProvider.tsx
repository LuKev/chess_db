"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type Toast = {
  id: string;
  message: string;
  kind: "info" | "success" | "error";
};

type ToastContextValue = {
  toasts: Toast[];
  pushToast(toast: Omit<Toast, "id">): void;
  removeToast(id: string): void;
};

const ToastsContext = createContext<ToastContextValue | null>(null);

function randomId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export function ToastsProvider(props: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((items) => items.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = randomId();
    setToasts((items) => [...items, { ...toast, id }]);

    // Auto-dismiss non-error toasts. Errors stay until dismissed.
    if (toast.kind !== "error") {
      window.setTimeout(() => {
        removeToast(id);
      }, 3500);
    }
  }, [removeToast]);

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, pushToast, removeToast }),
    [toasts, pushToast, removeToast]
  );

  return (
    <ToastsContext.Provider value={value}>
      {props.children}
      <div
        style={{
          position: "fixed",
          right: 14,
          bottom: 14,
          display: "grid",
          gap: 8,
          zIndex: 1000,
          width: 320,
          maxWidth: "calc(100vw - 28px)",
        }}
        aria-live="polite"
        aria-relevant="additions"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            style={{
              border: "1px solid var(--line)",
              borderLeft:
                toast.kind === "error"
                  ? "4px solid #d9423a"
                  : toast.kind === "success"
                    ? "4px solid var(--accent)"
                    : "4px solid #8a6f2f",
              background: "var(--panel)",
              borderRadius: 10,
              padding: "10px 10px",
              boxShadow: "0 12px 30px rgba(0,0,0,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ fontSize: 14, lineHeight: 1.2 }}>{toast.message}</div>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              style={{
                borderColor: "transparent",
                background: "transparent",
                color: "var(--text)",
                padding: "4px 8px",
              }}
              aria-label="Dismiss"
              title="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastsContext.Provider>
  );
}

export function useToasts(): ToastContextValue {
  const value = useContext(ToastsContext);
  if (!value) {
    throw new Error("useToasts must be used within ToastsProvider");
  }
  return value;
}
