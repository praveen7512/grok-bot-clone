import { useState } from 'react';
import { Modal } from './Modal';
import { VoicePicker } from './VoicePicker';
import type { VoiceApi } from '../hooks/useVoice';
import type { Bot, VoiceSettings } from '../lib/types';

export function BotSettingsModal({ bot, onClose, onSave, onClearHistory, voice }: {
  bot: Bot;
  onClose: () => void;
  onSave: (patch: { name: string; persona: string; voice: VoiceSettings }) => Promise<void>;
  onClearHistory: () => void;
  voice: VoiceApi;
}) {
  const [name, setName] = useState(bot.name);
  const [persona, setPersona] = useState(bot.persona);
  const [v, setV] = useState<VoiceSettings>(bot.voice);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave({ name: name.trim(), persona, voice: v });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Bot settings" onClose={onClose} footer={
      <>
        <button className="btn ghost danger-text" onClick={onClearHistory}>Clear conversation</button>
        <span className="grow" />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!name.trim() || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
      </>
    }>
      <div className="stack">
        {error && <div className="alert error">{error}</div>}
        <label className="field"><span>Name</span><input maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Persona / instructions</span><textarea rows={5} value={persona} onChange={(e) => setPersona(e.target.value)} /></label>
        <fieldset className="fieldset"><legend>Voice</legend><VoicePicker value={v} onChange={setV} voice={voice} botName={name} /></fieldset>
      </div>
    </Modal>
  );
}
