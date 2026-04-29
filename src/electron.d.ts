declare module "electron" {
  export interface OpenDialogOptions {
    title?: string;
    defaultPath?: string;
    properties?: Array<"openDirectory" | "createDirectory">;
  }

  export interface OpenDialogReturnValue {
    canceled: boolean;
    filePaths: string[];
  }

  export interface Dialog {
    showOpenDialog(
      options: OpenDialogOptions
    ): Promise<OpenDialogReturnValue>;
  }

  export const dialog: Dialog;
  export const remote: { dialog?: Dialog } | undefined;
}
