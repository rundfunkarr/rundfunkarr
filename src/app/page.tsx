"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import packageJson from "../../package.json";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Search, ArrowRight, RefreshCw } from "lucide-react";
import { formatSize, formatDateShort } from "@/lib/formatters";
import { getStatusBadge } from "@/components/shared/status-badge";

interface QueueSlot {
  nzo_id: string;
  filename: string;
  status: string;
  percentage: string;
  timeleft: string;
  mb: string;
  mbleft: string;
  speed: string;
}

interface HistorySlot {
  nzo_id: string;
  name: string;
  status: string;
  completed: number;
  bytes: number;
}

export default function Dashboard() {
  const [queue, setQueue] = useState<QueueSlot[]>([]);
  const [history, setHistory] = useState<HistorySlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [queueRes, historyRes] = await Promise.all([
        fetch("/api/download?mode=queue"),
        fetch("/api/download?mode=history&limit=5"),
      ]);
      const queueData = await queueRes.json();
      const historyData = await historyRes.json();
      setQueue(queueData.queue?.slots || []);
      setHistory((historyData.history?.slots || []).slice(0, 5));
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm">Willkommen bei RundfunkArr</p>
        </div>
        <Badge variant="outline" className="text-xs">
          v{packageJson.version}
        </Badge>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/search">
          <Card className="hover:bg-accent/50 transition-colors cursor-pointer h-full">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <Search className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-medium">Mediathek durchsuchen</h3>
                <p className="text-sm text-muted-foreground">Finde Sendungen in der Mediathek</p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/downloads">
          <Card className="hover:bg-accent/50 transition-colors cursor-pointer h-full">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <Download className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-medium">Downloads verwalten</h3>
                <p className="text-sm text-muted-foreground">
                  {queue.length} aktiv, {history.length > 0 ? `${history.length}+` : "0"} in History
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Active Downloads */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Aktive Downloads</CardTitle>
            <Button variant="ghost" size="sm" onClick={fetchData}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-center py-4">Laden...</p>
          ) : queue.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">Keine aktiven Downloads</p>
          ) : (
            <div className="space-y-3">
              {queue.map((item) => (
                <div
                  key={item.nzo_id}
                  className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{item.filename}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {getStatusBadge(item.status)}
                      <span className="text-xs text-muted-foreground">
                        {item.speed} - {item.timeleft} verbleibend
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{item.percentage}%</p>
                    <p className="text-xs text-muted-foreground">{item.mb} MB</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Letzte Aktivitäten</CardTitle>
            <Link href="/downloads">
              <Button variant="ghost" size="sm">
                Alle anzeigen
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">Keine Downloads in der History</p>
          ) : (
            <div className="space-y-2">
              {history.map((item) => (
                <div
                  key={item.nzo_id}
                  className="flex items-center justify-between p-2 hover:bg-muted/50 rounded-lg"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {getStatusBadge(item.status)}
                    <span className="truncate">{item.name}</span>
                  </div>
                  <div className="text-sm text-muted-foreground whitespace-nowrap ml-2">
                    {formatDateShort(item.completed)} - {formatSize(item.bytes)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
