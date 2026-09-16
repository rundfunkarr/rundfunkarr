import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const encodedUrl = searchParams.get("encodedUrl");
  const encodedTitle = searchParams.get("encodedTitle");

  if (!encodedUrl || !encodedTitle) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  if (
    [encodedUrl, encodedTitle].some(
      (value) =>
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) ||
        Buffer.from(value, "base64").toString("base64") !== value
    )
  ) {
    return NextResponse.json({ error: "Invalid base64 string" }, { status: 400 });
  }

  // Embed the still-base64-encoded values, not the decoded URL/title.
  // Real-world source URLs (confirmed live: ORF's own CDN naming, e.g.
  // ".../BOesterreich--6_..." ) can contain "--", which is illegal inside
  // an XML comment ("An XML comment cannot contain '--'") - Sonarr/Radarr
  // validate the fetched .nzb as XML before ever handing it back to
  // addToQueue(), so a raw "--" in the URL broke every such release with
  // no way to work around it downstream. Standard base64's alphabet
  // (A-Za-z0-9+/=) never produces "--", so encoding sidesteps the whole
  // problem instead of trying to escape it (XML comments have no escape
  // mechanism for "--"). parseNzbContent() in services/download.ts
  // base64-decodes what it extracts from the comment to match.
  const nzbContent = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.0//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.0.dtd">
<!-- ${encodedTitle} -->
<!-- ${encodedUrl} -->
<nzb>
    <file post_id="1">
        <groups>
            <group>a.b.zdf</group>
        </groups>
        <segments>
            <segment number="1">ExampleSegmentID@news.example.com</segment>
        </segments>
    </file>
</nzb>`;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `rundfunk-${timestamp}.nzb`;

  return new NextResponse(nzbContent, {
    status: 200,
    headers: {
      "Content-Type": "application/x-nzb",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
