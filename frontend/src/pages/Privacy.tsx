import { Topbar } from "@/components/layout/Topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";

export function Privacy() {
  const points = [
    "CarePilot Urgent provides operational triage workflow support only and does not diagnose.",
    "Camera frames are processed in memory for QR detection only and are not recorded to disk.",
    "QR values are decoded in memory and used only for check-in token resolution.",
    "Public waiting-room screens show token-only queue details with no medical symptoms displayed.",
  ];
  return (
    <>
      <Topbar />
      <main className="mx-auto max-w-2xl px-4 py-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Privacy and Safety Statement</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground text-sm">
                {points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </motion.div>
      </main>
    </>
  );
}
