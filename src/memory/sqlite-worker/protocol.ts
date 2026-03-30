export interface SQLiteWorkerInitMessage {
  type: "init";
  filePath: string;
  allowedAiTags?: string[];
}

export interface SQLiteWorkerRequestMessage {
  type: "request";
  requestId: string;
  op:
    | "block.upsert"
    | "block.get"
    | "block.getMany"
    | "block.list"
    | "raw.put"
    | "raw.get"
    | "raw.remove"
    | "raw.listBlockIds"
    | "relation.add"
    | "relation.listOutgoing"
    | "relation.listIncoming"
    | "relation.listAll"
    | "meta.close";
  payload?: unknown;
}

export interface SQLiteWorkerSuccessResponse {
  type: "response";
  requestId: string;
  ok: true;
  payload?: unknown;
}

export interface SQLiteWorkerErrorResponse {
  type: "response";
  requestId: string;
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type SQLiteWorkerResponseMessage = SQLiteWorkerSuccessResponse | SQLiteWorkerErrorResponse;

export interface SQLiteWorkerReadyMessage {
  type: "ready";
}

export interface SQLiteWorkerFatalMessage {
  type: "fatal";
  error: {
    code: string;
    message: string;
  };
}

export type SQLiteWorkerIncomingMessage = SQLiteWorkerReadyMessage | SQLiteWorkerResponseMessage | SQLiteWorkerFatalMessage;

export function createWorkerRequest(
  requestId: string,
  op: SQLiteWorkerRequestMessage["op"],
  payload?: unknown
): SQLiteWorkerRequestMessage {
  return {
    type: "request",
    requestId,
    op,
    payload
  };
}
