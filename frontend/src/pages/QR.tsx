import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";

export function QR() {
  const { pid } = useParams<{ pid: string }>();
  const [data, setData] = useState<{ token: string; display_name: string } | null>(null);

  useEffect(() => {
    if (!pid) return;
    fetch(`/api/qr/${pid}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, [pid]);

  return (
    <>
      <Topbar />
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid gap-4 sm:grid-cols-2"
        >
          <Card>
            <CardHeader>
              <CardTitle>Your Check-in Details</CardTitle>
              <CardDescription>{data?.display_name ?? "…"}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border-2 border-primary bg-primary/5 py-4 text-center text-2xl font-bold tracking-wide text-primary">
                {data?.token ?? "—"}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Show this token or QR at the <strong>check-in kiosk</strong> when you arrive at the hospital.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>QR Check-in</CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              {pid ? (
                <img
                  src={`/qr-img/${pid}`}
                  alt="QR code"
                  width={220}
                  height={220}
                  className="mx-auto rounded-lg border border-border p-1"
                />
              ) : null}
              <p className="mt-2 text-sm text-muted-foreground">Show this at the kiosk or use code: <strong>{pid}</strong></p>
            </CardContent>
          </Card>
        </motion.div>
        <p className="text-center text-muted-foreground text-sm">The check-in kiosk is at the hospital; bring this QR or token when you arrive.</p>
      </main>
    </>
  );
}
