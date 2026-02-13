"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "../../../lib/api";
import { useToasts } from "../../../components/ToastsProvider";
import { useSessionQuery } from "../../../features/auth/useSessionQuery";
import { stripAppBasePath } from "../../../lib/basePath";

export default function LoginPage() {
  const router = useRouter();
  const [next, setNext] = useState("/games");
  const session = useSessionQuery();
  const queryClient = useQueryClient();
  const toasts = useToasts();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [seedOnRegister, setSeedOnRegister] = useState(true);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetRequested, setResetRequested] = useState(false);
  const [resetStatus, setResetStatus] = useState("Use password reset if you lose access to your password");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const parsed = new URLSearchParams(window.location.search);
    const nextParam = parsed.get("next");
    if (nextParam && nextParam.trim().length > 0) {
      const trimmed = nextParam.trim();
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        return;
      }
      setNext(stripAppBasePath(trimmed.startsWith("/") ? trimmed : `/${trimmed}`));
    }
  }, []);

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

    if (response.status >= 400) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `${mode} failed`;
      setStatus(msg);
      toasts.pushToast({ kind: "error", message: msg });
      setBusy(false);
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ["session"] });
    await queryClient.refetchQueries({ queryKey: ["session"] });
    toasts.pushToast({ kind: "success", message: mode === "login" ? "Signed in" : "Account created" });

    if (mode === "register" && seedOnRegister) {
      setStatus("Queuing starter games import (up to 1000 games)...");
      const seedResponse = await fetchJson<{ id: number }>("/api/imports/starter", {
        method: "POST",
        body: JSON.stringify({ maxGames: 1000 }),
      });
      if (seedResponse.status >= 400) {
        const msg =
          "error" in seedResponse.data && seedResponse.data.error
            ? seedResponse.data.error
            : "Failed to queue starter seed";
        toasts.pushToast({ kind: "error", message: msg });
        setStatus(msg);
      } else {
        toasts.pushToast({ kind: "success", message: "Queued starter games import. See Import page for status." });
        setStatus("Starter games import queued. You can track progress on the Import page.");
      }
    }

    setBusy(false);
    router.replace(next);
  }

  async function requestPasswordReset(): Promise<void> {
    if (!resetEmail.trim()) {
      setResetStatus("Enter an email to request a reset token");
      return;
    }

    const response = await fetchJson<{ ok: boolean; resetToken?: string }>(
      "/api/auth/password-reset/request",
      {
        method: "POST",
        body: JSON.stringify({ email: resetEmail.trim() }),
      }
    );

    if (response.status !== 200) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : "Password reset request failed";
      setResetStatus(msg);
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }

    if ("resetToken" in response.data && typeof response.data.resetToken === "string") {
      setResetToken(response.data.resetToken);
      setResetRequested(true);
      setResetStatus("Reset token generated (non-production mode)");
      toasts.pushToast({ kind: "success", message: "Reset token generated" });
      return;
    }

    setResetRequested(true);
    setResetStatus("If that email exists, a reset message has been sent");
    toasts.pushToast({ kind: "info", message: "If that email exists, a reset message was sent" });
  }

  async function confirmPasswordReset(): Promise<void> {
    if (!resetToken.trim() || !resetNewPassword.trim()) {
      setResetStatus("Provide both reset token and new password");
      return;
    }

    const response = await fetchJson<{ ok: boolean }>("/api/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ token: resetToken.trim(), newPassword: resetNewPassword }),
    });

    if (response.status !== 200) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : "Password reset confirm failed";
      setResetStatus(msg);
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }

    setResetStatus("Password reset successful. You can now log in with the new password.");
    setPassword(resetNewPassword);
    toasts.pushToast({ kind: "success", message: "Password reset successful" });
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
              data-testid="auth-email"
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
              data-testid="auth-password"
              required
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={seedOnRegister}
              onChange={(event) => setSeedOnRegister(event.target.checked)}
              disabled={busy}
            />
            Seed starter games on register (1000)
          </label>
          <div className="button-row">
            <button type="button" onClick={() => void submit("register")} disabled={busy} data-testid="auth-register">
              Register
            </button>
            <button type="submit" disabled={busy} data-testid="auth-login">
              Login
            </button>
          </div>
        </form>
        <p className="muted" data-testid="auth-status">{status || "Not signed in"}</p>
        <p className="app-shell-user" data-testid="auth-next">
          Next: {next}
        </p>
      </section>

      <section className="card">
        <h2>Password Reset</h2>
        <div className="subsection">
          <p className="muted-small">Step 1: request a reset token using your account email.</p>
          <div className="auth-grid">
            <label>
              Password Reset Email
              <input
                type="email"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                placeholder="you@example.com"
                data-testid="reset-email"
              />
            </label>
            <div className="button-row button-row-end">
              <button type="button" onClick={() => void requestPasswordReset()} data-testid="reset-request">
                Request token
              </button>
            </div>
          </div>
        </div>

        <div className="subsection">
          <p className="muted-small">Step 2: paste the token and choose a new password.</p>
          <div className="auth-grid">
            <label>
              Reset Token
              <input
                value={resetToken}
                onChange={(event) => setResetToken(event.target.value)}
                placeholder="Paste token from email"
                data-testid="reset-token"
              />
            </label>
            <label>
              New Password
              <input
                type="password"
                value={resetNewPassword}
                onChange={(event) => setResetNewPassword(event.target.value)}
                minLength={8}
                data-testid="reset-new-password"
              />
            </label>
            <div className="button-row button-row-end">
              <button
                type="button"
                onClick={() => void confirmPasswordReset()}
                data-testid="reset-confirm"
                disabled={!resetRequested && !resetToken.trim()}
              >
                Set new password
              </button>
            </div>
          </div>
        </div>
        <p className="muted" data-testid="reset-status">{resetStatus}</p>
      </section>
    </main>
  );
}
