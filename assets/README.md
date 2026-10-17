# /assets — Local static assets

This folder holds **local** static assets only.

## Icon policy

The user interface loads every icon dynamically from the Icons8 **Fluency**
collection using the single canonical URL pattern required by the spec:

```
https://img.icons8.com/fluency/200/[icon-name].png
```

The helper `iconUrl(name)` in `src/app.js` builds those URLs, so **no icon
image files are stored here**. Icons are requested at 200px and scaled down in
CSS, keeping one predictable, cache-friendly source.

## Local files

- `logo-mark.svg` — a self-contained vector fallback used only when the remote
  Icons8 logo fails to load (offline / blocked CDN), so the shell never renders
  a broken image.
