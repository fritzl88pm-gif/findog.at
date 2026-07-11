import { describe, expect, it, vi } from "vitest";

import { recordAdminRequest } from "./admin-request-history";

describe("admin request audit persistence", () => {
  it("inserts exactly the user prompt and ownership identifiers", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ insert }));

    await recordAdminRequest({
      supabase: { from } as never,
      userId: "user-1",
      conversationId: "conversation-1",
      content: "Benutzerfrage",
    });

    expect(from).toHaveBeenCalledWith("admin_request_history");
    expect(insert).toHaveBeenCalledWith({
      user_id: "user-1",
      conversation_id: "conversation-1",
      content: "Benutzerfrage",
    });
  });

  it("fails closed when the durable audit insert fails", async () => {
    const from = vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: new Error("database unavailable") }),
    }));

    await expect(recordAdminRequest({
      supabase: { from } as never,
      userId: "user-1",
      conversationId: "conversation-1",
      content: "Benutzerfrage",
    })).rejects.toMatchObject({ status: 503 });
  });
});
