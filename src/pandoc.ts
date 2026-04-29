import * as path from "path";
import * as fs from "fs";
import { PandocOptions, ExportResult } from "./types";
import { spawn } from "child_process";

// === Build Pandoc args array (no shell escaping issues) ===

function buildPandocArgs(options: PandocOptions): string[] {
  const {
    inputPath,
    outputPath,
    format,
    engine,
    fontSize,
    pageSize,
    pageMargin,
    codeTheme,
    cjkFont,
    enableCjk,
    customCssPath,
    customTemplatePath,
    extraArgs,
  } = options;
  const listingsHeaderPath = path.join(options.tempDir, "obsidian-press-listings.tex");

  const args: string[] = [
    inputPath,
    "-o",
    outputPath,
    "--from",
    "markdown+fenced_code_blocks+fenced_code_attributes+backtick_code_blocks+pipe_tables+grid_tables+raw_html+tex_math_dollars",
    "--to",
    format === "pdf" ? "pdf" : format === "docx" ? "docx" : "html5",
    "--standalone",
    "--toc",
    "--toc-depth=3",
    `--highlight-style=${codeTheme}`,
    "--resource-path",
    path.dirname(inputPath),
  ];

  // Engine-specific args
  const latexBase = [
    "-V",
    `geometry:margin=${pageMargin}mm`,
    "-V",
    `fontsize=${fontSize}pt`,
    "-V",
    `papersize=${pageSize.toLowerCase()}`,
  ];

  switch (engine) {
    case "xelatex":
      args.push(
        "--pdf-engine=xelatex",
        "--listings",
        "-H",
        listingsHeaderPath,
        ...latexBase,
        ...getCjkArgs(engine, enableCjk, cjkFont),
        "-V",
        "colorlinks=true"
      );
      break;
    case "pdflatex":
      args.push(
        "--pdf-engine=pdflatex",
        "--listings",
        "-H",
        listingsHeaderPath,
        ...latexBase,
        "-V",
        "colorlinks=true"
      );
      break;
    case "lualatex":
      args.push(
        "--pdf-engine=lualatex",
        "--listings",
        "-H",
        listingsHeaderPath,
        ...latexBase,
        ...getCjkArgs(engine, enableCjk, cjkFont),
        "-V",
        "colorlinks=true"
      );
      break;
    case "wkhtmltopdf":
      args.push(
        "--pdf-engine=wkhtmltopdf",
        "-V",
        `margin-top=${pageMargin}mm`,
        "-V",
        `margin-bottom=${pageMargin}mm`,
        "-V",
        `margin-left=${pageMargin}mm`,
        "-V",
        `margin-right=${pageMargin}mm`
      );
      break;
    case "weasyprint":
      args.push("--pdf-engine=weasyprint", "-V", `margin=${pageMargin}mm`);
      break;
    case "typst":
      args.push(
        "--pdf-engine=typst",
        "-V",
        `font-size=${fontSize}pt`,
        "-V",
        `page-size=${pageSize.toLowerCase()}`
      );
      break;
  }

  // CSS for HTML-based engines
  if (
    (engine === "wkhtmltopdf" || engine === "weasyprint") &&
    customCssPath
  ) {
    args.push("--css", customCssPath);
  }

  // Template
  if (customTemplatePath) {
    args.push("--template", customTemplatePath);
  }

  // Extra args
  if (extraArgs.length > 0) {
    args.push(...extraArgs);
  }

  return args;
}

function normalizeCjkFontName(fontName: string): string {
  const trimmed = fontName.trim();
  if (process.platform === "darwin" && trimmed === "PingFang SC") {
    return "STHeitiSC-Medium";
  }
  return trimmed;
}

function getCjkArgs(
  engine: string,
  enableCjk: boolean,
  cjkFont: string
): string[] {
  if (!enableCjk) return [];

  const resolved = normalizeCjkFontName(cjkFont);
  if (resolved) {
    return ["-V", `CJKmainfont=${resolved}`];
  }

  if (process.platform === "darwin" && engine === "xelatex") {
    return ["-V", "CJKmainfont=STHeitiSC-Medium"];
  }

  return [];
}

// === Export with Pandoc (spawn with array, no shell escaping issues) ===

