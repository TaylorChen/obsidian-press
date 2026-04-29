import { App, TFile } from "obsidian";
import { RenderResult, CalloutType } from "./types";
import { resolveAttachmentPath, getTmpDir } from "./utils";
import { renderMermaidBlock } from "./mermaid";

const CALLOUT_TYPES: CalloutType[] = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
  "abstract",
  "info",
  "todo",
  "example",
  "quote",
  "success",
  "question",
  "failure",
  "danger",
  "bug",
];

const CALLOUT_ICONS: Record<string, string> = {
  note: "\u{1F4DD}",
  tip: "\u{1F4A1}",
  important: "\u{2757}",
  warning: "\u{26A0}\u{FE0F}",
  caution: "\u{26A0}\u{FE0F}",
  abstract: "\u{1F4CB}",
  info: "\u{2139}\u{FE0F}",
  todo: "\u{2611}",
  example: "\u{1F4DA}",
  quote: "\u{275D}",
  success: "\u{2705}",
  question: "\u{2753}",
  failure: "\u{274C}",
  danger: "\u{1F6A8}",
  bug: "\u{1F41B}",
};

/**
 * Full preprocessing pipeline: Obsidian Markdown → Pandoc-compatible Markdown
 */
export async function renderToPandoc(
  content: string,
  file: TFile,
  app: App,
  mermaidPath: string,
  mermaidTheme: string
): Promise<RenderResult> {
  const tmpDir = getTmpDir(app);
  const tempFiles: string[] = [];

  // Step 1: Strip YAML frontmatter (preserve title as heading)
  let rendered = stripFrontmatter(content);

  rendered = formatFlattenedCodeBlocks(rendered);

  // Step 2: Pre-render Mermaid blocks before protecting ordinary code fences
  rendered = await convertMermaidBlocks(
    rendered,
    mermaidPath,
    mermaidTheme,
    tmpDir,
    tempFiles
  );

  // Step 3: Protect code blocks/spans from Obsidian syntax conversions
  const protectedCode = protectCodeSegments(rendered);
  rendered = protectedCode.content;

  // Step 4: Convert callouts
  rendered = convertCallouts(rendered);

  // Step 5: Convert wikilinks to standard links
  rendered = convertWikilinks(rendered, file, app);

  // Step 6: Convert embedded images ![[img.png]] → ![img](abs/path)
  rendered = convertEmbeds(rendered, file, app);

  // Step 7: Inline embedded notes ![[other-note]] (limited depth)
  rendered = await inlineNoteEmbeds(rendered, file, app, 0, 5);

  // Step 8: Convert ==highlight== → <mark>highlight</mark>
  rendered = convertHighlights(rendered);

  // Step 9: Convert ^sup^ and ~~sub~~
  rendered = convertSupSub(rendered);

  // Step 10: Strip %%comments%%
  rendered = stripComments(rendered);

  // Step 11: Convert Obsidian-style images with size ![[img.png|200]]
  rendered = convertImageSizes(rendered);

  // Step 12: Restore protected code blocks/spans for Pandoc highlighting
  rendered = restoreCodeSegments(rendered, protectedCode.segments);

  return { content: rendered, tempFiles };
}

export function formatFlattenedCodeBlocks(content: string): string {
  return content.replace(
    /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm,
    (match, fence: string, info: string, code: string) => {
      const language = info.trim().split(/\s+/)[0]?.toLowerCase() || "";
      if (!shouldFormatFlattenedCode(language, code)) {
        return match;
      }

      const formatted = formatJavaScriptLikeCode(code);
      return `${fence}${info}\n${formatted}\n${fence}`;
    }
  );
}

