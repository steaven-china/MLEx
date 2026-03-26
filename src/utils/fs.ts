import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });

  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  const payload = JSON.stringify(value, null, 2);
  await fs.writeFile(temporaryPath, payload, "utf8");

  try {
    await fs.rename(temporaryPath, filePath);
  } catch {
    await fs.rm(filePath, { force: true });
    await fs.rename(temporaryPath, filePath);
  }
}
