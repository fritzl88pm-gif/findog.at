"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo } from "react";
import { mayLeaveAdminEditor, type AdminEditorState } from "@/lib/admin-navigation";

export function useAdminNavigationGuard() {
  const guard = useMemo(() => {
    const editors = new Map<string, AdminEditorState>();
    return {
      editors,
      canLeave: () => mayLeaveAdminEditor(
        editors.values(),
        () => window.confirm("Ungespeicherte Änderungen verwerfen und fortfahren?"),
        () => window.alert("Bitte warten Sie, bis der laufende Vorgang abgeschlossen ist."),
      ),
    };
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if ([...guard.editors.values()].some((entry) => entry.dirty || entry.busy)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [guard]);
  return guard;
}

type Guard = ReturnType<typeof useAdminNavigationGuard>;
export const AdminGuardContext = createContext<Guard | null>(null);

export function confirmAdminEditorLeave(state: AdminEditorState) {
  return mayLeaveAdminEditor(
    [state],
    () => window.confirm("Ungespeicherte Änderungen verwerfen und fortfahren?"),
    () => window.alert("Bitte warten Sie, bis der laufende Vorgang abgeschlossen ist."),
  );
}

export function useAdminEditorGuard(state: AdminEditorState, explicitGuard?: Guard) {
  const context = useContext(AdminGuardContext);
  const guard = explicitGuard ?? context;
  const id = useId();
  const { dirty, busy } = state;
  useLayoutEffect(() => {
    guard?.editors.set(id, { dirty, busy });
    return () => { guard?.editors.delete(id); };
  }, [guard, id, dirty, busy]); // State is a snapshot of the current editor.
  return () => confirmAdminEditorLeave(state);
}
