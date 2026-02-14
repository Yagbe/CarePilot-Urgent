import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getVitalsForPatient, type VitalsReading } from "@/api/client";
import { X, Radio } from "lucide-react";

type Props = {
  pid: string;
  token: string;
  fullName?: string;
  onClose: () => void;
};

function formatTs(ts?: string): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return ts;
  }
}

export function LiveVitalsPanel({ pid, token, fullName, onClose }: Props) {
  const [vitals, setVitals] = useState<VitalsReading | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      getVitalsForPatient(pid)
        .then((r) => {
          if (!cancelled) {
            setVitals(r.vitals ?? null);
            setError("");
          }
        })
        .catch(() => {
          if (!cancelled) setError("Could not load vitals.");
        });
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [pid]);

  return (
    <Card className="fixed right-4 top-24 z-50 w-full max-w-sm border-2 border-primary shadow-lg">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b bg-primary/10 pb-3">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-destructive" />
          <CardTitle className="text-base">Live Vitals</CardTitle>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="h-5 w-5" />
        </Button>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="mb-2 flex items-center gap-2 rounded bg-destructive/15 px-2 py-1 text-destructive">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-destructive" />
          <span className="text-sm font-medium">Recording live – shared with doctor</span>
        </div>
        <p className="text-muted-foreground text-sm">
          <strong>{token}</strong> {fullName && `· ${fullName}`}
        </p>
        {error && <p className="mt-2 text-destructive text-sm">{error}</p>}
        {!vitals && !error && (
          <p className="mt-3 text-muted-foreground text-sm">Waiting for vitals from kiosk…</p>
        )}
        {vitals && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {vitals.spo2 != null && (
              <div className="rounded-lg bg-muted/50 p-2">
                <p className="text-muted-foreground text-xs">SpO2</p>
                <p className="text-xl font-bold">{vitals.spo2}%</p>
              </div>
            )}
            {vitals.hr != null && (
              <div className="rounded-lg bg-muted/50 p-2">
                <p className="text-muted-foreground text-xs">Heart rate</p>
                <p className="text-xl font-bold">{vitals.hr} bpm</p>
              </div>
            )}
            {vitals.temp_c != null && (
              <div className="rounded-lg bg-muted/50 p-2">
                <p className="text-muted-foreground text-xs">Temp</p>
                <p className="text-xl font-bold">{vitals.temp_c} °C</p>
              </div>
            )}
            {(vitals.bp_sys != null || vitals.bp_dia != null) && (
              <div className="rounded-lg bg-muted/50 p-2">
                <p className="text-muted-foreground text-xs">BP</p>
                <p className="text-xl font-bold">
                  {vitals.bp_sys ?? "—"} / {vitals.bp_dia ?? "—"}
                </p>
              </div>
            )}
          </div>
        )}
        <p className="mt-3 text-muted-foreground text-xs">Last updated: {formatTs(vitals?.ts)}</p>
      </CardContent>
    </Card>
  );
}
