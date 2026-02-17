import { useEffect, useRef, useState } from "react";
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
  postClaimBundle,
  postClaimSubmit,
  getClaimStatus,
} from "@/api/client";
import { UserCheck, CheckCircle, Copy, Activity, Radio } from "lucide-react";
import { motion } from "framer-motion";
import { LiveVitalsPanel } from "@/components/vitals/LiveVitalsPanel";
import { t, getLanguage, type Language } from "@/lib/i18n";

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
  const [billingPatient, setBillingPatient] = useState<StaffQueueItem | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingStatus, setBillingStatus] = useState<{ status: string; claimId?: string } | null>(null);
  const billingCardRef = useRef<HTMLDivElement>(null);
  const [lang, setLang] = useState<Language>(getLanguage());

  // Scroll billing panel into view when opened so it's visible below the queue
  useEffect(() => {
    if (billingPatient && billingCardRef.current) {
      billingCardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [billingPatient]);

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

  useEffect(() => {
    const handleStorage = () => setLang(getLanguage());
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
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
    if (!window.confirm(t("staff.resetConfirm", lang))) return;
    postDemoReset().then(load).catch(() => {});
  };

  const handleCopyNote = (item: StaffQueueItem) => {
    copyToClipboard(copyHandoffNote(item)).then(() => alert("Handoff note copied."));
  };

  const handleSimVitals = (pid: string) => {
    postVitalsSimulate(pid).then(load).catch(() => {});
  };

  const handleSimVitalsAll = () => {
    if (!data?.items?.length) return;
    Promise.all(data.items.map((item) => postVitalsSimulate(item.id))).then(load).catch(() => {});
  };

  if (!data) {
    return (
      <>
        <StaffTopbar />
        <main className="mx-auto max-w-4xl px-4 py-8">
          <p className="text-muted-foreground">{t("staff.loading", lang)}</p>
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
              <CardTitle className="text-muted-foreground text-sm">{t("staff.providersAvailable", lang)}</CardTitle>
              <span className="text-3xl font-bold">{data.provider_count}</span>
            </CardHeader>
            <CardContent>
              <label className="text-muted-foreground text-sm">{t("staff.providerCount", lang)}</label>
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
              <CardTitle className="text-muted-foreground text-sm">{t("staff.currentQueue", lang)}</CardTitle>
              <span className="text-3xl font-bold">{data.items.length}</span>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm">{t("staff.avgWaitLaneMix", lang)}</CardTitle>
              <span className="text-2xl font-bold">
                {t("staff.estimatedWait", lang)} {data.avg_wait_min ?? 0} min
              </span>
              <p className="text-muted-foreground text-xs">{laneMix}</p>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardContent className="flex flex-wrap gap-2 pt-6">
            <Button variant="secondary" onClick={handleSeedDemo}>{t("staff.seedDemo", lang)}</Button>
            <Button variant="secondary" onClick={handleSimVitalsAll} disabled={data.items.length === 0}>
              {t("staff.simVitalsAll", lang)}
            </Button>
            <Button variant="destructive" onClick={handleReset}>{t("staff.reset", lang)}</Button>
          </CardContent>
        </Card>

        <h2 className="text-xl font-semibold">{t("staff.liveQueueTitle", lang)}</h2>
        <div className="space-y-4">
          {data.items.length === 0 && (
            <Card>
              <CardContent className="py-6 text-muted-foreground text-center">
                {t("staff.noPatients", lang)}
              </CardContent>
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
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {t("staff.waitLane", lang).replace("{lane}", item.lane ?? "Standard")}
                  </span>
                  <span className="ml-2 text-muted-foreground text-xs">
                    {t("staff.estWait", lang).replace("{mins}", String(item.estimated_wait_min ?? 0))}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="default" disabled={updating === item.id} onClick={() => updateStatus(item.id, "called")}>
                    <UserCheck className="mr-1 h-4 w-4" /> {t("staff.call", lang)}
                  </Button>
                  <Button size="sm" variant="default" disabled={updating === item.id} onClick={() => updateStatus(item.id, "in_room")}>
                    <UserCheck className="mr-1 h-4 w-4" /> {t("staff.inRoom", lang)}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={updating === item.id} onClick={() => updateStatus(item.id, "done")}>
                    <CheckCircle className="mr-1 h-4 w-4" /> {t("staff.done", lang)}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={updating === item.id} onClick={() => handleSimVitals(item.id)}>
                    <Activity className="mr-1 h-4 w-4" /> {t("staff.simVitals", lang)}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleCopyNote(item)}>
                    <Copy className="mr-1 h-4 w-4" /> {t("staff.copyNote", lang)}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setLiveVitalsPatient(item)}>
                    <Radio className="mr-1 h-4 w-4" /> {t("staff.liveVitals", lang)}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setBillingPatient(item)}>
                    Billing
                  </Button>
                </div>
              </div>
              <hr className="my-3 border-border" />
              <div className="text-sm">
                <p>
                  <strong>{t("staff.chiefComplaint", lang)}</strong> {item.chief_complaint ?? "—"}
                </p>
                <p>
                  <strong>{t("staff.symptoms", lang)}</strong> {item.symptoms ?? "—"}
                </p>
                {item.symptom_list?.length ? (
                  <ul className="list-inside list-disc text-muted-foreground">{item.symptom_list.map((s, j) => <li key={j}>{s}</li>)}</ul>
                ) : null}
                <p className="text-muted-foreground">
                  <strong>{t("staff.duration", lang)}</strong> {item.duration_text ?? "—"}
                </p>
                <p className="text-muted-foreground">
                  <strong>{t("staff.redFlags", lang)}</strong>{" "}
                  {item.red_flags?.length ? (
                    <span className="rounded bg-destructive/20 px-1.5 py-0.5 text-destructive">{item.red_flags.join(", ")}</span>
                  ) : (
                    t("staff.noneDetected", lang)
                  )}
                </p>
              </div>
              <Card className="mt-3 bg-muted/30">
                <CardContent className="py-3 text-sm">
                  <strong>{t("staff.aiStructuredIntake", lang)}</strong>
                  <p className="text-muted-foreground">
                    {t("staff.cluster", lang)} {item.ai_cluster ?? "—"}
                  </p>
                  <p className="text-muted-foreground">
                    {t("staff.complexity", lang)} {item.ai_complexity ?? "—"}
                  </p>
                  <p className="text-muted-foreground">
                    {t("staff.estimatedVisit", lang)} {item.ai_visit_duration ?? 0}-{(item.ai_visit_duration ?? 0) + 10} min
                  </p>
                  <p className="text-muted-foreground">
                    {t("staff.estimatedWait", lang)} {item.estimated_wait_min ?? 0} min
                  </p>
                  <p className="text-muted-foreground">
                    {t("staff.vitals", lang)} {formatVitals(item.vitals_latest)}
                  </p>
                  {item.suggested_resources?.length ? (
                    <p className="text-muted-foreground">
                      {t("staff.suggestedResources", lang)} {item.suggested_resources.join(", ")}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {billingPatient && (
          <Card ref={billingCardRef} className="border-primary/30">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm">
                {t("staff.billingPreviewTitle", lang)} {billingPatient.token} ({billingPatient.full_name ?? "—"})
              </CardTitle>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setBillingPatient(null);
                  setBillingStatus(null);
                }}
              >
                {t("staff.close", lang)}
              </Button>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">{t("staff.billingDraft", lang)}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={billingLoading}
                  onClick={async () => {
                    if (!billingPatient) return;
                    setBillingLoading(true);
                    try {
                      const res = await postClaimBundle(billingPatient.id);
                      setBillingStatus({ status: res.status });
                    } catch (e) {
                      alert(e instanceof Error ? e.message : "Failed to build bundle");
                    } finally {
                      setBillingLoading(false);
                    }
                  }}
                >
                  {t("staff.buildBundle", lang)}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={billingLoading}
                  onClick={async () => {
                    if (!billingPatient) return;
                    setBillingLoading(true);
                    try {
                      const res = await postClaimSubmit(billingPatient.id);
                      setBillingStatus({ status: res.status, claimId: res.claim_id });
                    } catch (e) {
                      alert(e instanceof Error ? e.message : "Failed to submit claim");
                    } finally {
                      setBillingLoading(false);
                    }
                  }}
                >
                  {t("staff.submitClaim", lang)}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={billingLoading}
                  onClick={async () => {
                    if (!billingPatient) return;
                    setBillingLoading(true);
                    try {
                      const res = await getClaimStatus(billingPatient.id);
                      setBillingStatus({ status: res.status, claimId: res.claim_id });
                    } catch (e) {
                      alert(e instanceof Error ? e.message : "Failed to load claim status");
                    } finally {
                      setBillingLoading(false);
                    }
                  }}
                >
                  {t("staff.refreshStatus", lang)}
                </Button>
              </div>
              {billingStatus && (
                <p>
                  {t("staff.status", lang)}{" "}
                  <span className="font-semibold text-foreground">{billingStatus.status}</span>
                  {billingStatus.claimId ? ` • ${t("staff.claimId", lang)} ${billingStatus.claimId}` : null}
                </p>
              )}
              <p className="mt-1">
                {t("staff.billingDisclaimer", lang)}
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}
