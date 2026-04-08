import type { IncomingMessage, ServerResponse } from "node:http";

import { ReadonlyFileService } from "../../files/ReadonlyFileService.js";
import type { I18n } from "../../i18n/index.js";

interface FileRouteHelpers {
  sendJson: (res: ServerResponse, statusCode: number, body: unknown) => void;
  requireFeatureEnabled: (enabled: boolean, i18n: I18n) => void;
  requireAdminAuthorization: (
    req: IncomingMessage,
    adminToken: string | undefined,
    i18n: I18n
  ) => void;
  parsePositiveInt: (raw: string | null, fallback: number) => number;
}

export interface FileRouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  pathname: string;
  url: URL;
  i18n: I18n;
  fileApiEnabled: boolean;
  adminToken: string | undefined;
  fileService: ReadonlyFileService;
  helpers: FileRouteHelpers;
}

export async function handleFileRoute(input: FileRouteContext): Promise<boolean> {
  const { req, res, method, pathname, url, i18n, fileApiEnabled, adminToken, fileService, helpers } = input;

  if (method === "GET" && pathname === "/api/files/list") {
    helpers.requireFeatureEnabled(fileApiEnabled, i18n);
    helpers.requireAdminAuthorization(req, adminToken, i18n);
    const pathInput = url.searchParams.get("path") ?? ".";
    const maxEntries = helpers.parsePositiveInt(url.searchParams.get("maxEntries"), 200);
    try {
      const entries = await fileService.list(pathInput, maxEntries);
      helpers.sendJson(res, 200, { path: pathInput, entries });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      helpers.sendJson(res, 400, { error: message });
    }
    return true;
  }

  if (method === "GET" && pathname === "/api/files/read") {
    helpers.requireFeatureEnabled(fileApiEnabled, i18n);
    helpers.requireAdminAuthorization(req, adminToken, i18n);
    const pathInput = url.searchParams.get("path")?.trim();
    if (!pathInput) {
      helpers.sendJson(res, 400, { error: i18n.t("web.api.error.path_required") });
      return true;
    }
    const maxBytesRaw = url.searchParams.get("maxBytes");
    const maxBytes = maxBytesRaw ? helpers.parsePositiveInt(maxBytesRaw, 64 * 1024) : undefined;
    try {
      const result = await fileService.read(pathInput, maxBytes);
      helpers.sendJson(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      helpers.sendJson(res, 400, { error: message });
    }
    return true;
  }

  return false;
}
