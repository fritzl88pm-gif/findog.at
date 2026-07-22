import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { isAdminUser } from "@/lib/admin-auth";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { generateQuiz } from "@/lib/quiz/generate";
import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({
  authenticateSupabaseRequest: vi.fn(),
  getBearerToken: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  isAdminUser: vi.fn(),
}));

vi.mock("@/lib/quiz/generate", () => ({
  generateQuiz: vi.fn(),
  CATEGORIES: ["Arbeitnehmerveranlagung", "Verfahrensrecht"],
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(),
    },
  })),
}));

type MockRequestOptions = {
  authorization?: boolean;
  secFetchSite?: string;
};

function mockRawRequest(body: string, options?: MockRequestOptions): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    host: "localhost",
  };
  if (options?.authorization !== false) {
    headers.Authorization = "Bearer access-token";
  }
  if (options?.secFetchSite) {
    headers["sec-fetch-site"] = options.secFetchSite;
  }
  return new Request("http://localhost/api/quiz/generate", {
    method: "POST",
    headers,
    body,
  });
}

function mockRequest(body: unknown, options?: MockRequestOptions): Request {
  return mockRawRequest(JSON.stringify(body), options);
}

function quizResponse(category: "Arbeitnehmerveranlagung" | "Verfahrensrecht" = "Arbeitnehmerveranlagung") {
  return {
    id: "test-quiz-id",
    category,
    questions: Array.from({ length: 10 }, (_, index) => ({
      question: `Frage ${index + 1}?`,
      options: ["Option A", "Option B", "Option C", "Option D"] as [string, string, string, string],
      correctIndex: 0,
      explanation: `Erklärung für Frage ${index + 1}.`,
    })),
  };
}

describe("POST /api/quiz/generate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T12:00:00Z"));
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "default-test-user" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("rejects cross-site requests before authentication", async () => {
    const response = await POST(mockRequest(
      { category: "Arbeitnehmerveranlagung" },
      { secFetchSite: "cross-site" },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Diese Quiz-Anfrage ist nicht erlaubt." });
    expect(authenticateSupabaseRequest).not.toHaveBeenCalled();
    expect(generateQuiz).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValueOnce(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );

    const response = await POST(mockRequest(
      { category: "Arbeitnehmerveranlagung" },
      { authorization: false },
    ));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Bitte zuerst anmelden." });
    expect(generateQuiz).not.toHaveBeenCalled();
  });

  it("rejects an authenticated non-admin before quiz generation", async () => {
    vi.mocked(isAdminUser).mockResolvedValueOnce(false);

    const response = await POST(mockRequest({ category: "Arbeitnehmerveranlagung" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Du hast keine Administrationsberechtigung.",
    });
    expect(isAdminUser).toHaveBeenCalledWith(expect.anything(), "default-test-user");
    expect(generateQuiz).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized bodies", async () => {
    const malformed = await POST(mockRawRequest("{"));
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({ error: "Die Anfrage enthält kein gültiges JSON." });

    const oversized = await POST(mockRequest({
      category: "Arbeitnehmerveranlagung",
      padding: "x".repeat(2_100),
    }));
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toEqual({ error: "Die Anfrage ist zu groß." });
    expect(generateQuiz).not.toHaveBeenCalled();
  });

  it("rejects missing, invalid, and extra body fields", async () => {
    const missing = await POST(mockRequest({}));
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({ error: "Bitte eine gültige Kategorie angeben." });

    const invalid = await POST(mockRequest({ category: "InvalidCategory" }));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: "Ungültige Kategorie. Erlaubt: Arbeitnehmerveranlagung, Verfahrensrecht.",
    });

    const extra = await POST(mockRequest({ category: "Arbeitnehmerveranlagung", extra: "field" }));
    expect(extra.status).toBe(400);
    await expect(extra.json()).resolves.toEqual({ error: "Die Anfrage enthält unbekannte Felder." });
    expect(generateQuiz).not.toHaveBeenCalled();
  });

  it("validates the body before consuming rate-limit quota", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "body-before-rate-user" });
    vi.mocked(generateQuiz).mockResolvedValue(quizResponse());

    for (let index = 0; index < 6; index += 1) {
      const invalid = await POST(mockRequest({ category: "InvalidCategory" }));
      expect(invalid.status).toBe(400);
    }

    const valid = await POST(mockRequest({ category: "Arbeitnehmerveranlagung" }));
    expect(valid.status).toBe(200);
    expect(generateQuiz).toHaveBeenCalledTimes(1);
  });

  it("returns concise errors from quiz generation", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "error-test-user" });
    vi.mocked(generateQuiz).mockRejectedValueOnce(new Error("Unexpected"));

    const unexpected = await POST(mockRequest({ category: "Arbeitnehmerveranlagung" }));
    expect(unexpected.status).toBe(500);
    await expect(unexpected.json()).resolves.toEqual({
      error: "Das Quiz konnte nicht erstellt werden. Bitte später erneut versuchen.",
    });

    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "visible-error-test-user" });
    vi.mocked(generateQuiz).mockRejectedValueOnce(
      new UserVisibleError("Für diese Kategorie konnte kein Lernmaterial gefunden werden.", 502),
    );
    const visible = await POST(mockRequest({ category: "Arbeitnehmerveranlagung" }));
    expect(visible.status).toBe(502);
    await expect(visible.json()).resolves.toEqual({
      error: "Für diese Kategorie konnte kein Lernmaterial gefunden werden.",
    });
  });

  it("returns a private no-store quiz response for each valid category", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "success-test-anv" });
    vi.mocked(generateQuiz).mockResolvedValueOnce(quizResponse());

    const anv = await POST(mockRequest({ category: "Arbeitnehmerveranlagung" }));
    expect(anv.status).toBe(200);
    expect(anv.headers.get("Cache-Control")).toBe("no-store, private");
    await expect(anv.json()).resolves.toMatchObject({
      id: "test-quiz-id",
      category: "Arbeitnehmerveranlagung",
    });

    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "success-test-vr" });
    vi.mocked(generateQuiz).mockResolvedValueOnce(quizResponse("Verfahrensrecht"));
    const verfahrensrecht = await POST(mockRequest({ category: "Verfahrensrecht" }));
    expect(verfahrensrecht.status).toBe(200);
    await expect(verfahrensrecht.json()).resolves.toMatchObject({ category: "Verfahrensrecht" });
  });

  it("enforces the per-user rate limit", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "rate-limit-test-user" });
    vi.mocked(generateQuiz).mockResolvedValue(quizResponse());

    for (let index = 0; index < 5; index += 1) {
      const response = await POST(mockRequest({ category: "Arbeitnehmerveranlagung" }));
      expect(response.status).toBe(200);
    }

    const response = await POST(mockRequest({ category: "Arbeitnehmerveranlagung" }));
    expect(response.status).toBe(429);
    expect((await response.json()).error).toContain("Quiz-Limit");
  });
});
