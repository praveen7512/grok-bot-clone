import type { ScreenMode } from '../orchestrator/types.js';

const SCREEN_PATTERNS: RegExp[] = [
  /\b(show|share|open)\b.{0,20}\b(your|ur|the bot'?s?)\b.{0,15}\b(computer|screen|desktop|pc|machine)\b/i,
  /\blet me see\b.{0,15}\b(your|ur)\b.{0,10}\b(computer|screen|desktop)\b/i,
  /\b(apna|apni|apne|tera|teri|tumhara|tumhari)\b.{0,15}\b(computer|screen|desktop|pc|laptop)\b.{0,15}\b(dikhao|dikha|dikhaa|dikhado|dikha\s*do|dikhaiye|dikhana|share karo)\b/i,
  /\b(computer|screen|desktop)\b.{0,10}\b(dikhao|dikha\s*do|dikhado|dikhaao|share\s*karo)\b/i,
  /^\s*(screen|desktop)\s*(please|pls|plz)?\s*[!.?]*\s*$/i,
];

const CONTROL_PATTERNS = /\b(control|remote|take over|use it|chala(ne|na|u|oon)?|use karne|operate)\b/i;

/** Returns the requested screen mode when the message asks to see the bot's computer, else null. */
export function detectScreenIntent(text: string): ScreenMode | null {
  const t = text.trim();
  if (t.length > 300) return null;
  if (!SCREEN_PATTERNS.some((re) => re.test(t))) return null;
  return CONTROL_PATTERNS.test(t) ? 'control' : 'view';
}
