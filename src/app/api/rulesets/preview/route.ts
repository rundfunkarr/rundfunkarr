import { NextRequest, NextResponse } from "next/server";
import { rulesetInput, inputToRuleset } from "@/lib/ruleset-input";
import { queryContent } from "@/services/content-search";
import { getShowInfoByTvdbId } from "@/services/shows";
import { diagnoseRuleset } from "@/services/mediathek";
import { isRulesetRegexError } from "@/server/ruleset-regex";

export async function POST(request: NextRequest) {
  const input = rulesetInput.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json({ error: "Bitte TVDB-ID, Thema und Regeln prüfen." }, { status: 400 });
  try {
    const show = await getShowInfoByTvdbId(input.data.tvdbId);
    if (!show)
      return NextResponse.json(
        { error: "Keine Serienmetadaten verfügbar. TVDB-ID und Metadaten-Zugang prüfen." },
        { status: 422 }
      );
    const candidates = await queryContent([{ fields: ["topic"], query: input.data.topic }], 30, {
      deduplicate: false,
    });
    if (candidates === null)
      return NextResponse.json(
        { error: "Die Mediathek ist derzeit nicht erreichbar." },
        { status: 502 }
      );
    const rule = inputToRuleset(input.data, show.name);
    const exact = candidates.filter((item) => item.topic === rule.topic);
    const other = candidates.filter((item) => item.topic !== rule.topic);
    const results = [];
    for (const item of [...exact, ...other].slice(0, 30))
      results.push(await diagnoseRuleset(item, rule, show));
    return NextResponse.json({
      show: show.germanName || show.name,
      topic: rule.topic,
      limit: 30,
      results,
    });
  } catch (error) {
    if (isRulesetRegexError(error))
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "timeout" || error.code === "too-large" ? 422 : 503 }
      );
    return NextResponse.json(
      { error: "Die Vorschau konnte nicht erstellt werden." },
      { status: 500 }
    );
  }
}
