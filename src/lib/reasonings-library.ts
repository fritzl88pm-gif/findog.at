import { getChildCategoryIds } from "./reasonings";

export type ReasoningLibraryItem = {
  id: string;
  title: string;
  content: string;
  categoryIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ReasoningSortBy = "updated" | "alpha";

export type FilterAndSortOptions = {
  query?: string;
  categoryId?: string;
  childIdsByParent: ReadonlyMap<string, readonly string[]>;
  sortBy?: ReasoningSortBy;
};

export function filterAndSortReasonings(
  items: readonly ReasoningLibraryItem[],
  options: FilterAndSortOptions,
): ReasoningLibraryItem[] {
  const query = options.query?.trim().toLowerCase() ?? "";
  const { categoryId, childIdsByParent, sortBy = "updated" } = options;

  let allowedCategoryIds: string[] | null = null;
  if (categoryId) {
    allowedCategoryIds = getChildCategoryIds(categoryId, childIdsByParent);
  }

  const filtered = items.filter((item) => {
    if (allowedCategoryIds) {
      const matchesCategory = item.categoryIds.some((id) => allowedCategoryIds!.includes(id));
      if (!matchesCategory) return false;
    }

    if (query) {
      const inTitle = item.title.toLowerCase().includes(query);
      const inContent = item.content.toLowerCase().includes(query);
      if (!inTitle && !inContent) return false;
    }

    return true;
  });

  return sortReasonings(filtered, sortBy);
}

export function sortReasonings(
  items: readonly ReasoningLibraryItem[],
  sortBy: ReasoningSortBy,
): ReasoningLibraryItem[] {
  const sorted = [...items];

  if (sortBy === "alpha") {
    sorted.sort((a, b) => {
      // German locale-aware title sorting
      const comp = a.title.localeCompare(b.title, "de-AT", { sensitivity: "base" });
      if (comp !== 0) return comp;
      const exactComp = a.title.localeCompare(b.title, "de-AT");
      if (exactComp !== 0) return exactComp;
      return a.id.localeCompare(b.id);
    });
  } else {
    // "updated" (default): recently updated descending
    sorted.sort((a, b) => {
      const timeA = Date.parse(a.updatedAt || a.createdAt);
      const timeB = Date.parse(b.updatedAt || b.createdAt);
      const validA = !Number.isNaN(timeA);
      const validB = !Number.isNaN(timeB);

      if (validA && validB) {
        if (timeB !== timeA) return timeB - timeA;
      } else if (validA && !validB) {
        return -1;
      } else if (!validA && validB) {
        return 1;
      }
      return a.id.localeCompare(b.id);
    });
  }

  return sorted;
}

export function resolveSelectedReasoningId(
  currentSelectedId: string | null,
  filteredItems: readonly ReasoningLibraryItem[],
): string | null {
  if (filteredItems.length === 0) return null;
  if (currentSelectedId && filteredItems.some((item) => item.id === currentSelectedId)) {
    return currentSelectedId;
  }
  return filteredItems[0].id;
}

export function getReasoningPreview(content: string, maxLength = 160): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}
