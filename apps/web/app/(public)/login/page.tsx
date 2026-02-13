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
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
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
    await queryClient.refetchQueries({ queryKey: ["session"] });
    toasts.pushToast({ kind: "success", message: mode === "login" ? "Signed in" : "Account created" });
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
      setResetStatus("Reset token generated (non-production mode)");
      toasts.pushToast({ kind: "success", message: "Reset token generated" });
      return;
    }

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
        <p className="muted" style={{ fontSize: 12 }} data-testid="auth-next">
          Next: {next}
        </p>
      </section>

      <section className="card">
        <h2>Password Reset</h2>
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
          <div className="button-row">
            <button type="button" onClick={() => void requestPasswordReset()} data-testid="reset-request">
              Request Reset
            </button>
            <button type="button" onClick={() => void confirmPasswordReset()} data-testid="reset-confirm">
              Confirm Reset
            </button>
          </div>
        </div>
        <p className="muted" data-testid="reset-status">{resetStatus}</p>
      </section>
    </main>
  );
}
