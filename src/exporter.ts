import { App, TFile, TFolder, requestUrl } from "obsidian";
import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";
import { PluginSettings, ExportResult, BatchResult, PandocOptions } from "./types";
import { renderToPandoc } from "./renderer";
import { exportWithPandoc, checkPandocAvailable } from "./pandoc";
import {
  getVaultPath,
  getOutputPath,
  getTmpDir,
  createSemaphore,
  checkCommandExists,
} from "./utils";

// === Single file export ===

export async function exportFile(
  file: TFile,
  app: App,
  settings: PluginSettings
): Promise<ExportResult> {
  const vaultPath = getVaultPath(app);
  const tmpDir = getTmpDir(app);

  try {
    // Read file content
    const content = await app.vault.read(file);
    const effectivePdfEngine =
      settings.defaultFormat === "pdf" &&
      settings.pdfEngine === "pdflatex" &&
      containsCjk(content)
        ? "xelatex"
        : settings.pdfEngine;

    // Determine output path
    const format = settings.defaultFormat;
    const outputPath = getOutputPath(
      file,
      vaultPath,
      settings.outputDir,
      settings.outputNaming,
      format
    );

    // Pre-process Obsidian markdown
    const rendered = await renderToPandoc(
      content,
      file,
      app,
      settings.mermaidPath,
      settings.mermaidTheme
    );

    if (settings.defaultFormat === "pdf") {
      rendered.content = normalizeRemoteImageUrls(rendered.content);
    }

    if (settings.defaultFormat === "pdf" && effectivePdfEngine === "typst") {
      rendered.content = await localizeImagesForTypst(
        rendered.content,
        file,
        vaultPath,
        tmpDir,
        rendered.tempFiles
      );
    }

    if (settings.defaultFormat === "pdf" && isLatexEngine(effectivePdfEngine)) {
      rendered.content = await convertWebpImagesForLatex(
        rendered.content,
        file,
        vaultPath,
        tmpDir,
        rendered.tempFiles
      );
    }

    // Write processed content to temp file
    const tempMdPath = path.join(
      tmpDir,
      `press-${Date.now()}-${path.basename(file.path)}`
    );
    fs.writeFileSync(tempMdPath, rendered.content, "utf8");

    // Build Pandoc options
    const pandocOptions: PandocOptions = {
      inputPath: tempMdPath,
      outputPath,
      format,
      engine: effectivePdfEngine,
      pandocPath: settings.pandocPath,
      tempDir: tmpDir,
      fontSize: settings.fontSize,
      pageSize: settings.pageSize,
      pageMargin: settings.pageMargin,
      codeTheme: settings.codeTheme,
      cjkFont: settings.cjkFont,
      enableCjk: settings.enableCjk,
      customCssPath: settings.customCssPath || undefined,
      customTemplatePath: settings.customTemplatePath || undefined,
      extraArgs: settings.extraArgs
        ? settings.extraArgs.split(/\s+/).filter(Boolean)
        : [],
    };

    // Run Pandoc
    const result = await exportWithPandoc(pandocOptions);

    // Clean up temp files
    try {
      fs.unlinkSync(tempMdPath);
    } catch {
      // Ignore
    }

    // Clean up mermaid SVG files
    for (const tempFile of rendered.tempFiles) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch {
        // Ignore
      }
    }

    return result;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      duration: 0,
    };
  }
}

// === Folder batch export ===

export async function exportFolder(
  folder: TFolder,
  app: App,
  settings: PluginSettings,
  onProgress?: (done: number, total: number, current: string) => void
): Promise<BatchResult> {
  const startTime = Date.now();

  // Collect all .md files in the folder
  const mdFiles: TFile[] = [];
  collectMarkdownFiles(folder, mdFiles);

  if (mdFiles.length === 0) {
    return {
      total: 0,
      success: 0,
      failed: 0,
      errors: [],
      outputDir: "",
      duration: Date.now() - startTime,
    };
  }

  // Run batch export
  const result = await exportBatch(mdFiles, app, settings, onProgress);

  return {
    ...result,
    duration: Date.now() - startTime,
  };
}

// === Vault export ===

