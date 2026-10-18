import type { MemoryRepository } from '../repositories/memoryRepository.js';
import type { Memory } from '../types.js';

export class MemoryService {
  constructor(private repo: MemoryRepository, private injectLimit = 100) {}

  save(botId: string, key: string, value: string): Memory {
    const k = key.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 80);
    if (!k) throw new Error('memory key is empty');
    return this.repo.upsert(botId, k, value.trim().slice(0, 4000));
  }

  recall(botId: string, query?: string): Memory[] {
    return query?.trim() ? this.repo.search(botId, query.trim()) : this.repo.list(botId, 50);
  }

  delete(botId: string, key: string): boolean {
    return this.repo.delete(botId, key);
  }

  list(botId: string): Memory[] {
    return this.repo.list(botId);
  }

  /** Rendered into the system prompt every turn. */
  promptBlock(botId: string): string {
    const items = this.repo.list(botId, this.injectLimit);
    if (!items.length) return 'You have no saved memories yet.';
    return items.map((m) => `- ${m.key}: ${m.value}`).join('\n');
  }
}
