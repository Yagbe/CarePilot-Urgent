import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postIntake, postInsuranceEligibilityCheck } from "@/api/client";
import { motion, AnimatePresence } from "framer-motion";

const STEPS = 4;

export function Intake() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    dob: "",
    symptoms: "",
    duration_text: "1 day",
    arrival_window: "now",
  });
  const [useInsurance, setUseInsurance] = useState(false);
  const [insurance, setInsurance] = useState({
    national_id: "",
    insurer_name: "",
    policy_number: "",
    member_id: "",
    consent: false,
  });
  const navigate = useNavigate();

  const next = () => {
    if (step < STEPS) setStep((s) => s + 1);
  };
  const prev = () => {
    if (step > 1) setStep((s) => s - 1);
  };

  const submit = async () => {
    if (!form.first_name.trim() || !form.symptoms.trim()) return;
    setLoading(true);
    try {
      const res = await postIntake(form);
      // Optional: run insurance eligibility if enabled and consented
      if (useInsurance && insurance.consent) {
        try {
          await postInsuranceEligibilityCheck({
            encounter_id: res.encounter_id ?? res.pid,
            pid: res.pid,
            national_id: insurance.national_id || undefined,
            insurer_name: insurance.insurer_name || undefined,
            policy_number: insurance.policy_number || undefined,
            member_id: insurance.member_id || undefined,
            consent: true,
          });
        } catch (e) {
          // Non-fatal for patient; staff can still handle self-pay.
          console.warn("Eligibility check failed", e);
        }
      }
      navigate(res.redirect);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Topbar />
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Urgent care only. For life-threatening emergencies, call 911 or go to the nearest ER.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((s) => (
                <span
                  key={s}
                  className={`rounded-full px-3 py-1 text-sm font-medium ${
                    step === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  Step {s} of {STEPS}
                </span>
              ))}
            </div>
            <CardTitle>Urgent Care Intake</CardTitle>
            <CardDescription>Most check-ins take under 30 seconds.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AnimatePresence mode="wait">
              {step === 1 && (
                <motion.div
                  key="1"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  className="space-y-4"
                >
                  <div>
                    <Label htmlFor="first_name">First name *</Label>
                    <Input
                      id="first_name"
                      value={form.first_name}
                      onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="last_name">Last name</Label>
                    <Input
                      id="last_name"
                      value={form.last_name}
                      onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <Label htmlFor="dob">Date of birth</Label>
                    <Input
                      id="dob"
                      type="date"
                      value={form.dob}
                      onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">YYYY-MM-DD. Future dates not allowed.</p>
                  </div>
                </motion.div>
              )}
              {step === 2 && (
                <motion.div
                  key="2"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  className="space-y-4"
                >
                  <div>
                    <Label htmlFor="symptoms">Symptoms *</Label>
                    <textarea
                      id="symptoms"
                      className="flex min-h-[100px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={form.symptoms}
                      onChange={(e) => setForm((f) => ({ ...f, symptoms: e.target.value }))}
                      placeholder="Describe symptoms in plain language..."
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="duration_text">Symptom duration</Label>
                    <Input
                      id="duration_text"
                      value={form.duration_text}
                      onChange={(e) => setForm((f) => ({ ...f, duration_text: e.target.value }))}
                      placeholder="e.g. 2 days"
                    />
                  </div>
                  <div>
                    <Label htmlFor="arrival_window">When are you likely to arrive?</Label>
                    <select
                      id="arrival_window"
                      className="flex h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      value={form.arrival_window}
                      onChange={(e) => setForm((f) => ({ ...f, arrival_window: e.target.value }))}
                    >
                      <option value="now">Now</option>
                      <option value="soon">In 1-2 hours</option>
                      <option value="later">Later today</option>
                    </select>
                  </div>
                </motion.div>
              )}
              {step === 3 && (
                <motion.div
                  key="3"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="font-semibold">Insurance (optional)</Label>
                      <p className="text-xs text-muted-foreground">
                        You can skip this step and pay cash at the clinic, or enter insurance details for eligibility checks.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${
                        useInsurance ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground"
                      }`}
                      onClick={() => setUseInsurance((v) => !v)}
                    >
                      {useInsurance ? "Using insurance" : "Self-pay"}
                    </button>
                  </div>
                  {useInsurance && (
                    <>
                      <div>
                        <Label htmlFor="national_id">National ID / Iqama / Passport</Label>
                        <Input
                          id="national_id"
                          value={insurance.national_id}
                          onChange={(e) => setInsurance((i) => ({ ...i, national_id: e.target.value }))}
                          placeholder="Optional identifier"
                        />
                      </div>
                      <div>
                        <Label htmlFor="insurer_name">Insurer name</Label>
                        <Input
                          id="insurer_name"
                          value={insurance.insurer_name}
                          onChange={(e) => setInsurance((i) => ({ ...i, insurer_name: e.target.value }))}
                          placeholder="e.g. Bupa, Tawuniya"
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="policy_number">Policy number</Label>
                          <Input
                            id="policy_number"
                            value={insurance.policy_number}
                            onChange={(e) => setInsurance((i) => ({ ...i, policy_number: e.target.value }))}
                          />
                        </div>
                        <div>
                          <Label htmlFor="member_id">Member ID</Label>
                          <Input
                            id="member_id"
                            value={insurance.member_id}
                            onChange={(e) => setInsurance((i) => ({ ...i, member_id: e.target.value }))}
                          />
                        </div>
                      </div>
                      <label className="flex items-start gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={insurance.consent}
                          onChange={(e) => setInsurance((i) => ({ ...i, consent: e.target.checked }))}
                        />
                        <span>
                          I consent to sharing my information for insurance eligibility and claims processing. This does not authorize diagnosis or treatment.
                        </span>
                      </label>
                    </>
                  )}
                </motion.div>
              )}
              {step === 4 && (
                <motion.div
                  key="4"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                >
                  <p className="text-muted-foreground text-sm">Confirm and submit to generate your token and QR code.</p>
                  <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
                    <li>Privacy-safe public display uses token only.</li>
                    <li>AI intake summary is operational, non-diagnostic.</li>
                    <li>If you chose insurance, staff will review coverage and claims before any submission.</li>
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="flex gap-2 pt-4">
              {step > 1 && (
                <Button type="button" variant="secondary" onClick={prev}>
                  Back
                </Button>
              )}
              {step < STEPS ? (
                <Button type="button" onClick={next}>Next</Button>
              ) : (
                <Button onClick={submit} disabled={loading}>
                  {loading ? "Submitting…" : "Submit Intake"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
