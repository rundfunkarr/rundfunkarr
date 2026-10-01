import { NextRequest, NextResponse } from "next/server";
import { addToQueue, parseNzbContent } from "@/services/download";

/** Handle both SABnzbd uploads and the web UI's raw NZB requests. */
export async function addNzb(request: NextRequest, sabnzbd = false) {
  const params = request.nextUrl.searchParams;
  const fail = (error: string, status = 400) => {
    // SABnzbd reports application errors with HTTP 200. Sonarr asks for JSON
    // and checks status:false; HTTP errors bypass that parser entirely.
    if (sabnzbd && params.get("output") !== "json") {
      return new NextResponse(`error: ${error}\n`, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return NextResponse.json({ status: false, error }, { status: sabnzbd ? 200 : status });
  };

  if (params.get("mode") !== "addfile") {
    return fail("Invalid mode");
  }

  let content: string;
  let fileName: string | undefined;
  try {
    if (request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("name");
      if (!file || typeof file === "string") {
        return fail("Missing NZB file");
      }
      content = await file.text();
      fileName = file.name;
    } else {
      content = await request.text();
    }
  } catch {
    return fail("Invalid NZB upload");
  }

  const parsed = parseNzbContent(content, fileName);
  if (!parsed) {
    return fail("Invalid NZB format");
  }

  try {
    // Preserve the client category: Sonarr filters queue/history by exact
    // match, including the empty category. Folder defaults belong on disk.
    const category = params.get("cat") ?? "";
    const item = await addToQueue(parsed.url, parsed.fileName, category);
    return NextResponse.json({ status: true, nzo_ids: [item.id] });
  } catch (error) {
    console.error("Error adding NZB:", error);
    return fail(error instanceof Error ? error.message : "Unknown error", 500);
  }
}
