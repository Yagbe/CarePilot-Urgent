import { useEffect, useState, useCallback } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, CardContent } from "@/components/ui/card";
import { getQueue, getLobbyLoad, type PublicQueueItem } from "@/api/client";
import { motion } from "framer-motion";

function freshnessLabel(updatedAt?: string): string {
  if (!updatedAt) return "Updated just now";
  const then = new Date(updatedAt).getTime();
  if (!then) return "Updated just now";
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  return `Updated ${sec}s ago`;
}

export function Display() {
  const [queue, setQueue] = useState<PublicQueueItem[]>([]);
  const [lobby, setLobby] = useState({ level: "Low", queue_size: 0 });

  const loadQueue = useCallback(() => {
    getQueue().then(setQueue).catch(() => setQueue([]));
  }, []);
  const loadLobby = useCallback(() => {
    getLobbyLoad().then(setLobby).catch(() => {});
  }, []);

  useEffect(() => {
    loadQueue();
    loadLobby();
    const t1 = setInterval(loadQueue, 2000);
    const t2 = setInterval(loadLobby, 4000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  }, [loadQueue, loadLobby]);

  useEffect(() => {
    let ws: WebSocket;
    let timeout: ReturnType<typeof setTimeout>;
    function connect() {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${window.location.host}/ws/queue`);
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string);
          if (payload?.items) setQueue(payload.items);
        } catch {}
      };
      ws.onclose = () => {
        timeout = setTimeout(connect, 1200);
      };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => {
      clearTimeout(timeout);
      ws?.close();
    };
  }, []);

  const statusColor = (s: string) => {
    if (s === "called") return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200";
    if (s === "in_room") return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200";
    if (s === "done") return "bg-muted text-muted-foreground";
    return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200";
  };

  const priorityColor = (p?: string) => {
    if (p === "high") return "bg-red-500 text-white";
    if (p === "medium") return "bg-orange-500 text-white";
    return "bg-yellow-500 text-yellow-950";
  };

  const nextItem = queue.length > 0 ? queue[0] : null;
  const announcement = nextItem
    ? nextItem.priority === "high"
      ? `${nextItem.token} — High Priority — Please proceed to Emergency. A doctor is being notified.`
      : nextItem.priority === "medium"
        ? `${nextItem.token} — Medium Priority — Please proceed to the waiting room. You will be called when ready.`
        : `${nextItem.token} — Please proceed to the waiting room. You will be called when ready.`
    : null;

  return (
    <>
      <Topbar />
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        <h1 className="text-2xl font-bold">Waiting Room Display</h1>
        <p className="text-muted-foreground text-sm">Token-only queue (privacy-safe). Real-time updates enabled.</p>
        <p className="text-muted-foreground text-xs">This screen contains no medical details.</p>

        {announcement && (
          <Card className="border-2 border-primary bg-primary/5">
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-sm font-medium mb-1">Now calling</p>
              <p className="text-xl font-bold">{announcement}</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="flex items-baseline justify-between pt-6">
            <span className="text-muted-foreground text-sm">Lobby Occupancy</span>
            <span className="text-2xl font-bold">
              {lobby.level} ({lobby.queue_size} waiting)
            </span>
          </CardContent>
        </Card>
        <div className="space-y-3">
          {queue.length === 0 && (
            <Card>
              <CardContent className="py-6 text-center text-muted-foreground">No patients currently in queue.</CardContent>
            </Card>
          )}
          {queue.map((item, i) => (
            <motion.div
              key={item.token}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <Card className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-mono text-xl font-bold">{item.token}</p>
                      {item.priority && (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityColor(item.priority)}`}>
                          {item.priority === "high" ? "High" : item.priority === "medium" ? "Medium" : "Low"}
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground text-sm">
                      Estimated wait: {item.estimated_wait_min ?? 0} min
                    </p>
                    <p className="text-muted-foreground text-sm">
                      Position: #{item.position_in_line ?? "—"} • Providers: {item.providers_active ?? "—"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {item.eta_explanation ?? ""} • {freshnessLabel(item.updated_at)}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusColor(item.status)}`}>
                    {item.status_label ?? item.status.replace("_", " ")}
                  </span>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </main>
    </>
  );
}
