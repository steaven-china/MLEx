import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { parse } from "smol-toml";

const DEFAULT_TAGS_TOML_PATH = path.join(homedir(), ".mlex", "tags.toml");

const MAX_DOC_TEXT_LENGTH = 12_000;
const MAX_VAR_KEY_LENGTH = 64;
const MAX_VAR_VALUE_LENGTH = 2000;

export interface LoadUserTagsTomlOptions {
  filePath?: string;
}

export interface UserTagsToml {
  docs?: {
    intro?: string;
    item?: string[];
  };
  vars?: Record<string, string>;
}

export function loadUserTagsToml(options: LoadUserTagsTomlOptions = {}): UserTagsToml {
  const filePath = options.filePath ?? DEFAULT_TAGS_TOML_PATH;
  if (!existsSync(filePath)) return {};

  const source = readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = parse(source);
  } catch (error) {
    throw new Error(`Failed to parse tags TOML config at ${filePath}: ${toErrorMessage(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Invalid tags TOML config at ${filePath}: root must be a table.`);
  }

  return mapTagsToml(parsed, filePath);
}

function mapTagsToml(root: Record<string, unknown>, filePath: string): UserTagsToml {
  const output: UserTagsToml = {};

  if (root.docs !== undefined) {
    output.docs = mapDocs(root.docs, filePath, "docs");
  }
  if (root.vars !== undefined) {
    output.vars = mapVars(root.vars, filePath, "vars");
  }

  return output;
}

function mapDocs(value: unknown, filePath: string, fieldPath: string): UserTagsToml["docs"] {
  const table = expectTable(value, filePath, fieldPath);
  const output: NonNullable<UserTagsToml["docs"]> = {};

  if (table.intro !== undefined) {
    if (typeof table.intro !== "string") {
      throw typeError(filePath, `${fieldPath}.intro`, "string", table.intro);
    }
    output.intro = limitText(table.intro, MAX_DOC_TEXT_LENGTH);
  }

  if (table.item !== undefined) {
    if (!Array.isArray(table.item) || table.item.some((entry) => typeof entry !== "string")) {
      throw typeError(filePath, `${fieldPath}.item`, "string[]", table.item);
    }
    output.item = table.item.map((entry) => limitText(entry, MAX_DOC_TEXT_LENGTH));
  }

  return output;
}

function mapVars(value: unknown, filePath: string, fieldPath: string): Record<string, string> {
  const table = expectTable(value, filePath, fieldPath);
  const output: Record<string, string> = {};

  for (const [key, raw] of Object.entries(table)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(
        `Invalid tags TOML config at ${filePath}: ${fieldPath}.${key} must match [A-Za-z_][A-Za-z0-9_]*.`
      );
    }
    if (key.length > MAX_VAR_KEY_LENGTH) {
      throw new Error(
        `Invalid tags TOML config at ${filePath}: ${fieldPath}.${key} key too long (max ${MAX_VAR_KEY_LENGTH}).`
      );
    }
    if (typeof raw !== "string") {
      throw typeError(filePath, `${fieldPath}.${key}`, "string", raw);
    }
    output[key] = limitText(raw, MAX_VAR_VALUE_LENGTH);
  }

  return output;
}

function limitText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}\n...[truncated]`;
}

function expectTable(value: unknown, filePath: string, fieldPath: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw typeError(filePath, fieldPath, "table", value);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeError(filePath: string, fieldPath: string, expected: string, actual: unknown): Error {
  return new Error(
    `Invalid tags TOML config at ${filePath}: ${fieldPath} must be ${expected}, got ${describeValue(actual)}.`
  );
}

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
