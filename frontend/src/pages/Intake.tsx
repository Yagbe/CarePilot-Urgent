import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postIntake } from "@/api/client";
import { motion, AnimatePresence } from "framer-motion";

const STEPS = 3;

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
              {[1, 2, 3].map((s) => (
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
                >
                  <p className="text-muted-foreground text-sm">Confirm and submit to generate your token and QR code.</p>
                  <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
                    <li>Privacy-safe public display uses token only.</li>
                    <li>AI intake summary is operational, non-diagnostic.</li>
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
