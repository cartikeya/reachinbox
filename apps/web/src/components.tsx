import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Activity, ArrowUpRight, Check, ChevronDown, FileText, LoaderCircle, Mail, Plus, Search, Send, ShieldCheck, Sparkles, Upload, X, Zap } from 'lucide-react';
import type { Email, Sender, User } from './api';

export function Logo() {
  return <div className="brand-mark"><div className="brand-icon"><span /><span /><i /></div><span className="brand-word">reach<span>/</span>INBOX</span></div>;
}

export function Avatar({ user, small = false }: { user: User; small?: boolean }) {
  return user.avatarUrl ? <img className={small ? 'avatar avatar-small' : 'avatar'} src={user.avatarUrl} alt="" /> : <div className={small ? 'avatar avatar-small avatar-fallback' : 'avatar avatar-fallback'}>{user.name.slice(0, 1).toUpperCase()}</div>;
}

export function StatusPill({ status }: { status: Email['status'] }) {
  const label = status === 'scheduled' ? 'Queued' : status === 'sent' ? 'Sent' : 'Failed';
  return <span className={`status-pill status-${status}`}><span className="status-dot" />{label}</span>;
}

export function MetricCard({ label, value, hint, tone = 'violet', icon: Icon }: { label: string; value: number | string; hint: string; tone?: string; icon: typeof Activity }) {
  return <div className={`metric-card metric-${tone}`}><div className="metric-top"><span className="eyebrow">{label}</span><span className="metric-icon"><Icon size={16} /></span></div><div className="metric-value">{value}</div><div className="metric-hint">{hint}</div></div>;
}

export function EmailTable({ emails, loading, type, onCompose }: { emails: Email[]; loading: boolean; type: 'scheduled' | 'sent'; onCompose: () => void }) {
  if (loading) return <div className="table-state"><LoaderCircle className="spin" size={24} /><span>Syncing the send rail…</span></div>;
  if (!emails.length) return <div className="empty-state"><div className="empty-icon"><Mail size={25} /></div><h3>{type === 'scheduled' ? 'Your queue is quiet.' : 'No deliveries yet.'}</h3><p>{type === 'scheduled' ? 'Compose a message and put your next conversation on a rail.' : 'Once emails are delivered, they will appear here with preview links.'}</p><button className="button button-primary" onClick={onCompose}><Plus size={16} /> Compose email</button></div>;
  return <div className="table-shell"><table><thead><tr><th>Recipient</th><th>Subject</th><th>{type === 'scheduled' ? 'Scheduled time' : 'Sent time'}</th><th>Status</th><th /></tr></thead><tbody>{emails.map((email) => <tr key={email.id}><td><div className="recipient-cell"><span className="recipient-avatar">{email.recipientEmail.slice(0, 1).toUpperCase()}</span><div><strong>{email.recipientEmail}</strong><small>via {email.senderEmail}</small></div></div></td><td><span className="subject-cell">{email.subject}</span></td><td><span className="time-cell">{formatDate(type === 'scheduled' ? email.scheduledAt : email.sentAt)}</span></td><td><StatusPill status={email.status} />{email.errorMessage && <small className="error-detail">{email.errorMessage}</small>}</td><td>{email.etherealPreviewUrl ? <a className="table-link" href={email.etherealPreviewUrl} target="_blank" rel="noreferrer">Preview <ArrowUpRight size={13} /></a> : <span className="muted">—</span>}</td></tr>)}</tbody></table></div>;
}

export function Sidebar({ active, onChange, onCompose, user }: { active: 'scheduled' | 'sent'; onChange: (value: 'scheduled' | 'sent') => void; onCompose: () => void; user: User }) {
  return <aside className="sidebar"><Logo /><div className="rail-label">Workspace</div><nav><button className={active === 'scheduled' ? 'nav-item active' : 'nav-item'} onClick={() => onChange('scheduled')}><Zap size={17} /><span>Scheduled</span><span className="nav-count">01</span></button><button className={active === 'sent' ? 'nav-item active' : 'nav-item'} onClick={() => onChange('sent')}><Send size={17} /><span>Sent</span></button></nav><button className="compose-rail" onClick={onCompose}><Plus size={17} /><span>Compose new</span><span className="shortcut">⌘ K</span></button><div className="sidebar-bottom"><div className="rail-label">System</div><div className="system-status"><span className="live-dot" />All systems nominal</div><div className="user-chip"><Avatar user={user} small /><div><strong>{user.name}</strong><small>{user.email}</small></div><ChevronDown size={14} /></div></div></aside>;
}