export async function exportWithPandoc(
  options: PandocOptions
): Promise<ExportResult> {
  const startTime = Date.now();
  const pandocPath = options.pandocPath || "pandoc";

  // Verify input file exists
  if (!fs.existsSync(options.inputPath)) {
    return {
      success: false,
      error: `Input file not found: ${options.inputPath}`,
      duration: Date.now() - startTime,
    };
  }

  // Ensure output directory exists
  const outputDir = path.dirname(options.outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  if (!fs.existsSync(options.tempDir)) {
    fs.mkdirSync(options.tempDir, { recursive: true });
  }
  writeListingsHeader(options.tempDir);
  const texCacheDir = path.join(options.tempDir, "tex-cache");
  if (!fs.existsSync(texCacheDir)) {
    fs.mkdirSync(texCacheDir, { recursive: true });
  }

  const args = buildPandocArgs(options);

  return new Promise((resolve) => {
    // Use spawn with array args and shell: false — pandocPath is used as the
    // executable directly, never appears in the args array.
    const child = spawn(pandocPath, args, {
      shell: false,
      cwd: options.tempDir,
      stdio: "pipe",
      timeout: 120000,
      env: {
        ...process.env,
        PATH: `/Library/TeX/texbin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
        TMPDIR: options.tempDir,
        TMP: options.tempDir,
        TEMP: options.tempDir,
        TEXMFVAR: texCacheDir,
        TEXMFCACHE: texCacheDir,
        LANG: process.env.LANG || "en_US.UTF-8",
        LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
      },
    });

    let stderr = "";

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      const duration = Date.now() - startTime;

      if (code === 0) {
        if (fs.existsSync(options.outputPath)) {
          const stats = fs.statSync(options.outputPath);
          if (stats.size > 0) {
            resolve({
              success: true,
              outputPath: options.outputPath,
              duration,
            });
            return;
          }
        }
        resolve({
          success: false,
          error: "Output file was not created or is empty",
          duration,
        });
        return;
      }

      // Parse error
      const errorMsg = parsePandocError(stderr, code);
      resolve({ success: false, error: errorMsg, duration });
    });

    child.on("error", (err) => {
      resolve({
        success: false,
        error: `Failed to run pandoc: ${err.message}`,
        duration: Date.now() - startTime,
      });
    });
  });
}

function writeListingsHeader(tempDir: string): void {
  const headerPath = path.join(tempDir, "obsidian-press-listings.tex");
  const content = String.raw`\lstset{
  breaklines=true,
  breakatwhitespace=false,
  columns=fullflexible,
  keepspaces=true,
  basicstyle=\ttfamily\footnotesize,
  frame=single,
  framerule=0.3pt,
  rulecolor=\color[HTML]{D0D7DE},
  backgroundcolor=\color[HTML]{F6F8FA},
  xleftmargin=0.5em,
  xrightmargin=0.5em,
  aboveskip=0.8em,
  belowskip=0.8em
}
`;
  fs.writeFileSync(headerPath, content, "utf8");
}

// === Error parsing ===

function parsePandocError(stderr: string, code: number | null): string {
  if (!stderr) return `Pandoc exited with code ${code}`;

  const lines = stderr.split("\n").filter((line) => line.trim());
  const latexErrorIndex = lines.findIndex((line) => /^! /.test(line.trim()));
  if (latexErrorIndex >= 0) {
    return lines
      .slice(latexErrorIndex, latexErrorIndex + 5)
      .join("\n")
      .substring(0, 800);
  }

  const errorPatterns = [
    /Package .* Error/,
    /LaTeX Error/,
    /error:/i,
    /not found/i,
    /failed/i,
    /cannot/i,
    /unable/i,
    /does not exist/i,
  ];

  for (const pattern of errorPatterns) {
    const errorLine = lines.find((line) => pattern.test(line));
    if (errorLine) return errorLine.trim();
  }

  return lines.slice(0, 3).join("; ").substring(0, 500);
}

// === Pandoc availability check ===

export async function checkPandocAvailable(
  pandocPath: string
): Promise<{ available: boolean; version?: string }> {
  return new Promise((resolve) => {
    const child = spawn(pandocPath, ["--version"], {
      shell: false,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `/Library/TeX/texbin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
      },
    });

    let stdout = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        const versionMatch = stdout.match(/pandoc\s+(\d+\.\d+[.\d]*)/);
        resolve({
          available: true,
          version: versionMatch ? versionMatch[1] : "unknown",
        });
      } else {
        resolve({ available: false });
      }
    });

    child.on("error", () => {
      resolve({ available: false });
    });
  });
}
