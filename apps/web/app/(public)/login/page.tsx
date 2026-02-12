"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "../../../lib/api";
import { useToasts } from "../../../components/ToastsProvider";
import { useSessionQuery } from "../../../features/auth/useSessionQuery";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/games";
  const session = useSessionQuery();
  const queryClient = useQueryClient();
  const toasts = useToasts();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session.data?.user) {
      router.replace(next);
    }
  }, [session.data?.user, router, next]);

  async function submit(mode: "login" | "register") {
    setBusy(true);
    setStatus("");
    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const response = await fetchJson<{ user: { email: string } }>(endpoint, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);

    if (response.status >= 400) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `${mode} failed`;
      setStatus(msg);
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ["session"] });
    toasts.pushToast({ kind: "success", message: mode === "login" ? "Signed in" : "Account created" });
    router.replace(next);
  }

  return (
    <main>
      <h1>Chess DB</h1>
      <p className="muted">Sign in to access your database.</p>

      <section className="card">
        <h2>Account</h2>
        <form
          className="auth-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void submit("login");
          }}
        >
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password"
              minLength={8}
              required
            />
          </label>
          <div className="button-row">
            <button type="button" onClick={() => void submit("register")} disabled={busy}>
              Register
            </button>
            <button type="submit" disabled={busy}>
              Login
            </button>
          </div>
        </form>
        {status ? <p className="muted">{status}</p> : null}
      </section>
    </main>
  );
}

