import nodemailer from "nodemailer";
import type { AppConfig } from "../config.js";

export type PasswordResetMailer = {
  sendPasswordResetEmail(params: { email: string; token: string }): Promise<void>;
};

function hasSmtpConfig(config: AppConfig): boolean {
  return Boolean(
    config.smtpHost &&
      config.smtpPort &&
      config.smtpUser &&
      config.smtpPass &&
      config.passwordResetFrom &&
      config.passwordResetBaseUrl
  );
}

export function createPasswordResetMailer(config: AppConfig): PasswordResetMailer {
  const smtpConfigured = hasSmtpConfig(config);

  if (config.nodeEnv === "production" && !smtpConfigured) {
    throw new Error(
      "SMTP configuration is required in production for password reset emails (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, PASSWORD_RESET_FROM, PASSWORD_RESET_BASE_URL)."
    );
  }

  if (!smtpConfigured) {
    return {
      async sendPasswordResetEmail(): Promise<void> {
        return;
      },
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.smtpHost!,
    port: config.smtpPort!,
    secure: config.smtpSecure,
    auth: {
      user: config.smtpUser!,
      pass: config.smtpPass!,
    },
  });

  return {
    async sendPasswordResetEmail(params): Promise<void> {
      const resetUrl = new URL(config.passwordResetBaseUrl!);
      resetUrl.searchParams.set("token", params.token);

      await transporter.sendMail({
        from: config.passwordResetFrom!,
        to: params.email,
        subject: "Chess DB Password Reset",
        text: [
          "You requested a password reset for Chess DB.",
          `Use this link to reset your password: ${resetUrl.toString()}`,
          "If you did not request this, you can ignore this email.",
        ].join("\n\n"),
      });
    },
  };
}