export async function exportVault(
  app: App,
  settings: PluginSettings,
  onProgress?: (done: number, total: number, current: string) => void
): Promise<BatchResult> {
  const startTime = Date.now();

  // Collect all .md files in the vault
  const mdFiles = app.vault.getMarkdownFiles();

  if (mdFiles.length === 0) {
    return {
      total: 0,
      success: 0,
      failed: 0,
      errors: [],
      outputDir: "",
      duration: Date.now() - startTime,
    };
  }

  // Run batch export
  const result = await exportBatch(mdFiles, app, settings, onProgress);

  return {
    ...result,
    duration: Date.now() - startTime,
  };
}

// === Core batch logic ===

async function exportBatch(
  files: TFile[],
  app: App,
  settings: PluginSettings,
  onProgress?: (done: number, total: number, current: string) => void
): Promise<Omit<BatchResult, "duration">> {
  const total = files.length;
  let success = 0;
  let failed = 0;
  const errors: Array<{ file: string; error: string }> = [];

  const semaphore = createSemaphore(settings.concurrency);
  let done = 0;

  const promises = files.map(async (file) => {
    await semaphore.acquire();

    try {
      const result = await exportFile(file, app, settings);

      done++;
      onProgress?.(done, total, file.name);

      if (result.success) {
        success++;
      } else {
        failed++;
        errors.push({
          file: file.path,
          error: result.error || "Unknown error",
        });

        if (!settings.skipErrors) {
          throw new Error(`Export failed for ${file.path}: ${result.error}`);
        }
      }
    } catch (err) {
      failed++;
      errors.push({
        file: file.path,
        error: err instanceof Error ? err.message : String(err),
      });

      if (!settings.skipErrors) {
        throw err;
      }
    } finally {
      semaphore.release();
    }
  });

  // Wait for all exports to complete (or first error if skipErrors is false)
  if (settings.skipErrors) {
    await Promise.allSettled(promises);
  } else {
    await Promise.all(promises);
  }

  const vaultPath = getVaultPath(app);
  const outputDir = path.isAbsolute(settings.outputDir)
    ? settings.outputDir
    : path.join(vaultPath, settings.outputDir || "pdf");

  return {
    total,
    success,
    failed,
    errors,
    outputDir,
  };
}

// === Helpers ===

function collectMarkdownFiles(folder: TFolder, files: TFile[]): void {
  for (const child of folder.children) {
    if (child instanceof TFile && child.extension === "md") {
      files.push(child);
    } else if (child instanceof TFolder) {
      collectMarkdownFiles(child, files);
    }
  }
}

function isLatexEngine(engine: string): boolean {
  return engine === "xelatex" || engine === "pdflatex" || engine === "lualatex";
}

function containsCjk(content: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/u.test(
    content
  );
}

