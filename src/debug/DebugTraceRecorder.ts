export interface DebugTraceEntry {
  id: number;
  at: number;
  category: string;
  event: string;
  payload: unknown;
}

export interface IDebugTraceRecorder {
  record(category: string, event: string, payload: unknown): void;
  list(limit?: number): DebugTraceEntry[];
  clear(): void;
  size(): number;
}

export interface InMemoryDebugTraceRecorderConfig {
  enabled: boolean;
  maxEntries: number;
}

export class InMemoryDebugTraceRecorder implements IDebugTraceRecorder {
  private readonly entries: DebugTraceEntry[] = [];
  private nextId = 1;

  constructor(private readonly config: InMemoryDebugTraceRecorderConfig) {}

  record(category: string, event: string, payload: unknown): void {
    if (!this.config.enabled) return;
    const entry: DebugTraceEntry = {
      id: this.nextId++,
      at: Date.now(),
      category,
      event,
      payload
    };
    this.entries.push(entry);
    if (this.entries.length > this.config.maxEntries) {
      this.entries.splice(0, this.entries.length - this.config.maxEntries);
    }
  }

  list(limit?: number): DebugTraceEntry[] {
    if (!Number.isFinite(limit) || !limit || limit <= 0) {
      return this.entries.map(cloneEntry);
    }
    const count = Math.max(1, Math.floor(limit));
    return this.entries.slice(-count).map(cloneEntry);
  }

  clear(): void {
    this.entries.length = 0;
  }

  size(): number {
    return this.entries.length;
  }
}

export class NoopDebugTraceRecorder implements IDebugTraceRecorder {
  record(_category: string, _event: string, _payload: unknown): void {
    return;
  }

  list(_limit?: number): DebugTraceEntry[] {
    return [];
  }

  clear(): void {
    return;
  }

  size(): number {
    return 0;
  }
}

function cloneEntry(entry: DebugTraceEntry): DebugTraceEntry {
  return {
    id: entry.id,
    at: entry.at,
    category: entry.category,
    event: entry.event,
    payload: safeClone(entry.payload)
  };
}

function safeClone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}
