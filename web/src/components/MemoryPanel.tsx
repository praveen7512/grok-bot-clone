import { useCallback, useEffect, useState } from 'react';
import { Brain, Plus, Trash2, X, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import type { Memory } from '../lib/types';

export function MemoryPanel({ botId, botName, refreshKey, onClose }: { botId: string; botName: string; refreshKey: number; onClose: () => void }) {
  const [items, setItems] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await api.memories(botId)); setError(''); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [botId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!k.trim() || !v.trim()) return;
    try { await api.saveMemory(botId, k, v); setK(''); setV(''); load(); } catch (err) { setError((err as Error).message); }
  };
  const remove = async (key: string) => {
    setItems((x) => x.filter((m) => m.key !== key));
    try { await api.deleteMemory(botId, key); } catch (err) { setError((err as Error).message); load(); }
  };

  const shown = items.filter((m) => !filter || `${m.key} ${m.value}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <aside className="side-panel">
      <header className="panel-header">
        <Brain size={16} />
        <h3>Memory <span className="muted">· {botName}</span></h3>
        <span className="grow" />
        <button className="icon-btn" onClick={load} aria-label="Refresh"><RefreshCw size={15} className={loading ? 'spin' : ''} /></button>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </header>
      <p className="hint pad-x">Only this bot can see these. They’re injected into its prompt every turn and survive restarts.</p>
      <input className="search" placeholder="Filter memories…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {error && <div className="alert error pad-x">{error}</div>}
      <ul className="memory-list">
        {!loading && shown.length === 0 && <li className="muted small pad">No memories yet. Try telling the bot “remember that I prefer TypeScript”.</li>}
        {shown.map((m) => (
          <li key={m.key} className="memory-item">
            <div>
              <code className="mem-key">{m.key}</code>
              <p className="mem-val">{m.value}</p>
              <span className="muted tiny-text">{new Date(m.updatedAt).toLocaleString()}</span>
            </div>
            <button className="icon-btn" aria-label={`Delete ${m.key}`} onClick={() => remove(m.key)}><Trash2 size={14} /></button>
          </li>
        ))}
      </ul>
      <form className="memory-add" onSubmit={add}>
        <input placeholder="key" value={k} onChange={(e) => setK(e.target.value)} maxLength={80} />
        <input placeholder="value" value={v} onChange={(e) => setV(e.target.value)} maxLength={4000} />
        <button className="btn primary small" disabled={!k.trim() || !v.trim()}><Plus size={14} /> Add</button>
      </form>
    </aside>
  );
}
