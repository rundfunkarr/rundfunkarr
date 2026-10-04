import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { controlDownload, setQueuePaused } from "./download-queue";

export async function handleQueueCommand(params: URLSearchParams): Promise<NextResponse | null> {
  const mode = params.get("mode");
  const name = params.get("name");
  if (mode === "pause" || mode === "resume") {
    await setQueuePaused(mode === "pause");
    return NextResponse.json({ status: true });
  }
  if (mode !== "queue" || !name) return null;
  const id = params.get("value");
  if (!id || !["pause", "resume", "delete", "priority"].includes(name))
    return NextResponse.json({ status: false, error: "Ungültige Queue-Aktion." });
  const priority = Number(params.get("value2"));
  if (name === "priority" && (!params.has("value2") || ![-100, -2, -1, 0, 1].includes(priority)))
    return NextResponse.json({ status: false, error: "Ungültige Priorität." });
  const action =
    name === "delete"
      ? "cancel"
      : name === "priority" && priority === -2
        ? "pause"
        : (name as "pause" | "resume" | "priority");
  const status = await controlDownload(id, action, priority === -100 ? 0 : priority * 10);
  if (status && name === "priority") {
    const items = await prisma.download.findMany({
      where: { status: { in: ["queued", "paused", "downloading", "converting"] } },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ status: true, position: items.findIndex((item) => item.id === id) });
  }
  return NextResponse.json({
    status,
    nzo_ids: status ? [id] : [],
    ...(status ? {} : { error: "Auftrag nicht gefunden oder bereits abgeschlossen." }),
  });
}
