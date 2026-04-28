import { TFile, TFolder } from "obsidian";

// === Settings ===

export type PdfEngine =
  | "xelatex"
  | "wkhtmltopdf"
  | "weasyprint"
  | "pdflatex"
  | "lualatex"
  | "typst";

export type OutputFormat = "pdf" | "docx" | "html";
export type OutputNaming = "same" | "timestamp" | "suffix";
export type PageSize = "A4" | "Letter" | "Legal" | "A3";
export type CodeTheme =
  | "tango"
  | "zenburn"
  | "breezedark"
  | "pygments"
  | "kate"
  | "monochrome";
export type MermaidTheme = "default" | "dark" | "forest" | "neutral";

export interface PluginSettings {
  // Pandoc
  pandocPath: string;
  pdfEngine: PdfEngine;
  enginePath: string;

  // Output
  outputDir: string;
  outputNaming: OutputNaming;
  openAfterExport: boolean;
  defaultFormat: OutputFormat;

  // Style & Template
  customCssPath: string;
  customTemplatePath: string;
  fontSize: number;
  pageSize: PageSize;
  pageMargin: string;
  codeTheme: CodeTheme;

  // CJK
  cjkFont: string;
  enableCjk: boolean;

  // Mermaid
  mermaidPath: string;
  mermaidTheme: MermaidTheme;

  // Advanced
  extraArgs: string;

  // Batch
  concurrency: number;
  skipErrors: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  pandocPath: "/opt/homebrew/bin/pandoc",
  pdfEngine: "xelatex",
  enginePath: "",
  outputDir: "pdf",
  outputNaming: "same",
  openAfterExport: true,
  defaultFormat: "pdf",
  customCssPath: "",
  customTemplatePath: "",
  fontSize: 11,
  pageSize: "A4",
  pageMargin: "25",
  codeTheme: "tango",
  cjkFont: "",
  enableCjk: true,
  mermaidPath: "mmdc",
  mermaidTheme: "default",
  extraArgs: "",
  concurrency: 3,
  skipErrors: true,
};

// === Export ===

export interface ExportResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  duration: number;
}

export interface PandocOptions {
  inputPath: string;
  outputPath: string;
  format: OutputFormat;
  engine: PdfEngine;
  pandocPath: string;
  tempDir: string;
  fontSize: number;
  pageSize: string;
  pageMargin: string;
  codeTheme: string;
  cjkFont: string;
  enableCjk: boolean;
  customCssPath?: string;
  customTemplatePath?: string;
  extraArgs: string[];
}

export interface RenderResult {
  content: string;
  tempFiles: string[];
}

// === Callout ===

export type CalloutType =
  | "note"
  | "tip"
  | "important"
  | "warning"
  | "caution"
  | "abstract"
  | "info"
  | "todo"
  | "example"
  | "quote"
  | "success"
  | "question"
  | "failure"
  | "danger"
  | "bug";

// === Batch Export ===

export interface BatchResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ file: string; error: string }>;
  outputDir: string;
  duration: number;
}
