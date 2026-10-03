"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { RefreshCw, X, RotateCcw } from "lucide-react";
import { formatSize } from "@/lib/formatters";
import { getStatusBadge } from "@/components/shared/status-badge";

interface QueueSlot {
  nzo_id: string;
  filename: string;
  status: string;
  percentage: string;
  timeleft: string;
  cat: string;
  mb: string;
  mbleft: string;
  speed: string;
}

interface HistorySlot {
  nzo_id: string;
  name: string;
  status: string;
  completed: number;
  category: string;
  storage: string;
  bytes: number;
  fail_message: string;
  warning?: string;
}

export default function DownloadsPage() {
  const [queue, setQueue] = useState<QueueSlot[]>([]);
  const [history, setHistory] = useState<HistorySlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    try {
      const [queueRes, historyRes] = await Promise.all([
        fetch("/api/download?mode=queue"),
        fetch("/api/download?mode=history"),
      ]);
      const queueData = await queueRes.json();
      const historyData = await historyRes.json();
      setQueue(queueData.queue?.slots || []);
      setHistory(historyData.history?.slots || []);
      setLastRefresh(new Date());
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

  const handleDelete = async (nzoId: string, delFiles: boolean = false) => {
    try {
      const res = await fetch(
        `/api/download?mode=history&name=delete&value=${nzoId}&del_files=${delFiles ? 1 : 0}`
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.status) {
        fetchData();
      }
    } catch (error) {
      console.error("Delete failed:", error);
    }
  };

  const handleRetry = async (nzoId: string) => {
    try {
      const res = await fetch(`/api/download?mode=history&name=retry&value=${nzoId}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.status) {
        fetchData();
      }
    } catch (error) {
      console.error("Retry failed:", error);
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Downloads</h1>
          <p className="text-muted-foreground text-sm">Verwalte deine Downloads</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground" suppressHydrationWarning>
            Aktualisiert: {lastRefresh.toLocaleTimeString("de-DE")}
          </span>
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Aktualisieren
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Card>
        <CardHeader>
          <CardTitle>Download-Verwaltung</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="queue">
            <TabsList className="mb-4">
              <TabsTrigger value="queue">Queue ({queue.length})</TabsTrigger>
              <TabsTrigger value="history">History ({history.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="queue">
              {isLoading ? (
                <p className="text-muted-foreground text-center py-8">Laden...</p>
              ) : queue.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">Keine aktiven Downloads</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Fortschritt</TableHead>
                        <TableHead>Größe</TableHead>
                        <TableHead>Geschw.</TableHead>
                        <TableHead>Verbleibend</TableHead>
                        <TableHead className="w-20">Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {queue.map((item) => (
                        <TableRow key={item.nzo_id}>
                          <TableCell className="font-medium max-w-xs truncate">
                            {item.filename}
                          </TableCell>
                          <TableCell>{getStatusBadge(item.status)}</TableCell>
                          <TableCell>{item.percentage}%</TableCell>
                          <TableCell>{item.mb} MB</TableCell>
                          <TableCell>{item.speed}</TableCell>
                          <TableCell>{item.timeleft}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(item.nzo_id)}
                              title="Abbrechen"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="history">
              {history.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  Keine Downloads in der History
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Abgeschlossen</TableHead>
                        <TableHead>Größe</TableHead>
                        <TableHead className="w-24">Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((item) => (
                        <TableRow key={item.nzo_id}>
                          <TableCell className="font-medium max-w-xs">
                            <span className="truncate block">{item.name}</span>
                            {item.warning && <span className="text-xs text-amber-500">{item.warning}</span>}
                            {item.fail_message && (
                              <span className="text-xs text-destructive">{item.fail_message}</span>
                            )}
                          </TableCell>
                          <TableCell>{getStatusBadge(item.status)}</TableCell>
                          <TableCell>
                            {new Date(item.completed * 1000).toLocaleDateString("de-DE", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </TableCell>
                          <TableCell>{formatSize(item.bytes)}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {item.status.toLowerCase() === "failed" && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleRetry(item.nzo_id)}
                                  title="Erneut versuchen"
                                >
                                  <RotateCcw className="w-4 h-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(item.nzo_id, true)}
                                title="Löschen"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
