import { Plugin, TFile, TFolder, Notice, Menu, Platform } from "obsidian";
import * as path from "path";
import { PluginSettings, DEFAULT_SETTINGS, OutputFormat } from "./types";
import { ObsidianPressSettingTab } from "./settings";
import { exportFile, exportFolder, exportVault, preflightChecks } from "./exporter";
import { getVaultPath } from "./utils";

class ExportProgressNotice {
  private notice: Notice;
  private titleEl: HTMLElement;
  private detailEl: HTMLElement;
  private fillEl: HTMLElement;

  constructor(title: string, detail = "") {
    this.notice = new Notice("", 0);
    this.notice.noticeEl.empty();
    this.notice.noticeEl.addClass("obsidian-press-progress-notice");

    this.titleEl = this.notice.noticeEl.createDiv({
      cls: "obsidian-press-progress-title",
      text: title,
    });
    this.detailEl = this.notice.noticeEl.createDiv({
      cls: "obsidian-press-progress-detail",
      text: detail,
    });

    const barEl = this.notice.noticeEl.createDiv({
      cls: "obsidian-press-progress-bar",
    });
    this.fillEl = barEl.createDiv({
      cls: "obsidian-press-progress-bar-fill",
    });
    this.setProgress(0);
  }

  update(title: string, detail: string, progress: number) {
    this.titleEl.setText(title);
    this.detailEl.setText(detail);
    this.setProgress(progress);
  }

  hide() {
    this.notice.hide();
  }

  private setProgress(progress: number) {
    const normalized = Math.max(0, Math.min(100, progress));
    this.fillEl.style.width = `${normalized}%`;
  }
}

export default class ObsidianPressPlugin extends Plugin {
  settings: PluginSettings;

