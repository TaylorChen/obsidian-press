import { App, TFile, TFolder, Vault } from "obsidian";
import { exec, spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// === Login Shell Command Execution ===
// Electron doesn't inherit the user's shell PATH.
// We use exec() with a login shell wrapper so Homebrew etc. are on PATH.

export function runCommand(
  cmd: string,
  options?: { timeout?: number }
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    exec(
      cmd,
      {
        timeout: options?.timeout || 30000,
        maxBuffer: 10 * 1024 * 1024,
        // Use login shell so PATH includes Homebrew
        shell: "/bin/zsh",
        env: {
          ...process.env,
          PATH: `/Library/TeX/texbin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
        },
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout || "",
          stderr: stderr || "",
          code: error ? error.code || 1 : 0,
        });
      }
    );
  });
}

// === Vault Path ===

export function getVaultPath(app: App): string {
  return (app.vault.adapter as any).basePath;
}

// === Attachment Path Resolution ===

export function resolveAttachmentPath(
  src: string,
  currentFile: TFile,
  app: App
): string {
  const vaultPath = getVaultPath(app);

  // Already absolute
  if (path.isAbsolute(src)) {
    return src;
  }

  // URL — skip
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return src;
  }

  // Data URI — skip
  if (src.startsWith("data:")) {
    return src;
  }

  // Try relative to current file directory
  const currentDir = path.dirname(currentFile.path);
  const relativePath = path.join(currentDir, src);
  const absRelative = path.join(vaultPath, relativePath);
  if (fs.existsSync(absRelative)) {
    return absRelative;
  }

  // Try vault root
  const absRoot = path.join(vaultPath, src);
  if (fs.existsSync(absRoot)) {
    return absRoot;
  }

  // Try Obsidian attachmentFolderPath setting
  const attachmentFolder = (app.vault as any).getConfig?.("attachmentFolderPath");
  if (attachmentFolder) {
    const absAttachment = path.join(vaultPath, attachmentFolder, src);
    if (fs.existsSync(absAttachment)) {
      return absAttachment;
    }
  }

  // Fallback: return as-is (relative path, may or may not work)
  return src;
}

// === CJK Font Detection ===

export async function detectCjkFont(): Promise<string> {
  const platform = os.platform();

  if (platform === "darwin") {
    const fonts = ["STHeitiSC-Medium", "Heiti SC", "Hiragino Sans", "HiraginoSans-W6"];
    for (const font of fonts) {
      const { stdout } = await runCommand(`fc-list ':family=${font}'`);
      if (stdout.trim().length > 0) return font;
    }
    return "";
  } else if (platform === "win32") {
    return "";
  } else {
    const fonts = ["Noto Sans CJK SC", "WenQuanYi Micro Hei", "Droid Sans Fallback"];
    for (const font of fonts) {
      const { stdout } = await runCommand(`fc-list ':family=${font}'`);
      if (stdout.trim().length > 0) return font;
    }
    return "";
  }
}

// === Command Detection ===

export async function checkCommandExists(cmd: string): Promise<boolean> {
  const platform = os.platform();
  const checkCmd = platform === "win32" ? `where ${cmd}` : `which ${cmd}`;
  const { code } = await runCommand(checkCmd);
  return code === 0;
}

// === Temp Directory ===

export function getTmpDir(vaultPath: string): string {
  const tmpDir = path.join(
    vaultPath,
    ".obsidian",
    "plugins",
    "obsidian-press",
    "tmp"
  );
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  return tmpDir;
}

export async function cleanTmpDir(tmpDir: string): Promise<void> {
  try {
    if (fs.existsSync(tmpDir)) {
      const files = fs.readdirSync(tmpDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

// === Semaphore ===

export interface Semaphore {
  acquire(): Promise<void>;
  release(): void;
}

export function createSemaphore(limit: number): Semaphore {
  let current = 0;
  const queue: Array<() => void> = [];

  return {
    async acquire(): Promise<void> {
      if (current < limit) {
        current++;
        return;
      }
      return new Promise<void>((resolve) => {
        queue.push(resolve);
      });
    },
    release(): void {
      current--;
      if (queue.length > 0) {
        current++;
        const next = queue.shift()!;
        next();
      }
    },
  };
}

// === File Helpers ===

export function getOutputPath(
  file: TFile,
  vaultPath: string,
  outputDir: string,
  naming: string,
  format: string
): string {
  const baseName = path.basename(file.path, ".md");
  let fileName: string;

  switch (naming) {
    case "timestamp":
      const ts = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      fileName = `${baseName}_${ts}.${format}`;
      break;
    case "suffix":
      fileName = `${baseName}_export.${format}`;
      break;
    default:
      fileName = `${baseName}.${format}`;
  }

  // If outputDir is relative, resolve relative to the file's directory
  let outDir: string;
  if (path.isAbsolute(outputDir)) {
    outDir = outputDir;
  } else if (outputDir) {
    outDir = path.join(vaultPath, outputDir);
  } else {
    outDir = path.join(vaultPath, "pdf");
  }

  // Create directory if needed
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  return path.join(outDir, fileName);
}

// === Pandoc Version Check ===

export async function getPandocVersion(
  pandocPath: string
): Promise<string | null> {
  const { stdout, code } = await runCommand(`${pandocPath} --version`);
  if (code === 0) {
    const match = stdout.match(/pandoc\s+(\d+\.\d+[\.\d]*)/);
    return match ? match[1] : "unknown";
  }
  return null;
}
