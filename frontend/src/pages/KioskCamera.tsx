/**
 * Kiosk page: linear flow for patient check-in at a physical kiosk.
 *
 * Flow: (1) Scan — QR or manual code → check-in
 *       (2) Vitals — use provided sensors, enter BP/pulse/temp; triage runs and bot speaks condition level
 *       (3) Chat — CarePilot AI (wait time, wayfinding, vitals); "Session done" resets to scan
 *
 * Uses /camera/stream for live feed, getAiSpeech (OpenAI TTS) with browser fallback, and postAiChat with token for context.
 */
import { useEffect, useState, useRef, useCallback } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postKioskCheckin, postAiChat, getAiSpeech, getVitalsByToken, getTriage, type VitalsReading, type TriageResult } from "@/api/client";
import { motion } from "framer-motion";
import { Mic, Activity } from "lucide-react";
import { VitalsForm } from "@/components/vitals/VitalsForm";
import { getLanguage, t, setLanguage, Language } from "@/lib/i18n";

/** Kiosk steps: scan (QR/code) → vitals → chat, then session done back to scan */
type KioskStep = "scan" | "vitals" | "chat";

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
  const [lang, setLangState] = useState<Language>(getLanguage());
  const [status, setStatus] = useState(t("kiosk.scanning", getLanguage()));
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

  useEffect(() => {
    const storedLang = getLanguage();
    setLangState(storedLang);
    setLanguage(storedLang);
    const handleStorageChange = () => {
      const newLang = getLanguage();
      setLangState(newLang);
      setLanguage(newLang);
      setStatus(t("kiosk.scanning", newLang));
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  interface SpeechRecognitionLike {
    start: () => void;
    abort: () => void;
    lang?: string;
    interimResults: boolean;
    maxAlternatives: number;
    onstart: () => void;
    onend: () => void;
    onresult: (e: { results?: { [i: number]: { [j: number]: { transcript?: string } } } }) => void;
  }

  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "processing" | "speaking">("idle");
  const [transcript, setTranscript] = useState<TranscriptBubble[]>([]);
  const [redFlagAlert, setRedFlagAlert] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const announcedWaitRef = useRef(false);
  const [autoVitals, setAutoVitals] = useState<VitalsReading | null>(null);
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const greetedRef = useRef(false);
  const triageSpokenRef = useRef(false);
  const triageRequestedRef = useRef(false);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [kioskStep, setKioskStep] = useState<KioskStep>("scan");
  const AI_NAME = "CarePilot";

  const speechQueueRef = useRef<{ text: string; onEnd?: () => void }[]>([]);
  const isPlayingSpeechRef = useRef(false);

  /** Play the next item in the speech queue. Only one utterance at a time. */
  const playNextInQueue = useCallback(() => {
    if (isPlayingSpeechRef.current) return;
    const queue = speechQueueRef.current;
    if (queue.length === 0) return;
    const item = queue.shift()!;
    const text = item.text?.trim() || "";
    const onEnd = item.onEnd;
    if (!text) {
      onEnd?.();
      playNextInQueue();
      return;
    }
    isPlayingSpeechRef.current = true;
    const done = () => {
      isPlayingSpeechRef.current = false;
      onEnd?.();
      playNextInQueue();
    };
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    const fallbackToBrowserTts = () => {
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(text);
        u.onend = () => done();
        window.speechSynthesis.speak(u);
      } else {
        done();
      }
    };

    const playWithFallback = () => {
      getAiSpeech(text)
        .then((blob) => {
          if (blob && blob.size > 0) {
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.onended = () => {
              URL.revokeObjectURL(url);
              done();
            };
            audio.onerror = () => {
              URL.revokeObjectURL(url);
              fallbackToBrowserTts();
            };
            audio.play().catch(() => {
              URL.revokeObjectURL(url);
              fallbackToBrowserTts();
            });
            return;
          }
          fallbackToBrowserTts();
        })
        .catch(fallbackToBrowserTts);
    };
    playWithFallback();
  }, []);

  /** Speak with OpenAI TTS when available, else browser speechSynthesis. Queued so only one line at a time. */
  const speakWithTts = useCallback(
    (text: string, onEnd?: () => void) => {
      if (!text?.trim()) {
        onEnd?.();
        return;
      }
      speechQueueRef.current.push({ text, onEnd });
      if (!isPlayingSpeechRef.current) {
        playNextInQueue();
      }
    },
    [playNextInQueue]
  );

  const submitCode = useCallback(async (code: string, fromCamera: boolean) => {
    if (!code.trim()) return;
    const currentLang = getLanguage();
    setSubmitting(true);
    setStatus(fromCamera ? t("kiosk.qrDetected", currentLang) : t("kiosk.checkingIn", currentLang));
    try {
      const res = await postKioskCheckin(code.trim());
      if (res.ok && res.checked_in) {
        setSuccessCard({
          token: res.token,
          message: res.message,
          estimated_wait_min: res.estimated_wait_min ?? 0,
          display_name: res.display_name,
        });
        setKioskStep("vitals");
        setAutoVitals(null);
        setTriageResult(null);
        greetedRef.current = false;
        triageSpokenRef.current = false;
        triageRequestedRef.current = false;
        beep();
        if (fromCamera) {
          setScanningEnabled(false);
          cooldownUntilRef.current = Date.now() + 3000;
          setStatus(t("kiosk.scanPaused", currentLang));
          setTimeout(() => {
            setScanningEnabled(true);
            setStatus(t("kiosk.scanning", currentLang));
          }, 3000);
        } else {
          setStatus(t("kiosk.checkedIn", currentLang));
        }
      } else {
        setStatus(res.message || t("kiosk.codeNotFound", currentLang));
      }
    } catch {
      setStatus(t("kiosk.checkInError", currentLang));
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
        if (!cancelled) {
          const currentLang = getLanguage();
          setStatus(t("kiosk.cameraUnavailable", currentLang));
        }
      }
    };
    poll();
    const intervalId = setInterval(poll, 200);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [scanningEnabled, submitCode]);

  useEffect(() => {
    const Win = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Rec = Win.SpeechRecognition ?? Win.webkitSpeechRecognition;
    if (!Rec) return;
    const rec = new Rec() as SpeechRecognitionLike;
    recognitionRef.current = rec;
    if (rec.lang !== undefined) {
      rec.lang = lang === "ar" ? "ar-SA" : "en-US";
    }
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
      postAiChat(text, { token: successCard?.token })
        .then((data) => {
          setTranscript((prev) => [
            { role: "assistant", text: data.reply ?? t("kiosk.aiNoResponse", lang) },
            ...prev,
          ]);
          if (data.red_flags?.length) {
            setRedFlagAlert(true);
            beep();
          }
          if (data.reply) {
            setVoiceState("speaking");
            speakWithTts(data.reply, () => setVoiceState("idle"));
          } else {
            setVoiceState("idle");
          }
        })
        .catch(() => {
          setTranscript((prev) => [
            { role: "assistant", text: t("kiosk.aiUnavailableShort", lang) },
            ...prev,
          ]);
          setVoiceState("idle");
        });
    };
    recognitionRef.current = rec;
    return () => {
      rec.abort();
    };
  }, [successCard?.token]);

  const startListening = () => {
    setRedFlagAlert(false);
    recognitionRef.current?.start();
  };

  const sendChatMessage = async () => {
    const msg = chatInput.trim();
    if (!msg || chatSending) return;
    setChatInput("");
    setTranscript((prev) => [...prev, { role: "user", text: msg }]);
    setChatSending(true);
    setRedFlagAlert(false);
    try {
      const data = await postAiChat(msg, { token: successCard?.token });
      setTranscript((prev) => [...prev, { role: "assistant", text: data.reply ?? t("kiosk.aiNoResponse", lang) }]);
      if (data.red_flags?.length) {
        setRedFlagAlert(true);
        beep();
      }
      if (data.reply) {
        speakWithTts(data.reply);
      }
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch {
      setTranscript((prev) => [
        ...prev,
        { role: "assistant", text: t("kiosk.aiUnavailable", lang) },
      ]);
    } finally {
      setChatSending(false);
    }
  };

  // Intro: speak once when they first land on vitals step after check-in
  useEffect(() => {
    if (!successCard || kioskStep !== "vitals" || greetedRef.current) return;
    greetedRef.current = true;
    const msg = t("kiosk.vitalsIntro", lang);
    const timeoutId = setTimeout(() => speakWithTts(msg), 400);
    return () => clearTimeout(timeoutId);
  }, [successCard, kioskStep, speakWithTts]);

  // Run triage when vitals appear (e.g. from effect when autoVitals set by polling or elsewhere)
  useEffect(() => {
    if (!successCard?.token || triageRequestedRef.current) return;
    if (!autoVitals) return;
    triageRequestedRef.current = true;
    getTriage(successCard.token)
      .then(setTriageResult)
      .catch(() => {
        triageRequestedRef.current = false;
      });
  }, [successCard?.token, autoVitals]);

  /** Call when vitals form is submitted: refetch vitals, run triage (AI judges health from vitals), and activate bot to speak. */
  const handleVitalsSubmitted = useCallback(() => {
    if (!successCard?.token) return;
    getVitalsByToken(successCard.token).then((r) => {
      if (r.vitals) setAutoVitals(r.vitals);
    });
    triageSpokenRef.current = false;
    getTriage(successCard.token)
      .then((result) => {
        setTriageResult(result);
      })
      .catch(() => {});
  }, [successCard?.token]);

  // When user goes to chat without vitals yet, run triage once so we have a result (backend uses null vitals → low)
  useEffect(() => {
    if (!successCard?.token || kioskStep !== "chat" || triageResult || triageRequestedRef.current) return;
    triageRequestedRef.current = true;
    getTriage(successCard.token)
      .then(setTriageResult)
      .catch(() => {
        triageRequestedRef.current = false;
      });
  }, [successCard?.token, kioskStep, triageResult]);

  // After you enter vitals: speak condition level based on the vitals you entered (on vitals or chat step)
  useEffect(() => {
    if (!successCard || !triageResult || triageSpokenRef.current) return;
    if (kioskStep !== "vitals" && kioskStep !== "chat") return;
    triageSpokenRef.current = true;
    const currentLang = lang;
    const msg =
      triageResult.priority === "high"
        ? t("kiosk.triageHigh", currentLang).replace("{script}", triageResult.ai_script ?? "")
        : triageResult.priority === "medium"
          ? t("kiosk.triageMedium", currentLang)
          : t("kiosk.triageLow", currentLang);
    if (msg) speakWithTts(msg);
  }, [successCard, kioskStep, triageResult, speakWithTts]);

  // After triage spoken, announce wait time once (medium/low only), on vitals or chat step
  useEffect(() => {
    if (!successCard || !triageResult || announcedWaitRef.current || triageResult.priority === "high") return;
    if (kioskStep !== "vitals" && kioskStep !== "chat") return;
    announcedWaitRef.current = true;
    const id = setTimeout(() => {
      const currentLang = lang;
      const mins = successCard.estimated_wait_min;
      const waitText =
        mins <= 0
          ? t("kiosk.waitShort", currentLang)
          : `${mins} ${t("kiosk.minutes", currentLang)}`;
      const msg = t("kiosk.waitAnnouncement", currentLang).replace("{wait}", waitText);
      speakWithTts(msg);
    }, 4000);
    return () => clearTimeout(id);
  }, [successCard, kioskStep, triageResult, speakWithTts]);

  const handleSessionDone = () => {
    setSuccessCard(null);
    setAutoVitals(null);
    setTriageResult(null);
    setScanningEnabled(true);
    const currentLang = getLanguage();
    setStatus(t("kiosk.scanning", currentLang));
    setTranscript([]);
    setChatInput("");
    setRedFlagAlert(false);
    setKioskStep("scan");
    announcedWaitRef.current = false;
    greetedRef.current = false;
    triageSpokenRef.current = false;
    triageRequestedRef.current = false;
  };

  return (
    <>
      <Topbar />
      <main className="mx-auto flex max-w-4xl flex-col items-center space-y-4 px-4 py-4">
        {/* Step 1: QR scan — show until check-in */}
        {!successCard && (
          <>
            <div className="flex w-full max-w-2xl flex-wrap items-center justify-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitCode(manualCode, false);
                }}
              >
                <Label htmlFor="manual-code" className="sr-only">{t("kiosk.tokenOrCode", lang)}</Label>
                <Input
                  id="manual-code"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder={t("kiosk.tokenOrCodePlaceholder", lang)}
                  className="max-w-[200px] font-mono"
                  dir={lang === "ar" ? "ltr" : "ltr"}
                />
                <Button type="submit" disabled={submitting} size="sm">
                  {submitting ? "…" : t("kiosk.checkIn", lang)}
                </Button>
              </form>
              <span className="text-sm text-muted-foreground">{status}</span>
            </div>
            <Card className="w-full max-w-2xl">
              <CardContent className="p-0 flex justify-center">
                <img
                  src="/camera/stream"
                  alt="Point QR code at camera"
                  className="h-auto w-full rounded-lg border-0 border-border object-contain max-h-[50vh] sm:max-h-[60vh]"
                />
              </CardContent>
              <p className="px-4 pb-2 text-center text-muted-foreground text-xs">{t("kiosk.scanQR", lang)}</p>
            </Card>
          </>
        )}

        {/* Step 2: Vitals — after check-in, before chat */}
        {successCard && kioskStep === "vitals" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="w-full max-w-2xl space-y-4 text-center"
          >
            <div className="rounded-lg border-l-4 border-green-600 bg-green-50 p-4 dark:bg-green-950">
              <p className="text-lg font-bold text-green-900 dark:text-green-100">{t("kiosk.checkedInTitle", lang)}</p>
              {successCard.display_name && (
                <p className="text-green-800 dark:text-green-200">{t("kiosk.welcome", lang)} <strong>{successCard.display_name}</strong>.</p>
              )}
              <p className="font-mono text-xl font-bold text-green-800 dark:text-green-200">{successCard.token}</p>
              <p className="text-green-800 dark:text-green-200 text-sm">{t("kiosk.waitTime", lang)} <strong>{successCard.estimated_wait_min} {t("kiosk.minutes", lang)}</strong>. {t("kiosk.nextVitals", lang)}</p>
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
                  {t("kiosk.priority", lang)} {triageResult.priority === "high" ? t("kiosk.priorityHigh", lang) : triageResult.priority === "medium" ? t("kiosk.priorityMedium", lang) : t("kiosk.priorityLow", lang)}
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
                  {t("kiosk.vitalsTitle", lang)}
                </CardTitle>
                <CardContent className="pt-0">
                  <p className="text-muted-foreground text-sm py-2">
                    {t("kiosk.vitalsDesc", lang)}
                  </p>
                  <div className="max-w-md mx-auto mt-2">
                    <VitalsForm token={successCard.token} onSuccess={handleVitalsSubmitted} />
                  </div>
                  {autoVitals && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-4 mt-4 border-t border-border">
                      {(autoVitals.bp_sys != null || autoVitals.bp_dia != null) && (
                        <div className="rounded-lg bg-muted/50 p-3">
                          <p className="text-muted-foreground text-xs">{t("kiosk.bloodPressure", lang)}</p>
                          <p className="text-xl font-bold">{autoVitals.bp_sys ?? "—"} / {autoVitals.bp_dia ?? "—"}</p>
                        </div>
                      )}
                      {autoVitals.hr != null && (
                        <div className="rounded-lg bg-muted/50 p-3">
                          <p className="text-muted-foreground text-xs">{t("kiosk.pulse", lang)}</p>
                          <p className="text-xl font-bold">{autoVitals.hr} bpm</p>
                        </div>
                      )}
                      {autoVitals.temp_c != null && (
                        <div className="rounded-lg bg-muted/50 p-3">
                          <p className="text-muted-foreground text-xs">{t("kiosk.bodyTemp", lang)}</p>
                          <p className="text-xl font-bold">{autoVitals.temp_c} °C</p>
                        </div>
                      )}
                      {autoVitals.spo2 != null && (
                        <div className="rounded-lg bg-muted/50 p-3">
                          <p className="text-muted-foreground text-xs">SpO2</p>
                          <p className="text-xl font-bold">{autoVitals.spo2}%</p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </CardHeader>
            </Card>
            <Button type="button" size="lg" className="w-full max-w-xs" onClick={() => setKioskStep("chat")}>
              {t("kiosk.continueChat", lang)}
            </Button>
          </motion.div>
        )}

        {/* Step 3: Chat — then Session done back to scan */}
        {successCard && kioskStep === "chat" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="w-full max-w-2xl space-y-4 text-center"
          >
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-2 flex items-center justify-between flex-wrap gap-2">
              <span className="text-sm text-muted-foreground">
                <span className="font-mono font-bold text-foreground">{successCard.token}</span>
                {" · "}
                {t("kiosk.chatTitle", lang)} {AI_NAME}
              </span>
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("kiosk.chatTitle", lang)} {AI_NAME} — {t("kiosk.chatSubtitle", lang)}</CardTitle>
                <CardContent className="pt-0 space-y-3">
                  <p className="text-muted-foreground text-xs">
                    {t("kiosk.chatHint", lang)}
                  </p>
                  <div className="rounded-lg border border-border bg-muted/20 min-h-[140px] max-h-[220px] overflow-y-auto p-3 space-y-2">
                    {transcript.length === 0 && (
                      <p className="text-muted-foreground text-sm">{t("kiosk.chatPlaceholder", lang)}</p>
                    )}
                    {transcript.map((b, i) => (
                      <div
                        key={i}
                        className={`rounded-lg p-2 text-sm ${
                          b.role === "assistant"
                            ? "bg-primary/10 ml-0 mr-4"
                            : "bg-muted ml-4 mr-0 text-right"
                        }`}
                      >
                        <span className="font-medium text-xs opacity-80">{b.role === "assistant" ? AI_NAME : t("kiosk.you", lang)}</span>
                        <p className="mt-0.5">{b.text}</p>
                      </div>
                    ))}
                    {chatSending && (
                      <div className="rounded-lg p-2 text-sm bg-primary/10 text-primary-foreground ml-0 mr-4">
                        <span className="font-medium text-xs opacity-80">{AI_NAME}</span>
                        <p className="mt-0.5 text-muted-foreground">…</p>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      placeholder={t("kiosk.typeQuestion", lang)}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && sendChatMessage()}
                      disabled={chatSending}
                      className="flex-1 min-w-[160px]"
                      dir={lang === "ar" ? "rtl" : "ltr"}
                    />
                    <Button type="button" onClick={sendChatMessage} disabled={chatSending || !chatInput.trim()}>
                      {chatSending ? "…" : t("kiosk.send", lang)}
                    </Button>
                    <Button type="button" variant="outline" size="icon" onClick={startListening} disabled={voiceState === "listening" || chatSending} title={t("kiosk.voice", lang)}>
                      <Mic className="h-4 w-4" />
                    </Button>
                    <span className="rounded-full bg-muted px-2 py-1 text-xs">
                      {voiceState === "idle" && t("kiosk.idle", lang)}
                      {voiceState === "listening" && t("kiosk.listening", lang)}
                      {voiceState === "processing" && t("kiosk.processing", lang)}
                      {voiceState === "speaking" && t("kiosk.speaking", lang)}
                    </span>
                  </div>
                  {redFlagAlert && (
                    <div className="rounded-lg border-l-4 border-destructive bg-destructive/10 p-3 text-destructive font-medium text-sm">
                      {t("kiosk.redFlag", lang)}
                    </div>
                  )}
                </CardContent>
              </CardHeader>
            </Card>
            <Button type="button" variant="secondary" size="lg" className="w-full max-w-xs" onClick={handleSessionDone}>
              {t("kiosk.sessionDone", lang)}
            </Button>
          </motion.div>
        )}
      </main>
    </>
  );
}
