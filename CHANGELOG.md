# Changelog

All notable changes to Obsidian Press are documented here.

This project follows semantic versioning where practical.

## 1.0.0 - 2026-04-28

- Prepared community plugin metadata with marketplace id `press-pdf-export`.
- Added export progress notices for single-file, folder, and whole-vault exports.
- Added PDF export through Pandoc with XeLaTeX, pdfLaTeX, LuaLaTeX, wkhtmltopdf, WeasyPrint, and Typst engines.
- Added DOCX and HTML export.
- Added current note, current folder, and whole vault export commands.
- Added optional folder picker commands for one-off export destinations.
- Added right-click menu entries for note and folder PDF export.
- Added Obsidian Markdown preprocessing for callouts, wikilinks, embeds, highlights, comments, image sizes, math, tables, and Mermaid diagrams.
- Added runtime PATH support for Homebrew and BasicTeX/MacTeX CLI tools.
- Added writable temporary directory handling for Pandoc, LaTeX, and LuaLaTeX cache files.
- Added CJK font settings and LaTeX engine support.
