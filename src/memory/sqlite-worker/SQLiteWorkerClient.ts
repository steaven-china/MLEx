import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";

import type {
  SQLiteWorkerIncomingMessage,
  SQLiteWorkerInitMessage,
  SQLiteWorkerRequestMessage,
  SQLiteWorkerResponseMessage
} from "./protocol.js";
import { createWorkerRequest } from "./protocol.js";

type InflightRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export interface SQLiteWorkerClientOptions {
  filePath: string;
  allowedAiTags?: string[];
}

export class SQLiteWorkerClient {
  private readonly worker: Worker;
  private readonly inflight = new Map<string, InflightRequest>();
  private readyPromise: Promise<void>;
  private readyResolve: (() => void) | undefined;
  private readyReject: ((error: Error) => void) | undefined;
  private closed = false;

  constructor(options: SQLiteWorkerClientOptions) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    const workerModule = import.meta.url.endsWith(".ts") ? "./sqlite.worker.ts" : "./sqlite.worker.js";
    this.worker = new Worker(new URL(workerModule, import.meta.url), {
      workerData: {
        type: "init",
        filePath: options.filePath,
        allowedAiTags: options.allowedAiTags
      } satisfies SQLiteWorkerInitMessage,
      execArgv: import.meta.url.endsWith(".ts") ? ["--import", "tsx/esm"] : undefined
    });

    this.worker.on("message", (message: SQLiteWorkerIncomingMessage) => {
      this.handleMessage(message);
    });
    this.worker.on("error", (error) => {
      this.failAll(error instanceof Error ? error : new Error(String(error)));
    });
    this.worker.on("exit", (code) => {
      if (this.closed && code === 0) return;
      if (code !== 0) {
        this.failAll(new Error(`SQLite worker exited with code ${code}`));
      }
    });
  }

  async request<T>(op: SQLiteWorkerRequestMessage["op"], payload?: unknown): Promise<T> {
    if (this.closed) {
      throw new Error("SQLite worker client is closed");
    }
    await this.readyPromise;

    const requestId = randomUUID();
    const message = createWorkerRequest(requestId, op, payload);
    const result = new Promise<T>((resolve, reject) => {
      this.inflight.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject
      });
    });

    this.worker.postMessage(message);
    return result;
  }

  async close(): Promise<void> {
    if (this.closed) return;

    try {
      await this.request("meta.close");
    } catch {
      // ignore and force terminate
    }

    this.closed = true;
    await this.worker.terminate();
    this.inflight.clear();
  }

  private handleMessage(message: SQLiteWorkerIncomingMessage): void {
    if (message.type === "ready") {
      this.readyResolve?.();
      this.readyResolve = undefined;
      this.readyReject = undefined;
      return;
    }

    if (message.type === "fatal") {
      const error = new Error(message.error.message);
      this.failAll(error);
      return;
    }

    const response = message as SQLiteWorkerResponseMessage;
    const request = this.inflight.get(response.requestId);
    if (!request) return;
    this.inflight.delete(response.requestId);

    if (response.ok) {
      request.resolve(response.payload);
      return;
    }

    request.reject(new Error(`${response.error.code}: ${response.error.message}`));
  }

  private failAll(error: Error): void {
    this.readyReject?.(error);
    this.readyResolve = undefined;
    this.readyReject = undefined;
    for (const { reject } of this.inflight.values()) {
      reject(error);
    }
    this.inflight.clear();
  }
}
