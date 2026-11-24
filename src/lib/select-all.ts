/**
 * Every row of a query, not just the first thousand: the API hands out at
 * most 1000 rows a request, and a table that has grown past that would
 * quietly lose its oldest rows. Pages are read a few at a time until one
 * comes back short. The query must be ordered on something unique, or rows
 * can slip between pages.
 */
export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 1000,
  parallel = 4
): Promise<T[]> {
  const out: T[] = [];
  for (let n = 0; n < 500; n += parallel) {
    const got = await Promise.all(
      Array.from({ length: parallel }, (_, i) => page((n + i) * size, (n + i) * size + size - 1))
    );
    let done = false;
    for (const { data, error } of got) {
      if (error) throw new Error(error.message);
      if (done) continue;
      out.push(...(data ?? []));
      if ((data ?? []).length < size) done = true;
    }
    if (done) break;
  }
  return out;
}
