import { memo, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronRight, Terminal, Brain, Search, Trash2, Wrench, Copy, Check } from 'lucide-react';
import type { ToolItem, Turn } from '../lib/types';
import { avatarColor, initials } from './Sidebar';

const toolMeta: Record<string, { label: string; icon: typeof Terminal }> = {
  run_shell: { label: 'Ran a command', icon: Terminal },
  save_memory: { label: 'Saved to memory', icon: Brain },
  recall_memory: { label: 'Searched memory', icon: Search },
  delete_memory: { label: 'Forgot a memory', icon: Trash2 },
};

function ToolCard({ t }: { t: ToolItem }) {
  const [open, setOpen] = useState(false);
  const meta = toolMeta[t.name] ?? { label: t.name, icon: Wrench };
  const Icon = meta.icon;
  const summary =
    t.name === 'run_shell' ? String(t.input.command ?? '') :
    t.name === 'save_memory' ? `${t.input.key}: ${t.input.value}` :
    t.name === 'recall_memory' ? String(t.input.query ?? 'all') : JSON.stringify(t.input);
  return (
    <div className={`tool-card ${t.isError ? 'error' : ''} ${t.output === undefined ? 'running' : ''}`}>
      <button className="tool-head" onClick={() => setOpen(!open)}>
        <ChevronRight size={14} className={`chev ${open ? 'open' : ''}`} />
        <Icon size={14} />
        <span className="tool-label">{meta.label}</span>
        <code className="tool-summary">{summary}</code>
        {t.output === undefined && <span className="spinner-dot" />}
      </button>
      {open && t.output !== undefined && <pre className="tool-output">{t.output}</pre>}
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="icon-btn tiny" aria-label="Copy" onClick={() => { navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }}>
      {ok ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

const TurnView = memo(function TurnView({ turn, botName }: { turn: Turn; botName: string }) {
  if (turn.role === 'user') {
    return (
      <div className="turn user">
        <div className="bubble user-bubble">{turn.text}</div>
      </div>
    );
  }
  return (
    <div className="turn assistant">
      <span className="avatar" style={{ background: avatarColor(botName) }}>{initials(botName)}</span>
      <div className="assistant-body">
        {turn.tools.length > 0 && <div className="tools">{turn.tools.map((t) => <ToolCard key={t.id} t={t} />)}</div>}
        {turn.text ? (
          <div className="markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.text}</ReactMarkdown>
            {turn.streaming && <span className="caret" />}
          </div>
        ) : turn.streaming && !turn.tools.length ? (
          <div className="typing"><i /><i /><i /></div>
        ) : null}
        {!turn.streaming && turn.text && <div className="turn-actions"><CopyBtn text={turn.text} /></div>}
      </div>
    </div>
  );
});

export function MessageList({ turns, botName, empty }: { turns: Turn[]; botName: string; empty?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [turns]);
  return (
    <div
      className="messages"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div className="messages-inner">
        {turns.length === 0 ? empty : turns.map((t) => <TurnView key={t.key} turn={t} botName={botName} />)}
      </div>
    </div>
  );
}
