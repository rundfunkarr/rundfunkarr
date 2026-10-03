import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  subscriptionInput,
  saveSubscription,
  checkSubscription,
  downloadSubscriptionMatch,
} from "@/server/subscriptions";
import { z } from "zod";
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    const offset = Number(request.nextUrl.searchParams.get("offset") || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 2147483647)
      return NextResponse.json({ error: "Ungültige Ergebnisseite." }, { status: 400 });
    const where = { subscriptionId: id, state: { not: "baseline" } };
    const [matches, total] = await prisma.$transaction([
      prisma.subscriptionMatch.findMany({
        where,
        orderBy: [{ foundAt: "desc" }, { id: "desc" }],
        skip: offset,
        take: 50,
      }),
      prisma.subscriptionMatch.count({ where }),
    ]);
    return NextResponse.json({ matches, total });
  }
  const subscriptions = await prisma.searchSubscription.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { matches: { where: { state: "new" } } } } },
  });
  return NextResponse.json({ subscriptions });
}
const command = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    id: z.string().uuid().optional(),
    input: subscriptionInput,
  }),
  z.object({ action: z.literal("pause"), id: z.string().uuid(), paused: z.boolean() }),
  z.object({ action: z.enum(["check", "delete", "download", "dismiss"]), id: z.string().uuid() }),
]);
export async function POST(request: NextRequest) {
  const input = command.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      {
        error: "Bitte Name, Suchbegriff, Laufzeiten und Intervall (mindestens 15 Minuten) prüfen.",
      },
      { status: 400 }
    );
  const body = input.data;
  try {
    if (body.action === "save") {
      const item = await saveSubscription(body.input, body.id);
      await checkSubscription(item.id);
      return NextResponse.json({ id: item.id });
    }
    if (body.action === "pause")
      await prisma.searchSubscription.update({
        where: { id: body.id },
        data: { paused: body.paused, ...(!body.paused ? { nextCheckAt: new Date() } : {}) },
      });
    else if (body.action === "check") await checkSubscription(body.id);
    else if (body.action === "delete")
      await prisma.searchSubscription.delete({ where: { id: body.id } });
    else if (body.action === "download")
      return NextResponse.json({ downloadId: await downloadSubscriptionMatch(body.id) });
    else
      await prisma.subscriptionMatch.updateMany({
        where: { id: body.id, state: "new" },
        data: { state: "dismissed" },
      });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Das Suchabo oder der Treffer konnte nicht geändert werden. Bitte neu laden." },
      { status: 409 }
    );
  }
}
