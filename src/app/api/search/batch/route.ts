import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enqueueSelection } from "@/services/advanced-search";
const schema = z.object({
  snapshot: z.string().uuid(),
  ids: z
    .array(z.string().uuid())
    .min(1)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length),
  quality: z.enum(["low", "standard", "high"]),
});
export async function POST(request: NextRequest) {
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "Bitte 1 bis 50 verschiedene Ergebnisse auswählen." },
      { status: 400 }
    );
  try {
    const results = await enqueueSelection(input.data.snapshot, input.data.ids, input.data.quality);
    if (!results)
      return NextResponse.json(
        { error: "Diese Suche ist abgelaufen. Bitte erneut suchen." },
        { status: 410 }
      );
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Die Auswahl ist ungültig." }, { status: 400 });
  }
}
