export interface HistoryPage {
  start: number;
  limit: number;
}

export function parseHistoryPage(params: URLSearchParams): HistoryPage | undefined {
  if (!params.has("start") && !params.has("limit")) return undefined;
  const start = params.get("start") ?? "0";
  const limit = params.get("limit") ?? "50";
  if (!/^\d+$/.test(start) || !/^\d+$/.test(limit)) {
    throw new Error("Start und Limit müssen ganze Zahlen sein.");
  }
  const page = { start: Number(start), limit: Number(limit) };
  if (
    !Number.isSafeInteger(page.start) ||
    page.start > 2147483647 ||
    page.limit < 1 ||
    page.limit > 1000
  ) {
    throw new Error("Start muss zwischen 0 und 2147483647, Limit zwischen 1 und 1000 liegen.");
  }
  return page;
}
