"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  const [historyPage, setHistoryPage] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const pageSize = 50;
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const [queueRes, historyRes] = await Promise.all([
        fetch("/api/download?mode=queue"),
        fetch(`/api/download?mode=history&start=${page * pageSize}&limit=${pageSize}`),
      ]);
      if (!queueRes.ok || !historyRes.ok) throw new Error("Downloads konnten nicht geladen werden.");
      const queueData = await queueRes.json();
      const historyData = await historyRes.json();
      if (sequence !== requestSequence.current) return;
      const count = historyData.history?.noofslots ?? 0;
      setTotal(count);
      if (page > 0 && page * pageSize >= count) {
        setPage(Math.max(0, Math.ceil(count / pageSize) - 1));
        return;
      }
      setError(null);
      setQueue(queueData.queue?.slots || []);
      setHistory(historyData.history?.slots || []);
      setHistoryPage(page);
      setLastRefresh(new Date());
    } catch (error) {
      if (sequence === requestSequence.current) setError(error instanceof Error ? error.message : "Laden fehlgeschlagen.");
    } finally {
      if (sequence === requestSequence.current) setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => { clearInterval(interval); requestSequence.current++; };
  }, [fetchData, refreshVersion]);

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
        setRefreshVersion((version) => version + 1);
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
        setRefreshVersion((version) => version + 1);
      }
    } catch (error) {
      console.error("Retry failed:", error);
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Downloads</h1>
          <p className="text-muted-foreground text-sm">Verwalte deine Downloads</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground" suppressHydrationWarning>
            Aktualisiert: {lastRefresh.toLocaleTimeString("de-DE")}
          </span>
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Aktualisieren
          </Button>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {/* Tabs */}
      <Card>
        <CardHeader>
          <CardTitle>Download-Verwaltung</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="queue">
            <TabsList className="mb-4">
              <TabsTrigger value="queue">Queue ({queue.length})</TabsTrigger>
              <TabsTrigger value="history">Historie ({total})</TabsTrigger>
            </TabsList>

            <TabsContent value="queue">
              {isLoading ? (
                <p className="text-muted-foreground text-center py-8">Laden...</p>
              ) : queue.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">Keine aktiven Downloads</p>
              ) : (
                <div className="min-w-0">
                  <Table scrollLabel="Warteschlange" className="min-w-[52rem]">
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
              <nav aria-label="Historienseiten" className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {total === 0 ? "0 Einträge" : `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)} von ${total} Einträgen`}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Zurück</Button>
                  <Button variant="outline" size="sm" disabled={(page + 1) * pageSize >= total} onClick={() => setPage(page + 1)}>Weiter</Button>
                </div>
              </nav>
              {historyPage !== page ? (
                <p className="text-muted-foreground text-center py-8">
                  {error ? "Historie konnte nicht geladen werden." : "Laden..."}
                </p>
              ) : history.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  Keine Downloads in der Historie
                </p>
              ) : (
                <div className="min-w-0">
                  <Table scrollLabel="Download-Historie" className="min-w-[44rem]">
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
