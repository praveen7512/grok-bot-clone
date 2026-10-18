import { useState } from 'react';
import { Plus, Bot as BotIcon, Pencil, Trash2, LogOut, X } from 'lucide-react';
import type { Bot } from '../lib/types';

export function Sidebar({ bots, activeId, onSelect, onNew, onRename, onDelete, onLogout, open, onCloseMobile }: {
  bots: Bot[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (bot: Bot) => void;
  onLogout: () => void;
  open: boolean;
  onCloseMobile: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commit = (id: string) => {
    if (draft.trim()) onRename(id, draft.trim());
    setEditing(null);
  };

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand">
        <img src="/favicon.svg" alt="" width={28} height={28} />
        <span>BotClone</span>
        <button className="icon-btn mobile-only" onClick={onCloseMobile} aria-label="Close menu"><X size={18} /></button>
      </div>
      <button className="btn primary new-bot" onClick={onNew}><Plus size={16} /> New bot</button>
      <div className="bot-list" role="list">
        {bots.length === 0 && <p className="muted small pad">No bots yet. Create your first one.</p>}
        {bots.map((b) => (
          <div
            key={b.id}
            role="listitem"
            className={`bot-item ${b.id === activeId ? 'active' : ''}`}
            onClick={() => !b.pending && editing !== b.id && onSelect(b.id)}
          >
            <span className="avatar sm" style={{ background: avatarColor(b.name) }}>{initials(b.name)}</span>
            <div className="bot-meta">
              {editing === b.id ? (
                <input
                  className="inline-input"
                  autoFocus
                  value={draft}
                  maxLength={60}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commit(b.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commit(b.id); if (e.key === 'Escape') setEditing(null); }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="bot-name">{b.name}</span>
              )}
              <span className="bot-sub">
                <StatusDot status={b.pending ? 'provisioning' : b.status} />
                {b.pending ? 'provisioning…' : b.status === 'ready' ? (b.sandboxKind === 'docker' ? 'docker' : 'demo sandbox') : b.status}
              </span>
            </div>
            {!b.pending && (
              <div className="bot-actions">
                <button className="icon-btn" aria-label="Rename" onClick={(e) => { e.stopPropagation(); setDraft(b.name); setEditing(b.id); }}><Pencil size={14} /></button>
                <button className="icon-btn" aria-label="Delete" onClick={(e) => { e.stopPropagation(); onDelete(b); }}><Trash2 size={14} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        <BotIcon size={14} /> <span className="muted small">{bots.length} bot{bots.length === 1 ? '' : 's'}</span>
        <span className="grow" />
        <button className="btn ghost small" onClick={onLogout}><LogOut size={14} /> Log out</button>
      </div>
    </aside>
  );
}

export function StatusDot({ status }: { status: string }) {
  return <span className={`dot dot-${status}`} aria-label={status} />;
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

export function avatarColor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 50) % 360} 70% 45%))`;
}
