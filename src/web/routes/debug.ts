import type { IncomingMessage, ServerResponse } from "node:http";

import type { createRuntime } from "../../container.js";
import type { IDebugTraceRecorder } from "../../debug/DebugTraceRecorder.js";
import type { I18n } from "../../i18n/index.js";
import type { Context } from "../../types.js";

interface LastContextState {
  query: string;
  at: number;
  context: Context;
}

interface DebugState {
  lastContextBySession: Map<string, LastContextState>;
  lastSharedContextBySession: Map<string, LastContextState>;
}

interface SessionRuntimeSet {
  sessionId: string;
  privateRuntime: ReturnType<typeof createRuntime>;
  sharedRuntime: ReturnType<typeof createRuntime>;
}

interface DebugRouteHelpers {
  sendJson: (res: ServerResponse, statusCode: number, body: unknown) => void;
  requireFeatureEnabled: (enabled: boolean, i18n: I18n) => void;
  requireAdminAuthorization: (
    req: IncomingMessage,
    adminToken: string | undefined,
    i18n: I18n
  ) => void;
  normalizeSessionId: (sessionId: string | undefined) => string;
  parsePositiveInt: (raw: string | null, fallback: number) => number;
  buildDebugDatabaseSnapshot: (
    runtime: ReturnType<typeof createRuntime>,
    lastContext: LastContextState | undefined
  ) => Promise<Record<string, unknown>>;
  buildDebugBlockDetail: (
    runtime: ReturnType<typeof createRuntime>,
    blockId: string
  ) => Promise<Record<string, unknown> | undefined>;
}

export interface DebugRouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  pathname: string;
  url: URL;
  i18n: I18n;
  debugApiEnabled: boolean;
  adminToken: string | undefined;
  defaultRuntime: SessionRuntimeSet;
  resolveRuntimeForSession: (sessionId: string) => SessionRuntimeSet;
  debugState: DebugState;
  helpers: DebugRouteHelpers;
}

export async function handleDebugRoute(input: DebugRouteContext): Promise<boolean> {
  const {
    req,
    res,
    method,
    pathname,
    url,
    i18n,
    debugApiEnabled,
    adminToken,
    defaultRuntime,
    resolveRuntimeForSession,
    debugState,
    helpers
  } = input;

  if (method === "GET" && pathname === "/api/debug/database") {
    helpers.requireFeatureEnabled(debugApiEnabled, i18n);
    helpers.requireAdminAuthorization(req, adminToken, i18n);
    const sessionId = helpers.normalizeSessionId(url.searchParams.get("sessionId") ?? undefined);
    const runtimeSet = resolveRuntimeForSession(sessionId);
    const [privateSnapshot, sharedSnapshot] = await Promise.all([
      helpers.buildDebugDatabaseSnapshot(runtimeSet.privateRuntime, debugState.lastContextBySession.get(sessionId)),
      helpers.buildDebugDatabaseSnapshot(runtimeSet.sharedRuntime, debugState.lastSharedContextBySession.get(sessionId))
    ]);
    helpers.sendJson(res, 200, {
      sessionId,
      ...privateSnapshot,
      shared: sharedSnapshot
    });
    return true;
  }

  if (method === "GET" && pathname === "/api/debug/traces") {
    helpers.requireFeatureEnabled(debugApiEnabled, i18n);
    helpers.requireAdminAuthorization(req, adminToken, i18n);
    const traceRecorder = defaultRuntime.privateRuntime.container.resolve<IDebugTraceRecorder>("debugTraceRecorder");
    const limit = helpers.parsePositiveInt(url.searchParams.get("limit"), 500);
    helpers.sendJson(res, 200, {
      total: traceRecorder.size(),
      entries: traceRecorder.list(Math.min(limit, 5000))
    });
    return true;
  }

  if (method === "POST" && pathname === "/api/debug/traces/clear") {
    helpers.requireFeatureEnabled(debugApiEnabled, i18n);
    helpers.requireAdminAuthorization(req, adminToken, i18n);
    const traceRecorder = defaultRuntime.privateRuntime.container.resolve<IDebugTraceRecorder>("debugTraceRecorder");
    traceRecorder.clear();
    helpers.sendJson(res, 200, { ok: true });
    return true;
  }

  if (method === "GET" && pathname === "/api/debug/block") {
    helpers.requireFeatureEnabled(debugApiEnabled, i18n);
    helpers.requireAdminAuthorization(req, adminToken, i18n);
    const blockId = url.searchParams.get("id")?.trim();
    if (!blockId) {
      helpers.sendJson(res, 400, { error: i18n.t("web.api.error.id_required") });
      return true;
    }
    const sessionId = helpers.normalizeSessionId(url.searchParams.get("sessionId") ?? undefined);
    const scope = (url.searchParams.get("scope") ?? "private").trim().toLowerCase();
    const runtimeSet = resolveRuntimeForSession(sessionId);
    const targetRuntime = scope === "shared" ? runtimeSet.sharedRuntime : runtimeSet.privateRuntime;
    const detail = await helpers.buildDebugBlockDetail(targetRuntime, blockId);
    if (!detail) {
      helpers.sendJson(res, 404, { error: i18n.t("web.api.error.block_not_found") });
      return true;
    }
    helpers.sendJson(res, 200, {
      sessionId,
      scope: scope === "shared" ? "shared" : "private",
      ...detail
    });
    return true;
  }

  return false;
}
