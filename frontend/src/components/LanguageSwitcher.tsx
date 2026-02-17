import { Button } from "@/components/ui/button";
import { Languages } from "lucide-react";
import { Language, getLanguage, setLanguage } from "@/lib/i18n";
import { useState, useEffect } from "react";

export function LanguageSwitcher() {
  const [lang, setLangState] = useState<Language>(getLanguage());

  useEffect(() => {
    setLanguage(lang);
  }, [lang]);

  const toggle = () => {
    const newLang = lang === "en" ? "ar" : "en";
    setLangState(newLang);
    setLanguage(newLang);
    // Dispatch storage event so other components listening to storage changes will update
    window.dispatchEvent(new Event("storage"));
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      className="text-primary-foreground/90 hover:bg-primary-foreground/20 hover:text-primary-foreground"
      title={lang === "en" ? "Switch to Arabic" : "التبديل إلى الإنجليزية"}
    >
      <Languages className="mr-1.5 h-4 w-4" />
      {lang === "en" ? "العربية" : "English"}
    </Button>
  );
}
