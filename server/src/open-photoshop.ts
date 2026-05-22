import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import {
  backAbsFromPrimaryRel,
  displaySourceAbsFromPrimaryRel,
  imageAbsFromRel,
} from "./metadata.js";

const execFileAsync = promisify(execFile);

export type OpenPhotoshopVariant = "enhanced" | "primary" | "back";

export function resolveAbsForExternalEditor(
  primaryRel: string,
  variant: OpenPhotoshopVariant,
): string | null {
  if (variant === "primary") return imageAbsFromRel(primaryRel);
  if (variant === "back") return backAbsFromPrimaryRel(primaryRel);
  return displaySourceAbsFromPrimaryRel(primaryRel);
}

/**
 * Opens a file in Photoshop via the OS (server must run on the same machine as Photoshop).
 * macOS: `open -a <PHOTOSHOP_APP_NAME>` (default Adobe Photoshop 2025).
 * Windows: runs `PHOTOSHOP_WIN_EXE` with the file path as the first argument.
 */
export async function openFileInPhotoshop(absPath: string): Promise<void> {
  const platform = os.platform();

  if (platform === "darwin") {
    const app = process.env.PHOTOSHOP_APP_NAME?.trim() || "Adobe Photoshop 2025";
    await execFileAsync("open", ["-a", app, absPath]);
    return;
  }

  if (platform === "win32") {
    const exe = process.env.PHOTOSHOP_WIN_EXE?.trim();
    if (!exe) {
      throw new Error(
        "Set PHOTOSHOP_WIN_EXE in .env to the full path of Photoshop.exe (e.g. C:\\\\Program Files\\\\Adobe\\\\Adobe Photoshop 2025\\\\Photoshop.exe)",
      );
    }
    await execFileAsync(exe, [absPath], { windowsHide: true });
    return;
  }

  throw new Error("Open in Photoshop is only supported on macOS and Windows.");
}
