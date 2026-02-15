import { useEffect, useState, useRef, useCallback } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postKioskCheckin, postAiChat, getVitalsByToken, getTriage, type VitalsReading, type TriageResult } from "@/api/client";
import { motion } from "framer-motion";
import { Mic, Activity } from "lucide-react";
import { VitalsForm } from "@/components/vitals/VitalsForm";

function beep() {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 880;
  gain.gain.value = 0.0001;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
  osc.stop(ctx.currentTime + 0.24);
}

type TranscriptBubble = { role: "user" | "assistant"; text: string };

export function KioskCamera() {
  const [status, setStatus] = useState("Scanning for QR…");
  const [successCard, setSuccessCard] = useState<{
    token: string;
    message: string;
    estimated_wait_min: number;
    display_name?: string;
  } | null>(null);
  const [scanningEnabled, setScanningEnabled] = useState(true);
  const [manualCode, setManualCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const lastProcessedRef = useRef("");
  const cooldownUntilRef = useRef(0);

  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "processing" | "speaking">("idle");
  const [transcript, setTranscript] = useState<TranscriptBubble[]>([]);
  const [redFlagAlert, setRedFlagAlert] = useState(false);
  const recognitionRef = useRef<{ start: () => void; abort: () => void } | null>(null);
  const announcedWaitRef = useRef(false);
  const [autoVitals, setAutoVitals] = useState<VitalsReading | null>(null);
  const [showManualVitals, setShowManualVitals] = useState(false);
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const greetedRef = useRef(false);
  const triageSpokenRef = useRef(false);
  const triageRequestedRef = useRef(false);
  const AI_NAME = "CarePilot";

  const submitCode = useCallback(async (code: string, fromCamera: boolean) => {
    if (!code.trim()) return;
    setSubmitting(true);
    setStatus(fromCamera ? "QR detected, checking in…" : "Checking in…");
    try {
      const res = await postKioskCheckin(code.trim());
      if (res.ok && res.checked_in) {
        setSuccessCard({
          token: res.token,
          message: res.message,
          estimated_wait_min: res.estimated_wait_min ?? 0,
          display_name: res.display_name,
        });
        setAutoVitals(null);
        setShowManualVitals(false);
        setTriageResult(null);
        greetedRef.current = false;
        triageSpokenRef.current = false;
        triageRequestedRef.current = false;
        beep();
        // Tell local sensor bridge (Nano) which patient to send vitals for
        try {
          await fetch("http://localhost:9999/current-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: res.token }),
          });
        } catch {
          // Token receiver not running (e.g. not on Nano); sensors may use CAREPILOT_TOKEN manually
        }
        if (fromCamera) {
          setScanningEnabled(false);
          cooldownUntilRef.current = Date.now() + 3000;
          setStatus("Checked in. Scan paused for 3 seconds…");
          setTimeout(() => {
            setScanningEnabled(true);
            setStatus("Scanning for QR…");
          }, 3000);
        } else {
          setStatus("Checked in.");
        }
      } else {
        setStatus(res.message || "Code not found.");
      }
    } catch {
      setStatus("Check-in error. Use manual fallback.");
    } finally {
      setSubmitting(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (!scanningEnabled || Date.now() < cooldownUntilRef.current) return;
      try {
        const r = await fetch("/api/camera/last-scan", { credentials: "same-origin" });
        const d = await r.json();
        const v = String(d.value ?? "").trim();
        if (d.fresh && v && v !== lastProcessedRef.current) {
          lastProcessedRef.current = v;
          if (!cancelled) await submitCode(v, true);
        }
      } catch {
        if (!cancelled) setStatus("Camera unavailable. Use manual fallback.");
      }
    };
    poll();
    const t = setInterval(poll, 200);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [scanningEnabled, submitCode]);

  interface SpeechRecognitionLike {
    start: () => void;
    abort: () => void;
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    onstart: () => void;
    onend: () => void;
    onresult: (e: { results?: { [i: number]: { [j: number]: { transcript?: string } } } }) => void;
  }

  useEffect(() => {
    const Win = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Rec = Win.SpeechRecognition ?? Win.webkitSpeechRecognition;
    if (!Rec) return;
    const rec = new Rec() as SpeechRecognitionLike;
    recognitionRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => {
      setVoiceState("listening");
    };
    rec.onend = () => {
      setVoiceState("idle");
    };
    rec.onresult = (event: { results?: { [i: number]: { [j: number]: { transcript?: string } } } }) => {
      const text = (event.results?.[0]?.[0]?.transcript ?? "").trim();
      if (!text) return;
      setTranscript((prev) => [{ role: "user", text }, ...prev]);
      setVoiceState("processing");
      postAiChat(text)
        .then((data) => {
          setTranscript((prev) => [{ role: "assistant", text: data.reply ?? "Unable to respond." }, ...prev]);
          if (data.red_flags?.length) {
            setRedFlagAlert(true);
            beep();
          }
          if ("speechSynthesis" in window && data.reply) {
            setVoiceState("speaking");
            const u = new SpeechSynthesisUtterance(data.reply);
            window.speechSynthesis.speak(u);
            u.onend = () => setVoiceState("idle");
          } else {
            setVoiceState("idle");
          }
        })
        .catch(() => {
          setTranscript((prev) => [{ role: "assistant", text: "Assistant unavailable right now." }, ...prev]);
          setVoiceState("idle");
        });
    };
    recognitionRef.current = rec;
    return () => {
      rec.abort();
    };
  }, []);

  const startListening = () => {
    setRedFlagAlert(false);
    recognitionRef.current?.start();
  };

  // Speak AI greeting once after check-in
  useEffect(() => {
    if (!successCard || greetedRef.current) return;
    greetedRef.current = true;
    const msg = `Greetings, my name is ${AI_NAME} and I will be your AI medical assistant. Before we get started, I am going to take a look at your vital signs.`;
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(msg);
      window.speechSynthesis.speak(u);
    }
  }, [successCard]);

  // Run triage once when vitals are available or after 6s
  useEffect(() => {
    if (!successCard?.token || triageRequestedRef.current) return;
    const runTriage = () => {
      if (triageRequestedRef.current) return;
      triageRequestedRef.current = true;
      getTriage(successCard.token)
        .then(setTriageResult)
        .catch(() => {
          triageRequestedRef.current = false;
        });
    };
    if (autoVitals) {
      runTriage();
      return;
    }
    const fallback = setTimeout(runTriage, 6000);
    return () => clearTimeout(fallback);
  }, [successCard?.token, autoVitals]);

  useEffect(() => {
    if (!successCard || !triageResult || triageSpokenRef.current) return;
    triageSpokenRef.current = true;
    const msg = triageResult.ai_script;
    if ("speechSynthesis" in window && msg) {
      const u = new SpeechSynthesisUtterance(msg);
      window.speechSynthesis.speak(u);
    }
  }, [successCard, triageResult]);

  // After triage outcome spoken, announce wait time once (medium/low only)
  useEffect(() => {
    if (!successCard || !triageResult || announcedWaitRef.current || triageResult.priority === "high") return;
    announcedWaitRef.current = true;
    const id = setTimeout(() => {
      const mins = successCard.estimated_wait_min;
      const waitText = mins <= 0 ? "a short time" : `${mins} minute${mins !== 1 ? "s" : ""}`;
      const msg = `Your estimated wait is ${waitText}. If you have any questions, ask me now.`;
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(msg);
        window.speechSynthesis.speak(u);
      }
    }, 4000);
    return () => clearTimeout(id);
  }, [successCard, triageResult]);

  const handleNextPatient = () => {
    setSuccessCard(null);
    setAutoVitals(null);
    setShowManualVitals(false);
    setTriageResult(null);
    setScanningEnabled(true);
    setStatus("Scanning for QR…");
    setTranscript([]);
    setRedFlagAlert(false);
    announcedWaitRef.current = false;
    greetedRef.current = false;
    triageSpokenRef.current = false;
    triageRequestedRef.current = false;
  };

  // Poll for vitals when patient is checked in (sensors auto-submit to API)
  useEffect(() => {
    if (!successCard?.token) return;
    let cancelled = false;
    const poll = () => {
      getVitalsByToken(successCard.token)
        .then((r) => {
          if (!cancelled && r.vitals) setAutoVitals(r.vitals);
        })
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [successCard?.token]);

  return (
    <>
      <Topbar />
      <main className="mx-auto flex max-w-4xl flex-col items-center space-y-4 px-4 py-4">
        {/* Small top bar: code entry + status */}
        <div className="flex w-full max-w-2xl flex-wrap items-center justify-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submitCode(manualCode, false);
            }}
          >
            <Label htmlFor="manual-code" className="sr-only">Token or code</Label>
            <Input
              id="manual-code"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="UC-1234 or code"
              className="max-w-[200px] font-mono"
            />
            <Button type="submit" disabled={submitting} size="sm">
              {submitting ? "…" : "Check In"}
            </Button>
          </form>
          <span className="text-sm text-muted-foreground">{status}</span>
        </div>

        {/* Largest: QR camera */}
        <Card className="w-full max-w-2xl">
          <CardContent className="p-0 flex justify-center">
            <img
              src="/camera/stream"
              alt="Point QR code at camera"
              className="h-auto w-full rounded-lg border-0 border-border object-contain max-h-[50vh] sm:max-h-[60vh]"
            />
          </CardContent>
          <p className="px-4 pb-2 text-center text-muted-foreground text-xs">Scan your QR code or enter your token above.</p>
        </Card>

        {/* Only after check-in: success summary + voice assistant */}
        {successCard && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="w-full max-w-2xl space-y-4 text-center"
          >
            <div className="rounded-lg border-l-4 border-green-600 bg-green-50 p-4 dark:bg-green-950">
              <p className="text-lg font-bold text-green-900 dark:text-green-100">✓ You're checked in</p>
              {successCard.display_name && (
                <p className="text-green-800 dark:text-green-200">Welcome, <strong>{successCard.display_name}</strong>.</p>
              )}
              <p className="font-mono text-xl font-bold text-green-800 dark:text-green-200">{successCard.token}</p>
              <p className="text-green-800 dark:text-green-200">Estimated wait: <strong>{successCard.estimated_wait_min} min</strong>. Watch the waiting room screen for your token.</p>
              <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={handleNextPatient}>
                Next patient
              </Button>
            </div>

            {triageResult && (
              <div
                className={`rounded-lg border-l-4 p-4 ${
                  triageResult.priority === "high"
                    ? "border-red-600 bg-red-50 dark:bg-red-950"
                    : triageResult.priority === "medium"
                      ? "border-orange-500 bg-orange-50 dark:bg-orange-950/50"
                      : "border-yellow-500 bg-yellow-50 dark:bg-yellow-950/50"
                }`}
              >
                <p className={`text-lg font-bold ${
                  triageResult.priority === "high"
                    ? "text-red-900 dark:text-red-100"
                    : triageResult.priority === "medium"
                      ? "text-orange-900 dark:text-orange-100"
                      : "text-yellow-900 dark:text-yellow-100"
                }`}>
                  Priority: {triageResult.priority === "high" ? "High" : triageResult.priority === "medium" ? "Medium" : "Low"}
                </p>
                <p className={`text-sm mt-1 ${
                  triageResult.priority === "high"
                    ? "text-red-800 dark:text-red-200"
                    : triageResult.priority === "medium"
                      ? "text-orange-800 dark:text-orange-200"
                      : "text-yellow-800 dark:text-yellow-200"
                }`}>
                  {triageResult.message}
                </p>
              </div>
            )}

            <Card className="text-center">
              <CardHeader>
                <CardTitle className="flex items-center justify-center gap-2 text-base">
                  <Activity className="h-5 w-5" />
                  Vitals (from sensors)
                </CardTitle>
                <CardContent className="pt-0">
                  {!autoVitals && (
                    <p className="text-muted-foreground text-sm py-4">
                      Collecting vitals from sensors… The system will record them automatically. No need to enter anything.
                    </p>
                  )}
                  {autoVitals && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-2">
                      {autoVitals.spo2 != null && (
                        <div className="rounded-lg bg-muted/50 p-3">
                          <p className="text-muted-foreground text-xs">SpO2</p>
                          <p className="text-xl font-bold">{autoVitals.spo2}%</p>
                        </div>
                      )}
                      {autoVitals.hr != null && (
                        <div className="rounded-lg bg-muted/50 p-3">
                          <p className="text-muted-foreground text-xs">Heart rate</p>
                          <p className="text-xl font-bold">{autoVitals.hr} bpm</p>
                        </div>
                      )}
                      {autoVitals.temp_c != null && (
                        <div className="rounded-lg bg-muted/50 p-3">
                          <p className="text-muted-foreground text-xs">Temp</p>
                          <p className="text-xl font-bold">{autoVitals.temp_c} °C</p>
                        </div>
                      )}
                      {(autoVitals.bp_sys != null || autoVitals.bp_dia != null) && (
                        <div className="rounded-lg bg-muted/50 p-3">
                          <p className="text-muted-foreground text-xs">BP</p>
                          <p className="text-xl font-bold">{autoVitals.bp_sys ?? "—"} / {autoVitals.bp_dia ?? "—"}</p>
                        </div>
                      )}
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 text-muted-foreground"
                    onClick={() => setShowManualVitals((v) => !v)}
                  >
                    {showManualVitals ? "Hide manual entry" : "Enter manually if sensors didn’t work"}
                  </Button>
                  {showManualVitals && (
                    <div className="mt-4 max-w-md mx-auto">
                      <VitalsForm token={successCard.token} onSuccess={() => getVitalsByToken(successCard.token).then((r) => r.vitals && setAutoVitals(r.vitals))} />
                    </div>
                  )}
                </CardContent>
              </CardHeader>
            </Card>

            <Card className="text-center">
              <CardHeader>
                <CardTitle className="text-base">Voice assistant — your wait time & questions</CardTitle>
                <CardContent className="pt-0">
                  <p className="text-muted-foreground text-xs">
                    Ask about your wait time or anything else. If emergency symptoms, alert staff immediately.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    <Button type="button" onClick={startListening} disabled={voiceState === "listening"}>
                      <Mic className="mr-2 h-4 w-4" />
                      {voiceState === "listening" ? "Listening…" : "Ask a question"}
                    </Button>
                    <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">
                      {voiceState === "idle" && "Idle"}
                      {voiceState === "listening" && "Listening"}
                      {voiceState === "processing" && "Processing"}
                      {voiceState === "speaking" && "Speaking"}
                    </span>
                  </div>
                  {redFlagAlert && (
                    <div className="mt-3 rounded-lg border-l-4 border-destructive bg-destructive/10 p-3 text-destructive font-medium">
                      Red-flag phrase detected. Please call staff now.
                    </div>
                  )}
                  <div className="mt-3 space-y-2 max-h-32 overflow-y-auto">
                    {transcript.map((b, i) => (
                      <div key={i} className="rounded-lg border border-border bg-muted/30 p-2 text-sm">
                        <strong>{b.role === "assistant" ? "Assistant" : "You"}:</strong> {b.text}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </CardHeader>
            </Card>
          </motion.div>
        )}
      </main>
    </>
  );
}
