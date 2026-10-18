import type { Bot, ChatEvent, Health, Memory, ScreenSession, StoredMessage, VoiceSettings } from './types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let onUnauthorized: () => void = () => undefined;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? res.statusText);
    if (res.status === 401 && !path.startsWith('/api/auth/login')) onUnauthorized();
    throw err;
  }
  return data as T;
}

export const api = {
  health: () => req<Health>('/api/health'),
  me: () => req<{ authenticated: boolean; expiresAt: number | null }>('/api/auth/me'),
  login: (password: string) => req<{ ok: true }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => req<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  listBots: () => req<{ bots: Bot[] }>('/api/bots').then((r) => r.bots),
  createBot: (b: { name: string; persona?: string; voice?: Partial<VoiceSettings> }) =>
    req<{ bot: Bot }>('/api/bots', { method: 'POST', body: JSON.stringify(b) }).then((r) => r.bot),
  updateBot: (id: string, patch: { name?: string; persona?: string; voice?: Partial<VoiceSettings> }) =>
    req<{ bot: Bot }>(`/api/bots/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then((r) => r.bot),
  deleteBot: (id: string) => req<void>(`/api/bots/${id}`, { method: 'DELETE' }),

  messages: (id: string) => req<{ messages: StoredMessage[]; summary: string | null }>(`/api/bots/${id}/messages`),
  clearMessages: (id: string) => req<void>(`/api/bots/${id}/messages`, { method: 'DELETE' }),

  memories: (id: string) => req<{ memories: Memory[] }>(`/api/bots/${id}/memories`).then((r) => r.memories),
  saveMemory: (id: string, key: string, value: string) =>
    req<{ memory: Memory }>(`/api/bots/${id}/memories`, { method: 'PUT', body: JSON.stringify({ key, value }) }),
  deleteMemory: (id: string, key: string) => req<void>(`/api/bots/${id}/memories/${encodeURIComponent(key)}`, { method: 'DELETE' }),

  sandbox: (id: string) => req<{ sandbox: { kind: string; state: string; health?: string; detail?: string } }>(`/api/bots/${id}/sandbox`),
  screenSession: (id: string, mode: 'view' | 'control') =>
    req<{ session: ScreenSession }>(`/api/bots/${id}/screen-session`, { method: 'POST', body: JSON.stringify({ mode }) }).then((r) => r.session),

  /** POST + Server-Sent Events stream. */
  async chat(id: string, message: string, onEvent: (e: ChatEvent) => void, signal?: AbortSignal) {
    const res = await fetch(`/api/bots/${id}/chat`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
      signal,
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) onUnauthorized();
      throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? 'Chat failed');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (line.startsWith('data: ')) {
            try { onEvent(JSON.parse(line.slice(6)) as ChatEvent); } catch { /* ignore malformed */ }
          }
        }
      }
    }
  },
};