export function Topbar({ active, onCompose, query, setQuery, onSearch }: { active: 'scheduled' | 'sent'; onCompose: () => void; query: string; setQuery: (value: string) => void; onSearch: (event: FormEvent) => void }) {
  return <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span className="slash">/</span><strong>{active === 'scheduled' ? 'Scheduled emails' : 'Sent emails'}</strong></div><div className="top-actions"><form className="search-box" onSubmit={onSearch}><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the send rail…" /><kbd>⌘ K</kbd></form><button className="button button-primary button-compact" onClick={onCompose}><Plus size={16} /> Compose</button></div></header>;
}

export function ComposeModal({ open, onClose, onSubmit, senders, submitting }: { open: boolean; onClose: () => void; onSubmit: (input: { recipients: string[]; senderEmail: string; subject: string; body: string; startAt: string; delayBetweenMs: number; hourlyLimit: number }) => Promise<void>; senders: Sender[]; submitting: boolean }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [startAt, setStartAt] = useState(toLocalInput(new Date(Date.now() + 5 * 60 * 1000)));
  const [delay, setDelay] = useState('2');
  const [hourlyLimit, setHourlyLimit] = useState('200');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const activeSender = senderEmail || senders[0]?.email || '';
  if (!open) return null;
  const parseLeadFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => { const found = String(reader.result).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []; setRecipients([...new Set(found.map((value) => value.toLowerCase()))]); };
    reader.readAsText(file);
  };
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!recipients.length) return setError('Upload a CSV or text file with at least one email address.');
    if (!subject.trim() || !body.trim()) return setError('Add a subject and body before scheduling.');
    setError('');
    await onSubmit({ recipients, senderEmail: activeSender, subject, body, startAt: new Date(startAt).toISOString(), delayBetweenMs: Math.max(0, Number(delay) * 1000), hourlyLimit: Math.max(1, Number(hourlyLimit)) });
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="compose-modal"><div className="modal-header"><div><span className="eyebrow">New sequence</span><h2>Put a conversation on a rail.</h2><p>One message, many thoughtful sends. Delivery is paced automatically.</p></div><button className="icon-button" onClick={onClose} aria-label="Close compose"><X size={20} /></button></div><form onSubmit={handleSubmit}><div className="compose-grid"><label className="field"><span>From</span><select value={activeSender} onChange={(event) => setSenderEmail(event.target.value)}>{senders.map((sender) => <option key={sender.email} value={sender.email}>{sender.email}</option>)}{!senders.length && <option value="reachinbox.demo@ethereal.email">reachinbox.demo@ethereal.email</option>}</select></label><label className="field"><span>Start time</span><input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label></div><label className="field"><span>Subject</span><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="A useful note for your next conversation" /></label><label className="field"><span>Message body</span><textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write something relevant and human…" rows={5} /></label><div className="upload-panel"><input id="lead-upload" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={parseLeadFile} /><label htmlFor="lead-upload" className="upload-label"><div className="upload-icon"><Upload size={18} /></div><div><strong>{fileName || 'Drop your lead list here'}</strong><small>{fileName ? `${recipients.length} unique email addresses detected` : 'CSV or TXT · email addresses are detected automatically'}</small></div><FileText size={18} /></label></div><div className="compose-grid compose-grid-three"><label className="field"><span>Delay between sends</span><div className="input-suffix"><input type="number" min="0" step="0.5" value={delay} onChange={(event) => setDelay(event.target.value)} /><em>sec</em></div></label><label className="field"><span>Hourly limit</span><div className="input-suffix"><input type="number" min="1" value={hourlyLimit} onChange={(event) => setHourlyLimit(event.target.value)} /><em>emails</em></div></label><div className="detected-count"><span className="eyebrow">Detected</span><strong>{recipients.length.toString().padStart(2, '0')}</strong><small>recipients</small></div></div>{error && <div className="form-error">{error}</div>}<div className="modal-footer"><div className="delivery-note"><ShieldCheck size={16} /><span>Idempotent scheduling · restart safe</span></div><div className="footer-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={submitting}>{submitting ? <><LoaderCircle size={16} className="spin" /> Scheduling…</> : <><Sparkles size={16} /> Schedule emails</>}</button></div></div></form></section></div>;
}

export function formatDate(value?: string | null) { if (!value) return '—'; const date = new Date(value); return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`; }
function toLocalInput(date: Date) { const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16); }
