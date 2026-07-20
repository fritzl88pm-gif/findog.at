export type WeKnoraKnowledgeKind = "document" | "faq";

export type WeKnoraKnowledgeBase = {
  id: string;
  name: string;
  kind: WeKnoraKnowledgeKind;
  count: number;
  isProcessing: boolean;
  processingCount: number;
};

export type WeKnoraDashboardTotals = {
  knowledgeBases: number;
  contents: number;
  documents: number;
  faqEntries: number;
  processing: number;
};

export type WeKnoraDashboard = {
  knowledgeBases: WeKnoraKnowledgeBase[];
  totals: WeKnoraDashboardTotals;
  fetchedAt: string;
  stale: boolean;
};
