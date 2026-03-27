"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchJson } from "../lib/api";
import { useToasts } from "./ToastsProvider";

type NavItem = {
  href: string;
  label: string;
  section: string;
};

const NAV: NavItem[] = [
  { section: "Database", href: "/games", label: "Games" },
  { section: "Data", href: "/import", label: "Import" },
  { section: "Search", href: "/search/position", label: "Position Search" },
  { section: "Explore", href: "/openings", label: "Opening Explorer" },
  { section: "Organize", href: "/collections", label: "Collections" },
  { section: "Organize", href: "/tags", label: "Tags" },
  { section: "Organize", href: "/filters", label: "Saved Filters" },
  { section: "Data", href: "/exports", label: "Exports" },
  { section: "Ops", href: "/ops/dead-letters", label: "Dead Letters" },
  { section: "Settings", href: "/settings", label: "Settings" },
  { section: "Dev", href: "/diagnostics", label: "Diagnostics" },
];

const NAV_COLLAPSED_STORAGE_KEY = "chessdb.nav.collapsed";

function groupNav(items: NavItem[]): Array<{ section: string; items: NavItem[] }> {
  const sections: Array<{ section: string; items: NavItem[] }> = [];
  for (const item of items) {
    const last = sections[sections.length - 1];
    if (last && last.section === item.section) {
      last.items.push(item);
    } else {
      sections.push({ section: item.section, items: [item] });
    }
  }
  return sections;
}

export function AppShell(props: {
  userEmail: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const [navOpen, setNavOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.localStorage.getItem(NAV_COLLAPSED_STORAGE_KEY);
    if (stored === "1") {
      setNavCollapsed(true);
    }

    function syncViewport() {
      const desktop = window.innerWidth > 920;
      setIsDesktop(desktop);
      if (desktop) {
        setNavOpen(false);
      }
    }

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(NAV_COLLAPSED_STORAGE_KEY, navCollapsed ? "1" : "0");
  }, [navCollapsed]);

  async function logout(): Promise<void> {
    const response = await fetchJson<{ ok: boolean }>("/api/auth/logout", { method: "POST" }, { jsonBody: false });
    if (response.status !== 200) {
      toasts.pushToast({
        kind: "error",
        message:
          "error" in response.data && response.data.error
            ? response.data.error
            : "Logout failed",
      });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    toasts.pushToast({ kind: "success", message: "Signed out" });
    router.replace("/login");
  }

  const sections = groupNav(NAV);

  function toggleNavigation(): void {
    if (isDesktop) {
      setNavCollapsed((value) => !value);
      return;
    }
    setNavOpen((value) => !value);
  }

  return (
    <div className={`app-shell ${navCollapsed ? "nav-collapsed" : ""}`}>
      <button
        type="button"
        className={`app-shell-overlay ${navOpen ? "open" : ""}`}
        onClick={() => setNavOpen(false)}
        aria-label="Close navigation"
      />
      <aside
        id="app-nav"
        className={`app-shell-nav ${navOpen ? "open" : ""}`}
      >
        <div className="app-shell-brand">
          <div className="app-shell-title">Chess DB</div>
          <div className="app-shell-user" data-testid="user-email">
            {props.userEmail}
          </div>
          <div className="button-row">
            <button type="button" onClick={() => void logout()} data-testid="auth-logout">
              Logout
            </button>
          </div>
        </div>

        {sections.map((section) => (
          <div key={section.section} className="app-shell-nav-section">
            <div className="app-shell-nav-label">
              {section.section}
            </div>
            <div className="app-shell-nav-items">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setNavOpen(false)}
                    className={`app-shell-nav-link ${active ? "active" : ""}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </aside>
      <div className="app-shell-content">
        <header className="app-shell-top">
          <button
            type="button"
            onClick={() => toggleNavigation()}
            aria-expanded={isDesktop ? !navCollapsed : navOpen}
            aria-controls="app-nav"
          >
            {isDesktop ? (navCollapsed ? "Show sidebar" : "Hide sidebar") : "Menu"}
          </button>
          <div className="app-shell-title">Chess DB</div>
          <div className="app-shell-user">{props.userEmail}</div>
        </header>
        {props.children}
      </div>
    </div>
  );
}
