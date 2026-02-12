"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "../../components/AppShell";
import { useSessionQuery } from "../../features/auth/useSessionQuery";

export default function AppLayout(props: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const session = useSessionQuery();

  const nextUrl = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;

  useEffect(() => {
    if (!session.isLoading && session.data?.user === null) {
      router.replace(`/login?next=${encodeURIComponent(nextUrl)}`);
    }
  }, [router, nextUrl, session.isLoading, session.data?.user]);

  if (session.isLoading) {
    return (
      <main>
        <section className="card">
          <h2>Loading session...</h2>
          <p className="muted">Checking authentication.</p>
        </section>
      </main>
    );
  }

  if (session.isError) {
    return (
      <main>
        <section className="card">
          <h2>Session error</h2>
          <p className="muted">{String(session.error)}</p>
        </section>
      </main>
    );
  }

  if (!session.data?.user) {
    return (
      <main>
        <section className="card">
          <h2>Redirecting...</h2>
        </section>
      </main>
    );
  }

  return <AppShell userEmail={session.data.user.email}>{props.children}</AppShell>;
}

