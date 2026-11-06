import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/fred-public-share", () => ({ loadFredPublicShare: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));

import { loadFredPublicShare } from "@/lib/fred-public-share";
import FredPublicSharePage from "./page";

const tag = (doc: string, chunk: string) =>
  `<kb doc="${doc}" chunk_id="${chunk}" kb_id="e0282ab8-b94f-4553-962e-68705201cf9a" />`;

describe("Fred public share page citations", () => {
  beforeEach(() => vi.resetAllMocks());

  it("shows plain [n] markers and a list of document names without links or tags", async () => {
    vi.mocked(loadFredPublicShare).mockResolvedValue({
      question_content: "Wie hoch ist die USt?",
      answer_content: `Der Satz beträgt 20 % ${tag("UStG_1994.md", "c1")}. Ausnahme ${tag("UStR_2000.md", "c2")}.`,
    } as never);

    const html = renderToStaticMarkup(await FredPublicSharePage({
      params: Promise.resolve({ shareId: "11111111-1111-4111-8111-111111111111" }),
    }));

    expect(html).toContain('<span>Der Satz beträgt 20 %</span><span class="fred-cite-plain">[1]</span>');
    expect(html).toContain('<span>. Ausnahme</span><span class="fred-cite-plain">[2]</span>');
    expect(html).toContain("Quellen");
    expect(html).toContain("<li value=\"1\">UStG 1994</li>");
    expect(html).toContain("<li value=\"2\">UStR 2000</li>");
    expect(html).not.toMatch(/<kb|chunk_id|kb_id|⟦|<button/u);
  });

  it("omits the source list for answers without citations", async () => {
    vi.mocked(loadFredPublicShare).mockResolvedValue({
      question_content: "Frage",
      answer_content: "Nur Text.",
    } as never);
    const html = renderToStaticMarkup(await FredPublicSharePage({
      params: Promise.resolve({ shareId: "11111111-1111-4111-8111-111111111111" }),
    }));
    expect(html).not.toContain("fred-public-share-sources");
  });
});
