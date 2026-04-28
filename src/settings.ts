import { App, PluginSettingTab, Setting } from "obsidian";
import ObsidianPressPlugin from "./main";
import { PdfEngine, PageSize, CodeTheme, MermaidTheme } from "./types";

export class ObsidianPressSettingTab extends PluginSettingTab {
  plugin: ObsidianPressPlugin;

  constructor(app: App, plugin: ObsidianPressPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // === General ===
    new Setting(containerEl).setName("General").setHeading();

    new Setting(containerEl)
      .setName("Pandoc path")
      .setDesc("Path to the pandoc binary")
      .addText((text) =>
        text
          .setPlaceholder("/opt/homebrew/bin/pandoc")
          .setValue(this.plugin.settings.pandocPath)
          .onChange(async (value) => {
            this.plugin.settings.pandocPath = value || "/opt/homebrew/bin/pandoc";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("PDF engine")
      .setDesc("The PDF rendering engine to use")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("xelatex", "XeLaTeX (best quality)")
          .addOption("pdflatex", "pdfLaTeX (auto XeLaTeX for CJK)")
          .addOption("lualatex", "LuaLaTeX")
          .addOption("wkhtmltopdf", "wkhtmltopdf (lightweight)")
          .addOption("weasyprint", "WeasyPrint (CSS-based)")
          .addOption("typst", "Typst (experimental)")
          .setValue(this.plugin.settings.pdfEngine)
          .onChange(async (value: string) => {
            this.plugin.settings.pdfEngine = value as PdfEngine;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default format")
      .setDesc("Default export format")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("pdf", "PDF")
          .addOption("docx", "Word (DOCX)")
          .addOption("html", "HTML")
          .setValue(this.plugin.settings.defaultFormat)
          .onChange(async (value: string) => {
            this.plugin.settings.defaultFormat = value as any;
            await this.plugin.saveSettings();
          })
      );

    // === Output ===
    new Setting(containerEl).setName("Output").setHeading();

    new Setting(containerEl)
      .setName("Output directory")
      .setDesc(
        "Relative to vault root, or absolute path. Leave empty for 'pdf' folder"
      )
      .addText((text) =>
        text
          .setPlaceholder("pdf")
          .setValue(this.plugin.settings.outputDir)
          .onChange(async (value) => {
            this.plugin.settings.outputDir = value || "pdf";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("File naming")
      .setDesc("How output files are named")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("same", "Same as source (note.pdf)")
          .addOption("timestamp", "With timestamp (note_2024-01-01T00-00-00.pdf)")
          .addOption("suffix", "With suffix (note_export.pdf)")
          .setValue(this.plugin.settings.outputNaming)
          .onChange(async (value: string) => {
            this.plugin.settings.outputNaming = value as any;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Open after export")
      .setDesc("Automatically open the exported file after completion")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openAfterExport)
          .onChange(async (value) => {
            this.plugin.settings.openAfterExport = value;
            await this.plugin.saveSettings();
          })
      );

    // === Typography ===
    new Setting(containerEl).setName("Typography").setHeading();

    new Setting(containerEl)
      .setName("Font size")
      .setDesc("Base font size in points")
      .addText((text) =>
        text
          .setPlaceholder("11")
          .setValue(String(this.plugin.settings.fontSize))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0 && num <= 72) {
              this.plugin.settings.fontSize = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Page size")
      .setDesc("PDF page dimensions")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("A4", "A4")
          .addOption("Letter", "Letter")
          .addOption("Legal", "Legal")
          .addOption("A3", "A3")
          .setValue(this.plugin.settings.pageSize)
          .onChange(async (value: string) => {
            this.plugin.settings.pageSize = value as PageSize;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Page margin")
      .setDesc("Page margin in millimeters")
      .addText((text) =>
        text
          .setPlaceholder("25")
          .setValue(this.plugin.settings.pageMargin)
          .onChange(async (value) => {
            this.plugin.settings.pageMargin = value || "25";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Code highlight theme")
      .setDesc("Syntax highlighting theme for code blocks")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("tango", "Tango (default)")
          .addOption("pygments", "Pygments (minimal background)")
          .addOption("zenburn", "Zenburn")
          .addOption("breezedark", "Breeze Dark")
          .addOption("kate", "Kate")
          .addOption("monochrome", "Monochrome")
          .setValue(this.plugin.settings.codeTheme)
          .onChange(async (value: string) => {
            this.plugin.settings.codeTheme = value as CodeTheme;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("CJK font")
      .setDesc(
        "Chinese/Japanese/Korean font name. On macOS, STHeitiSC-Medium is a reliable XeLaTeX choice."
      )
      .addText((text) =>
        text
          .setPlaceholder("STHeitiSC-Medium")
          .setValue(this.plugin.settings.cjkFont)
          .onChange(async (value) => {
            this.plugin.settings.cjkFont = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Enable CJK support")
      .setDesc("Add CJK font configuration for LaTeX engines")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableCjk)
          .onChange(async (value) => {
            this.plugin.settings.enableCjk = value;
            await this.plugin.saveSettings();
          })
      );

    // === Advanced ===
    new Setting(containerEl).setName("Advanced").setHeading();

    new Setting(containerEl)
      .setName("Custom CSS file")
      .setDesc(
        "Path to custom CSS file (relative to vault root, for HTML-based engines)"
      )
      .addText((text) =>
        text
          .setPlaceholder("styles/custom-pdf.css")
          .setValue(this.plugin.settings.customCssPath)
          .onChange(async (value) => {
            this.plugin.settings.customCssPath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Custom Pandoc template")
      .setDesc("Path to custom Pandoc template file")
      .addText((text) =>
        text
          .setPlaceholder("templates/custom.html")
          .setValue(this.plugin.settings.customTemplatePath)
          .onChange(async (value) => {
            this.plugin.settings.customTemplatePath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Mermaid CLI path")
      .setDesc("Path to mmdc binary for Mermaid diagram rendering")
      .addText((text) =>
        text
          .setPlaceholder("mmdc")
          .setValue(this.plugin.settings.mermaidPath)
          .onChange(async (value) => {
            this.plugin.settings.mermaidPath = value || "mmdc";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Mermaid theme")
      .setDesc("Theme for Mermaid diagrams")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("default", "Default")
          .addOption("dark", "Dark")
          .addOption("forest", "Forest")
          .addOption("neutral", "Neutral")
          .setValue(this.plugin.settings.mermaidTheme)
          .onChange(async (value: string) => {
            this.plugin.settings.mermaidTheme = value as MermaidTheme;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Extra Pandoc arguments")
      .setDesc("Additional command-line arguments passed to Pandoc")
      .addText((text) =>
        text
          .setPlaceholder("--pdf-engine-opt=--enable-local-file-access")
          .setValue(this.plugin.settings.extraArgs)
          .onChange(async (value) => {
            this.plugin.settings.extraArgs = value;
            await this.plugin.saveSettings();
          })
      );

    // === Batch ===
    new Setting(containerEl).setName("Batch Export").setHeading();

    new Setting(containerEl)
      .setName("Concurrency")
      .setDesc("Number of files to export in parallel")
      .addText((text) =>
        text
          .setPlaceholder("3")
          .setValue(String(this.plugin.settings.concurrency))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0 && num <= 20) {
              this.plugin.settings.concurrency = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Skip errors")
      .setDesc("Continue exporting remaining files if one fails")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.skipErrors)
          .onChange(async (value) => {
            this.plugin.settings.skipErrors = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
