"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchJson } from "../../../lib/api";
import { useToasts } from "../../../components/ToastsProvider";
import { useSessionQuery } from "../../../features/auth/useSessionQuery";

export default function SettingsPage() {
  const session = useSessionQuery();
  const toasts = useToasts();

  const [resetEmail, setResetEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetStatus, setResetStatus] = useState("Request a reset token, then confirm with a new password.");

  useEffect(() => {
    if (session.data?.user?.email) {
      setResetEmail(session.data.user.email);
    }
  }, [session.data?.user?.email]);

  async function requestReset(): Promise<void> {
    if (!resetEmail.trim()) {
      setResetStatus("Enter an email to request a reset token.");
      return;
    }
    const response = await fetchJson<{ ok: boolean; resetToken?: string }>("/api/auth/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email: resetEmail.trim() }),
    });
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
      setResetStatus("Reset token generated (non-production mode).");
      toasts.pushToast({ kind: "success", message: "Reset token generated" });
      return;
    }
    setResetStatus("If that email exists, a reset message has been sent.");
    toasts.pushToast({ kind: "info", message: "If that email exists, a reset message was sent" });
  }

  async function confirmReset(): Promise<void> {
    if (!resetToken.trim() || !resetNewPassword.trim()) {
      setResetStatus("Provide both reset token and new password.");
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
    setResetStatus("Password reset successful.");
    toasts.pushToast({ kind: "success", message: "Password reset successful" });
  }

  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Settings</h2>
          <div className="button-row">
            <Link href="/games">Games</Link>
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">Account status and password reset.</p>
      </section>

      <section className="card">
        <h2>Account</h2>
        {session.isLoading ? <p className="muted">Loading session...</p> : null}
        {session.isError ? <p className="muted">Error: {String(session.error)}</p> : null}
        {session.data?.user ? (
          <p className="muted">
            Signed in as <strong>{session.data.user.email}</strong>
          </p>
        ) : (
          <p className="muted">Not signed in.</p>
        )}
      </section>

      <section className="card">
        <h2>Password Reset</h2>
        <div className="auth-grid">
          <label>
            Email
            <input value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} />
          </label>
          <label>
            Reset Token
            <input value={resetToken} onChange={(event) => setResetToken(event.target.value)} placeholder="Token from email" />
          </label>
          <label>
            New Password
            <input
              type="password"
              value={resetNewPassword}
              onChange={(event) => setResetNewPassword(event.target.value)}
              minLength={8}
            />
          </label>
        </div>
        <div className="button-row" style={{ marginTop: 10 }}>
          <button type="button" onClick={() => void requestReset()}>
            Request reset
          </button>
          <button type="button" onClick={() => void confirmReset()}>
            Confirm reset
          </button>
        </div>
        <p className="muted">{resetStatus}</p>
      </section>
    </main>
  );
}

