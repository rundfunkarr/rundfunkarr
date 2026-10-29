"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Select } from "@/components/ui/select";
import { Page, PageHeader } from "@/components/shared/page";
import { Field } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";
import { EmptyState } from "@/components/shared/empty-state";
import { Progress } from "@/components/shared/progress";
import { Download, History, RefreshCw, X, RotateCcw, Pause, Play } from "lucide-react";
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
  priorityValue: number;
  attempts: number;
  nextRetryAt: string | null;
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
  const [options, setOptions] = useState({ parallel: 1, maxRetries: 2, paused: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueSlot[]>([]);
  const [history, setHistory] = useState<HistorySlot[]>([]);
  const [historyPage, setHistoryPage] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [total, setTotal] = useState(0);
  const requestSequence = useRef(0);
  const pageSize = 50;
  const [isLoading, setIsLoading] = useState(true);
  // Starts empty so the first successful fetch always changes the rendered text.
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const [queueRes, historyRes, optionsRes] = await Promise.all([
        fetch("/api/download?mode=queue"),
        fetch(`/api/download?mode=history&start=${page * pageSize}&limit=${pageSize}`),
        fetch("/api/download/control"),
      ]);
      if (!queueRes.ok || !historyRes.ok || !optionsRes.ok)
        throw new Error("Downloads konnten nicht geladen werden.");
      const queueData = await queueRes.json();
      const historyData = await historyRes.json();
      const optionsData = await optionsRes.json();
      if (sequence !== requestSequence.current) return;
      const count = historyData.history?.noofslots ?? 0;
      setTotal(count);
      if (page > 0 && page * pageSize >= count) {
        setPage(Math.max(0, Math.ceil(count / pageSize) - 1));
        return;
      }
      setLoadError(null);
      setOptions(optionsData);
      setQueue(queueData.queue?.slots || []);
      setHistory(historyData.history?.slots || []);
      setHistoryPage(page);
      setLastRefresh(new Date());
    } catch (error) {
      if (sequence === requestSequence.current)
        setLoadError(error instanceof Error ? error.message : "Laden fehlgeschlagen.");
    } finally {
      if (sequence === requestSequence.current) setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    // Capture the ref object (not its value): cleanup must bump the latest counter so in-flight responses are ignored.
    const requests = requestSequence;
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => {
      clearInterval(interval);
      requests.current++;
    };
  }, [fetchData, refreshVersion]);

  const handleAction = async (action: string, extra: Record<string, string | number> = {}) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/download/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Die Aktion ist fehlgeschlagen.");
      setRefreshVersion((version) => version + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Die Aktion ist fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

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
    <Page>
      <PageHeader
        title="Downloads"
        description="Warteschlange steuern und die Historie nachvollziehen."
        actions={
          <>
            <span className="tabular font-mono text-xs text-muted-foreground">
              Stand {lastRefresh ? lastRefresh.toLocaleTimeString("de-DE") : "–"}
            </span>
            <Button variant="outline" size="sm" onClick={fetchData}>
              <RefreshCw />
              Aktualisieren
            </Button>
          </>
        }
      />

      {(error || loadError) && <Notice tone="danger">{error || loadError}</Notice>}

      <Card>
        <CardHeader>
          <CardTitle>Warteschlange steuern</CardTitle>
          <CardDescription>
            Einzeln pausierte Downloads stoppen sofort und beginnen beim Fortsetzen erneut.
            Netzwerkfehler werden mit wachsendem Abstand wiederholt. Nach einem Neustart werden
            unterbrochene Aufträge erneut eingeplant.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[13rem_15rem_minmax(0,1fr)] lg:items-end">
            <Field label="Parallele Downloads">
              {(id) => (
                <Select
                  id={id}
                  disabled={busy}
                  value={options.parallel}
                  onChange={(e) =>
                    handleAction("settings", {
                      parallel: Number(e.target.value),
                      maxRetries: options.maxRetries,
                    })
                  }
                >
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Automatische Wiederholungen">
              {(id) => (
                <Select
                  id={id}
                  disabled={busy}
                  value={options.maxRetries}
                  onChange={(e) =>
                    handleAction("settings", {
                      parallel: options.parallel,
                      maxRetries: Number(e.target.value),
                    })
                  }
                >
                  {[0, 1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      {value === 0 ? "Aus" : value}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-1">
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => handleAction(options.paused ? "resumeQueue" : "pauseQueue")}
              >
                {options.paused ? <Play /> : <Pause />}
                {options.paused ? "Warteschlange fortsetzen" : "Neue Starts pausieren"}
              </Button>
              <p className="text-sm text-muted-foreground" role="status">
                {options.paused
                  ? "Neue Aufträge warten. Laufende Downloads werden noch abgeschlossen."
                  : "Neue Aufträge starten nach ihrer Priorität."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <Tabs defaultValue="queue">
            <TabsList>
              <TabsTrigger value="queue">
                <Download />
                Warteschlange
                <span className="tabular text-xs text-muted-foreground">{queue.length}</span>
              </TabsTrigger>
              <TabsTrigger value="history">
                <History />
                Historie
                <span className="tabular text-xs text-muted-foreground">{total}</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="queue">
              {isLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Wird geladen…</p>
              ) : queue.length === 0 ? (
                <EmptyState
                  icon={Download}
                  title="Keine aktiven Downloads"
                  description="Aufträge aus Sonarr, Radarr, Suchabos oder der Suche erscheinen hier, sobald sie eingeplant sind."
                />
              ) : (
                <div className="min-w-0">
                  <Table scrollLabel="Warteschlange" className="min-w-[52rem]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Priorität</TableHead>
                        <TableHead>Fortschritt</TableHead>
                        <TableHead>Größe</TableHead>
                        <TableHead className="w-24 text-right">Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {queue.map((item) => {
                        const percent = Number(item.percentage) || 0;
                        return (
                          <TableRow key={item.nzo_id}>
                            <TableCell className="max-w-xs">
                              <span
                                className="block truncate font-mono text-xs"
                                title={item.filename}
                              >
                                {item.filename}
                              </span>
                            </TableCell>
                            <TableCell>
                              {getStatusBadge(item.nextRetryAt ? "Retrying" : item.status)}
                              {item.nextRetryAt && (
                                <p className="tabular mt-1 text-xs text-muted-foreground">
                                  Ab {new Date(item.nextRetryAt).toLocaleTimeString("de-DE")}
                                </p>
                              )}
                            </TableCell>
                            <TableCell>
                              <Select
                                aria-label={`Priorität für ${item.filename}`}
                                disabled={busy || !["Queued", "Paused"].includes(item.status)}
                                value={item.priorityValue || 0}
                                onChange={(e) =>
                                  handleAction("priority", {
                                    id: item.nzo_id,
                                    priority: Number(e.target.value),
                                  })
                                }
                                className="w-28"
                              >
                                <option value={10}>Hoch</option>
                                <option value={0}>Normal</option>
                                <option value={-10}>Niedrig</option>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Progress
                                  value={percent}
                                  label={`Fortschritt: ${item.filename}`}
                                  className="w-24"
                                />
                                <span className="tabular text-xs">{percent}%</span>
                              </div>
                              {(item.speed || (item.timeleft && item.timeleft !== "0:00:00")) && (
                                <p className="tabular mt-1 whitespace-nowrap text-xs text-muted-foreground">
                                  {[
                                    item.speed,
                                    item.timeleft && item.timeleft !== "0:00:00"
                                      ? `${item.timeleft} verbleibend`
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="tabular whitespace-nowrap">{item.mb} MB</TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  disabled={busy}
                                  title={item.status === "Paused" ? "Fortsetzen" : "Pausieren"}
                                  aria-label={`${item.status === "Paused" ? "Fortsetzen" : "Pausieren"}: ${item.filename}`}
                                  onClick={() =>
                                    handleAction(item.status === "Paused" ? "resume" : "pause", {
                                      id: item.nzo_id,
                                    })
                                  }
                                >
                                  {item.status === "Paused" ? <Play /> : <Pause />}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  disabled={busy}
                                  onClick={() => handleAction("cancel", { id: item.nzo_id })}
                                  aria-label={`Abbrechen: ${item.filename}`}
                                  title="Abbrechen"
                                >
                                  <X />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="history">
              <nav
                aria-label="Historienseiten"
                className="mb-4 flex flex-wrap items-center justify-between gap-3"
              >
                <p className="tabular text-sm text-muted-foreground" aria-live="polite">
                  {total === 0
                    ? "0 Einträge"
                    : `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)} von ${total} Einträgen`}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                  >
                    Zurück
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(page + 1) * pageSize >= total}
                    onClick={() => setPage(page + 1)}
                  >
                    Weiter
                  </Button>
                </div>
              </nav>
              {historyPage !== page ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {loadError ? "Historie konnte nicht geladen werden." : "Wird geladen…"}
                </p>
              ) : history.length === 0 ? (
                <EmptyState
                  icon={History}
                  title="Keine Downloads in der Historie"
                  description="Abgeschlossene, abgebrochene und fehlgeschlagene Aufträge erscheinen hier."
                />
              ) : (
                <div className="min-w-0">
                  <Table scrollLabel="Download-Historie" className="min-w-[44rem]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Abgeschlossen</TableHead>
                        <TableHead>Größe</TableHead>
                        <TableHead className="w-24 text-right">Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((item) => (
                        <TableRow key={item.nzo_id}>
                          <TableCell className="max-w-xs">
                            <span className="block truncate font-mono text-xs" title={item.name}>
                              {item.name}
                            </span>
                            {item.warning && (
                              <span className="mt-1 block text-xs text-warn">{item.warning}</span>
                            )}
                            {item.fail_message && (
                              <span className="mt-1 block text-xs text-danger">
                                {item.fail_message}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>{getStatusBadge(item.status)}</TableCell>
                          <TableCell className="tabular whitespace-nowrap">
                            {new Date(item.completed * 1000).toLocaleDateString("de-DE", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </TableCell>
                          <TableCell className="tabular whitespace-nowrap">
                            {formatSize(item.bytes)}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-0.5">
                              {["failed", "cancelled"].includes(item.status.toLowerCase()) && (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => handleRetry(item.nzo_id)}
                                  title="Erneut versuchen"
                                  aria-label={`Erneut versuchen: ${item.name}`}
                                >
                                  <RotateCcw />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => handleDelete(item.nzo_id, true)}
                                title="Löschen"
                                aria-label={`Löschen: ${item.name}`}
                              >
                                <X />
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
    </Page>
  );
}