function shouldFormatFlattenedCode(language: string, code: string): boolean {
  const supportedLanguages = new Set([
    "",
    "js",
    "javascript",
    "jsx",
    "ts",
    "typescript",
    "tsx",
    "php",
  ]);
  if (!supportedLanguages.has(language)) {
    return false;
  }

  const trimmed = code.trim();
  if (trimmed.length < 160) {
    return false;
  }

  const nonEmptyLines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  if (nonEmptyLines.length > 2) {
    return false;
  }

  return /[{};]/.test(trimmed) && /\b(const|let|var|function|class|async|while|if|return|await|new)\b/.test(trimmed);
}

function formatJavaScriptLikeCode(code: string): string {
  const { text, literals } = protectStringLiterals(code.trim());

  let formatted = text
    .replace(/\r?\n/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\}\s*else\s*\{/g, "}\nelse {")
    .replace(/\}\s*catch\s*\(/g, "}\ncatch (")
    .replace(/\}\s*finally\s*\{/g, "}\nfinally {")
    .replace(/\s*\{\s*/g, " {\n")
    .replace(/;\s*/g, ";\n")
    .replace(/,\s*/g, ",\n")
    .replace(/\s*\}\s*/g, "\n}\n")
    .replace(/\)\s*(?=(?:async\s+)?(?:function|class|const|let|var|if|for|while|return|await|new|this\.))/g, ")\n")
    .replace(/\n{2,}/g, "\n");

  formatted = restoreStringLiterals(formatted, literals);
  return indentFormattedCode(formatted);
}

function protectStringLiterals(code: string): { text: string; literals: string[] } {
  const literals: string[] = [];
  let text = "";
  let i = 0;

  while (i < code.length) {
    const char = code[i];
    if (char !== "'" && char !== '"' && char !== "`") {
      text += char;
      i++;
      continue;
    }

    const quote = char;
    let literal = char;
    i++;

    while (i < code.length) {
      const next = code[i];
      literal += next;
      i++;

      if (next === "\\") {
        if (i < code.length) {
          literal += code[i];
          i++;
        }
        continue;
      }

      if (next === quote) {
        break;
      }
    }

    const token = `__OBSIDIAN_PRESS_LITERAL_${literals.length}__`;
    literals.push(literal);
    text += token;
  }

  return { text, literals };
}

function restoreStringLiterals(text: string, literals: string[]): string {
  return literals.reduce(
    (result, literal, index) =>
      result.split(`__OBSIDIAN_PRESS_LITERAL_${index}__`).join(literal),
    text
  );
}

function indentFormattedCode(code: string): string {
  const lines = code
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const output: string[] = [];
  let level = 0;

  for (const line of lines) {
    if (line.startsWith("}") || line.startsWith("]") || line.startsWith(")")) {
      level = Math.max(0, level - 1);
    }

    output.push(`${"  ".repeat(level)}${line}`);

    const opens = countCharacters(line, "{[(");
    const closes = countCharacters(line, "}])");
    level = Math.max(0, level + opens - closes);
  }

  return output.join("\n");
}

function countCharacters(value: string, characters: string): number {
  let count = 0;
  for (const char of value) {
    if (characters.includes(char)) {
      count++;
    }
  }
  return count;
}

// === Code protection ===

interface ProtectedCodeSegments {
  content: string;
  segments: Map<string, string>;
}

function protectCodeSegments(content: string): ProtectedCodeSegments {
  const segments = new Map<string, string>();
  let index = 0;

  const store = (value: string): string => {
    const token = `OBSIDIAN_PRESS_CODE_${index++}`;
    segments.set(token, value);
    return token;
  };

  let result = content.replace(
    /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm,
    (match) => store(match)
  );

  result = result.replace(/(`+)([\s\S]*?[^`])\1/g, (match) => store(match));

  return { content: result, segments };
}

function restoreCodeSegments(
  content: string,
  segments: Map<string, string>
): string {
  let result = content;
  for (const [token, value] of segments) {
    result = result.split(token).join(value);
  }
  return result;
}

// === Step 1: YAML Frontmatter ===

