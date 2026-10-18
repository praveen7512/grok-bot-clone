import { Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import type { VoiceApi } from '../hooks/useVoice';

/** Mic button for the composer (speech-to-text with auto-send). */
export function MicButton({ voice, disabled }: { voice: VoiceApi; disabled?: boolean }) {
  if (!voice.sttSupported) {
    return (
      <button type="button" className="icon-btn composer-btn" disabled title="Voice input isn’t supported in this browser. Try Chrome, Edge or Safari.">
        <MicOff size={18} />
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`icon-btn composer-btn ${voice.listening ? 'listening' : ''}`}
      onClick={voice.toggle}
      disabled={disabled}
      aria-pressed={voice.listening}
      title={voice.listening ? 'Stop listening' : 'Speak (sends automatically when you stop)'}
    >
      <Mic size={18} />
    </button>
  );
}

/** Voice-mode toggle in the chat header: reads every bot reply aloud. */
export function VoiceModeToggle({ enabled, onToggle, voice }: { enabled: boolean; onToggle: () => void; voice: VoiceApi }) {
  return (
    <button
      className={`chip-btn ${enabled ? 'on' : ''}`}
      onClick={() => { if (enabled) voice.cancelSpeech(); onToggle(); }}
      title={voice.ttsSupported ? (enabled ? 'Voice mode on: replies are read aloud' : 'Turn on voice mode') : 'This browser cannot speak replies'}
      disabled={!voice.ttsSupported}
    >
      {enabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
      <span className="hide-sm">Voice</span>
      {voice.speaking && <span className="eq" aria-hidden><i /><i /><i /></span>}
    </button>
  );
}

/** Live interim transcript + errors shown above the composer. */
export function VoiceStatus({ voice }: { voice: VoiceApi }) {
  if (voice.error) return <div className="voice-status error">{voice.error}</div>;
  if (!voice.listening) return null;
  return (
    <div className="voice-status">
      <span className="rec-dot" /> {voice.interim || 'Listening… speak now'}
    </div>
  );
}

export function VoiceControls(props: { voice: VoiceApi; disabled?: boolean }) {
  return <MicButton {...props} />;
}
