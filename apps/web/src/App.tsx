import { useEffect, useState, type FormEvent } from 'react';
import { Activity, Bell, CheckCircle2, LogOut, MessageSquare, RefreshCw, Send, Settings2, TriangleAlert } from 'lucide-react';
import { api, type Email, type Overview, type Sender, type User } from './api';
import { Avatar, ComposeModal, EmailTable, MetricCard, Sidebar, Topbar } from './components';

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [active, setActive] = useState<'scheduled' | 'sent'>('scheduled');
  const [emails, setEmails] = useState<Email[]>([]);
  const [overview, setOverview] = useState<Overview>({ scheduled: 0, sent: 0, failed: 0 });
  const [senders, setSenders] = useState<Sender[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState('');
  const [slack, setSlack] = useState<{ connected: boolean; teamName?: string | null; channelId?: string | null }>({ connected: false });

  const loadWorkspace = async (currentUser: User) => {
    setLoading(true);
    try {
      const [summary, senderResponse, slackStatus] = await Promise.all([api.overview(), api.senders(), api.slackStatus()]);
      setOverview(summary.overview); setSenders(senderResponse.senders); setSlack(slackStatus);
      const emailResponse = await api.emails(active, query); setEmails(emailResponse.emails);
    } catch (error) { setToast(error instanceof Error ? error.message : 'Could not load workspace.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { api.me().then(({ user: currentUser }) => { setUser(currentUser); return loadWorkspace(currentUser); }).catch(() => { setUser(null); setLoading(false); }); }, []);
  useEffect(() => { if (user) api.emails(active, query).then(({ emails: next }) => setEmails(next)).catch(() => undefined); }, [active]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 5000); return () => window.clearTimeout(timer); }, [toast]);

  if (user === undefined) return <div className="boot-screen"><div className="loader-orbit" /><span>Connecting to the send rail…</span></div>;
  if (!user) return <LoginScreen onDemoLogin={async () => { try { const { user: next } = await api.demoLogin(); setUser(next); await loadWorkspace(next); } catch { window.alert('Demo access is disabled. Configure Google OAuth for real workspace access.'); } }} />;

  const refresh = () => loadWorkspace(user);
  const handleSearch = async (event: FormEvent) => { event.preventDefault(); if (!query.trim()) return refresh(); try { const result = await api.search(query); setEmails(result.emails); } catch (error) { setToast(error instanceof Error ? error.message : 'Search failed.'); } };
  const schedule = async (input: Parameters<typeof api.schedule>[0]) => { setSubmitting(true); try { const result = await api.schedule(input); setComposeOpen(false); setToast(`${result.count} email${result.count === 1 ? '' : 's'} queued${result.skippedDuplicates ? ` · ${result.skippedDuplicates} duplicate${result.skippedDuplicates === 1 ? '' : 's'} skipped` : ''}.`); await loadWorkspace(user); } catch (error) { setToast(error instanceof Error ? error.message : 'Could not schedule emails.'); } finally { setSubmitting(false); } };
  const logout = async () => { await api.logout(); setUser(null); };

  return <div className="app-shell"><Sidebar active={active} onChange={setActive} onCompose={() => setComposeOpen(true)} user={user} /><main className="workspace"><Topbar active={active} onCompose={() => setComposeOpen(true)} query={query} setQuery={setQuery} onSearch={handleSearch} /><div className="workspace-scroll"><section className="hero-row"><div><span className="eyebrow eyebrow-signal"><span className="live-dot" /> Live workspace</span><h1>Keep every send <span>thoughtful.</span></h1><p>One calm control room for the conversations that move your business forward.</p></div><div className="hero-actions"><button className="button button-ghost" onClick={refresh}><RefreshCw size={15} /> Refresh</button><button className="button button-primary" onClick={() => setComposeOpen(true)}><Send size={15} /> Compose email</button></div></section><section className="metrics-grid"><MetricCard label="Scheduled" value={overview.scheduled} hint={overview.next_scheduled ? `Next · ${new Date(overview.next_scheduled).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Ready when you are'} tone="violet" icon={Activity} /><MetricCard label="Sent" value={overview.sent} hint="Delivered through Ethereal" tone="mint" icon={CheckCircle2} /><MetricCard label="Needs attention" value={overview.failed} hint={overview.failed ? 'Review failed deliveries' : 'No failed deliveries'} tone="amber" icon={TriangleAlert} /><SlackCard status={slack} onConnect={() => { window.location.href = '/api/slack/connect'; }} onDisconnect={async () => { await api.disconnectSlack(); setSlack({ connected: false }); }} /></section><section className="content-section"><div className="section-heading"><div><span className="eyebrow">Delivery ledger</span><h2>{active === 'scheduled' ? 'Scheduled emails' : 'Sent emails'}</h2></div><div className="section-meta"><span className="live-dot" /> Auto-refreshed on action</div></div><EmailTable emails={emails} loading={loading} type={active} onCompose={() => setComposeOpen(true)} /></section><footer className="workspace-footer"><span>ReachInbox Scheduler <strong>v1.0</strong></span><span>Worker concurrency <strong>configurable</strong> · Redis-backed rate limits</span><button className="logout-link" onClick={logout}><LogOut size={14} /> Log out</button></footer></div></main><ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} onSubmit={schedule} senders={senders} submitting={submitting} />{toast && <div className="toast"><Bell size={16} /><span>{toast}</span><button onClick={() => setToast('')}>×</button></div>}</div>;
}

function LoginScreen({ onDemoLogin }: { onDemoLogin: () => Promise<void> }) {
  return <div className="login-screen"><div className="login-noise" /><div className="login-panel"><div className="login-brand"><div className="brand-icon"><span /><span /><i /></div><span className="brand-word">reach<span>/</span>INBOX</span></div><span className="eyebrow eyebrow-signal">SEND CONTROL ROOM</span><h1>Put every send<br /><span>on a rail.</span></h1><p>A dependable workspace for scheduling thoughtful outbound at the pace your team intends.</p><button className="google-button" onClick={() => { window.location.href = '/api/auth/google'; }}><span className="google-g">G</span> Continue with Google <span className="button-arrow">→</span></button><button className="demo-login-button" onClick={onDemoLogin}>Use local demo access <span>↗</span></button><div className="login-rule"><span>Secure workspace access</span></div><div className="login-trust"><span><CheckCircle2 size={14} /> OAuth protected</span><span><Activity size={14} /> Queue aware</span><span><ShieldIcon /> Restart safe</span></div></div><div className="login-aside"><span className="eyebrow">Today’s signal</span><strong>98.4%</strong><p>of scheduled sends are delivered within the intended window.</p><div className="signal-bars"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><span className="aside-note">ETHEREAL DELIVERY MONITOR</span></div></div>;
}
function ShieldIcon() { return <Settings2 size={14} />; }
function SlackCard({ status, onConnect, onDisconnect }: { status: { connected: boolean; teamName?: string | null }; onConnect: () => void; onDisconnect: () => Promise<void> }) { return <div className="metric-card metric-slack"><div className="metric-top"><span className="eyebrow">Slack alerts</span><span className="metric-icon"><MessageSquare size={16} /></span></div><div className="slack-line"><span className={status.connected ? 'slack-badge connected' : 'slack-badge'}>#</span><div><strong>{status.connected ? status.teamName ?? 'Connected workspace' : 'Not connected'}</strong><small>{status.connected ? 'Rate-limit alerts are live' : 'Get notified when a sender throttles'}</small></div></div>{status.connected ? <button className="text-button" onClick={onDisconnect}>Disconnect</button> : <button className="text-button" onClick={onConnect}>Connect Slack <span>→</span></button>}</div>; }
