import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StaffTopbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getStaffQueue,
  setStatus,
  setProviderCount,
  postDemoSeed,
  postDemoReset,
  postVitalsSimulate,
  getDemoMode,
  ApiError,
  type StaffQueueItem,
} from "@/api/client";
import { UserCheck, CheckCircle, Copy, Activity, Radio } from "lucide-react";
import { motion } from "framer-motion";
import { LiveVitalsPanel } from "@/components/vitals/LiveVitalsPanel";

function formatVitals(v: StaffQueueItem["vitals_latest"]): string {
  if (!v) return "pending";
  const parts = [];
  if (v.spo2 != null) parts.push(`SpO2 ${v.spo2}%`);
  if (v.hr != null) parts.push(`HR ${v.hr} bpm`);
  if (v.temp_c != null) parts.push(`Temp ${v.temp_c} °C`);
  return parts.length ? parts.join(" • ") : "pending";
}

function copyHandoffNote(item: StaffQueueItem): string {
  const flags = (item.red_flags?.length ? item.red_flags.join(", ") : "none") || "none";
  return [
    "Token: " + (item.token || "-"),
    "Name: " + (item.full_name || "-"),
    "Chief complaint: " + (item.chief_complaint || "-"),
    "Symptoms: " + (item.symptoms || "-"),
    "Duration: " + (item.duration_text || "-"),
    "Cluster: " + (item.ai_cluster || "-"),
    "Red flags: " + flags,
    "Operational complexity: " + (item.ai_complexity || "-"),
    "Est visit: " + (item.ai_visit_duration ?? 0) + "-" + ((item.ai_visit_duration ?? 0) + 10) + " min",
    "Est wait: " + (item.estimated_wait_min ?? 0) + " min",
    "Suggested resources: " + (item.suggested_resources?.join(", ") || "-"),
  ].join("\n");
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

export function Staff() {
  const navigate = useNavigate();
  const [demoMode, setDemoMode] = useState(false);
  const [data, setData] = useState<{
    items: StaffQueueItem[];
    provider_count: number;
    avg_wait_min?: number;
    lane_counts?: { Fast?: number; Standard?: number; Complex?: number };
  } | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [liveVitalsPatient, setLiveVitalsPatient] = useState<StaffQueueItem | null>(null);

  const load = () => {
    getStaffQueue()
      .then((d) => setData({
        items: d.items,
        provider_count: d.provider_count,
        avg_wait_min: d.avg_wait_min,
        lane_counts: d.lane_counts,
      }))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          navigate("/staff/login", { replace: true });
          return;
        }
        setData(null);
      });
    getDemoMode().then((d) => setDemoMode(d.demo_mode)).catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);

  const updateStatus = async (pid: string, status: string) => {
    setUpdating(pid);
    try {
      await setStatus(pid, status);
      load();
    } finally {
      setUpdating(null);
    }
  };

  const setProviders = async (n: number) => {
    try {
      await setProviderCount(n);
      load();
    } catch {}
  };

  const handleSeedDemo = () => {
    postDemoSeed().then(load).catch(() => {});
  };

  const handleReset = () => {
    if (!window.confirm("Reset all patients and demo data?")) return;
    postDemoReset().then(load).catch(() => {});
  };

  const handleCopyNote = (item: StaffQueueItem) => {
    copyToClipboard(copyHandoffNote(item)).then(() => alert("Handoff note copied."));
  };

  const handleSimVitals = (pid: string) => {
    postVitalsSimulate(pid).then(load).catch(() => {});
  };

  if (!data) {
    return (
      <>
        <StaffTopbar />
        <main className="mx-auto max-w-4xl px-4 py-8">
          <p className="text-muted-foreground">Loading…</p>
        </main>
      </>
    );
  }

  const lc = data.lane_counts || {};
  const laneMix = `Fast ${lc.Fast ?? 0} • Standard ${lc.Standard ?? 0} • Complex ${lc.Complex ?? 0}`;

  return (
    <>
      <StaffTopbar demoMode={demoMode} />
      {liveVitalsPatient && (
        <LiveVitalsPanel
          pid={liveVitalsPatient.id}
          token={liveVitalsPatient.token}
          fullName={liveVitalsPatient.full_name}
          onClose={() => setLiveVitalsPatient(null)}
        />
      )}
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm">Providers Available</CardTitle>
              <span className="text-3xl font-bold">{data.provider_count}</span>
            </CardHeader>
            <CardContent>
              <label className="text-muted-foreground text-sm">Provider count</label>
              <select
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                value={data.provider_count}
                onChange={(e) => setProviders(Number(e.target.value))}
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm">Current Queue</CardTitle>
              <span className="text-3xl font-bold">{data.items.length}</span>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm">Average Wait / Lane Mix</CardTitle>
              <span className="text-2xl font-bold">{data.avg_wait_min ?? 0} min</span>
              <p className="text-muted-foreground text-xs">{laneMix}</p>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardContent className="flex flex-wrap gap-2 pt-6">
            <Button variant="secondary" onClick={handleSeedDemo}>Seed demo patients</Button>
            <Button variant="destructive" onClick={handleReset}>Reset</Button>
          </CardContent>
        </Card>

        <h2 className="text-xl font-semibold">Live Staff Queue</h2>
        <div className="space-y-4">
          {data.items.length === 0 && (
            <Card>
              <CardContent className="py-6 text-muted-foreground text-center">No patients in queue.</CardContent>
            </Card>
          )}
          {data.items.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span className="font-mono font-bold">{item.token}</span>
                  <span className="ml-2 text-muted-foreground text-sm">{item.full_name ?? "—"}</span>
                  <br />
                  <span className={`mr-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    item.status === "waiting" ? "bg-blue-100 text-blue-800" :
                    item.status === "called" ? "bg-amber-100 text-amber-800" :
                    item.status === "in_room" ? "bg-green-100 text-green-800" : "bg-muted text-muted-foreground"
                  }`}>
                    {item.status_label ?? item.status}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{item.lane ?? "Standard"} lane</span>
                  <span className="ml-2 text-muted-foreground text-xs">Est wait {item.estimated_wait_min ?? 0} min</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="default" disabled={updating === item.id} onClick={() => updateStatus(item.id, "called")}>
                    <UserCheck className="mr-1 h-4 w-4" /> Call
                  </Button>
                  <Button size="sm" variant="default" disabled={updating === item.id} onClick={() => updateStatus(item.id, "in_room")}>
                    <UserCheck className="mr-1 h-4 w-4" /> In Room
                  </Button>
                  <Button size="sm" variant="secondary" disabled={updating === item.id} onClick={() => updateStatus(item.id, "done")}>
                    <CheckCircle className="mr-1 h-4 w-4" /> Done
                  </Button>
                  <Button size="sm" variant="secondary" disabled={updating === item.id} onClick={() => handleSimVitals(item.id)}>
                    <Activity className="mr-1 h-4 w-4" /> Sim Vitals
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleCopyNote(item)}>
                    <Copy className="mr-1 h-4 w-4" /> Copy Note
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setLiveVitalsPatient(item)}>
                    <Radio className="mr-1 h-4 w-4" /> Live Vitals
                  </Button>
                </div>
              </div>
              <hr className="my-3 border-border" />
              <div className="text-sm">
                <p><strong>Chief complaint:</strong> {item.chief_complaint ?? "—"}</p>
                <p><strong>Symptoms:</strong> {item.symptoms ?? "—"}</p>
                {item.symptom_list?.length ? (
                  <ul className="list-inside list-disc text-muted-foreground">{item.symptom_list.map((s, j) => <li key={j}>{s}</li>)}</ul>
                ) : null}
                <p className="text-muted-foreground"><strong>Duration:</strong> {item.duration_text ?? "—"}</p>
                <p className="text-muted-foreground">
                  <strong>Red flags:</strong>{" "}
                  {item.red_flags?.length ? (
                    <span className="rounded bg-destructive/20 px-1.5 py-0.5 text-destructive">{item.red_flags.join(", ")}</span>
                  ) : (
                    "none detected"
                  )}
                </p>
              </div>
              <Card className="mt-3 bg-muted/30">
                <CardContent className="py-3 text-sm">
                  <strong>AI Structured Intake (Operational, non-diagnostic)</strong>
                  <p className="text-muted-foreground">Cluster: {item.ai_cluster ?? "—"}</p>
                  <p className="text-muted-foreground">Complexity: {item.ai_complexity ?? "—"}</p>
                  <p className="text-muted-foreground">Estimated visit: {item.ai_visit_duration ?? 0}-{(item.ai_visit_duration ?? 0) + 10} min</p>
                  <p className="text-muted-foreground">Estimated wait: {item.estimated_wait_min ?? 0} min</p>
                  <p className="text-muted-foreground">Vitals: {formatVitals(item.vitals_latest)}</p>
                  {item.suggested_resources?.length ? (
                    <p className="text-muted-foreground">Suggested resources: {item.suggested_resources.join(", ")}</p>
                  ) : null}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </main>
    </>
  );
}