function normalizeRemoteImageUrls(content: string): string {
  return content.replace(
    /(https?:\/\/[^\s)"'>]+[?&])tp=webp(&?)/gi,
    (_match, prefix: string, suffix: string) => {
      if (suffix) return prefix;
      return prefix.endsWith("?") ? prefix.slice(0, -1) : prefix.slice(0, -1);
    }
  );
}

async function localizeImagesForTypst(
  content: string,
  file: TFile,
  vaultPath: string,
  tmpDir: string,
  tempFiles: string[]
): Promise<string> {
  const references = collectImageReferences(content);
  const replacements: Array<{ original: string; converted: string }> = [];
  const localizedBySource = new Map<string, string>();
  let index = 0;

  for (const rawPath of references) {
    const normalizedPath = stripMarkdownUrlDelimiters(rawPath);
    if (/^data:/i.test(normalizedPath)) {
      continue;
    }

    const sourceKey = normalizedPath;
    let localPath: string | null | undefined = localizedBySource.get(sourceKey);
    if (!localPath) {
      localPath = /^https?:/i.test(normalizedPath)
        ? await downloadRemoteImageForTypst(normalizedPath, tmpDir, index++)
        : await copyLocalImageForTypst(
            normalizedPath,
            file,
            vaultPath,
            tmpDir,
            index++
          );
      if (!localPath) {
        continue;
      }
      localizedBySource.set(sourceKey, localPath);
      tempFiles.push(localPath);
    }

    replacements.push({
      original: rawPath,
      converted: `<./${path.basename(localPath)}>`,
    });
  }

  let result = content;
  for (const replacement of replacements) {
    result = result.split(replacement.original).join(replacement.converted);
  }

  return result;
}

async function convertWebpImagesForLatex(
  content: string,
  file: TFile,
  vaultPath: string,
  tmpDir: string,
  tempFiles: string[]
): Promise<string> {
  const references = collectImageReferences(content);
  const replacements: Array<{ original: string; converted: string }> = [];
  const convertedBySource = new Map<string, string>();
  let index = 0;

  for (const rawPath of references) {
    const normalizedPath = stripMarkdownUrlDelimiters(rawPath);
    if (/^data:/i.test(normalizedPath)) {
      continue;
    }

    const resolvedPath = /^https?:/i.test(normalizedPath)
      ? await downloadRemoteWebpIfNeeded(normalizedPath, tmpDir, index)
      : isWebpReference(normalizedPath)
        ? resolveWebpReference(normalizedPath, file, vaultPath)
        : null;
    if (!resolvedPath) {
      continue;
    }
    if (resolvedPath.startsWith(path.join(tmpDir, "remote-webp-"))) {
      tempFiles.push(resolvedPath);
    }

    let outputPath = convertedBySource.get(resolvedPath);
    if (!outputPath) {
      outputPath = path.join(
        tmpDir,
        `webp-${Date.now()}-${index++}.png`
      );

      await convertWebpToPng(resolvedPath, outputPath);
      convertedBySource.set(resolvedPath, outputPath);
      tempFiles.push(outputPath);
    }
    replacements.push({
      original: rawPath,
      converted: `<${outputPath}>`,
    });
  }

  let result = content;
  for (const replacement of replacements) {
    result = result.split(replacement.original).join(replacement.converted);
  }

  return result;
}

function collectImageReferences(content: string): string[] {
  const references = new Set<string>();
  const markdownImageRegex = /!\[[^\]]*\]\(\s*(<[^>]+>|[^)]+?)(?:\s+["'][^"']*["'])?\s*\)(?:\{[^}]*\})?/gi;
  const htmlImageRegex = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  const remoteImageUrlRegex = /https?:\/\/[^\s<>"']+/gi;
  let match: RegExpExecArray | null;

  while ((match = markdownImageRegex.exec(content)) !== null) {
    const reference = match[1].trim();
    references.add(reference);
  }

  while ((match = htmlImageRegex.exec(content)) !== null) {
    const reference = match[1].trim();
    references.add(reference);
  }

  while ((match = remoteImageUrlRegex.exec(content)) !== null) {
    const reference = trimUrlDelimiters(match[0]);
    if (isLikelyImageUrl(reference)) {
      references.add(reference);
    }
  }

  return Array.from(references);
}

function trimUrlDelimiters(value: string): string {
  return value.replace(/[)\]}|.,;:]+$/g, "");
}

