import { UserVisibleError } from "./errors";

export const MAX_REASONING_TITLE_CHARS = 160;
export const MAX_REASONING_CONTENT_CHARS = 100_000;
export const MAX_REASONING_CATEGORY_NAME_CHARS = 80;
export const MAX_REASONING_CATEGORIES = 50;

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type ReasoningInput = {
  title: string;
  content: string;
  categoryIds: string[];
};

export function parseReasoningInput(value: unknown): ReasoningInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UserVisibleError("Der Textbaustein ist ungültig.", 400);
  }

  const body = value as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!title) {
    throw new UserVisibleError("Bitte einen Titel eingeben.", 400);
  }
  if (title.length > MAX_REASONING_TITLE_CHARS) {
    throw new UserVisibleError(
      `Der Titel darf maximal ${MAX_REASONING_TITLE_CHARS} Zeichen lang sein.`,
      400,
    );
  }
  if (!content) {
    throw new UserVisibleError("Bitte einen Textbaustein eingeben.", 400);
  }
  if (content.length > MAX_REASONING_CONTENT_CHARS) {
    throw new UserVisibleError(
      `Der Textbaustein darf maximal ${MAX_REASONING_CONTENT_CHARS.toLocaleString("de-AT")} Zeichen lang sein.`,
      400,
    );
  }
  if (!Array.isArray(body.categoryIds)) {
    throw new UserVisibleError("Die Kategorienauswahl ist ungültig.", 400);
  }
  if (
    body.categoryIds.length > MAX_REASONING_CATEGORIES
    || body.categoryIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))
  ) {
    throw new UserVisibleError("Die Kategorienauswahl ist ungültig.", 400);
  }

  const categoryIds = [...new Set(body.categoryIds as string[])];
  return { title, content, categoryIds };
}

export function parseCategoryName(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UserVisibleError("Die Kategorie ist ungültig.", 400);
  }
  const rawName = (value as Record<string, unknown>).name;
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) {
    throw new UserVisibleError("Bitte einen Kategorienamen eingeben.", 400);
  }
  if (name.length > MAX_REASONING_CATEGORY_NAME_CHARS) {
    throw new UserVisibleError(
      `Der Kategoriename darf maximal ${MAX_REASONING_CATEGORY_NAME_CHARS} Zeichen lang sein.`,
      400,
    );
  }
  return name;
}

export type CategoryInput = {
  name: string;
  parentId: string | null;
};

export function parseCategoryInput(value: unknown): CategoryInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UserVisibleError("Die Kategorie ist ungültig.", 400);
  }
  const body = value as Record<string, unknown>;
  const name = parseCategoryName(value);

  let parentId: string | null = null;
  if (body.parentId !== undefined && body.parentId !== null) {
    if (typeof body.parentId !== "string" || !UUID_PATTERN.test(body.parentId)) {
      throw new UserVisibleError("Die übergeordnete Kategorie ist ungültig.", 400);
    }
    parentId = body.parentId;
  }

  return { name, parentId };
}

export function requireReasoningUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new UserVisibleError(`${label} ist ungültig.`, 400);
  }
  return value;
}

export type ReasoningCategoryReference = {
  id: string;
  name: string;
  parentId: string | null;
};

export function getChildCategoryIds(
  categoryId: string,
  childIdsByParent: ReadonlyMap<string, readonly string[]>,
): string[] {
  const children = childIdsByParent.get(categoryId);
  return children ? [categoryId, ...children] : [categoryId];
}

export function orderReasoningCategories<T extends ReasoningCategoryReference>(
  categories: readonly T[],
): T[] {
  const sorted = [...categories].sort((left, right) =>
    left.name.localeCompare(right.name, "de-AT")
  );
  const topLevel = sorted.filter((category) => !category.parentId);
  const ordered = topLevel.flatMap((parent) => [
    parent,
    ...sorted.filter((category) => category.parentId === parent.id),
  ]);
  const includedIds = new Set(ordered.map((category) => category.id));
  return [...ordered, ...sorted.filter((category) => !includedIds.has(category.id))];
}

export function reasoningCategoryLabel(
  category: ReasoningCategoryReference,
  categories: readonly ReasoningCategoryReference[],
): string {
  if (!category.parentId) return category.name;
  const parent = categories.find((candidate) => candidate.id === category.parentId);
  return parent ? `${parent.name} › ${category.name}` : category.name;
}
