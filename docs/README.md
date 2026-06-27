# AutoNyan user documentation

Bilingual (English / 日本語) end-user documentation site, built with
[Docusaurus](https://docusaurus.io/) and published to GitHub Pages at
<https://kkohtaka.github.io/AutoNyan/>.

This is a **standalone** npm project — it is intentionally not part of the root
npm workspace, so the Cloud Functions CI never installs the Docusaurus
toolchain. Run all commands from this `docs/` directory.

## Local development

```bash
cd docs
npm ci
npm start            # dev server with hot reload (default locale)
npm start -- --locale ja   # preview the Japanese site
```

## Build

```bash
cd docs
npm ci
npm run build        # outputs static site to docs/build/
npm run serve        # serve the built site locally
```

Publishing happens automatically: pushing to `master` runs
`.github/workflows/docs.yml`, which builds this site and deploys it to GitHub
Pages.

## Adding or translating content

- English (default locale) pages live under `docs/`.
- Japanese translations of those pages live under
  `i18n/ja/docusaurus-plugin-content-docs/current/`.
- UI string translations (navbar, footer, theme) live under
  `i18n/ja/docusaurus-theme-classic/`. Regenerate the translation templates
  with `npm run write-translations -- --locale ja`.

The information architecture and authoring conventions are defined in
[#339](https://github.com/kkohtaka/AutoNyan/issues/339).
