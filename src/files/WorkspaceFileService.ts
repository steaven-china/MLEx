import { promises as fs } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export type WorkspaceWriteMode = "overwrite" | "append";

export interface WorkspaceFileServiceConfig {
  rootPath: string;
}

export interface WorkspaceWriteOptions {
  mode?: WorkspaceWriteMode;
  createDirs?: boolean;
  maxBytes?: number;
}

export interface WorkspaceWriteResult {
  path: string;
  mode: WorkspaceWriteMode;
  bytesWritten: number;
  totalBytes: number;
  modifiedAt?: number;
}

export class WorkspaceFileService {
  private readonly rootPath: string;

  constructor(config: WorkspaceFileServiceConfig) {
    this.rootPath = resolve(config.rootPath);
  }

  async write(
    pathInput: string,
    content: string,
    options: WorkspaceWriteOptions = {}
  ): Promise<WorkspaceWriteResult> {
    const resolved = this.resolveWithinRoot(pathInput);
    const mode: WorkspaceWriteMode = options.mode === "append" ? "append" : "overwrite";
    const createDirs = options.createDirs !== false;
    const payload = String(content ?? "");
    const bytesWritten = Buffer.byteLength(payload, "utf8");

    if (options.maxBytes !== undefined) {
      const maxBytes = Math.max(1, Math.floor(options.maxBytes));
      if (bytesWritten > maxBytes) {
        throw new Error(`content exceeds maxBytes: ${bytesWritten} > ${maxBytes}`);
      }
    }

    if (createDirs) {
      await fs.mkdir(dirname(resolved.absolutePath), { recursive: true });
    }

    if (mode === "append") {
      await fs.appendFile(resolved.absolutePath, payload, "utf8");
    } else {
      await fs.writeFile(resolved.absolutePath, payload, "utf8");
    }

    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isFile()) {
      throw new Error(`Path is not a file after write: ${resolved.relativePath}`);
    }

    return {
      path: resolved.relativePath,
      mode,
      bytesWritten,
      totalBytes: stat.size,
      modifiedAt: stat.mtimeMs
    };
  }

  private resolveWithinRoot(pathInput: string): { absolutePath: string; relativePath: string } {
    const requestedPath = pathInput.trim().length > 0 ? pathInput.trim() : ".";
    const absolutePath = resolve(this.rootPath, requestedPath);
    const relativePath = relative(this.rootPath, absolutePath);
    const outsideRoot = relativePath.startsWith("..") || isAbsolute(relativePath);
    if (outsideRoot) {
      throw new Error(`Path escapes workspace root: ${requestedPath}`);
    }
    const normalized = relativePath.length > 0 ? relativePath.replace(/\\/g, "/") : ".";
    return { absolutePath, relativePath: normalized };
  }
}
