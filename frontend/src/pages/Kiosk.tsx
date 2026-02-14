import { useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postKioskCheckin } from "@/api/client";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { VitalsForm } from "@/components/vitals/VitalsForm";

type Result = {
  checked_in: boolean;
  message: string;
  token: string;
  estimated_wait_min: number;
} | null;

export function Kiosk() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await postKioskCheckin(code.trim());
      setResult({
        checked_in: res.checked_in,
        message: res.message,
        token: res.token,
        estimated_wait_min: res.estimated_wait_min,
      });
    } catch {
      setResult({
        checked_in: false,
        message: "Code not found or check-in failed.",
        token: "",
        estimated_wait_min: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Topbar />
      <main className="mx-auto max-w-xl space-y-6 px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Kiosk Check-in</CardTitle>
            <CardDescription>
              Enter your check-in code or token. This station is privacy-safe.
            </CardDescription>
            <p className="text-muted-foreground text-xs">Most check-ins take under 30 seconds.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {result && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className={`rounded-lg border-l-4 p-4 ${
                  result.checked_in
                    ? "border-green-600 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100"
                    : "border-destructive bg-destructive/10 text-destructive"
                }`}
              >
                <p className="font-medium">{result.message}</p>
                {result.token && (
                  <p className="mt-1">
                    Token: <strong>{result.token}</strong>
                  </p>
                )}
                {result.checked_in && result.estimated_wait_min >= 0 && (
                  <p className="mt-1">
                    Estimated wait: <strong>{result.estimated_wait_min} min</strong>
                  </p>
                )}
              </motion.div>
            )}
            {result?.checked_in && result.token && (
              <div className="mt-4">
                <VitalsForm token={result.token} />
              </div>
            )}
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="code">Code or token</Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="UC-104 or A1B2C3D4"
                  className="text-center text-2xl tracking-widest"
                  autoFocus
                  required
                />
              </div>
              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading ? "Checking in…" : "Confirm Check-in"}
              </Button>
            </form>
            <Button asChild variant="secondary" className="w-full">
              <Link to="/kiosk-station/camera">Use Camera QR Mode</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
