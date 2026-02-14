import { useEffect, useState, useRef, useCallback } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postKioskCheckin, postAiChat } from "@/api/client";
import { motion } from "framer-motion";
import { Mic } from "lucide-react";
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
        beep();
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

  // When patient is checked in, announce wait time once and that they can ask questions
  useEffect(() => {
    if (!successCard || announcedWaitRef.current) return;
    announcedWaitRef.current = true;
    const mins = successCard.estimated_wait_min;
    const waitText = mins <= 0 ? "a short time" : `${mins} minute${mins !== 1 ? "s" : ""}`;
    const msg = `You're checked in. Your estimated wait is ${waitText}. If you have any questions, ask me now.`;
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(msg);
      window.speechSynthesis.speak(u);
    }
  }, [successCard]);

  const handleNextPatient = () => {
    setSuccessCard(null);
    setScanningEnabled(true);
    setStatus("Scanning for QR…");
    setTranscript([]);
    setRedFlagAlert(false);
    announcedWaitRef.current = false;
  };

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

            <div className="flex justify-center">
              <VitalsForm token={successCard.token} />
            </div>

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
