import type { DeepSeekTool, JsonObject } from "../mcp/tools";
import { verifyBfgCitations } from "./bfg-citations";

export const FINDOK_VERIFY_BFG_CASES_TOOL_NAME = "findok_verify_bfg_cases";

export const findokVerifyBfgCasesTool: DeepSeekTool = {
  type: "function",
  function: {
    name: FINDOK_VERIFY_BFG_CASES_TOOL_NAME,
    description:
      "Verifiziert BFG-Geschäftszahlen über die offizielle Findok-API und liefert nur echte BFG-Fundstellen mit offiziellen PDF-Links zurück.",
    parameters: {
      type: "object",
      properties: {
        gzs: {
          type: "array",
          items: { type: "string" },
          description: "BFG-Geschäftszahlen wie RV/7103053/2014.",
        },
      },
      required: ["gzs"],
    },
  },
};

function asGzArray(argumentsObject: JsonObject): string[] {
  const value = argumentsObject.gzs;
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export async function callFindokVerifier(argumentsObject: JsonObject): Promise<string> {
  const gzs = asGzArray(argumentsObject);
  if (gzs.length === 0) {
    return JSON.stringify({
      verified: [],
      rejected: [],
      note: "Keine gültigen BFG-Geschäftszahlen zur Findok-Verifikation übergeben.",
    });
  }

  const verification = await verifyBfgCitations(gzs);
  return JSON.stringify(
    {
      verified: verification.verified.map((citation) => ({
        gz: citation.gz,
        title: citation.title,
        documentTitle: citation.documentTitle,
        pdfUrl: citation.pdfUrl,
        fullTextUrl: citation.fullTextUrl,
      })),
      rejected: verification.rejected.map((citation) => ({
        gz: citation.gz,
        status: citation.status,
        reason: citation.reason,
      })),
    },
    null,
    2,
  );
}
