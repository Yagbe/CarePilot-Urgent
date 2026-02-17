import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { User, Tv, Briefcase, ScanLine } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDemoMode } from "@/api/client";
import { motion } from "framer-motion";
import { t, getLanguage, type Language } from "@/lib/i18n";

export function Home() {
  const [demoMode, setDemoMode] = useState(false);
  const [lang, setLang] = useState<Language>(getLanguage());
  useEffect(() => {
    getDemoMode().then((d) => setDemoMode(d.demo_mode)).catch(() => {});
    const handleStorage = () => setLang(getLanguage());
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const stations = [
    { to: "/patient-station", titleKey: "home.patientAccess", descKey: "home.patientAccessDesc", icon: User },
    { to: "/kiosk-station", titleKey: "home.kiosk", descKey: "home.kioskDesc", icon: ScanLine },
    { to: "/waiting-room-station", titleKey: "home.waitingRoom", descKey: "home.waitingRoomDesc", icon: Tv },
    { to: "/staff-station", titleKey: "home.staff", descKey: "home.staffDesc", icon: Briefcase },
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
              <CardTitle>{t("home.title", lang)}</CardTitle>
              <CardDescription>
                {t("home.subtitle", lang)}
              </CardDescription>
            </CardHeader>
          </Card>
        </motion.div>
        <div className="grid gap-4 sm:grid-cols-2">
          {stations.map(({ to, titleKey, descKey, icon: Icon }, i) => (
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
                    {t(titleKey, lang)}
                  </CardTitle>
                  <CardDescription>{t(descKey, lang)}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild>
                    <Link to={to}>{t("home.open", lang)}</Link>
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("home.directUrlsTitle", lang)}</CardTitle>
            <CardDescription>{t("home.directUrlsDesc", lang)}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground text-sm space-y-1">
              <li>{t("home.directPatient", lang)}: <strong>/patient-station</strong></li>
              <li>{t("home.directKiosk", lang)}: <strong>/kiosk-station</strong> or <strong>/kiosk</strong></li>
              <li>{t("home.directWaitingRoom", lang)}: <strong>/waiting-room-station</strong></li>
              <li>{t("home.directStaff", lang)}: <strong>/staff-station</strong></li>
            </ul>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
