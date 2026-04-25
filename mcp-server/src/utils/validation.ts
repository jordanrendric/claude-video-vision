import { resolve } from "path";
import { existsSync, statSync } from "fs";

export function validateVideoPath(inputPath: string): string {
  const resolved = resolve(inputPath);
  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const stat = statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Path is not a regular file: ${resolved}`);
  }
  return resolved;
}
