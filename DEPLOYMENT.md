# Deployment

## Live URL

**https://amayztech.github.io/bits-digital-codeforge-grading-console/**

Repository: https://github.com/Amayztech/bits-digital-codeforge-grading-console

Deployed from `main` by `.github/workflows/pages.yml`. The application is a plain
static site, so the workflow publishes the repository root unchanged — there is no
build step, and the deployed artefact is byte-identical to what was tested locally.

## Verified live

`node tests/browser/verify-live.js` loads the public URL in Chromium and drives the
whole workflow — import, course selection, statistics, band editing, live impact,
review, confirmation, both downloads — asserting on visible DOM state and capturing
console errors, page errors and failed network requests.

Result on the deployed URL: **23 / 23 passing, 0 console errors, 0 page errors, 0
failed asset requests.** Captured output is in `artifacts/live-verify.txt` and a
screenshot of the finalized report is in `artifacts/screenshots/live-finalized.png`.

The live check specifically asserts that assets resolve from the `/<repo>/`
subdirectory, which is the failure mode a static submission is most likely to
have. The workflow fails the build if `index.html` ever contains an absolute
`src="/…"` or `href="/…"`.

## Redeploying

Any push to `main` deploys automatically:

```bash
git push origin main
```

Or trigger it manually:

```bash
gh workflow run pages.yml
```

## Deploying elsewhere

No build command, no output directory, no environment variables. Upload the
repository root.

**Vercel**

```bash
npx vercel --prod
```

**Netlify**

```bash
npx netlify-cli deploy --prod --dir .
```

**Any static host** — copy everything except `node_modules/`. The application
itself needs only `index.html`, `assets/`, `samples/`, `vendor/`, and
`.nojekyll`.

## Why this deploys cleanly

| Concern | How it is handled |
| --- | --- |
| Subdirectory hosting | Every asset reference in `index.html` is relative. There is no absolute path and no SPA routing. |
| CDN dependency | SheetJS is vendored at `vendor/xlsx.full.min.js` (v0.18.5), so the console works offline and on a host with a strict CSP. |
| Build step | There is none, so there is no build to break in a new environment. |
| Jekyll mangling files | `.nojekyll` is committed. |
| Caching of a stale index | Not applicable; Pages serves the current commit. |
| `node_modules` | Git-ignored, so never published. |

## Local fallback

If the live URL is unavailable, the console runs from `npm start`
(http://localhost:4173) or from `index.html` opened directly, because the scripts
are classic scripts rather than ES modules.
