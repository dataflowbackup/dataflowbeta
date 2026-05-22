/**
 * Correo SMTP (invitaciones, reset opcional).
 * Variables: SMTP_HOST, SMTP_PORT, SMTP_SECURE (true|false), SMTP_USER, SMTP_PASS, MAIL_FROM (From:)
 * APP_PUBLIC_URL — base de la app p. ej. https://playful-liger-bf4118.netlify.app
 */
import nodemailer from "nodemailer";

export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
}

export async function sendMail(options: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  if (!isMailConfigured()) {
    throw new Error(
      "Correo no configurado: definí SMTP_HOST, SMTP_USER, SMTP_PASS (y opcional SMTP_PORT, MAIL_FROM).",
    );
  }
  const host = process.env.SMTP_HOST!.trim();
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure =
    process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1" || port === 465;
  const user = process.env.SMTP_USER!.trim();
  const pass = process.env.SMTP_PASS!;
  const from = (process.env.MAIL_FROM || process.env.SMTP_FROM || `"Data Flow" <${user}>`).trim();

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html ?? options.text.replace(/\n/g, "<br/>"),
  });
}

/** URL pública de la app sin barra final */
export function getAppPublicUrl(): string {
  const raw = (
    process.env.APP_PUBLIC_URL ||
    process.env.VITE_SITE_URL ||
    process.env.URL ||
    "http://localhost:5000"
  )
    .trim()
    .replace(/\/$/, "");
  return raw;
}
