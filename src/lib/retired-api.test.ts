import { describe, expect, it } from "vitest";

import { POST as retiredChat } from "@/app/api/chat/route";
import {
  DELETE as retiredConversationBulkDelete,
  GET as retiredConversationList,
} from "@/app/api/conversations/route";
import {
  DELETE as retiredConversationDelete,
  GET as retiredConversation,
} from "@/app/api/conversations/[conversationId]/route";
import { POST as retiredFeedback } from "@/app/api/feedback/route";
import { POST as retiredPdf } from "@/app/api/documents/pdf/route";
import { GET as retiredPdfArtifact } from "@/app/api/documents/pdf/[artifactId]/route";
import {
  GET as retiredModels,
  PATCH as retiredModelsPatch,
  POST as retiredModelsPost,
} from "@/app/api/admin/models/route";
import {
  DELETE as retiredModelDelete,
  PATCH as retiredModelPatch,
} from "@/app/api/admin/models/[modelId]/route";
import { PATCH as retiredDefaultModel } from "@/app/api/admin/models/default/route";
import { PATCH as retiredModelImage } from "@/app/api/admin/models/[modelId]/image/route";
import {
  GET as retiredModelImages,
  POST as retiredModelImagesPost,
} from "@/app/api/admin/model-images/route";

describe("retired internal Fred APIs", () => {
  it.each([
    retiredChat,
    retiredConversationList,
    retiredConversationBulkDelete,
    retiredConversation,
    retiredConversationDelete,
    retiredFeedback,
    retiredPdf,
    retiredPdfArtifact,
    retiredModels,
    retiredModelsPost,
    retiredModelsPatch,
    retiredModelPatch,
    retiredModelDelete,
    retiredDefaultModel,
    retiredModelImage,
    retiredModelImages,
    retiredModelImagesPost,
  ])("returns 410 without calling a legacy provider", async (handler) => {
    const response = handler();
    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Dieser Endpunkt wurde durch den WeKnora-Fred ersetzt.",
    });
  });
});
