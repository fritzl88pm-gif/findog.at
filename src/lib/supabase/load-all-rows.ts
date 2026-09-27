import { UserVisibleError } from "@/lib/errors";

// Hosted Supabase PostgREST returns at most 1000 rows per request and cuts larger results
// off without an error, so list reads that can grow past it page through .range().
export const POSTGREST_PAGE_SIZE = 1_000;

/**
 * Reads every row of a query page by page. The query must have a stable, unique order
 * (end with an id tie-breaker) so consecutive pages neither overlap nor skip rows.
 */
export async function loadAllRows<Row>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  unavailableMessage: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += POSTGREST_PAGE_SIZE) {
    const { data, error } = await loadPage(from, from + POSTGREST_PAGE_SIZE - 1);
    if (error) {
      throw new UserVisibleError(unavailableMessage, 503);
    }
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < POSTGREST_PAGE_SIZE) return rows;
  }
}
