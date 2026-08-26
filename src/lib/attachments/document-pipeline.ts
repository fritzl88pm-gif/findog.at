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

export type OmnirouteDocumentProvider = DocumentProvider;

type DocumentPipelineDependencies = {
  mineruProvider: DocumentProvider;
  omnirouteProvider: OmnirouteDocumentProvider;
};

type ConfiguredDocumentProviderDependencies = DocumentPipelineDependencies & {
  getSettings: () => Promise<Pick<DocumentPipelineSettings, "documentPipeline">>;
};

type DocumentPipelineSettings = {
  documentPipeline: DocumentPipeline;
};

function providerOptions(signal: AbortSignal | undefined): DocumentProviderOptions {
  return { signal };
}

export async function extractDocumentsWithPipeline(
  files: MineruFileInput[],
  options: {
    pipeline: unknown;
    mineruProvider: DocumentProvider;
    omnirouteProvider: DocumentProvider;
    signal?: AbortSignal;
  },
): Promise<string[]> {
  if (
    options.pipeline !== "mineru_with_omniroute_luna_fallback"
    && options.pipeline !== "omniroute_luna_only"
  ) {
    throw new UserVisibleError("Die Dokument-Pipeline ist ungültig.", 500);
  }

  if (options.pipeline === "omniroute_luna_only") {
    return options.omnirouteProvider(files, providerOptions(options.signal));
  }

  try {
    return await options.mineruProvider(files, providerOptions(options.signal));
  } catch {
    return options.omnirouteProvider(files, providerOptions(options.signal));
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
      omnirouteProvider: (providerFiles, providerOptionsValue) =>
        dependencies.omnirouteProvider(providerFiles, providerOptionsValue),
      signal: options?.signal,
    });
  };
}
