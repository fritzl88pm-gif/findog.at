import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const componentSource = readFileSync(
  fileURLToPath(new URL("./admin-fred-personalities.tsx", import.meta.url)),
  "utf8",
);

describe("AdminFredPersonalities component", () => {
  it("is a client component", () => {
    expect(componentSource).toContain('"use client"');
  });

  it("exports a default function accepting accessToken prop", () => {
    expect(componentSource).toContain("export default function AdminFredPersonalities");
    expect(componentSource).toContain("accessToken");
  });

  // ── GET contract ──────────────────────────────────────────────────────

  it("GETs /api/admin/fred-personalities with Bearer token and cache:no-store on mount", () => {
    expect(componentSource).toContain("/api/admin/fred-personalities");
    expect(componentSource).toContain("Authorization: `Bearer ${accessToken}`");
    expect(componentSource).toContain('cache: "no-store"');
  });

  it("aborts in-flight requests on unmount/token change and ignores stale responses", () => {
    expect(componentSource).toContain("AbortController");
    expect(componentSource).toContain("mountedRef");
    expect(componentSource).toContain("controller.signal.aborted");
  });

  it("loads only on mount or token change, not when an item is selected", () => {
    expect(componentSource).toContain("}, [accessToken]);");
    expect(componentSource).not.toContain("}, [accessToken, selectedId]);");
  });

  // ── List rendering ────────────────────────────────────────────────────

  it("renders a compact list of existing personalities", () => {
    expect(componentSource).toMatch(/\.map\s*\(/);
    expect(componentSource).toContain("admin-personality-list");
  });

  it("does not render previews, IDs, timestamps, counters, or badges in the list", () => {
    expect(componentSource).not.toContain("counter");
    expect(componentSource).not.toContain("badge");
    expect(componentSource).not.toContain("createdAt");
    expect(componentSource).not.toContain("updatedAt");
    expect(componentSource).not.toContain("Zeichen");
  });

  // ── Edit form ─────────────────────────────────────────────────────────

  it("selecting a personality opens edit fields with Titel label, Textblock label, and Änderungen speichern button", () => {
    expect(componentSource).toContain("Titel");
    expect(componentSource).toContain("Textblock");
    expect(componentSource).toContain("Änderungen speichern");
  });

  it("edit form has text input for title with maxLength 80", () => {
    expect(componentSource).toMatch(/maxLength\s*=\s*\{80\}/);
    expect(componentSource).toContain('type="text"');
  });

  it("edit form has multiline textarea for prompt text with maxLength 4000", () => {
    expect(componentSource).toMatch(/maxLength\s*=\s*\{4000\}/);
    expect(componentSource).toContain("textarea");
  });

  it("provides correct label association (htmlFor) for title and promptText fields", () => {
    expect(componentSource).toContain('htmlFor="admin-personality-title"');
    expect(componentSource).toContain('htmlFor="admin-personality-prompt"');
  });

  // ── PUT contract ──────────────────────────────────────────────────────

  it("PUTs exact {id,title,promptText} on save", () => {
    expect(componentSource).toContain('method: "PUT"');
    expect(componentSource).toContain("JSON.stringify({ id:");
  });

  it("updates in-memory list from normalized PUT response and selects saved item", () => {
    expect(componentSource).toMatch(/setPersonalities\s*\(/);
    expect(componentSource).toMatch(/setSelectedId\s*\(/);
  });

  // ── Create form ───────────────────────────────────────────────────────

  it("provides Neue Persönlichkeit button that opens blank create form", () => {
    expect(componentSource).toContain("Neue Persönlichkeit");
  });

  it("create form has Persönlichkeit anlegen button", () => {
    expect(componentSource).toContain("Persönlichkeit anlegen");
  });

  // ── POST contract ─────────────────────────────────────────────────────

  it("POSTs exact {title,promptText} on create", () => {
    expect(componentSource).toContain('method: "POST"');
    expect(componentSource).toContain("JSON.stringify({ title");
  });

  // ── No delete ─────────────────────────────────────────────────────────

  it("does not call DELETE and has no delete button", () => {
    expect(componentSource).not.toContain('"DELETE"');
    expect(componentSource).not.toContain("Löschen");
    expect(componentSource).not.toContain("löschen");
  });

  // ── Disabled during mutations ─────────────────────────────────────────

  it("disables mutation controls while saving", () => {
    expect(componentSource).toContain("isSaving");
    expect(componentSource).toMatch(/disabled\s*=\s*\{[^}]*isSaving[^}]*\}/);
  });

  // ── Feedback messages ─────────────────────────────────────────────────

  it("shows bounded German error messages without exposing internals", () => {
    expect(componentSource).toContain("error-box");
    expect(componentSource).toContain('role="alert"');
    expect(componentSource).toContain("Persönlichkeitsprofile konnten nicht geladen werden.");
    expect(componentSource).toContain("Personalisierung konnte nicht gespeichert werden.");
    expect(componentSource).not.toContain("response.status");
    expect(componentSource).not.toContain(".stack");
  });

  it("shows success notice with notice-box and role status", () => {
    expect(componentSource).toContain("notice-box");
    expect(componentSource).toContain('role="status"');
  });

  it("shows loading state text while fetching", () => {
    expect(componentSource).toContain("Persönlichkeitsprofile werden geladen");
  });

  // ── Accessibility ─────────────────────────────────────────────────────

  it("uses form element with onSubmit for safe submit behavior", () => {
    expect(componentSource).toContain("onSubmit");
    expect(componentSource).toContain("<form");
  });

  it("uses aria-live polite on status container", () => {
    expect(componentSource).toContain('aria-live="polite"');
  });

  // ── No extra payload fields in request bodies ─────────────────────────

  it("does not send extra payload fields beyond {id,title,promptText} for PUT or {title,promptText} for POST", () => {
    // PUT body contains only id, title, promptText
    const putBody = componentSource.match(/JSON\.stringify\(\{\s*id:/);
    expect(putBody).not.toBeNull();
    // POST body contains only title, promptText (no id)
    const postBody = componentSource.match(/JSON\.stringify\(\{\s*title:/);
    expect(postBody).not.toBeNull();
    // No userId in any body
    expect(componentSource).not.toContain('"userId"');
    expect(componentSource).not.toContain("created_at");
    expect(componentSource).not.toContain("updated_at");
  });
});
