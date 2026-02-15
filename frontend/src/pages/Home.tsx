import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { User, Tv, Briefcase, ScanLine } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDemoMode } from "@/api/client";
import { motion } from "framer-motion";

export function Home() {
  const [demoMode, setDemoMode] = useState(false);
  useEffect(() => {
    getDemoMode().then((d) => setDemoMode(d.demo_mode)).catch(() => {});
  }, []);

  const stations = [
    { to: "/patient-station", title: "Patient Access", desc: "Complete intake and receive your QR/token for check-in.", icon: User },
    { to: "/kiosk-station", title: "Kiosk Check-in", desc: "QR scan and token entry for patient check-in at the clinic.", icon: ScanLine },
    { to: "/waiting-room-station", title: "Waiting Room Display", desc: "Token-only queue board for TVs.", icon: Tv },
    { to: "/staff-station", title: "Staff Workspace", desc: "Secure staff operations and analytics.", icon: Briefcase },
  ];
  return (
    <>
      <Topbar demoMode={demoMode} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Hospital Access Portal</CardTitle>
              <CardDescription>
                Choose your role-specific experience. Each area is isolated for real clinic workflows.
              </CardDescription>
            </CardHeader>
          </Card>
        </motion.div>
        <div className="grid gap-4 sm:grid-cols-2">
          {stations.map(({ to, title, desc, icon: Icon }, i) => (
            <motion.div
              key={to}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.05 * (i + 1) }}
            >
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Icon className="h-5 w-5" />
                    {title}
                  </CardTitle>
                  <CardDescription>{desc}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild>
                    <Link to={to}>Open</Link>
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Direct URLs (or use the Open buttons above)</CardTitle>
            <CardDescription>Use one URL per device. Avoid typing in the address bar—use these links or the buttons above so the browser doesn’t open a search.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground text-sm space-y-1">
              <li>Patient: <strong>/patient-station</strong></li>
              <li>Kiosk: <strong>/kiosk-station</strong> or <strong>/kiosk</strong></li>
              <li>Waiting room TV: <strong>/waiting-room-station</strong></li>
              <li>Staff: <strong>/staff-station</strong></li>
            </ul>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
