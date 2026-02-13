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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    function onResize() {
      if (window.innerWidth > 920) {
        setNavOpen(false);
      }
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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

  return (
    <div
      className="app-shell"
    >
      <aside
        className={`app-shell-nav ${navOpen ? "open" : ""}`}
      >
        <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
          <div style={{ fontWeight: 700 }}>Chess DB</div>
          <div style={{ fontSize: 12, opacity: 0.7 }} data-testid="user-email">
            {props.userEmail}
          </div>
          <div className="button-row">
            <button type="button" onClick={() => void logout()} data-testid="auth-logout">
              Logout
            </button>
          </div>
        </div>

        {sections.map((section) => (
          <div key={section.section} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
              {section.section}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setNavOpen(false)}
                    style={{
                      textDecoration: "none",
                      color: "var(--text)",
                      border: "1px solid var(--line)",
                      borderRadius: 10,
                      padding: "8px 10px",
                      background: active ? "rgba(47,111,79,0.12)" : "rgba(255,255,255,0.8)",
                    }}
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
          <button type="button" onClick={() => setNavOpen((v) => !v)}>
            Menu
          </button>
          <div style={{ fontWeight: 700 }}>Chess DB</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{props.userEmail}</div>
        </header>
        {props.children}
      </div>
    </div>
  );
}
