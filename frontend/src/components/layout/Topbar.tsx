import { Link, useLocation } from "react-router-dom";
import { Stethoscope, Shield, LayoutDashboard, BarChart3, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Portal", icon: LayoutDashboard },
  { to: "/privacy", label: "Privacy", icon: Shield },
];

export function Topbar({ demoMode }: { demoMode?: boolean } = {}) {
  const location = useLocation();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-primary text-primary-foreground shadow-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-6 w-6" />
          <span className="font-bold text-lg tracking-tight">CarePilot Urgent</span>
          {demoMode && (
            <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-bold">DEMO MODE</span>
          )}
        </div>
        <nav className="flex items-center gap-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to}>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "text-primary-foreground/90 hover:bg-primary-foreground/20 hover:text-primary-foreground",
                  location.pathname === to && "bg-primary-foreground/20"
                )}
              >
                <Icon className="mr-1.5 h-4 w-4" />
                {label}
              </Button>
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function StaffTopbar({ demoMode }: { demoMode?: boolean } = {}) {
  const location = useLocation();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-primary text-primary-foreground shadow-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-6 w-6" />
          <span className="font-bold text-lg tracking-tight">CarePilot Urgent</span>
          {demoMode && (
            <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-bold">DEMO MODE</span>
          )}
        </div>
        <nav className="flex items-center gap-1">
          <Link to="/">
            <Button variant="ghost" size="sm" className="text-primary-foreground/90 hover:bg-primary-foreground/20 hover:text-primary-foreground">
              Portal
            </Button>
          </Link>
          <Link to="/staff">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "text-primary-foreground/90 hover:bg-primary-foreground/20 hover:text-primary-foreground",
                location.pathname === "/staff" && "bg-primary-foreground/20"
              )}
            >
              Staff
            </Button>
          </Link>
          <Link to="/analytics">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "text-primary-foreground/90 hover:bg-primary-foreground/20 hover:text-primary-foreground",
                location.pathname === "/analytics" && "bg-primary-foreground/20"
              )}
            >
              <BarChart3 className="mr-1.5 h-4 w-4" />
              Analytics
            </Button>
          </Link>
          <form method="post" action="/staff/logout" className="inline">
            <Button type="submit" variant="ghost" size="sm" className="text-primary-foreground/90 hover:bg-primary-foreground/20">
              <LogOut className="mr-1.5 h-4 w-4" />
              Logout
            </Button>
          </form>
        </nav>
      </div>
    </header>
  );
}
