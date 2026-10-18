import { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor, MousePointer2, Eye, X, RotateCw, Maximize2, Minimize2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { ScreenSession } from '../lib/types';

type RFBType = InstanceType<typeof import('@novnc/novnc').default>;
type ConnState = 'connecting' | 'connected' | 'expired' | 'error' | 'reauth';

export function ScreenPanel({ botId, botName, initial, onClose }: { botId: string; botName: string; initial?: ScreenSession | null; onClose: () => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFBType | null>(null);
  const [session, setSession] = useState<ScreenSession | null>(initial ?? null);
  const [state, setState] = useState<ConnState>('connecting');
  const [msg, setMsg] = useState('');
  const [big, setBig] = useState(false);
  const [left, setLeft] = useState(0);

  const requestSession = useCallback(async (mode: 'view' | 'control') => {
    setState('connecting');
    try {
      setSession(await api.screenSession(botId, mode));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState('reauth');
      else { setState('error'); setMsg((e as Error).message); }
    }
  }, [botId]);

  useEffect(() => { if (!session) requestSession('view'); }, [session, requestSession]);

  // connect noVNC whenever we get a fresh session
  useEffect(() => {
    if (!session || !holder.current) return;
    let cancelled = false;
    let rfb: RFBType | null = null;
    (async () => {
      const { default: RFB } = await import('@novnc/novnc');
      if (cancelled || !holder.current) return;
      holder.current.innerHTML = '';
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      rfb = new RFB(holder.current, `${proto}//${location.host}${session.wsPath}`, { wsProtocols: ['binary'], shared: true });
      rfb.viewOnly = session.mode === 'view';
      rfb.scaleViewport = true;
      rfb.background = '#05070a';
      rfb.addEventListener('connect', () => setState('connected'));
      rfb.addEventListener('disconnect', () => {
        if (cancelled) return;
        if (session.expiresAt <= Date.now() + 2000) setState('expired');
        else { setState('error'); setMsg('Connection closed. If your login expired, sign in again.'); }
      });
      rfbRef.current = rfb;
    })();
    return () => { cancelled = true; rfb?.disconnect(); rfbRef.current = null; };
  }, [session]);

  // countdown to token expiry
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => setLeft(Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [session]);

  const mode = session?.mode ?? 'view';
  return (
    <div className={`screen-panel ${big ? 'big' : ''}`}>
      <header className="panel-header">
        <Monitor size={16} />
        <h3>{botName}’s computer</h3>
        <span className={`badge ${state === 'connected' ? 'ok' : ''}`}>{state === 'connected' ? (mode === 'control' ? 'controlling' : 'viewing') : state}</span>
        {session && state === 'connected' && <span className="muted small hide-sm">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} left</span>}
        <span className="grow" />
        <div className="segmented" role="tablist" aria-label="Screen mode">
          <button className={mode === 'view' ? 'on' : ''} onClick={() => mode !== 'view' && requestSession('view')}><Eye size={14} /> View</button>
          <button className={mode === 'control' ? 'on' : ''} onClick={() => mode !== 'control' && requestSession('control')}><MousePointer2 size={14} /> Control</button>
        </div>
        <button className="icon-btn" onClick={() => setBig(!big)} aria-label="Toggle size">{big ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
        <button className="icon-btn" onClick={onClose} aria-label="Close screen"><X size={16} /></button>
      </header>
      <div className="screen-body">
        <div ref={holder} className="vnc-holder" />
        {state !== 'connected' && (
          <div className="screen-overlay">
            {state === 'connecting' && <p><RotateCw size={18} className="spin" /> Connecting to the bot’s desktop…</p>}
            {state === 'expired' && (<><p>Screen session expired (sessions last 10 minutes).</p><button className="btn primary" onClick={() => requestSession(mode)}>Reconnect</button></>)}
            {state === 'error' && (<><p>{msg || 'Could not connect.'}</p><button className="btn primary" onClick={() => requestSession(mode)}>Try again</button></>)}
            {state === 'reauth' && <p>Your login expired. Please sign in again.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
