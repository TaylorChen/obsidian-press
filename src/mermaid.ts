import * as fs from "fs";
import * as path from "path";
import { runCommand, checkCommandExists } from "./utils";

/**
 * Render a Mermaid diagram to SVG using mmdc (mermaid-cli).
 * Returns the SVG file path, or null if mmdc is not available.
 */
export async function renderMermaidBlock(
  code: string,
  theme: string,
  tmpDir: string,
  index: number
): Promise<string | null> {
  // Check if mmdc is available
  const mmdcAvailable = await checkCommandExists("mmdc");
  if (!mmdcAvailable) {
    console.warn("Press PDF Export: mmdc not found, skipping Mermaid rendering");
    return null;
  }

  const inputFile = path.join(tmpDir, `mermaid-input-${index}.mmd`);
  const outputFile = path.join(tmpDir, `mermaid-output-${index}.svg`);

  try {
    // Write mermaid source to temp file
    fs.writeFileSync(inputFile, code, "utf8");

    // Run mmdc via login shell
    const cmd = `mmdc -i '${inputFile}' -o '${outputFile}' -t ${theme} -b transparent --quiet`;
    const { code: exitCode, stderr } = await runCommand(cmd, {
      timeout: 30000,
    });

    // Verify output exists
    if (exitCode === 0 && fs.existsSync(outputFile)) {
      return outputFile;
    }

    console.warn("Press PDF Export: Mermaid rendering failed:", stderr);
    return null;
  } catch (err) {
    console.error("Press PDF Export: Mermaid rendering error:", err);
    return null;
  } finally {
    // Clean up input file
    try {
      if (fs.existsSync(inputFile)) {
        fs.unlinkSync(inputFile);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Clean up SVG output files from tmp directory
 */
export function cleanupMermaidFiles(svgPaths: string[]): void {
  for (const svgPath of svgPaths) {
    try {
      if (fs.existsSync(svgPath)) {
        fs.unlinkSync(svgPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
