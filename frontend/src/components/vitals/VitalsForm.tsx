import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postVitalsSubmit, type VitalsInput } from "@/api/client";
import { Activity } from "lucide-react";

type Props = {
  token: string;
  onSuccess?: () => void;
};

export function VitalsForm({ token, onSuccess }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [vitals, setVitals] = useState<VitalsInput>({
    spo2: undefined,
    hr: undefined,
    temp_c: undefined,
    bp_sys: undefined,
    bp_dia: undefined,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const hasAny = [vitals.spo2, vitals.hr, vitals.temp_c, vitals.bp_sys, vitals.bp_dia].some((v) => v != null);
    if (!hasAny) {
      setError("Enter at least one value.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const payload: VitalsInput = {
        device_id: "kiosk",
      };
      if (vitals.spo2 != null) payload.spo2 = Number(vitals.spo2);
      if (vitals.hr != null) payload.hr = Number(vitals.hr);
      if (vitals.temp_c != null) payload.temp_c = Number(vitals.temp_c);
      if (vitals.bp_sys != null) payload.bp_sys = Number(vitals.bp_sys);
      if (vitals.bp_dia != null) payload.bp_dia = Number(vitals.bp_dia);
      await postVitalsSubmit(token, payload);
      setSent(true);
      onSuccess?.();
    } catch {
      setError("Failed to submit. Check your token and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <Card className="border-green-600 bg-green-50 dark:bg-green-950/30">
        <CardContent className="pt-6">
          <p className="font-medium text-green-800 dark:text-green-200">Vitals recorded. Your care team can see them.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-5 w-5" />
          Record your vitals
        </CardTitle>
        <CardDescription>Optional. These are shared live with your care team.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="vitals-spo2">SpO2 (%)</Label>
              <Input
                id="vitals-spo2"
                type="number"
                min={80}
                max={100}
                step={1}
                placeholder="e.g. 98"
                value={vitals.spo2 ?? ""}
                onChange={(e) => setVitals((v) => ({ ...v, spo2: e.target.value ? Number(e.target.value) : undefined }))}
              />
            </div>
            <div>
              <Label htmlFor="vitals-hr">Heart rate (bpm)</Label>
              <Input
                id="vitals-hr"
                type="number"
                min={40}
                max={200}
                step={1}
                placeholder="e.g. 72"
                value={vitals.hr ?? ""}
                onChange={(e) => setVitals((v) => ({ ...v, hr: e.target.value ? Number(e.target.value) : undefined }))}
              />
            </div>
            <div>
              <Label htmlFor="vitals-temp">Temp (°C)</Label>
              <Input
                id="vitals-temp"
                type="number"
                min={35}
                max={42}
                step={0.1}
                placeholder="e.g. 36.6"
                value={vitals.temp_c ?? ""}
                onChange={(e) => setVitals((v) => ({ ...v, temp_c: e.target.value ? Number(e.target.value) : undefined }))}
              />
            </div>
            <div>
              <Label htmlFor="vitals-bp-sys">BP sys</Label>
              <Input
                id="vitals-bp-sys"
                type="number"
                min={70}
                max={200}
                placeholder="e.g. 120"
                value={vitals.bp_sys ?? ""}
                onChange={(e) => setVitals((v) => ({ ...v, bp_sys: e.target.value ? Number(e.target.value) : undefined }))}
              />
            </div>
            <div>
              <Label htmlFor="vitals-bp-dia">BP dia</Label>
              <Input
                id="vitals-bp-dia"
                type="number"
                min={40}
                max={120}
                placeholder="e.g. 80"
                value={vitals.bp_dia ?? ""}
                onChange={(e) => setVitals((v) => ({ ...v, bp_dia: e.target.value ? Number(e.target.value) : undefined }))}
              />
            </div>
          </div>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Sending…" : "Submit vitals"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
