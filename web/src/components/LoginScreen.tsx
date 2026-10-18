import { useState } from 'react';
import { Lock } from 'lucide-react';
import { api } from '../lib/api';

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try { await api.login(pw); onLoggedIn(); } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <img src="/favicon.svg" width={48} height={48} alt="" />
        <h1>BotClone</h1>
        <p className="muted">Your private fleet of AI bots — each with its own memory and computer.</p>
        <label className="field">
          <span><Lock size={12} /> Owner password</span>
          <input type="password" autoFocus autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        {err && <div className="alert error">{err}</div>}
        <button className="btn primary block" disabled={!pw || busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="hint">Set <code>OWNER_PASSWORD</code> in <code>.env</code>. If unset, the server prints a one-time password in its logs.</p>
      </form>
    </div>
  );
}
