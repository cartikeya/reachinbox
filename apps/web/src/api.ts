export type EmailStatus = 'scheduled' | 'sent' | 'failed';

export interface User { id: string; name: string; email: string; avatarUrl?: string | null; }
export interface Sender { id: string; email: string; displayName?: string | null; active: boolean; }
export interface Email { id: string; senderEmail: string; recipientEmail: string; subject: string; body: string; status: EmailStatus; scheduledAt: string; sentAt?: string | null; failedAt?: string | null; errorMessage?: string | null; etherealPreviewUrl?: string | null; attemptCount: number; }
export interface Overview { scheduled: number; sent: number; failed: number; next_scheduled?: string | null; }

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: 'include', headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? 'Request failed.');
  return payload as T;
}

export const api = {
  me: () => request<{ user: User }>('/auth/me'),
  demoLogin: () => request<{ user: User }>('/auth/demo', { method: 'POST' }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  overview: () => request<{ overview: Overview }>('/overview'),
  senders: () => request<{ senders: Sender[] }>('/senders'),
  emails: (status: EmailStatus, query = '') => request<{ emails: Email[] }>(`/emails/${status}${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  search: (query: string) => request<{ emails: Email[]; source: string }>(`/search?q=${encodeURIComponent(query)}`),
  schedule: (input: { recipients: string[]; senderEmail: string; subject: string; body: string; startAt: string; delayBetweenMs: number; hourlyLimit: number }) => request<{ count: number; skippedDuplicates: number }>('/schedule', { method: 'POST', body: JSON.stringify(input) }),
  slackStatus: () => request<{ connected: boolean; teamName?: string | null; channelId?: string | null }>('/slack/status'),
  disconnectSlack: () => request<{ ok: boolean }>('/slack/disconnect', { method: 'POST' }),
};
