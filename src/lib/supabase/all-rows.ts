/**
 * Every row of a query, not just the first thousand: Supabase answers at
 * most 1000 rows a request, whatever the limit says. The query needs a
 * stable order so the pages neither skip nor repeat rows.
 */
export async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  max = 20_000
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data } = await page(from, Math.min(from + 999, max - 1));
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}