function stripFrontmatter(content: string): string {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?/;
  const match = content.match(frontmatterRegex);

  if (!match) return content;

  const yamlContent = match[1];
  const rest = content.slice(match[0].length);

  // Extract title if present
  const titleMatch = yamlContent.match(/^title:\s*(.+)$/m);
  if (titleMatch) {
    const title = titleMatch[1].replace(/^["']|["']$/g, "");
    return `# ${title}\n\n${rest}`;
  }

  return rest;
}

// === Step 2: Callouts ===

function convertCallouts(content: string): string {
  // Match callout blocks: > [!type] Title\n> content...
  const calloutRegex =
    /^(>\s*\[!([a-zA-Z]+)\](\+|-)?\s*(.*)?\n(?:>\s*.*\n?)*)/gm;

  return content.replace(
    calloutRegex,
    (
      match: string,
      _full: string,
      type: string,
      _collapse: string | undefined,
      title: string | undefined
    ) => {
      const calloutType = type.toLowerCase() as CalloutType;
      const isValidType = CALLOUT_TYPES.includes(calloutType);
      const cssType = isValidType ? calloutType : "note";
      const icon = CALLOUT_ICONS[cssType] || "\u{1F4DD}";
      const displayTitle = (title || cssType).trim();

      // Strip leading > from each line
      const lines = match.split("\n");
      const bodyLines = lines
        .map((line: string) => line.replace(/^>\s?/, ""))
        .filter((_line: string, i: number) => {
          // Remove the first line (the [!type] line)
          if (i === 0) return false;
          return true;
        });

      const body = bodyLines.join("\n").trim();

      return `<div class="callout callout-${cssType}">\n<div class="callout-title">\n${icon} ${displayTitle}\n</div>\n<div class="callout-body">\n\n${body}\n\n</div>\n</div>`;
    }
  );
}

// === Step 3: WikiLinks ===

function convertWikilinks(content: string, file: TFile, app: App): string {
  // [[target]] or [[target|alias]]
  return content.replace(
    /\[\[([^\]|]+?)(?:\|([^\]]*?))?\]\]/g,
    (_match: string, target: string, alias: string | undefined) => {
      const displayText = alias || target;

      // If it looks like an image, don't convert as link
      if (/\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/i.test(target)) {
        return displayText;
      }

      // Try to resolve as note file
      const resolvedFile = app.metadataCache.getFirstLinkpathDest(
        target,
        file.path
      );
      if (resolvedFile) {
        const relativePath = getRelativePath(file.path, resolvedFile.path);
        return `[${displayText}](${relativePath})`;
      }

      // Fallback: create link with .md extension
      return `[${displayText}](${target}.md)`;
    }
  );
}

// === Step 4: Embed Images ===

function convertEmbeds(
  content: string,
  file: TFile,
  app: App
): string {
  // ![[image.png]] or ![[image.png|size]]
  const embedRegex = /!\[\[([^\]|]+?)(?:\|(\d+))?\]\]/g;

  let result = content;
  let match: RegExpExecArray | null;

  while ((match = embedRegex.exec(content)) !== null) {
    const [fullMatch, src, size] = match;

    // Check if it's an image
    if (/\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/i.test(src)) {
      const absPath = resolveAttachmentPath(src, file, app);
      const sizeAttr = size ? ` width="${size}"` : "";
      const replacement = `![${src}](${absPath})${sizeAttr ? "{width=" + size + "}" : ""}`;
      result = result.replace(fullMatch, replacement);
    }
  }

  return result;
}

// === Step 5: Inline Note Embeds ===

