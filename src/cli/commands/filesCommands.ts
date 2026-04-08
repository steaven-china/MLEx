import type { Command } from "commander";

import {
  ReadonlyFileService,
  type ReadFileResult,
  type ReadonlyFileEntry
} from "../../files/ReadonlyFileService.js";
import type { I18n } from "../../i18n/index.js";

interface FileCommandDependencies {
  i18n: I18n;
  output: {
    write(chunk: string): unknown;
  };
  optionDescriptions: Record<string, string>;
  asOptionalString: (value: unknown) => string | undefined;
  parseOptionalNumber: (value: string | undefined) => number | undefined;
}

export function registerFileCommands(program: Command, deps: FileCommandDependencies): void {
  const { i18n, output, optionDescriptions, asOptionalString, parseOptionalNumber } = deps;

  program
    .command("files:list")
    .description(i18n.t("cli.files.list.description"))
    .argument("[path]", i18n.t("cli.files.list.arg_path"), ".")
    .option("--max-entries <number>", optionDescriptions.maxEntries, "200")
    .action(async (pathInput: string, options) => {
      const fileService = new ReadonlyFileService({ rootPath: process.cwd() });
      const maxEntries = parseOptionalNumber(asOptionalString(options.maxEntries));
      const entries = await fileService.list(pathInput, maxEntries);
      output.write(formatFileList(entries, pathInput, i18n));
    });

  program
    .command("files:read")
    .description(i18n.t("cli.files.read.description"))
    .argument("<path>", i18n.t("cli.files.read.arg_path"))
    .option("--max-bytes <number>", optionDescriptions.maxBytes)
    .action(async (pathInput: string, options) => {
      const fileService = new ReadonlyFileService({ rootPath: process.cwd() });
      const maxBytes = parseOptionalNumber(asOptionalString(options.maxBytes));
      const result = await fileService.read(pathInput, maxBytes);
      output.write(formatFileRead(result, i18n));
    });
}

function formatFileList(entries: ReadonlyFileEntry[], pathInput: string, i18n: I18n): string {
  const header = `${i18n.t("cli.files.list.header", { path: pathInput })}\n`;
  if (entries.length === 0) {
    return `${header}${i18n.t("cli.files.list.empty")}\n`;
  }
  const lines = entries.map((entry) => {
    const prefix =
      entry.type === "dir"
        ? i18n.t("cli.files.list.type.dir")
        : entry.type === "file"
          ? i18n.t("cli.files.list.type.file")
          : i18n.t("cli.files.list.type.other");
    const sizePart =
      typeof entry.sizeBytes === "number" ? i18n.t("cli.files.list.size", { size: entry.sizeBytes }) : "";
    return `${prefix} ${entry.path}${sizePart}`;
  });
  return `${header}${lines.join("\n")}\n`;
}

function formatFileRead(result: ReadFileResult, i18n: I18n): string {
  const meta =
    `${i18n.t("cli.files.read.meta", {
      path: result.path,
      bytes: result.bytes,
      totalBytes: result.totalBytes,
      truncated: result.truncated ? i18n.t("cli.files.read.truncated") : ""
    })}\n`;
  return `${meta}${result.text}\n`;
}
