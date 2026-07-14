import { describe, expect, it, vi } from "vitest";

import { isAdminUser } from "./admin-auth";

describe("admin auth helper", () => {
  it("checks administrator status in admin_users", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { user_id: "admin-1" }, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    await expect(isAdminUser({ from } as never, "admin-1")).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith("admin_users");
    expect(eq).toHaveBeenCalledWith("user_id", "admin-1");
  });

  it("returns false when the user is not an administrator", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });

    await expect(isAdminUser(
      { from: vi.fn().mockReturnValue({ select }) } as never,
      "user-1",
    )).resolves.toBe(false);
  });

  it("surfaces an unavailable administrator lookup", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: new Error("offline") });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });

    await expect(isAdminUser(
      { from: vi.fn().mockReturnValue({ select }) } as never,
      "user-1",
    )).rejects.toMatchObject({
      message: "Administrationsberechtigung konnte nicht geprüft werden.",
      status: 503,
    });
  });
});
