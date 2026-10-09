import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailRecord } from './types.js';
import { config } from './config.js';

let transporter: Transporter | null = null;
let transporterPromise: Promise<Transporter> | null = null;
let createdTestAccount = false;

async function getTransporter() {
  if (transporter) return transporter;
  if (!transporterPromise) {
    transporterPromise = (async () => {
      if (config.etherealUser && config.etherealPass) {
        return nodemailer.createTransport({ host: config.etherealHost, port: config.etherealPort, secure: config.etherealPort === 465, auth: { user: config.etherealUser, pass: config.etherealPass } });
      }
      const account = await nodemailer.createTestAccount();
      createdTestAccount = true;
      console.log(`Ethereal test account created for demo delivery: ${account.user}`);
      return nodemailer.createTransport({ host: account.smtp.host, port: account.smtp.port, secure: account.smtp.secure, auth: { user: account.user, pass: account.pass } });
    })();
  }
  transporter = await transporterPromise;
  return transporter;
}

export async function sendEmail(email: EmailRecord) {
  const mailer = await getTransporter();
  const messageId = `<${email.id}@reachinbox.local>`;
  const info = await mailer.sendMail({ from: email.senderEmail, to: email.recipientEmail, subject: email.subject, text: email.body, html: email.body.replace(/\n/g, '<br />'), messageId });
  const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;
  return { messageId, previewUrl, usingGeneratedAccount: createdTestAccount };
}