async function inlineNoteEmbeds(
  content: string,
  currentFile: TFile,
  app: App,
  depth: number,
  maxDepth: number
): Promise<string> {
  if (depth >= maxDepth) return content;

  // ![[note-name]] (not images)
  const embedRegex = /!\[\[([^\]|]+?)(?:\|[^\]]*?)?\]\]/g;
  let result = content;
  let match: RegExpExecArray | null;

  const contentSnapshot = result;
  while ((match = embedRegex.exec(contentSnapshot)) !== null) {
    const [fullMatch, target] = match;

    // Skip images (handled in step 4)
    if (/\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/i.test(target)) {
      continue;
    }

    // Resolve the note
    const resolvedFile = app.metadataCache.getFirstLinkpathDest(
      target,
      currentFile.path
    );
    if (resolvedFile instanceof TFile && resolvedFile.extension === "md") {
      const embedContent = await app.vault.read(resolvedFile);

      // Recursively process embedded content
      const processed = await inlineNoteEmbeds(
        embedContent,
        resolvedFile,
        app,
        depth + 1,
        maxDepth
      );

      result = result.replace(
        fullMatch,
        `\n\n<!-- Embedded: ${target} -->\n\n${processed}\n\n<!-- End embed: ${target} -->\n\n`
      );
    }
  }

  return result;
}

// === Step 6: Highlights ===

function convertHighlights(content: string): string {
  // ==text== → <mark>text</mark>
  return content.replace(/==([^=]+)==/g, "<mark>$1</mark>");
}

// === Step 7: Superscript / Subscript ===

function convertSupSub(content: string): string {
  // ^text^ → <sup>text</sup>
  let result = content.replace(/\^([^^]+)\^/g, "<sup>$1</sup>");
  // ~~text~~ → <sub>text</sub>
  result = result.replace(/~~([^~]+)~~/g, "<sub>$1</sub>");
  return result;
}

// === Step 8: Strip Comments ===

function stripComments(content: string): string {
  // %%comment%% → (removed)
  return content.replace(/%%[\s\S]*?%%/g, "");
}

// === Step 9: Image Sizes ===

function convertImageSizes(content: string): string {
  // ![alt|size](url) → ![alt](url){width=size}
  // Already handled in convertEmbeds for ![[ ]] syntax
  // Handle standard markdown image with Obsidian size: ![alt|200](url)
  return content.replace(
    /!\[([^\]]*?)\|(\d+)\]\(([^)]+)\)/g,
    (_match, alt, size, url) => {
      return `![${alt}](${url}){width=${size}}`;
    }
  );
}

// === Step 10: Mermaid Blocks ===

async function convertMermaidBlocks(
  content: string,
  _mermaidPath: string,
  mermaidTheme: string,
  tmpDir: string,
  tempFiles: string[]
): Promise<string> {
  // ```mermaid\n...\n```
  const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;

  let result = content;
  let match: RegExpExecArray | null;
  let index = 0;

  const contentSnapshot = content;
  while ((match = mermaidRegex.exec(contentSnapshot)) !== null) {
    const [fullMatch, code] = match;
    index++;

    try {
      const svgPath = await renderMermaidBlock(
        code.trim(),
        mermaidTheme,
        tmpDir,
        index
      );

      if (svgPath) {
        tempFiles.push(svgPath);
        result = result.replace(
          fullMatch,
          `![Mermaid Diagram ${index}](${svgPath})`
        );
      } else {
        // Fallback: keep as code block
        result = result.replace(
          fullMatch,
          "```mermaid\n" + code + "```"
        );
      }
    } catch {
      // Keep as code block on error
    }
  }

  return result;
}

// === Helpers ===

function getRelativePath(from: string, to: string): string {
  const fromDir = from.substring(0, from.lastIndexOf("/"));
  let relative = "";
  const fromParts = fromDir.split("/");
  const toParts = to.split("/");

  // Find common prefix
  let commonLength = 0;
  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength++;
  }

  // Go up from current directory
  for (let i = commonLength; i < fromParts.length; i++) {
    relative += "../";
  }

  // Go down to target
  for (let i = commonLength; i < toParts.length; i++) {
    relative += toParts[i];
    if (i < toParts.length - 1) relative += "/";
  }

  return relative || to;
}
