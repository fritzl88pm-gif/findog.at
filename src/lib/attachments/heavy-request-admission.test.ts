import { describe, expect, it } from "vitest";

import { HeavyAttachmentRequestAdmission } from "./heavy-request-admission";

describe("HeavyAttachmentRequestAdmission", () => {
  it("caps concurrent work and immediately reuses a released slot", () => {
    const admission = new HeavyAttachmentRequestAdmission(2);
    const first = admission.tryAcquire();
    const second = admission.tryAcquire();

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(admission.active).toBe(2);
    expect(admission.tryAcquire()).toBeNull();

    first?.release();
    expect(admission.active).toBe(1);
    expect(admission.tryAcquire()).not.toBeNull();
  });

  it("makes lease release idempotent", () => {
    const admission = new HeavyAttachmentRequestAdmission(1);
    const lease = admission.tryAcquire();
    lease?.release();
    lease?.release();
    expect(admission.active).toBe(0);
  });
});
