import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { User, Monitor, Tv, Briefcase } from "lucide-react";
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
    { to: "/kiosk-station", title: "Kiosk Station", desc: "Front-desk kiosk for token or code check-in.", icon: Monitor },
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
            <CardTitle className="text-lg">Multi-Computer Test URLs</CardTitle>
            <CardDescription>Use one URL per computer in your live test:</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground text-sm space-y-1">
              <li>Patient computer: <strong>/patient-station</strong></li>
              <li>Kiosk computer: <strong>/kiosk-station</strong></li>
              <li>Waiting room TV/computer: <strong>/waiting-room-station</strong></li>
              <li>Staff computer: <strong>/staff-station</strong></li>
            </ul>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
