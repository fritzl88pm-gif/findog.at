import type { MineruFileInput } from "@/lib/attachments/mineru-cloud";
import { UserVisibleError } from "@/lib/errors";
import type { DocumentPipeline } from "@/lib/scanning/settings";

export type DocumentProviderOptions = {
  signal?: AbortSignal;
};

export type DocumentProvider = (
  files: MineruFileInput[],
  options?: DocumentProviderOptions,
) => Promise<string[]>;

export type OpenrouterDocumentProvider = (
  files: MineruFileInput[],
  options: DocumentProviderOptions & { model: string },
) => Promise<string[]>;

type DocumentPipelineDependencies = {
  mineruProvider: DocumentProvider;
  openrouterProvider: OpenrouterDocumentProvider;
};

type ConfiguredDocumentProviderDependencies = DocumentPipelineDependencies & {
  getSettings: () => Promise<Pick<DocumentPipelineSettings, "documentPipeline" | "modelId">>;
};

type DocumentPipelineSettings = {
  documentPipeline: DocumentPipeline;
  modelId: string;
};

function providerOptions(signal: AbortSignal | undefined): DocumentProviderOptions {
  return { signal };
}

export async function extractDocumentsWithPipeline(
  files: MineruFileInput[],
  options: {
    pipeline: unknown;
    mineruProvider: DocumentProvider;
    openrouterProvider: DocumentProvider;
    signal?: AbortSignal;
  },
): Promise<string[]> {
  if (
    options.pipeline !== "mineru_with_openrouter_fallback"
    && options.pipeline !== "openrouter_only"
  ) {
    throw new UserVisibleError("Die Dokument-Pipeline ist ungültig.", 500);
  }

  if (options.pipeline === "openrouter_only") {
    return options.openrouterProvider(files, providerOptions(options.signal));
  }

  try {
    return await options.mineruProvider(files, providerOptions(options.signal));
  } catch {
    return options.openrouterProvider(files, providerOptions(options.signal));
  }
}

export function createConfiguredDocumentProvider(
  dependencies: ConfiguredDocumentProviderDependencies,
): DocumentProvider {
  return async (files, options) => {
    const settings = await dependencies.getSettings();
    return extractDocumentsWithPipeline(files, {
      pipeline: settings.documentPipeline,
      mineruProvider: (providerFiles, providerOptionsValue) =>
        dependencies.mineruProvider(providerFiles, providerOptionsValue),
      openrouterProvider: (providerFiles, providerOptionsValue) => dependencies.openrouterProvider(
        providerFiles,
        { ...providerOptionsValue, model: settings.modelId },
      ),
      signal: options?.signal,
    });
  };
}
