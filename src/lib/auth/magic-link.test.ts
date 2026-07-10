import { describe, expect, it } from "vitest";

import { magicLinkOptions } from "@/lib/auth/magic-link";

describe("magic-link policy", () => {
  it("preserves the redirect origin without allowing account creation", () => {
    const origin = "https://findog.example";

    expect(magicLinkOptions(origin)).toEqual({
      emailRedirectTo: origin,
      shouldCreateUser: false,
    });
  });
});