function isLikelyImageUrl(value: string): boolean {
  const url = stripMarkdownUrlDelimiters(value);
  if (/\.(png|jpe?g|gif|svg|webp|bmp|ico)(?:[?#].*)?$/i.test(url)) {
    return true;
  }

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    if (/\.(png|jpe?g|gif|svg|webp|bmp|ico)$/.test(pathname)) {
      return true;
    }
    return Boolean(
      parsed.searchParams.get("wx_fmt") ||
        parsed.searchParams.get("tp") === "webp"
    );
  } catch {
    return false;
  }
}

function isWebpReference(reference: string): boolean {
  return /\.webp(?:[?#].*)?$/i.test(stripMarkdownUrlDelimiters(reference));
}

function resolveWebpReference(
  rawPath: string,
  file: TFile,
  vaultPath: string
): string | null {
  return resolveImageReference(rawPath, file, vaultPath);
}

function resolveImageReference(
  rawPath: string,
  file: TFile,
  vaultPath: string
): string | null {
  const sourcePath = stripMarkdownUrlDelimiters(rawPath);
  const decodedPath = stripUrlQueryAndHash(safeDecodeUri(sourcePath));
  const candidates = path.isAbsolute(decodedPath)
    ? [decodedPath]
    : [
        path.join(vaultPath, path.dirname(file.path), decodedPath),
        path.join(vaultPath, decodedPath),
      ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function downloadRemoteWebpIfNeeded(
  rawUrl: string,
  tmpDir: string,
  index: number
): Promise<string | null> {
  const url = stripMarkdownUrlDelimiters(rawUrl);
  const isUrlWebp = isWebpReference(url);

  let image: RemoteImage;
  try {
    image = await downloadRemoteImage(url);
  } catch (err) {
    console.warn(
      "Press PDF Export: could not inspect remote image before export:",
      url,
      err
    );
    return null;
  }

  if (
    !isUrlWebp &&
    !image.contentType.includes("image/webp") &&
    !isWebpBuffer(image.data)
  ) {
    return null;
  }

  const outputPath = path.join(
    tmpDir,
    `remote-webp-${Date.now()}-${index}.webp`
  );
  fs.writeFileSync(outputPath, image.data);
  return outputPath;
}

interface RemoteImage {
  data: Buffer;
  contentType: string;
}

async function downloadRemoteImageForTypst(
  url: string,
  tmpDir: string,
  index: number
): Promise<string> {
  try {
    const image = await downloadRemoteImage(url);
    const extension = getImageExtension(url, image.contentType, image.data);
    const downloadedPath = path.join(
      tmpDir,
      `remote-image-${Date.now()}-${index}.${extension}`
    );
    fs.writeFileSync(downloadedPath, image.data);

    if (extension === "webp" || isWebpBuffer(image.data)) {
      const pngPath = path.join(
        tmpDir,
        `remote-image-${Date.now()}-${index}.png`
      );
      await convertWebpToPng(downloadedPath, pngPath);
      return pngPath;
    }

    return downloadedPath;
  } catch (err) {
    console.warn("Press PDF Export: could not download remote image:", url, err);
    return createMissingImagePlaceholder(tmpDir, index);
  }
}

async function copyLocalImageForTypst(
  rawPath: string,
  file: TFile,
  vaultPath: string,
  tmpDir: string,
  index: number
): Promise<string | null> {
  const resolvedPath = resolveImageReference(rawPath, file, vaultPath);
  if (!resolvedPath) {
    return null;
  }

  if (isWebpReference(resolvedPath)) {
    const outputPath = path.join(
      tmpDir,
      `typst-image-${Date.now()}-${index}.png`
    );
    await convertWebpToPng(resolvedPath, outputPath);
    return outputPath;
  }

  const extension = getImageExtensionFromPath(resolvedPath);
  const outputPath = path.join(
    tmpDir,
    `typst-image-${Date.now()}-${index}.${extension}`
  );
  fs.copyFileSync(resolvedPath, outputPath);
  return outputPath;
}

async function downloadRemoteImage(url: string): Promise<RemoteImage> {
  const response = await requestUrl({
    url,
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
  });
  const contentTypeHeader =
    response.headers["content-type"] || response.headers["Content-Type"] || "";

  return {
    data: Buffer.from(response.arrayBuffer),
    contentType: contentTypeHeader.toLowerCase(),
  };
}

function getImageExtension(
  url: string,
  contentType: string,
  data: Buffer
): string {
  if (isWebpBuffer(data) || contentType.includes("image/webp")) return "webp";
  if (isPngBuffer(data) || contentType.includes("image/png")) return "png";
  if (isJpegBuffer(data) || contentType.includes("image/jpeg")) return "jpg";
  if (isGifBuffer(data) || contentType.includes("image/gif")) return "gif";
  if (isSvgBuffer(data) || contentType.includes("image/svg")) return "svg";

  const formatFromQuery = getImageFormatFromQuery(url);
  if (formatFromQuery) return formatFromQuery;

  const pathname = safeUrlPathname(url);
  const ext = path.extname(pathname).replace(".", "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) {
    return ext === "jpeg" ? "jpg" : ext;
  }

  return "png";
}

function getImageExtensionFromPath(filePath: string): string {
  const ext = path
    .extname(stripUrlQueryAndHash(filePath))
    .replace(".", "")
    .toLowerCase();
  if (ext === "jpeg") return "jpg";
  if (["png", "jpg", "gif", "svg", "webp"].includes(ext)) return ext;
  return "png";
}

function getImageFormatFromQuery(url: string): string | null {
  try {
    const parsed = new URL(url);
    const value = (
      parsed.searchParams.get("wx_fmt") ||
      parsed.searchParams.get("format") ||
      ""
    ).toLowerCase();
    if (value === "jpeg") return "jpg";
    if (["png", "jpg", "gif", "svg", "webp"].includes(value)) return value;
  } catch {
    // Ignore invalid URLs.
  }
  return null;
}

function safeUrlPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function isWebpBuffer(data: Buffer): boolean {
  return (
    data.length >= 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  );
}

function isPngBuffer(data: Buffer): boolean {
  return (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  );
}

function isJpegBuffer(data: Buffer): boolean {
  return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8;
}

function isGifBuffer(data: Buffer): boolean {
  return (
    data.length >= 6 &&
    (data.toString("ascii", 0, 6) === "GIF87a" ||
      data.toString("ascii", 0, 6) === "GIF89a")
  );
}

function isSvgBuffer(data: Buffer): boolean {
  return data.toString("utf8", 0, Math.min(data.length, 256)).includes("<svg");
}

function createMissingImagePlaceholder(tmpDir: string, index: number): string {
  const outputPath = path.join(
    tmpDir,
    `remote-image-missing-${Date.now()}-${index}.svg`
  );
  fs.writeFileSync(
    outputPath,
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160" viewBox="0 0 640 160">
  <rect width="640" height="160" fill="#f6f6f6" stroke="#cccccc"/>
  <text x="320" y="86" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#666666">Remote image unavailable</text>
</svg>`,
    "utf8"
  );
  return outputPath;
}

function stripMarkdownUrlDelimiters(value: string): string {
  if (value.startsWith("<") && value.endsWith(">")) {
    return value.slice(1, -1);
  }
  return value;
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function stripUrlQueryAndHash(value: string): string {
  return value.replace(/[?#].*$/, "");
}

function convertWebpToPng(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("dwebp", [inputPath, "-o", outputPath], {
      shell: false,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
      },
    });

    let stderr = "";
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve();
      } else {
        reject(
          new Error(
            `Failed to convert WebP image for LaTeX: ${
              stderr.trim() || `dwebp exited with code ${code}`
            }`
          )
        );
      }
    });

    child.on("error", (err) => {
      reject(
        new Error(
          `Failed to run dwebp for WebP image conversion: ${err.message}`
        )
      );
    });
  });
}

// === Pre-flight checks ===

export async function preflightChecks(
  settings: PluginSettings
): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];

  // Check Pandoc
  const pandocCheck = await checkPandocAvailable(settings.pandocPath);
  if (!pandocCheck.available) {
    errors.push(
      `Pandoc not found at "${settings.pandocPath}". Install: brew install pandoc`
    );
  }

  // Check PDF engine (for non-Pandoc-native engines)
  if (settings.pdfEngine === "wkhtmltopdf") {
    const exists = await checkCommandExists("wkhtmltopdf");
    if (!exists) {
      errors.push(
        "wkhtmltopdf not found. Install: brew install wkhtmltopdf"
      );
    }
  } else if (settings.pdfEngine === "weasyprint") {
    const exists = await checkCommandExists("weasyprint");
    if (!exists) {
      errors.push(
        "WeasyPrint not found. Install: pip install weasyprint"
      );
    }
  } else if (
    settings.pdfEngine === "xelatex" ||
    settings.pdfEngine === "pdflatex" ||
    settings.pdfEngine === "lualatex"
  ) {
    const exists = await checkCommandExists(settings.pdfEngine);
    if (!exists) {
      errors.push(
        `${settings.pdfEngine} not found. Install: brew install --cask mactex-no-gui`
      );
    }
  }

  // Check Mermaid (optional, warn only)
  const mermaidExists = await checkCommandExists(
    settings.mermaidPath || "mmdc"
  );
  if (!mermaidExists) {
    // Not an error, just a warning — mermaid blocks will be kept as code
    console.warn(
      "Press PDF Export: mmdc not found. Mermaid diagrams will be exported as code blocks."
    );
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
