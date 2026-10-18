import { useCallback, useEffect, useState } from 'react';
import { Plus, Info } from 'lucide-react';
import { api, setUnauthorizedHandler } from './lib/api';
import type { Bot, Health, VoiceSettings } from './lib/types';
import { useVoice } from './hooks/useVoice';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { NewBotModal } from './components/NewBotModal';
import { BotSettingsModal } from './components/BotSettingsModal';
import { ConfirmDialog } from './components/Modal';
import { LoginScreen } from './components/LoginScreen';

type Toast = { id: number; msg: string; kind: 'error' | 'info' };

export default function App() {
  const [auth, setAuth] = useState<'unknown' | 'in' | 'out'>('unknown');
  const [health, setHealth] = useState<Health | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem('botclone.active'));
  const [showNew, setShowNew] = useState(false);
  const [settingsFor, setSettingsFor] = useState<Bot | null>(null);
  const [deleting, setDeleting] = useState<Bot | null>(null);
  const [clearing, setClearing] = useState<Bot | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [chatKey, setChatKey] = useState(0);
  const previewVoice = useVoice();

  const toast = useCallback((msg: string, kind: 'error' | 'info' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth('out'));
    api.me().then((r) => setAuth(r.authenticated ? 'in' : 'out')).catch(() => setAuth('out'));
    api.health().then(setHealth).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (auth !== 'in') return;
    api.listBots().then((list) => {
      setBots(list);
      setActiveId((cur) => (cur && list.some((b) => b.id === cur) ? cur : list[0]?.id ?? null));
    }).catch((e) => toast(e.message, 'error'));
  }, [auth, toast]);

  useEffect(() => { if (activeId) localStorage.setItem('botclone.active', activeId); }, [activeId]);

  const createBot = async (input: { name: string; persona: string; voice: VoiceSettings }) => {
    const tempId = `pending-${Date.now()}`;
    const now = Date.now();
    setBots((b) => [...b, { id: tempId, name: input.name, persona: input.persona, status: 'provisioning', sandboxKind: null, voice: input.voice, lastActiveAt: null, createdAt: now, updatedAt: now, pending: true }]);
    try {
      const bot = await api.createBot(input);
      setBots((b) => b.map((x) => (x.id === tempId ? bot : x)));
      setActiveId(bot.id);
      setSidebarOpen(false);
      return bot;
    } catch (e) {
      setBots((b) => b.filter((x) => x.id !== tempId)); // server rolled back too
      throw e;
    }
  };

  const updateBot = async (id: string, patch: Parameters<typeof api.updateBot>[1]) => {
    const prev = bots;
    setBots((b) => b.map((x) => (x.id === id ? { ...x, ...patch, voice: { ...x.voice, ...patch.voice } } as Bot : x)));
    try {
      const bot = await api.updateBot(id, patch);
      setBots((b) => b.map((x) => (x.id === id ? bot : x)));
    } catch (e) {
      setBots(prev);
      toast((e as Error).message, 'error');
      throw e;
    }
  };

  const deleteBot = async (bot: Bot) => {
    try {
      await api.deleteBot(bot.id);
      setBots((b) => b.filter((x) => x.id !== bot.id));
      if (activeId === bot.id) setActiveId(bots.find((x) => x.id !== bot.id)?.id ?? null);
      toast(`Deleted ${bot.name} and its computer`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  if (auth === 'unknown') return <div className="splash"><div className="typing"><i /><i /><i /></div></div>;
  if (auth === 'out') return <LoginScreen onLoggedIn={() => setAuth('in')} />;

  const active = bots.find((b) => b.id === activeId && !b.pending) ?? null;

  return (
    <div className="app">
      {sidebarOpen && <div className="scrim mobile-only" onClick={() => setSidebarOpen(false)} />}
      <Sidebar
        bots={bots}
        activeId={activeId}
        open={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
        onSelect={(id) => { setActiveId(id); setSidebarOpen(false); }}
        onNew={() => setShowNew(true)}
        onRename={(id, name) => updateBot(id, { name }).catch(() => undefined)}
        onDelete={setDeleting}
        onLogout={() => api.logout().finally(() => setAuth('out'))}
      />
      <main className="main">
        {(health?.demoLlm || health?.sandbox.defaultKind === 'subprocess') && (
          <div className="banner">
            <Info size={14} />
            {health.demoLlm && <span>Demo model active — add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> to use Claude.</span>}
            {health.sandbox.defaultKind === 'subprocess' && <span>Sandbox demo mode — start Docker for isolated computers and screen sharing.</span>}
          </div>
        )}
        {active ? (
          <ChatView
            key={`${active.id}-${chatKey}`}
            bot={active}
            health={health}
            toast={toast}
            onOpenSidebar={() => setSidebarOpen(true)}
            onOpenSettings={() => setSettingsFor(active)}
            onUpdateBot={(patch) => updateBot(active.id, patch).catch(() => undefined)}
          />
        ) : (
          <div className="welcome">
            <img src="/favicon.svg" width={56} height={56} alt="" />
            <h1>Welcome to BotClone</h1>
            <p className="muted">Create bots with their own personality, memory, voice and private computer.</p>
            <button className="btn primary" onClick={() => setShowNew(true)}><Plus size={16} /> Create your first bot</button>
            <button className="btn ghost mobile-only" onClick={() => setSidebarOpen(true)}>Open bot list</button>
          </div>
        )}
      </main>

      {showNew && <NewBotModal voice={previewVoice} sandboxKind={health?.sandbox.defaultKind} onClose={() => setShowNew(false)} onCreate={createBot} />}
      {settingsFor && (
        <BotSettingsModal
          bot={settingsFor}
          voice={previewVoice}
          onClose={() => setSettingsFor(null)}
          onSave={(patch) => updateBot(settingsFor.id, patch)}
          onClearHistory={() => { setClearing(settingsFor); setSettingsFor(null); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          message="This permanently deletes the bot, its conversation, its memories and its computer (container + files)."
          onConfirm={() => deleteBot(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
      {clearing && (
        <ConfirmDialog
          title="Clear conversation?"
          message="The chat history and summary for this bot will be deleted. Memories are kept."
          confirmLabel="Clear"
          onConfirm={() => api.clearMessages(clearing.id).then(() => setChatKey((k) => k + 1)).catch((e) => toast(e.message, 'error'))}
          onClose={() => setClearing(null)}
        />
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
      </div>
    </div>
  );
}
