import { Play } from 'lucide-react';
import type { VoiceApi } from '../hooks/useVoice';
import type { VoiceSettings } from '../lib/types';

/** Voice choice + rate + preview, used by New Bot and Bot Settings. */
export function VoicePicker({ value, onChange, voice, botName }: {
  value: VoiceSettings; onChange: (v: VoiceSettings) => void; voice: VoiceApi; botName: string;
}) {
  if (!voice.ttsSupported) {
    return <p className="hint warn">This browser can’t read replies aloud (no speechSynthesis). Settings are saved anyway.</p>;
  }
  const sorted = [...voice.voices].sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  return (
    <div className="voice-picker">
      <label className="switch-row">
        <input type="checkbox" checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} />
        <span className="switch" aria-hidden />
        <span>Read replies aloud (voice mode)</span>
      </label>
      <div className="row gap">
        <label className="field grow">
          <span>Voice</span>
          <select value={value.name ?? ''} onChange={(e) => onChange({ ...value, name: e.target.value || null })}>
            <option value="">System default</option>
            {sorted.map((v) => (
              <option key={v.voiceURI} value={v.name}>{v.name} · {v.lang}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn ghost preview-btn"
          onClick={() => voice.speak(`Hi! I'm ${botName || 'your new bot'}. Namaste, kaise ho?`, { voiceName: value.name, rate: value.rate })}
        >
          <Play size={14} /> Preview
        </button>
      </div>
      <label className="field">
        <span>Speed · {value.rate.toFixed(2)}×</span>
        <input type="range" min={0.5} max={2} step={0.05} value={value.rate} onChange={(e) => onChange({ ...value, rate: Number(e.target.value) })} />
      </label>
    </div>
  );
}