  async onload() {
    await this.loadSettings();

    // Ribbon icon — export current note
    this.addRibbonIcon("file-output", "Obsidian Press: Export current note", () => {
      this.exportCurrentNote();
    });

    // Commands
    this.addCommand({
      id: "export-current-note-pdf",
      name: "Export current note to PDF",
      callback: () => this.exportCurrentNote(),
    });

    this.addCommand({
      id: "export-current-note-pdf-choose-folder",
      name: "Export current note to PDF...",
      callback: () => this.exportCurrentNoteWithDirectory("pdf"),
    });

    this.addCommand({
      id: "export-current-note-docx",
      name: "Export current note to Word (DOCX)",
      callback: () => this.exportCurrentNote("docx"),
    });

    this.addCommand({
      id: "export-current-note-docx-choose-folder",
      name: "Export current note to Word (DOCX)...",
      callback: () => this.exportCurrentNoteWithDirectory("docx"),
    });

    this.addCommand({
      id: "export-current-note-html",
      name: "Export current note to HTML",
      callback: () => this.exportCurrentNote("html"),
    });

    this.addCommand({
      id: "export-current-note-html-choose-folder",
      name: "Export current note to HTML...",
      callback: () => this.exportCurrentNoteWithDirectory("html"),
    });

    this.addCommand({
      id: "export-folder",
      name: "Export all notes in current folder",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          const folder = file.parent;
          if (folder && folder instanceof TFolder) {
            if (!checking) {
              this.exportFolder(folder);
            }
            return true;
          }
        }
        return false;
      },
    });

    this.addCommand({
      id: "export-folder-choose-folder",
      name: "Export all notes in current folder...",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          const folder = file.parent;
          if (folder && folder instanceof TFolder) {
            if (!checking) {
              this.exportFolderWithDirectory(folder);
            }
            return true;
          }
        }
        return false;
      },
    });

    this.addCommand({
      id: "export-vault",
      name: "Export entire vault",
      callback: () => this.exportEntireVault(),
    });

    this.addCommand({
      id: "export-vault-choose-folder",
      name: "Export entire vault...",
      callback: () => this.exportEntireVaultWithDirectory(),
    });

    // File menu — right-click on file
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) => {
            item
              .setTitle("导出为 PDF（Obsidian Press）")
              .setIcon("file-output")
              .onClick(() => this.exportSpecificFile(file));
          });
          menu.addItem((item) => {
            item
              .setTitle("选择目录导出为 PDF（Obsidian Press）")
              .setIcon("folder-open")
              .onClick(() => this.exportSpecificFileWithDirectory(file, "pdf"));
          });
        }

        if (file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle("全部导出为 PDF（Obsidian Press）")
              .setIcon("file-output")
              .onClick(() => this.exportFolder(file));
          });
          menu.addItem((item) => {
            item
              .setTitle("选择目录全部导出为 PDF（Obsidian Press）")
              .setIcon("folder-open")
              .onClick(() => this.exportFolderWithDirectory(file));
          });
        }
      })
    );

    // Settings tab
    this.addSettingTab(new ObsidianPressSettingTab(this.app, this));
  }

  onunload() {
    // Cleanup if needed
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if ((this.settings.pdfEngine as string) === "chromium") {
      this.settings.pdfEngine = "xelatex";
      await this.saveSettings();
    }
    if (this.settings.codeTheme === "pygments") {
      this.settings.codeTheme = "tango";
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // === Export actions ===

  private async exportCurrentNote(forceFormat?: OutputFormat) {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice("No active Markdown file");
      return;
    }

    const format = forceFormat || this.settings.defaultFormat;
    const settings = { ...this.settings, defaultFormat: format };
    await this.exportSpecificFile(file, settings);
  }

  private async exportCurrentNoteWithDirectory(forceFormat?: OutputFormat) {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice("No active Markdown file");
      return;
    }

    await this.exportSpecificFileWithDirectory(
      file,
      forceFormat || this.settings.defaultFormat
    );
  }

  private async exportSpecificFileWithDirectory(
    file: TFile,
    format: OutputFormat
  ) {
    const outputDir = await this.chooseOutputDirectory();
    if (!outputDir) {
      return;
    }

    await this.exportSpecificFile(file, {
      ...this.settings,
      defaultFormat: format,
      outputDir,
    });
  }

  private async exportSpecificFile(
    file: TFile,
    overrideSettings?: PluginSettings
  ) {
    const settings = overrideSettings || this.settings;

    // Pre-flight check
    const check = await preflightChecks(settings);
    if (!check.ok) {
      new Notice(`Export failed:\n${check.errors.join("\n")}`, 8000);
      return;
    }

    const formatLabel = settings.defaultFormat.toUpperCase();
    const progress = new ExportProgressNotice(
      `正在导出 ${formatLabel}`,
      file.name
    );

    try {
      progress.update(`正在导出 ${formatLabel}`, "准备文件...", 20);
      const result = await exportFile(file, this.app, settings);

      progress.update(`正在导出 ${formatLabel}`, "写入导出文件...", 90);
      progress.hide();

      if (result.success) {
        new Notice(
          `Exported: ${result.outputPath}\n(${(result.duration / 1000).toFixed(1)}s)`
        );

        // Open the exported file
        if (settings.openAfterExport && result.outputPath) {
          window.open(`file://${result.outputPath}`);
        }
      } else {
        new Notice(`Export failed: ${result.error}`, 8000);
      }
    } catch (err) {
      progress.hide();
      new Notice(
        `Export error: ${err instanceof Error ? err.message : String(err)}`,
        8000
      );
    }
  }

  private async exportFolder(folder: TFolder, overrideSettings?: PluginSettings) {
    const settings = overrideSettings || this.settings;

    // Pre-flight check
    const check = await preflightChecks(settings);
    if (!check.ok) {
      new Notice(`Export failed:\n${check.errors.join("\n")}`, 8000);
      return;
    }

    const progress = new ExportProgressNotice(
      "正在导出文件夹",
      folder.name
    );

    try {
      const result = await exportFolder(
        folder,
        this.app,
        settings,
        (done, total, current) => {
          progress.update(
            "正在导出文件夹",
            `${done}/${total} · ${current}`,
            total > 0 ? (done / total) * 100 : 0
          );
        }
      );

      progress.hide();

      const summary = [
        `Export complete`,
        `Total: ${result.total}`,
        `Success: ${result.success}`,
        `Failed: ${result.failed}`,
        `Output: ${result.outputDir}`,
        `Time: ${(result.duration / 1000).toFixed(1)}s`,
      ].join("\n");

      new Notice(summary, 10000);

      if (result.failed > 0 && result.errors.length > 0) {
        console.error("Obsidian Press export errors:", result.errors);
      }
    } catch (err) {
      progress.hide();
      new Notice(
        `Export error: ${err instanceof Error ? err.message : String(err)}`,
        8000
      );
    }
  }

  private async exportFolderWithDirectory(folder: TFolder) {
    const outputDir = await this.chooseOutputDirectory();
    if (!outputDir) {
      return;
    }

    await this.exportFolder(folder, {
      ...this.settings,
      outputDir,
    });
  }

  private async exportEntireVault(overrideSettings?: PluginSettings) {
    const settings = overrideSettings || this.settings;

    // Pre-flight check
    const check = await preflightChecks(settings);
    if (!check.ok) {
      new Notice(`Export failed:\n${check.errors.join("\n")}`, 8000);
      return;
    }

    const progress = new ExportProgressNotice(
      "正在导出整个仓库",
      "扫描 Markdown 文件..."
    );

    try {
      const result = await exportVault(
        this.app,
        settings,
        (done, total, current) => {
          progress.update(
            "正在导出整个仓库",
            `${done}/${total} · ${current}`,
            total > 0 ? (done / total) * 100 : 0
          );
        }
      );

      progress.hide();

      const summary = [
        `Vault export complete`,
        `Total: ${result.total}`,
        `Success: ${result.success}`,
        `Failed: ${result.failed}`,
        `Output: ${result.outputDir}`,
        `Time: ${(result.duration / 1000).toFixed(1)}s`,
      ].join("\n");

      new Notice(summary, 10000);

      if (result.failed > 0 && result.errors.length > 0) {
        console.error("Obsidian Press export errors:", result.errors);
      }
    } catch (err) {
      progress.hide();
      new Notice(
        `Export error: ${err instanceof Error ? err.message : String(err)}`,
        8000
      );
    }
  }

  private async exportEntireVaultWithDirectory() {
    const outputDir = await this.chooseOutputDirectory();
    if (!outputDir) {
      return;
    }

    await this.exportEntireVault({
      ...this.settings,
      outputDir,
    });
  }

  private getConfiguredOutputDirectory(): string {
    const vaultPath = getVaultPath(this.app);
    const outputDir = this.settings.outputDir || "pdf";
    return path.isAbsolute(outputDir)
      ? outputDir
      : path.join(vaultPath, outputDir);
  }

  private async chooseOutputDirectory(): Promise<string | null> {
    if (!Platform.isDesktopApp) {
      new Notice("Folder selection is only available in the desktop app", 8000);
      return null;
    }

    try {
      const electron = require("electron") as any;
      const dialog = electron.remote?.dialog || electron.dialog;

      if (!dialog?.showOpenDialog) {
        new Notice("Folder selection is not available in this Obsidian window", 8000);
        return null;
      }

      const result = await dialog.showOpenDialog({
        title: "Choose export folder",
        defaultPath: this.getConfiguredOutputDirectory(),
        properties: ["openDirectory", "createDirectory"],
      });

      if (result.canceled || !result.filePaths?.[0]) {
        new Notice("Export canceled");
        return null;
      }

      return result.filePaths[0];
    } catch (err) {
      new Notice(
        `Could not open folder picker: ${
          err instanceof Error ? err.message : String(err)
        }`,
        8000
      );
      return null;
    }
  }
}
