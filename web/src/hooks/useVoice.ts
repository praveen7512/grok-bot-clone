import { useCallback, useEffect, useRef, useState } from 'react';
import { stripMarkdown } from '../lib/turns';

/* Minimal typings for the Web Speech API (not in lib.dom for all TS versions). */
interface SpeechRecognitionResultLike { isFinal: boolean; 0: { transcript: string } }
interface SpeechRecognitionEventLike { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type SRCtor = new () => SpeechRecognitionLike;

const getRecognition = (): SRCtor | undefined =>
  typeof window === 'undefined'
    ? undefined
    : ((window as unknown as { SpeechRecognition?: SRCtor }).SpeechRecognition ??
       (window as unknown as { webkitSpeechRecognition?: SRCtor }).webkitSpeechRecognition);

export interface UseVoiceOptions {
  /** BCP-47 language for recognition, e.g. "en-IN" or "hi-IN". */
  lang?: string;
  voiceName?: string | null;
  rate?: number;
  /** Called with the final transcript when the user stops speaking (auto-send). */
  onFinalTranscript?: (text: string) => void;
}

export function useVoice({ lang, voiceName, rate = 1, onFinalTranscript }: UseVoiceOptions = {}) {
  const SR = getRecognition();
  const sttSupported = !!SR;
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef('');
  const cbRef = useRef(onFinalTranscript);
  cbRef.current = onFinalTranscript;

  // voices load asynchronously in Chrome
  useEffect(() => {
    if (!ttsSupported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, [ttsSupported]);

  const stop = useCallback(() => recRef.current?.stop(), []);

  const start = useCallback(() => {
    if (!SR) {
      setError('Voice input is not supported in this browser. Use Chrome, Edge or Safari.');
      return;
    }
    if (ttsSupported) window.speechSynthesis.cancel(); // don't transcribe ourselves
    setError(null);
    finalRef.current = '';
    setInterim('');
    const rec = new SR();
    rec.lang = lang ?? navigator.language ?? 'en-US';
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) finalRef.current += r[0].transcript;
        else live += r[0].transcript;
      }
      setInterim((finalRef.current + ' ' + live).trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setError('Microphone permission was denied.');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') setError(`Voice input error: ${e.error}`);
    };
    rec.onend = () => {
      setListening(false);
      const text = finalRef.current.trim();
      setInterim('');
      recRef.current = null;
      if (text) cbRef.current?.(text);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch (err) {
      setError(String(err));
    }
  }, [SR, lang, ttsSupported]);

  const toggle = useCallback(() => (listening ? stop() : start()), [listening, start, stop]);

  const speak = useCallback(
    (text: string, override?: { voiceName?: string | null; rate?: number }) => {
      if (!ttsSupported || !text.trim()) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(stripMarkdown(text).slice(0, 4000));
      const name = override?.voiceName ?? voiceName;
      const v = name ? synth.getVoices().find((x) => x.name === name) : undefined;
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = override?.rate ?? rate;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      synth.speak(u);
    },
    [ttsSupported, voiceName, rate],
  );

  const cancelSpeech = useCallback(() => {
    if (ttsSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [ttsSupported]);

  useEffect(() => () => { recRef.current?.abort(); if (ttsSupported) window.speechSynthesis.cancel(); }, [ttsSupported]);

  return { sttSupported, ttsSupported, listening, interim, speaking, voices, error, start, stop, toggle, speak, cancelSpeech };
}

export type VoiceApi = ReturnType<typeof useVoice>;
