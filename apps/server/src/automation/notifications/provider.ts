import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import type { SmtpEnv } from "../../config/env.js";
import { logger as defaultLogger } from "../../lib/logger.js";
import type {
  EmailMessage,
  EmailProvider,
  EmailSendResult,
} from "./types.js";

function maskEmail(address: string): string {
  const [local, domain] = address.split("@");

  if (!local || !domain) {
    return "invalid-recipient";
  }

  return `${local.slice(0, 1)}***@${domain}`;
}

export interface LogEmailProviderOptions {
  logger?: Pick<typeof defaultLogger, "info">;
}

/**
 * Development adapter. It never transmits a message and only writes a short,
 * non-sensitive preview so flows can be inspected locally.
 */
export function createLogEmailProvider(
  options: LogEmailProviderOptions = {},
): EmailProvider {
  const log = options.logger ?? defaultLogger;

  return {
    name: "development-log",
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const preview = message.text.replace(/\s+/g, " ").slice(0, 180);
      const messageId = `log-${randomUUID()}`;

      log.info("Development email notification", {
        to: maskEmail(message.to),
        subject: message.subject,
        preview,
      });

      return {
        providerName: "development-log",
        providerMessageId: messageId,
      };
    },
  };
}

export function createSmtpEmailProvider(smtp: SmtpEnv): EmailProvider {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    ...(smtp.user && smtp.password
      ? { auth: { user: smtp.user, pass: smtp.password } }
      : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return {
    name: "smtp",
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const info = await transport.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html ?? undefined,
      });

      return {
        providerName: "smtp",
        providerMessageId: info.messageId || null,
      };
    },
  };
}

export function createEmailProvider(smtp: SmtpEnv | null): EmailProvider {
  return smtp ? createSmtpEmailProvider(smtp) : createLogEmailProvider();
}
