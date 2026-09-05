"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export default function AdminDialog({ title, onClose, children, busy = false }: {
  title: string; onClose: () => void; children: ReactNode; busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previousFocus = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return (
    <dialog ref={dialog} className="admin-dialog" aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <header className="admin-dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="admin-dialog-close" aria-label="Dialog schließen" disabled={busy} onClick={onClose}>×</button>
      </header>
      {children}
    </dialog>
  );
}
