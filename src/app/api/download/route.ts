import { handleQueueCommand } from "@/server/sabnzbd-queue-control";
import { NextRequest, NextResponse } from "next/server";
import { addNzb } from "@/server/add-nzb";
import {
  getQueue,
  getHistory,
  deleteHistoryItem,
  getConfigResponse,
  retryDownload,
} from "@/services/download";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("mode");
  const name = searchParams.get("name");
  const value = searchParams.get("value");
  const delFiles = searchParams.get("del_files") === "1";

  const command = await handleQueueCommand(searchParams);
  if (command) return command;

  switch (mode) {
    case "version":
      return NextResponse.json({ version: "4.3.3" });

    case "get_config":
      return NextResponse.json(await getConfigResponse());

    case "queue": {
      const queue = await getQueue();
      return NextResponse.json({ queue });
    }

    case "history": {
      // Handle history deletion
      if (name === "delete" && value) {
        const isDeleted = await deleteHistoryItem(value, delFiles);
        if (isDeleted) {
          return NextResponse.json({ status: true });
        }
        return NextResponse.json({ status: false, error: "Item not found" }, { status: 404 });
      }

      // Handle retry
      if (name === "retry" && value) {
        const result = await retryDownload(value);
        if (result) {
          return NextResponse.json({ status: true, nzo_id: result.id });
        }
        return NextResponse.json({ status: false, error: "Item not found" }, { status: 404 });
      }

      // Return history list
      const history = await getHistory();
      return NextResponse.json({ history });
    }

    default:
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  return addNzb(request);
}
