# Contributing

Thanks for your interest in improving Press PDF Export.

## Development Setup

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
```

Before opening a pull request, run:

```bash
npm run typecheck
npm run build
```

## Local Obsidian Testing

Build the plugin, then copy these files into a test vault:

```bash
mkdir -p /path/to/vault/.obsidian/plugins/press-pdf-export
cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/press-pdf-export/
```

Restart Obsidian or reload the plugin after copying files.

## Dependency Testing

PDF export depends on external tools. Verify the common macOS paths with:

```bash
PATH=/Library/TeX/texbin:/opt/homebrew/bin:/usr/local/bin:$PATH which \
  pandoc xelatex pdflatex lualatex wkhtmltopdf weasyprint typst mmdc
```

If a bug only happens with one PDF engine, include the engine name, version, operating system, and the smallest Markdown file that reproduces the issue.

## Pull Request Guidelines

- Keep changes focused. Avoid unrelated refactors.
- Prefer existing module boundaries: settings UI in `src/settings.ts`, export orchestration in `src/exporter.ts`, Pandoc execution in `src/pandoc.ts`, Markdown preprocessing in `src/renderer.ts`.
- Use `spawn` with argument arrays for external commands when possible.
- Do not pass user-controlled values through shell strings unless there is no practical alternative.
- Update `README.md` and `CHANGELOG.md` for user-visible changes.

## Reporting Issues

Include:

- Obsidian version
- Operating system
- Plugin version
- Export format and PDF engine
- Relevant settings
- Error message from Obsidian notices or the developer console
- A minimal Markdown sample when possible
