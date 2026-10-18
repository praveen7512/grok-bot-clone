import { useState } from 'react';
import { Check, Loader2, AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { VoicePicker } from './VoicePicker';
import type { VoiceApi } from '../hooks/useVoice';
import type { Bot, VoiceSettings } from '../lib/types';

type Stage = 'form' | 'pending' | 'ready' | 'error';

export function NewBotModal({ onClose, onCreate, voice, sandboxKind }: {
  onClose: () => void;
  onCreate: (input: { name: string; persona: string; voice: VoiceSettings }) => Promise<Bot>;
  voice: VoiceApi;
  sandboxKind?: 'docker' | 'subprocess';
}) {
  const [name, setName] = useState('');
  const [persona, setPersona] = useState('');
  const [v, setV] = useState<VoiceSettings>({ enabled: false, name: null, rate: 1 });
  const [stage, setStage] = useState<Stage>('form');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setStage('pending');
    setError('');
    try {
      await onCreate({ name: name.trim(), persona: persona.trim(), voice: v });
      setStage('ready');
      setTimeout(onClose, 450);
    } catch (err) {
      setError((err as Error).message);
      setStage('error');
    }
  };

  const busy = stage === 'pending' || stage === 'ready';
  return (
    <Modal title="New bot" onClose={busy ? () => undefined : onClose} footer={
      stage === 'form' || stage === 'error' ? (
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" form="new-bot-form" type="submit" disabled={!name.trim()}>Create bot</button>
        </>
      ) : undefined
    }>
      {busy ? (
        <div className="provisioning">
          <Step done label="Bot record, context and memory namespace created" />
          <Step done={stage === 'ready'} active={stage === 'pending'} label={sandboxKind === 'docker' ? 'Provisioning private Docker computer…' : 'Preparing sandbox (demo mode)…'} />
          <Step done={stage === 'ready'} label="Ready — opening chat" />
          <p className="hint">First bot on a fresh machine can take a little longer while the sandbox starts.</p>
        </div>
      ) : (
        <form id="new-bot-form" onSubmit={submit} className="stack">
          {stage === 'error' && (
            <div className="alert error"><AlertTriangle size={16} /> <span>{error} <em>Nothing was created; it’s safe to retry.</em></span></div>
          )}
          <label className="field">
            <span>Name</span>
            <input autoFocus maxLength={60} placeholder="e.g. Research Buddy" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Persona / instructions <em className="muted">(optional)</em></span>
            <textarea rows={4} maxLength={8000} placeholder="You are a patient tutor who explains things in simple Hinglish…" value={persona} onChange={(e) => setPersona(e.target.value)} />
          </label>
          <fieldset className="fieldset">
            <legend>Voice</legend>
            <VoicePicker value={v} onChange={setV} voice={voice} botName={name} />
          </fieldset>
        </form>
      )}
    </Modal>
  );
}

function Step({ label, done, active }: { label: string; done?: boolean; active?: boolean }) {
  return (
    <div className={`step ${done ? 'done' : ''} ${active ? 'active' : ''}`}>
      <span className="step-icon">{done ? <Check size={14} /> : active ? <Loader2 size={14} className="spin" /> : null}</span>
      <span>{label}</span>
    </div>
  );
}
