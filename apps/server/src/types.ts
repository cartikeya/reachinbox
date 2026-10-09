export type EmailStatus = 'scheduled' | 'sending' | 'sent' | 'failed';

export interface User {
  id: string;
  googleId?: string | null;
  name: string;
  email: string;
  avatarUrl?: string | null;
}

export interface Sender {
  id: string;
  email: string;
  displayName?: string | null;
  active: boolean;
}

export interface EmailRecord {
  id: string;
  userId: string;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt?: string | null;
  failedAt?: string | null;
  errorMessage?: string | null;
  messageId?: string | null;
  etherealPreviewUrl?: string | null;
  idempotencyKey: string;
  batchId?: string | null;
  attemptCount: number;
  delayBetweenMs: number;
  hourlyLimit: number;
  lastRateLimitWindow?: string | null;
  createdAt: string;
}

export interface ScheduleEmailInput {
  recipientEmail: string;
  senderEmail: string;
  subject: string;
  body: string;
  scheduledAt: string;
  delayBetweenMs: number;
  hourlyLimit: number;
}

export interface ScheduleBatchInput {
  recipients: string[];
  senderEmail: string;
  subject: string;
  body: string;
  startAt: string;
  delayBetweenMs: number;
  hourlyLimit: number;
}
