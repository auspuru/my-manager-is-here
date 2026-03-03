import { useState, useEffect, useCallback, useRef } from 'react';
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay, addDays } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { io, Socket } from 'socket.io-client';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import type { User, CalendarEvent, Task, Notification, PublicProfile } from './types';

// In production (Railway), the frontend and backend share the same origin.
// In local dev, point to the backend dev server.
const API = import.meta.env.VITE_API_URL || '';

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }),
  getDay,
  locales: { 'en-US': enUS },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

const EVENT_TYPES = [
  { value: 'busy', label: 'Busy', color: '#ef4444' },
  { value: 'meeting', label: 'Meeting', color: '#f97316' },
  { value: 'focus', label: 'Focus', color: '#8b5cf6' },
  { value: 'break', label: 'Break', color: '#22c55e' },
] as const;

const PRIORITY_COLORS = { low: '#22c55e', medium: '#f97316', high: '#ef4444' };

const STATUS_COLORS: Record<string, string> = {
  available: '#22c55e',
  busy: '#ef4444',
  meeting: '#f97316',
  focus: '#8b5cf6',
  break: '#22c55e',
};

// ─── Small reusable UI ────────────────────────────────────────────────────────
function Badge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 font-mono">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <div className="animate-slide-in w-full max-w-md rounded-xl border p-6" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-bright)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold" style={{ fontFamily: 'Space Mono, monospace' }}>{title}</h2>
          <button onClick={onClose} className="text-2xl leading-none hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-xs font-medium mb-1 block uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <input
        {...props}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500 transition"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
      />
    </label>
  );
}

function Select({ label, children, ...props }: { label: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="text-xs font-medium mb-1 block uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <select
        {...props}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500 transition"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
      >
        {children}
      </select>
    </label>
  );
}

