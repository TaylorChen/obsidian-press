import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(os.tmpdir(), `obsidian-press-code-export-${Date.now()}`);
const inputPath = path.join(outDir, "code-format.md");
const pdfPath = path.join(outDir, "code-format.pdf");
const listingsHeaderPath = path.join(outDir, "listings-wrap.tex");
const pngPrefix = path.join(outDir, "code-format-page");
const pngPath = `${pngPrefix}.png`;

const env = {
  ...process.env,
  PATH: `/Library/TeX/texbin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
  TMPDIR: outDir,
  TMP: outDir,
  TEMP: outDir,
  LANG: process.env.LANG || "en_US.UTF-8",
  LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
};

const input = `# Code export verification

The fenced block below must keep Obsidian-like syntax untouched.

\`\`\`ts
const marker = "[[wikilink]] ==highlight== %%comment%%";
const longLine = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
function add(a: number, b: number) {
  return a + b;
}
\`\`\`

Inline \`const inline = "==keep=="\` should remain inline code.
`;

await mkdir(outDir, { recursive: true });
await writeFile(inputPath, input, "utf8");
await writeFile(
  listingsHeaderPath,
  String.raw`\lstset{
  breaklines=true,
  breakatwhitespace=false,
  columns=fullflexible,
  keepspaces=true,
  basicstyle=\ttfamily\footnotesize,
  frame=single,
  backgroundcolor=\color[HTML]{F6F8FA}
}
`,
  "utf8"
);

await execFileAsync(
  "pandoc",
  [
    inputPath,
    "-o",
    pdfPath,
    "--from",
    "markdown+fenced_code_blocks+fenced_code_attributes+backtick_code_blocks+pipe_tables+grid_tables+raw_html+tex_math_dollars",
    "--to",
    "pdf",
    "--standalone",
    "--highlight-style=tango",
    "--listings",
    "-H",
    listingsHeaderPath,
    "--pdf-engine=xelatex",
    "-V",
    "geometry:margin=25mm",
    "-V",
    "fontsize=11pt",
    "-V",
    "papersize=a4",
    "-V",
    "colorlinks=true",
  ],
  { cwd: root, env }
);

const { stdout: extractedText } = await execFileAsync(
  "pdftotext",
  [pdfPath, "-"],
  { cwd: root, env }
);

for (const expected of [
  "[[wikilink]] ==highlight== %%comment%%",
  "const longLine =",
  "function add(a: number, b: number)",
  "const inline = \"==keep==\"",
]) {
  if (!extractedText.includes(expected)) {
    throw new Error(`PDF text is missing expected code content: ${expected}`);
  }
}

await execFileAsync("pdftoppm", ["-png", "-singlefile", pdfPath, pngPrefix], {
  cwd: root,
  env,
});

const [pdfStats, pngStats] = await Promise.all([stat(pdfPath), stat(pngPath)]);
if (pdfStats.size <= 0 || pngStats.size <= 0) {
  throw new Error("PDF or rendered PNG is empty");
}

const pngHeader = await readFile(pngPath, { encoding: null });
if (
  pngHeader.length < 8 ||
  pngHeader[0] !== 0x89 ||
  pngHeader[1] !== 0x50 ||
  pngHeader[2] !== 0x4e ||
  pngHeader[3] !== 0x47
) {
  throw new Error("Rendered PDF preview is not a PNG file");
}

console.log("Code export verification passed");
console.log(`PDF: ${pdfPath}`);
console.log(`Preview: ${pngPath}`);
