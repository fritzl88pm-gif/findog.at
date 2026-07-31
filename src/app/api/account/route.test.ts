import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { deleteTelegramIntegration } from "@/lib/telegram/settings";
import { DELETE } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/telegram/settings", () => ({ deleteTelegramIntegration: vi.fn() }));

const USER_ID = "22222222-2222-4222-8222-222222222222";

function request() {
  return new Request("http://localhost/api/account", {
    method: "DELETE",
    headers: { Authorization: "Bearer access-token" },
  });
}

describe("DELETE /api/account", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: USER_ID,
      email: "user@example.com",
    });
    vi.mocked(deleteTelegramIntegration).mockRejectedValue(
      new UserVisibleError("Keine Telegram-Integration gefunden.", 404),
    );
  });

  it("authenticates before attempting account deletion", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );

    const response = await DELETE(request());

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("deletes exactly the authenticated account through the atomic RPC", async () => {
    rpc.mockResolvedValue({ error: null });

    const response = await DELETE(request());

    expect(response.status).toBe(200);
    expect(deleteTelegramIntegration).toHaveBeenCalledWith(USER_ID);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("admin_delete_managed_user", {
      target_user_id: USER_ID,
    });
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("finishes Telegram cleanup before deleting an active account", async () => {
    const order: string[] = [];
    vi.mocked(deleteTelegramIntegration).mockImplementation(async () => {
      order.push("telegram-cleanup");
      return { deleted: true };
    });
    rpc.mockImplementation(async () => {
      order.push("account-delete");
      return { error: null };
    });

    const response = await DELETE(request());

    expect(response.status).toBe(200);
    expect(order).toEqual(["telegram-cleanup", "account-delete"]);
  });

  it("fails closed with a bounded 503 when Telegram cleanup is incomplete", async () => {
    vi.mocked(deleteTelegramIntegration).mockResolvedValue({
      deleted: false,
      error: "private Telegram detail",
    });

    const response = await DELETE(request());

    expect(response.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Das Benutzerkonto konnte nicht gelöscht werden.",
    });
  });

  it("does not delete the account when Telegram cleanup throws", async () => {
    vi.mocked(deleteTelegramIntegration).mockRejectedValue(new Error("private token-bearing error"));

    const response = await DELETE(request());

    expect(response.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Das Benutzerkonto konnte nicht gelöscht werden.",
    });
  });

  it("does not expose service errors", async () => {
    rpc.mockResolvedValue({ error: new Error("private database details") });

    const response = await DELETE(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Das Benutzerkonto konnte nicht gelöscht werden.",
    });
  });

  it("fails safely when account services are unavailable", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(null);

    const response = await DELETE(request());

    expect(response.status).toBe(503);
    expect(authenticateSupabaseRequest).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