function Btn({ variant = 'primary', className = '', ...props }: { variant?: 'primary' | 'ghost' | 'danger' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = {
    primary: { background: 'var(--accent)', color: 'white', border: 'none' },
    ghost: { background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)' },
    danger: { background: '#ef4444', color: 'white', border: 'none' },
  };
  return (
    <button
      {...props}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-85 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
      style={styles[variant]}
    />
  );
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }: { onAuth: (user: User, token: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ username: '', password: '', displayName: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError('');
    setLoading(true);
    try {
      const path = mode === 'login' ? '/api/login' : '/api/register';
      const data = await apiFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      localStorage.setItem('am_token', data.token);
      localStorage.setItem('am_user', JSON.stringify(data.user));
      onAuth(data.user, data.token);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-primary)' }}>
      {/* Background grid */}
      <div className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
        opacity: 0.3,
      }} />

      <div className="relative w-full max-w-sm animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-lg font-bold" style={{ background: 'var(--accent)' }}>◈</div>
            <span className="text-xl font-bold" style={{ fontFamily: 'Space Mono, monospace' }}>avail</span>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>collaborative scheduling</p>
        </div>

        <div className="rounded-2xl border p-6" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-bright)' }}>
          <div className="flex rounded-lg mb-5 p-1" style={{ background: 'var(--bg-secondary)' }}>
            {(['login', 'register'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className="flex-1 py-2 rounded-md text-sm font-medium transition-all capitalize"
                style={mode === m ? { background: 'var(--accent)', color: 'white' } : { color: 'var(--text-muted)' }}
              >{m}</button>
            ))}
          </div>

          <div className="space-y-4">
            {mode === 'register' && (
              <Input label="Display Name" value={form.displayName} onChange={f('displayName')} placeholder="Your Name" />
            )}
            <Input label="Username" value={form.username} onChange={f('username')} placeholder="username" autoComplete="username" />
            <Input label="Password" type="password" value={form.password} onChange={f('password')} placeholder="••••••••"
              onKeyDown={(e) => e.key === 'Enter' && submit()} />

            {error && (
              <div className="rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                {error}
              </div>
            )}

            <Btn className="w-full" onClick={submit} disabled={loading}>
              {loading ? '...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Notification Panel ───────────────────────────────────────────────────────
function NotificationPanel({ notifications, onMarkRead, onMarkAllRead }: {
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}) {
  const unread = notifications.filter((n) => !n.read);
  return (
    <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border shadow-2xl z-50 animate-slide-in overflow-hidden"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-bright)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-sm font-semibold" style={{ fontFamily: 'Space Mono, monospace' }}>Notifications</span>
        {unread.length > 0 && (
          <button onClick={onMarkAllRead} className="text-xs hover:opacity-70" style={{ color: 'var(--accent)' }}>
            Mark all read
          </button>
        )}
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: '360px' }}>
        {notifications.length === 0 ? (
          <div className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>No notifications</div>
        ) : (
          notifications.map((n) => (
            <div key={n.id}
              onClick={() => !n.read && onMarkRead(n.id)}
              className="px-4 py-3 border-b cursor-pointer transition-colors hover:bg-opacity-50"
              style={{
                borderColor: 'var(--border)',
                background: n.read ? 'transparent' : 'rgba(59,130,246,0.05)',
                borderLeft: n.read ? 'none' : `3px solid ${n.type === 'urgent' ? '#ef4444' : 'var(--accent)'}`,
              }}>
              <p className="text-sm leading-snug" style={{ color: n.read ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                {n.message}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {format(new Date(n.createdAt), 'MMM d, h:mm a')}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Create Event Modal ───────────────────────────────────────────────────────
function CreateEventModal({ slot, onSave, onClose }: {
  slot: { start: Date; end: Date } | null;
  onSave: (event: Omit<CalendarEvent, 'id' | 'userId' | 'color' | 'createdAt'>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    title: '',
    type: 'busy' as CalendarEvent['type'],
    isPublic: true,
    start: slot ? format(slot.start, "yyyy-MM-dd'T'HH:mm") : '',
    end: slot ? format(slot.end, "yyyy-MM-dd'T'HH:mm") : '',
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  return (
    <Modal title="New Event" onClose={onClose}>
      <div className="space-y-4">
        <Input label="Title" value={form.title} onChange={f('title')} placeholder="Event title" />
        <Select label="Type" value={form.type} onChange={f('type')}>
          {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <Input label="Start" type="datetime-local" value={form.start} onChange={f('start')} />
        <Input label="End" type="datetime-local" value={form.end} onChange={f('end')} />
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={form.isPublic}
            onChange={(e) => setForm((p) => ({ ...p, isPublic: e.target.checked }))}
            className="w-4 h-4 rounded accent-blue-500" />
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Visible on public calendar</span>
        </label>
        <div className="flex gap-2 pt-2">
          <Btn className="flex-1" onClick={() => onSave({ ...form, start: form.start, end: form.end })}
            disabled={!form.title || !form.start || !form.end}>
            Add Event
          </Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────────────
function TaskCard({ task, onToggle }: { task: Task; onToggle: () => void }) {
  return (
    <div className="rounded-xl border p-4 transition-all"
      style={{
        background: 'var(--bg-card)',
        borderColor: task.urgent ? 'rgba(239,68,68,0.4)' : 'var(--border)',
        opacity: task.completed ? 0.5 : 1,
        borderLeft: `3px solid ${PRIORITY_COLORS[task.priority]}`,
      }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {task.urgent && <span className="text-xs px-2 py-0.5 rounded-full font-mono font-bold" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>URGENT</span>}
            <span className="text-xs px-2 py-0.5 rounded-full font-mono capitalize" style={{ background: `${PRIORITY_COLORS[task.priority]}20`, color: PRIORITY_COLORS[task.priority] }}>{task.priority}</span>
          </div>
          <p className="text-sm font-medium leading-snug" style={{ textDecoration: task.completed ? 'line-through' : 'none', color: 'var(--text-primary)' }}>{task.title}</p>
          {task.description && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{task.description}</p>}
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>from <span style={{ color: 'var(--text-secondary)' }}>{task.assignerName}</span></span>
            {task.dueDate && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>due {format(new Date(task.dueDate), 'MMM d')}</span>}
          </div>
        </div>
        <button onClick={onToggle}
          className="w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all"
          style={{ borderColor: task.completed ? '#22c55e' : 'var(--border-bright)', background: task.completed ? '#22c55e' : 'transparent' }}>
          {task.completed && <span className="text-white text-xs">✓</span>}
        </button>
      </div>
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────
function SettingsPanel({ user }: { user: User }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}${window.location.pathname}?user=${user.username}`;

  const copy = () => {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border p-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
        <h3 className="text-sm font-semibold mb-4" style={{ fontFamily: 'Space Mono, monospace', color: 'var(--text-secondary)' }}>SHARE LINK</h3>
        <div className="flex gap-2">
          <div className="flex-1 rounded-lg px-3 py-2 text-sm font-mono truncate" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            {link}
          </div>
          <Btn onClick={copy}>{copied ? '✓ Copied' : 'Copy'}</Btn>
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>Share this link so others can view your availability and assign tasks.</p>
      </div>

      <div className="rounded-xl border p-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
        <h3 className="text-sm font-semibold mb-4" style={{ fontFamily: 'Space Mono, monospace', color: 'var(--text-secondary)' }}>EVENT COLORS</h3>
        <div className="grid grid-cols-2 gap-3">
          {EVENT_TYPES.map((t) => (
            <div key={t.value} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ background: t.color }} />
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Public Profile View ──────────────────────────────────────────────────────
function PublicView({ username }: { username: string }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: '', description: '', dueDate: '', priority: 'medium', assignerName: '', urgent: false });
  const [taskError, setTaskError] = useState('');
  const [taskSuccess, setTaskSuccess] = useState('');
  const [taskLoading, setTaskLoading] = useState(false);

  useEffect(() => {
    apiFetch(`/api/public/${username}`)
      .then(setProfile)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [username]);

  const submitTask = async () => {
    if (!taskForm.title || !taskForm.assignerName) {
      setTaskError('Title and your name are required');
      return;
    }
    setTaskLoading(true);
    setTaskError('');
    try {
      await apiFetch('/api/tasks/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...taskForm, targetUsername: username }),
      });
      setTaskSuccess('Task assigned successfully!');
      setTaskForm({ title: '', description: '', dueDate: '', priority: 'medium', assignerName: '', urgent: false });
      setShowTaskForm(false);
      setTimeout(() => setTaskSuccess(''), 4000);
    } catch (e: any) {
      setTaskError(e.message);
    } finally {
      setTaskLoading(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
    </div>
  );

  if (error || !profile) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div className="text-center">
        <p className="text-4xl mb-3">404</p>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>User not found</p>
      </div>
    </div>
  );

  const statusColor = STATUS_COLORS[profile.status] || '#64748b';

  return (
    <div className="min-h-screen p-6 max-w-2xl mx-auto" style={{ background: 'var(--bg-primary)' }}>
      {/* Fixed background grid */}
      <div className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
        opacity: 0.2,
      }} />

      <div className="relative space-y-5 animate-fade-in">
        {/* Header */}
        <div className="rounded-2xl border p-6" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-bright)' }}>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded flex items-center justify-center text-white text-sm font-bold" style={{ background: 'var(--accent)' }}>◈</div>
                <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>avail</span>
              </div>
              <h1 className="text-2xl font-bold" style={{ fontFamily: 'Space Mono, monospace' }}>{profile.user.displayName}</h1>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>@{profile.user.username}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ background: statusColor, boxShadow: `0 0 8px ${statusColor}` }} />
              <span className="text-sm font-medium capitalize" style={{ color: statusColor }}>{profile.status}</span>
            </div>
          </div>
          {profile.currentEvent && (
            <div className="mt-4 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
              Currently: <strong style={{ color: 'var(--text-primary)' }}>{profile.currentEvent.title}</strong>
              {' '}until {format(new Date(profile.currentEvent.end), 'h:mm a')}
            </div>
          )}
        </div>

        {/* Upcoming schedule */}
        <div className="rounded-2xl border p-6" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold mb-4" style={{ fontFamily: 'Space Mono, monospace', color: 'var(--text-secondary)' }}>NEXT 7 DAYS</h2>
          {profile.upcomingEvents.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No upcoming events — looks free!</p>
          ) : (
            <div className="space-y-2">
              {profile.upcomingEvents.map((e) => (
                <div key={e.id} className="flex items-center gap-3 py-2 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: e.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{e.title}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {format(new Date(e.start), 'EEE MMM d, h:mm a')} – {format(new Date(e.end), 'h:mm a')}
                    </p>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full capitalize flex-shrink-0" style={{ background: `${e.color}20`, color: e.color }}>{e.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Task assignment */}
        {taskSuccess && (
          <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e' }}>
            {taskSuccess}
          </div>
        )}

        {!showTaskForm ? (
          <Btn className="w-full py-3 text-base" onClick={() => setShowTaskForm(true)}>
            + Assign Task to {profile.user.displayName}
          </Btn>
        ) : (
          <div className="rounded-2xl border p-6 space-y-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-bright)' }}>
            <h2 className="text-sm font-semibold" style={{ fontFamily: 'Space Mono, monospace', color: 'var(--text-secondary)' }}>ASSIGN TASK</h2>
            <Input label="Task Title *" value={taskForm.title} onChange={(e) => setTaskForm((p) => ({ ...p, title: e.target.value }))} placeholder="What needs to be done?" />
            <label className="block">
              <span className="text-xs font-medium mb-1 block uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Description</span>
              <textarea value={taskForm.description} onChange={(e) => setTaskForm((p) => ({ ...p, description: e.target.value }))}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500 transition resize-none"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                rows={2} placeholder="Optional details..." />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Due Date" type="datetime-local" value={taskForm.dueDate} onChange={(e) => setTaskForm((p) => ({ ...p, dueDate: e.target.value }))} />
              <Select label="Priority" value={taskForm.priority} onChange={(e) => setTaskForm((p) => ({ ...p, priority: e.target.value }))}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>
            </div>
            <Input label="Your Name *" value={taskForm.assignerName} onChange={(e) => setTaskForm((p) => ({ ...p, assignerName: e.target.value }))} placeholder="Who's assigning this?" />
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={taskForm.urgent} onChange={(e) => setTaskForm((p) => ({ ...p, urgent: e.target.checked }))} className="w-4 h-4 rounded accent-red-500" />
              <span className="text-sm font-medium" style={{ color: '#ef4444' }}>🚨 Mark as Urgent</span>
            </label>
            {taskError && <div className="rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>{taskError}</div>}
            <div className="flex gap-2">
              <Btn className="flex-1" onClick={submitTask} disabled={taskLoading}>{taskLoading ? 'Sending…' : 'Assign Task'}</Btn>
              <Btn variant="ghost" onClick={() => setShowTaskForm(false)}>Cancel</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  // Check if public view
  const params = new URLSearchParams(window.location.search);
  const publicUser = params.get('user');
  if (publicUser) return <PublicView username={publicUser} />;

  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('am_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('am_token'));
  const [tab, setTab] = useState<'calendar' | 'tasks' | 'settings'>('calendar');

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [slot, setSlot] = useState<{ start: Date; end: Date } | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const notifsRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleAuth = (u: User, t: string) => {
    setUser(u);
    setToken(t);
  };

  const logout = () => {
    localStorage.removeItem('am_token');
    localStorage.removeItem('am_user');
    setUser(null);
    setToken(null);
    socketRef.current?.disconnect();
  };

  // Fetch data
  const fetchAll = useCallback(async () => {
    if (!user || !token) return;
    const headers = authHeaders(token);
    const [evts, tsks, notifs] = await Promise.all([
      apiFetch(`/api/calendar/${user.id}`, { headers }),
      apiFetch(`/api/tasks/${user.id}`, { headers }),
      apiFetch(`/api/notifications/${user.id}`, { headers }),
    ]).catch(() => [[], [], []]);
    setEvents(evts);
    setTasks(tsks);
    setNotifications(notifs);
  }, [user, token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Socket
  useEffect(() => {
    if (!user) return;
    const socket = io(API);
    socketRef.current = socket;
    socket.emit('register', user.id);
    socket.on('new-notification', (n: Notification) => {
      setNotifications((prev) => [n, ...prev]);
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(n.message);
      }
    });
    socket.on('new-task', (t: Task) => {
      setTasks((prev) => [t, ...prev]);
    });
    return () => { socket.disconnect(); };
  }, [user]);

  // Close notifs on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifsRef.current && !notifsRef.current.contains(e.target as Node)) {
        setShowNotifs(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const createEvent = async (data: Omit<CalendarEvent, 'id' | 'userId' | 'color' | 'createdAt'>) => {
    if (!token) return;
    const evt = await apiFetch('/api/events', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(data),
    });
    setEvents((p) => [...p, evt]);
    setSlot(null);
  };

  const deleteEvent = async (id: string) => {
    if (!token) return;
    await apiFetch(`/api/events/${id}`, { method: 'DELETE', headers: authHeaders(token) });
    setEvents((p) => p.filter((e) => e.id !== id));
  };

  const toggleTask = async (t: Task) => {
    if (!token) return;
    const updated = await apiFetch(`/api/tasks/${t.id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ completed: !t.completed }),
    });
    setTasks((p) => p.map((x) => (x.id === t.id ? updated : x)));
  };

  const markRead = async (id: string) => {
    if (!token) return;
    await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH', headers: authHeaders(token) });
    setNotifications((p) => p.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const markAllRead = async () => {
    if (!token || !user) return;
    await apiFetch(`/api/notifications/read-all/${user.id}`, { method: 'PATCH', headers: authHeaders(token) });
    setNotifications((p) => p.map((n) => ({ ...n, read: true })));
  };

  // Calendar event format for react-big-calendar
  const rbcEvents = events.map((e) => ({
    ...e,
    start: new Date(e.start),
    end: new Date(e.end),
    resource: e,
  }));

  if (!user || !token) return <AuthScreen onAuth={handleAuth} />;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      {/* Topbar */}
      <header className="flex items-center justify-between px-6 py-3 border-b sticky top-0 z-30" style={{ background: 'rgba(10,15,30,0.95)', backdropFilter: 'blur(12px)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded flex items-center justify-center text-white font-bold text-sm" style={{ background: 'var(--accent)' }}>◈</div>
          <span className="font-bold text-base" style={{ fontFamily: 'Space Mono, monospace' }}>avail</span>
        </div>

        <nav className="flex items-center gap-1">
          {(['calendar', 'tasks', 'settings'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all capitalize"
              style={tab === t ? { background: 'var(--accent)', color: 'white' } : { color: 'var(--text-muted)' }}>
              {t}
              {t === 'tasks' && tasks.filter((x) => !x.completed).length > 0 && (
                <span className="ml-1.5 text-xs" style={{ color: tab === 'tasks' ? 'rgba(255,255,255,0.7)' : 'var(--accent)' }}>
                  {tasks.filter((x) => !x.completed).length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {/* Notif bell */}
          <div className="relative" ref={notifsRef}>
            <button onClick={() => setShowNotifs((p) => !p)}
              className="relative w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-opacity-50"
              style={{ background: showNotifs ? 'var(--bg-card)' : 'transparent', color: 'var(--text-secondary)' }}>
              <span className="text-lg">🔔</span>
              <Badge count={unreadCount} />
            </button>
            {showNotifs && (
              <NotificationPanel
                notifications={notifications}
                onMarkRead={markRead}
                onMarkAllRead={markAllRead}
              />
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm hidden sm:block" style={{ color: 'var(--text-secondary)' }}>{user.displayName}</span>
            <button onClick={logout} className="text-xs px-2 py-1 rounded transition-colors hover:opacity-70" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
              out
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 p-4 md:p-6">
        {/* Calendar Tab */}
        {tab === 'calendar' && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-bold" style={{ fontFamily: 'Space Mono, monospace' }}>Your Calendar</h1>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Click a time slot to create an event</p>
              </div>
              <Btn onClick={() => setSlot({ start: new Date(), end: addDays(new Date(), 0) })}>+ Event</Btn>
            </div>

            <div className="rounded-2xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', height: '65vh', minHeight: 400 }}>
              <Calendar
                localizer={localizer}
                events={rbcEvents}
                startAccessor="start"
                endAccessor="end"
                titleAccessor="title"
                defaultView={Views.MONTH}
                views={[Views.MONTH, Views.WEEK, Views.DAY]}
                selectable
                onSelectSlot={({ start, end }) => setSlot({ start, end })}
                onSelectEvent={(e: any) => {
                  if (confirm(`Delete event "${e.title}"?`)) deleteEvent(e.id);
                }}
                eventPropGetter={(event: any) => ({
                  style: { backgroundColor: event.color || '#3b82f6', borderRadius: 4, border: 'none', color: 'white' },
                })}
                style={{ height: '100%' }}
              />
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-4">
              {EVENT_TYPES.map((t) => (
                <div key={t.value} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />
                  {t.label}
                </div>
              ))}
              <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>Click event to delete</span>
            </div>
          </div>
        )}

        {/* Tasks Tab */}
        {tab === 'tasks' && (
          <div className="space-y-4 max-w-2xl animate-fade-in">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-bold" style={{ fontFamily: 'Space Mono, monospace' }}>Tasks</h1>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {tasks.filter((t) => !t.completed).length} pending · {tasks.filter((t) => t.completed).length} done
                </p>
              </div>
            </div>

            {tasks.length === 0 ? (
              <div className="rounded-2xl border py-16 text-center" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
                <p className="text-4xl mb-3">📋</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No tasks yet. Share your link to get started.</p>
              </div>
            ) : (
              <>
                {tasks.filter((t) => t.urgent && !t.completed).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ fontFamily: 'Space Mono, monospace', color: '#ef4444' }}>Urgent</p>
                    <div className="space-y-2">
                      {tasks.filter((t) => t.urgent && !t.completed).map((t) => <TaskCard key={t.id} task={t} onToggle={() => toggleTask(t)} />)}
                    </div>
                  </div>
                )}
                {tasks.filter((t) => !t.urgent && !t.completed).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ fontFamily: 'Space Mono, monospace', color: 'var(--text-muted)' }}>Pending</p>
                    <div className="space-y-2">
                      {tasks.filter((t) => !t.urgent && !t.completed).map((t) => <TaskCard key={t.id} task={t} onToggle={() => toggleTask(t)} />)}
                    </div>
                  </div>
                )}
                {tasks.filter((t) => t.completed).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ fontFamily: 'Space Mono, monospace', color: 'var(--text-muted)' }}>Completed</p>
                    <div className="space-y-2">
                      {tasks.filter((t) => t.completed).map((t) => <TaskCard key={t.id} task={t} onToggle={() => toggleTask(t)} />)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {tab === 'settings' && (
          <div className="max-w-lg animate-fade-in">
            <h1 className="text-lg font-bold mb-5" style={{ fontFamily: 'Space Mono, monospace' }}>Settings</h1>
            <SettingsPanel user={user} />
          </div>
        )}
      </main>

      {/* Create Event Modal */}
      {slot && (
        <CreateEventModal
          slot={slot}
          onSave={createEvent}
          onClose={() => setSlot(null)}
        />
      )}
    </div>
  );
}
