/**
 * Browser fixture harness for the Findog Agent UI (Package 3 verification).
 *
 * It renders the *real* feature components inside the *real* admin workspace
 * shell so the browser checks exercise the shipped markup, CSS and behaviour.
 * It is not reachable from production routing: it lives outside `src/app`, is
 * bundled on demand and only ever talks to fixture API responses that the
 * Playwright script intercepts. No production auth bypass, no real user and no
 * live credential is used here.
 */

import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";

import "@/app/globals.css";
import AdminWorkspace from "@/components/admin-workspace";
import { AdminGuardContext, useAdminNavigationGuard } from "@/components/admin-editor-guard";
import FindogAgentChat from "@/components/findog-agent/chat";
import FindogAgentSettings from "@/components/findog-agent/settings";
import type { AdminArea } from "@/lib/admin-navigation";

function Harness() {
  const [area, setArea] = useState<AdminArea>("findog-agent");
  const guard = useAdminNavigationGuard();
  const feature = area === "findog-agent-settings"
    ? createElement(FindogAgentSettings, { accessToken: "fixture-token" })
    : createElement(FindogAgentChat, { accessToken: "fixture-token" });

  return createElement(
    AdminGuardContext.Provider,
    { value: guard },
    createElement(AdminWorkspace, { area, onNavigate: setArea }, feature),
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Fixture harness container is missing.");
}
createRoot(container).render(createElement(Harness));
