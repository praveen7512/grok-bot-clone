import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Brain, Menu, Monitor, Settings2, Square, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { toTurns } from '../lib/turns';
import type { Bot, Health, ScreenSession, Turn } from '../lib/types';
import { useVoice } from '../hooks/useVoice';
import { MessageList } from './MessageList';
import { MemoryPanel } from './MemoryPanel';
import { ScreenPanel } from './ScreenPanel';
import { MicButton, VoiceModeToggle, VoiceStatus } from './VoiceControls';
import { StatusDot, avatarColor, initials } from './Sidebar';

const SUGGESTIONS = [
  'Remember that I prefer TypeScript and short answers',
  'What do you remember about me?',
  'Run uname -a && python3 --version on your computer',
  'Show me your computer',
];

export function ChatView({ bot, health, onUpdateBot, onOpenSettings, onOpenSidebar, toast }: {
  bot: Bot;
  health: Health | null;
  onUpdateBot: (patch: Partial<Pick<Bot, 'voice'>>) => void;
  onOpenSettings: () => void;
  onOpenSidebar: () => void;
  toast: (msg: string, kind?: 'error' | 'info') => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [memOpen, setMemOpen] = useState(false);
  const [memKey, setMemKey] = useState(0);
  const [screen, setScreen] = useState<{ open: boolean; session: ScreenSession | null }>({ open: false, session: null });
  const abortRef = useRef<AbortController | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef<(t: string) => void>(() => undefined);

  const voice = useVoice({
    voiceName: bot.voice.name,
    rate: bot.voice.rate,
    lang: localStorage.getItem('botclone.sttLang') ?? undefined,
    onFinalTranscript: (t) => sendRef.current(t),
  });

  const reload = useCallback(async () => {
    const { messages } = await api.messages(bot.id);
    setTurns(toTurns(messages));
  }, [bot.id]);

  useEffect(() => {
    setLoading(true);
    setTurns([]);
    setScreen({ open: false, session: null });
    abortRef.current?.abort();
    reload().catch((e) => toast((e as Error).message, 'error')).finally(() => setLoading(false));
    voice.cancelSpeech();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id]);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || streaming) return;
    setInput('');
    setStreaming(true);
    voice.cancelSpeech();
    const liveKey = `live-${Date.now()}`;
    setTurns((t) => [
      ...t,
      { key: `${liveKey}-u`, role: 'user', text: message, tools: [], createdAt: Date.now() },
      { key: liveKey, role: 'assistant', text: '', tools: [], createdAt: Date.now(), streaming: true },
    ]);
    const patchLive = (fn: (t: Turn) => Turn) => setTurns((all) => all.map((x) => (x.key === liveKey ? fn(x) : x)));
    let finalText = '';
    let sawToolOrText = false;
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await api.chat(bot.id, message, (e) => {
        switch (e.type) {
          case 'text':
            finalText += e.delta;
            sawToolOrText = true;
            patchLive((t) => ({ ...t, text: t.text + e.delta }));
            break;
          case 'assistant_saved':
            // separate assistant steps with a blank line, like the persisted view
            if (finalText && !finalText.endsWith('\n\n')) { finalText += '\n\n'; patchLive((t) => ({ ...t, text: t.text + '\n\n' })); }
            break;
          case 'tool_call':
            sawToolOrText = true;
            patchLive((t) => ({ ...t, tools: [...t.tools, { id: e.id, name: e.name, input: e.input }] }));
            break;
          case 'tool_result':
            patchLive((t) => ({ ...t, tools: t.tools.map((x) => (x.id === e.id ? { ...x, output: e.output, isError: e.isError } : x)) }));
            if (e.name.endsWith('_memory')) setMemKey((k) => k + 1);
            break;
          case 'screen':
            setScreen({ open: true, session: e.session });
            break;
          case 'error':
            toast(e.message, 'error');
            break;
        }
      }, ac.signal);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') toast((err as Error).message, 'error');
    } finally {
      setStreaming(false);
      abortRef.current = null;
      await reload().catch(() => undefined);
      if (bot.voice.enabled && sawToolOrText && finalText.trim()) {
        // speak only the last assistant step (the actual answer)
        const parts = finalText.trim().split(/\n\n+/);
        voice.speak(parts.slice(-3).join('\n\n'));
      }
    }
  }, [bot.id, bot.voice.enabled, reload, streaming, toast, voice]);
  sendRef.current = send;

  const stop = () => abortRef.current?.abort();

  const openScreen = () => setScreen({ open: true, session: null });
  const screenSupported = bot.sandboxKind === 'docker';

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 220) + 'px';
  }, [input]);

  return (
    <div className="chat-wrap">
      <section className="chat">
        <header className="chat-header">
          <button className="icon-btn mobile-only" onClick={onOpenSidebar} aria-label="Open menu"><Menu size={18} /></button>
          <span className="avatar" style={{ background: avatarColor(bot.name) }}>{initials(bot.name)}</span>
          <div className="chat-title">
            <h1>{bot.name}</h1>
            <span className="sub"><StatusDot status={bot.status} /> {bot.sandboxKind === 'docker' ? 'Private Docker computer' : 'Demo sandbox'}{health?.demoLlm ? ' · demo model' : ''}</span>
          </div>
          <span className="grow" />
          <VoiceModeToggle enabled={bot.voice.enabled} voice={voice} onToggle={() => onUpdateBot({ voice: { ...bot.voice, enabled: !bot.voice.enabled } })} />
          <button className={`chip-btn ${screen.open ? 'on' : ''}`} onClick={() => (screen.open ? setScreen({ open: false, session: null }) : openScreen())} disabled={!screenSupported} title={screenSupported ? 'See / control the bot’s desktop' : 'Screen sharing needs Docker mode'}>
            <Monitor size={15} /><span className="hide-sm">Screen</span>
          </button>
          <button className={`chip-btn ${memOpen ? 'on' : ''}`} onClick={() => setMemOpen(!memOpen)}><Brain size={15} /><span className="hide-sm">Memory</span></button>
          <button className="icon-btn" onClick={onOpenSettings} aria-label="Bot settings"><Settings2 size={17} /></button>
        </header>

        {screen.open && <ScreenPanel key={screen.session?.token ?? 'new'} botId={bot.id} botName={bot.name} initial={screen.session} onClose={() => setScreen({ open: false, session: null })} />}

        <MessageList
          turns={turns}
          botName={bot.name}
          empty={loading ? <div className="empty"><div className="typing"><i /><i /><i /></div></div> : (
            <div className="empty">
              <div className="empty-icon"><Sparkles size={22} /></div>
              <h2>Start talking to {bot.name}</h2>
              <p className="muted">This bot has its own private memory and computer. Nothing here is shared with your other bots.</p>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => <button key={s} className="suggestion" onClick={() => send(s)}>{s}</button>)}
              </div>
            </div>
          )}
        />

        <div className="composer-wrap">
          <VoiceStatus voice={voice} />
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <textarea
              ref={taRef}
              rows={1}
              placeholder={voice.listening ? 'Listening…' : `Message ${bot.name}…`}
              value={voice.listening ? voice.interim : input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); } }}
              maxLength={20000}
            />
            <MicButton voice={voice} disabled={streaming} />
            {streaming ? (
              <button type="button" className="send-btn stop" onClick={stop} aria-label="Stop"><Square size={14} /></button>
            ) : (
              <button type="submit" className="send-btn" disabled={!input.trim()} aria-label="Send"><ArrowUp size={18} /></button>
            )}
          </form>
          <p className="composer-hint muted">Enter to send · Shift+Enter for a new line · context auto-saves after every message</p>
        </div>
      </section>
      {memOpen && <MemoryPanel botId={bot.id} botName={bot.name} refreshKey={memKey} onClose={() => setMemOpen(false)} />}
    </div>
  );
}
