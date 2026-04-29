# Obsidian Marketplace Submission

This project is prepared for the Obsidian community plugin directory.

## Plugin Entry

Add this object to the end of `community-plugins.json` in `obsidianmd/obsidian-releases`:

```json
{
  "id": "press-pdf-export",
  "name": "Obsidian Press",
  "author": "Obsidian Press Contributors",
  "description": "High-fidelity PDF export powered by Pandoc. Supports multiple engines (XeLaTeX, wkhtmltopdf, WeasyPrint), Mermaid diagrams, custom CSS/templates, and batch export.",
  "repo": "TaylorChen/obsidian-press"
}
```

The `id` matches `manifest.json` and intentionally does not contain `obsidian`, which is required by the Obsidian submission rules.

## Release Assets

Build and collect the release assets:

```bash
npm run release:package
```

Attach these files from `dist/press-pdf-export-<version>/` to the GitHub release whose tag exactly matches `manifest.json`:

- `main.js`
- `manifest.json`
- `styles.css`

Do not prefix the tag with `v`; use `1.0.0`, not `v1.0.0`.

## Submission Steps

1. Push the repository to GitHub.
2. Create a GitHub release with tag `1.0.0`.
3. Attach `main.js`, `manifest.json`, and `styles.css` from the release package directory.
4. Fork `obsidianmd/obsidian-releases`.
5. Add the plugin entry above to `community-plugins.json`.
6. Open a pull request titled `Add plugin: Obsidian Press`.
