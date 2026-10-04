import { NextRequest, NextResponse } from "next/server";
import {
  advancedSearch,
  getSearchSnapshot,
  PAGE_SIZE,
  SEARCH_LIMIT,
  searchFilters,
} from "@/services/advanced-search";
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const offset = Number(params.get("offset") || 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > SEARCH_LIMIT)
    return NextResponse.json({ error: "Ungültige Ergebnisseite." }, { status: 400 });
  try {
    let snapshot = params.get("snapshot");
    let result;
    if (snapshot) result = getSearchSnapshot(snapshot);
    else {
      const input = searchFilters.safeParse(Object.fromEntries(params));
      if (!input.success)
        return NextResponse.json({ error: input.error.issues[0].message }, { status: 400 });
      const created = await advancedSearch(input.data);
      snapshot = created.id;
      result = created;
    }
    if (!result)
      return NextResponse.json(
        { error: "Diese Suche ist abgelaufen. Bitte erneut suchen." },
        { status: 410 }
      );
    return NextResponse.json({
      snapshot,
      results: result.results.slice(offset, offset + PAGE_SIZE),
      total: result.results.length,
      limited: result.limited,
      limit: SEARCH_LIMIT,
      hasMore: offset + PAGE_SIZE < result.results.length,
    });
  } catch {
    return NextResponse.json(
      { error: "Die Mediathek-Suche ist momentan nicht erreichbar. Bitte erneut versuchen." },
      { status: 502 }
    );
  }
}
