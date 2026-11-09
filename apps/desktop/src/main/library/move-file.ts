import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { readBoundedSnapshot } from "./bounded-read";

export async function renameAcrossDevices(from: string, to: string, limit: number | undefined): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyAcrossDevices(from, to, limit);
  }
}

/** Read completely before writing or unlinking, including if the source grew after a prior read. */
export async function copyAcrossDevices(from: string, to: string, limit: number | undefined): Promise<void> {
  const content = limit === undefined ? await readFile(from) : (await readBoundedSnapshot(from, limit)).bytes;
  await writeFile(to, content);
  await unlink(from);
}
