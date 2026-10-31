"use client";

import { createContext, ReactNode, useCallback, useContext, useRef, useState } from "react";

type Kind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  kind: Kind;
}

const ToastCtx = createContext<(message: string, kind?: Kind) => void>(() => {});

/** Short, polite feedback after an action (copy, failure). Not used for routine clicks. */
export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const notify = useCallback((message: string, kind: Kind = "success") => {
    const id = next.current++;
    setItems((cur) => [...cur.slice(-2), { id, message, kind }]);
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), kind === "error" ? 5000 : 2200);
  }, []);

  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center gap-2 pointer-events-none max-w-[calc(100vw-2rem)]" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="fade-in popover rounded-lg px-3 py-2 text-body flex items-center gap-2 pointer-events-auto">
            <span
              aria-hidden
              className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-ground ${
                t.kind === "error" ? "bg-del" : t.kind === "info" ? "bg-accent" : "bg-add"
              }`}
            >
              {t.kind === "error" ? "!" : t.kind === "info" ? "i" : "✓"}
            </span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
