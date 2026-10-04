import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rulesetInput } from "@/lib/ruleset-input";
import {
  ensureRulesetsLoaded,
  getAllTopics,
  getRulesetsForTopic,
  reloadLocalRulesets,
} from "@/services/rulesets";
import { getShowInfoByTvdbId } from "@/services/shows";

export async function GET() {
  try {
    await ensureRulesetsLoaded();
    const local = await prisma.generatedRuleset.findMany({ orderBy: { updatedAt: "desc" } });
    const external = getAllTopics()
      .flatMap((topic) => getRulesetsForTopic(topic))
      .filter(
        (rule) =>
          !local.some(
            (saved) => saved.topic === rule.topic && saved.tvdbId === rule.media.media_tvdbId
          )
      );
    return NextResponse.json([
      ...local.map((rule) => ({ ...rule, source: "local" })),
      ...external.map((rule) => ({
        id: `community-${rule.id}-${rule.media.media_tvdbId}`,
        topic: rule.topic,
        tvdbId: rule.media.media_tvdbId,
        showName: rule.media.media_name,
        germanName: null,
        matchingStrategy: rule.matchingStrategy,
        filters: rule.filters,
        titleRegexRules: rule.titleRegexRules,
        seasonRegex: rule.seasonRegex || "",
        episodeRegex: rule.episodeRegex || "",
        updatedAt: null,
        source: "community",
      })),
    ]);
  } catch {
    return NextResponse.json({ error: "Regeln konnten nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const parsed = rulesetInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error: parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(" "),
      },
      { status: 400 }
    );
  try {
    const { id, ...input } = parsed.data;
    const show = await getShowInfoByTvdbId(input.tvdbId);
    if (!show)
      return NextResponse.json(
        { error: "Für diese TVDB-ID sind keine Serienmetadaten verfügbar." },
        { status: 422 }
      );
    const data = { ...input, showName: show.name, germanName: show.germanName };
    let rule;
    if (id && !id.startsWith("community-")) {
      const existing = await prisma.generatedRuleset.findUnique({ where: { id } });
      if (!existing)
        return NextResponse.json(
          { error: "Die lokale Regel wurde nicht gefunden." },
          { status: 404 }
        );
      rule = await prisma.generatedRuleset.update({ where: { id }, data });
    } else {
      const existing = await prisma.generatedRuleset.findUnique({ where: { topic: data.topic } });
      if (existing)
        return NextResponse.json(
          {
            error: "Für dieses Thema existiert bereits eine lokale Regel. Bitte diese bearbeiten.",
          },
          { status: 409 }
        );
      rule = await prisma.generatedRuleset.create({ data });
    }
    await reloadLocalRulesets();
    return NextResponse.json(rule);
  } catch (error) {
    const conflict =
      error && typeof error === "object" && "code" in error && error.code === "P2002";
    return NextResponse.json(
      {
        error: conflict
          ? "Für dieses Thema existiert bereits eine lokale Regel."
          : "Die Regel konnte nicht gespeichert werden.",
      },
      { status: conflict ? 409 : 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id || id.startsWith("community-"))
    return NextResponse.json(
      { error: "Nur lokale Regeln können gelöscht werden." },
      { status: 400 }
    );
  try {
    const result = await prisma.generatedRuleset.deleteMany({ where: { id } });
    if (!result.count)
      return NextResponse.json({ error: "Regel nicht gefunden." }, { status: 404 });
    await reloadLocalRulesets();
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Die Regel konnte nicht gelöscht werden." }, { status: 500 });
  }
}
