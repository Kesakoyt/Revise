# Fiches & Cloud

> A minimalist, Windows 11 "Fluent" study workspace — Markdown notes, math
> rendering and link curation, backed by Firebase. Zero build step.

Fiches & Cloud is a single-page application built with plain **HTML5 / CSS3 /
ES Modules**. It stores nothing but **Markdown** and **link metadata** in
Firestore: any PDF or DOCX you import is converted to Markdown *in the browser*
before it is ever uploaded.

---

## Table of contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Project structure](#project-structure)
4. [Running the app](#running-the-app)
5. [Firebase configuration](#firebase-configuration)
6. [Firestore data model](#firestore-data-model)
7. [Security rules](#security-rules)
8. [Design system](#design-system)
9. [Browser support](#browser-support)
10. [Troubleshooting](#troubleshooting)

---

## Features

### Core
- **Markdown study notes** with a live split-pane editor (source ↔ preview).
- **KaTeX math** — `$inline$`, `$$display$$`, `\(…\)` and `\[…\]`.
- **PDF & DOCX import** — drag-and-drop, converted to clean Markdown client-side
  (PDF.js + Mammoth.js).
- **Link manager** — bookmark external resources (title, URL, description, subject).
- **Subjects & topics** — classify, filter and sort every note.
- **Public notes** — publish a note and browse what others have shared.
- **Character quota** — a strict, account-wide character allowance is enforced
  before every write and shown as a live bar.

### Shell
- **Top navigation bar** with the account name, role badge, a **user-configurable
  shortcut bar** (backed by the `shortcuts` collection) and a theme toggle.
- **Left dock** application launcher with tooltips.
- **Split screen** — up to **3 panels side-by-side**, with draggable dividers,
  maximize and per-panel close.
- **Light / dark themes** following the OS preference, persisted in `localStorage`.

### Admin (role `admin`)
- **Database** — inspect and delete documents across `notes`, `links`,
  `shortcuts` and `users`, with search, pagination and a JSON inspector.
- **Users** — account list, role management, per-user document browsing and the
  document **access log**.
- **Statistics** — totals for notes, links, shortcuts, stored characters,
  active users and a per-subject breakdown.

---

## Architecture

- **Zero build.** No bundler, no `package.json`, no transpilation. The browser
  loads the ES modules directly.
- **CDN globals.** Firebase (compat), Marked, KaTeX, PDF.js and Mammoth are
  loaded as `<script>` tags *before* the modules run, and consumed through
  `window.*`.
- **Event bus.** Components are decoupled through a tiny
  `EventBus.on / off / emit` in `src/app.js` (`app:open`, `panel:close`,
  `auth:login`, `auth:logout`, `note:saved`, `note:deleted`, `link:saved`,
  `link:deleted`, `quota:updated`, `theme:changed`).
- **Global state.** `AppState` (`src/app.js`) holds the current `user`, their
  `profile`, the `theme` and `isAdmin`.
- **Component contract.** Every component default-exports `render(container, params)`
  and `destroy()`. Because the workspace keeps **one instance per app id**,
  components may safely use a module-level singleton `state` object.
- **Lazy loading.** The workspace `import()`s an app module only when its panel
  is opened.

### Deep modules

| Module | Responsibility |
| --- | --- |
| `src/app.js` | EventBus, AppState, `iconUrl()`/`iconImg()`, toasts, modals, auth modal, bootstrap |
| `src/components/workspace.js` | `APP_REGISTRY`, `openPanel` / `closePanel`, panel chrome |
| `src/components/split-screen.js` | 3-panel flex layout + draggable dividers |
| `src/services/firestore-service.js` | All CRUD by collection, admin reads, stats |
| `src/services/converter-service.js` | PDF/DOCX → Markdown, Markdown → HTML, KaTeX |
| `src/services/quota-manager.js` | Character accounting & enforcement |
| `src/services/firebase-config.js` | Base64 decode + Firebase init |

---

## Project structure

```
.
├── index.html                  # App shell: CDN tags, mount points, boot splash
├── README.md
├── LICENSE
├── PATCH_NOTES.md
├── .gitignore                  # ignores src/env-config.js (real keys)
├── assets/                     # Local static assets (logo fallback). Icons come from Icons8.
└── src/
    ├── app.js                  # Entry point + shared primitives
    ├── env-config.js           # Base64 Firebase credentials (git-ignored)
    ├── env-config.js.template  # Copy-me template
    ├── components/
    │   ├── navbar.js           # Brand, shortcuts, theme, account
    │   ├── dock.js             # App launcher (+ admin section)
    │   ├── workspace.js        # Panel orchestration / APP_REGISTRY
    │   ├── split-screen.js     # 1–3 panel layout
    │   ├── file-explorer.js    # Notes browser + import + quota
    │   ├── markdown-editor.js  # Split editor + KaTeX preview
    │   ├── link-manager.js     # Bookmarks CRUD
    │   ├── admin-database.js   # Collections inspector
    │   ├── admin-users.js      # Accounts, roles, audit log
    │   └── admin-statistics.js # Metrics dashboard
    ├── services/
    │   ├── firebase-config.js
    │   ├── auth-service.js
    │   ├── firestore-service.js
    │   ├── quota-manager.js
    │   └── converter-service.js
    └── styles/
        └── style.css           # Fluent design tokens + every component rule
```

---

## Running the app

ES modules are subject to the browser's CORS rules, so the app **must be served
over HTTP** (opening `index.html` from `file://` will not work).

Pick any static server:

```bash
# Python 3
python -m http.server 5173

# Node (npx)
npx serve .

# PHP
php -S localhost:5173
```

Then open <http://localhost:5173>.

There is **no install and no build step**.

---

## Firebase configuration

Credentials live in `src/env-config.js`, which is **git-ignored**. Every value
is stored **Base64-encoded** and decoded at runtime by
`src/services/firebase-config.js`.

### 1. Create / select a project

In the [Firebase console](https://console.firebase.google.com/) create a project
and add a **Web app**. Enable:

- **Authentication → Sign-in method → Email/Password**
- **Firestore Database** (production mode)

### 2. Fill in your keys

```bash
cp src/env-config.js.template src/env-config.js
```

Encode each value (browser console):

```js
btoa("AIzaSy…")
```

…or PowerShell:

```powershell
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("AIzaSy…"))
```

Paste the encoded strings into `src/env-config.js` and reload.

> **This repository ships pre-filled for the demo project `revise-61c6b`.** If it
> is not yours, replace every field.

### Security note

Firebase **Web App** config values are *identifiers*, not secrets: they ship to
every client by design. **Base64 is obfuscation, not encryption.** Real access
control lives entirely in the [Security rules](#security-rules) and Firebase
Auth. The `isConfigured` flag in `firebase-config.js` only distinguishes real
keys from placeholders so the UI can warn you.

---

## Firestore data model

| Collection | Document |
| --- | --- |
| `users/{uid}` | `email`, `displayName`, `role` (`user`\|`admin`), `createdAt`, `lastLogin`, `quotaUsed`, `quotaLimit`, `shortcuts[]` |
| `notes/{id}` | `uid`, `title`, `content`, `subject`, `topic`, `isPublic`, `charCount`, `createdAt`, `updatedAt` |
| `links/{id}` | `uid`, `title`, `url`, `description`, `subject`, `createdAt`, `updatedAt` |
| `shortcuts/{id}` | `uid`, `label`, `icon`, `action`, `order`, `createdAt` |
| `accessLogs/{id}` | `uid`, `documentId`, `documentType`, `action`, `timestamp` |

**Character quota** = the sum of every note's `charCount` for a user. The default
allowance is `500 000` characters (`quotaLimit` on the user document).

---

## Security rules

Paste into **Firestore → Rules**:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    function isOwner(uid) {
      return isSignedIn() && request.auth.uid == uid;
    }

    function isAdmin() {
      return isSignedIn()
        && exists(/databases/$(database)/documents/users/$(request.auth.uid))
        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    // User profiles: owners edit themselves, admins manage everyone.
    match /users/{userId} {
      allow read:   if isOwner(userId) || isAdmin();
      allow create: if isOwner(userId) && request.resource.data.role == 'user';
      allow update: if isAdmin()
                    || (isOwner(userId)
                        && !request.resource.data.diff(resource.data).affectedKeys()
                             .hasAny(['role', 'quotaLimit']));
      allow delete: if isAdmin();
    }

    // Notes: owners write; everyone reads public notes.
    match /notes/{noteId} {
      allow read:   if isAdmin()
                    || (resource.data.isPublic == true)
                    || (isSignedIn() && resource.data.uid == request.auth.uid);
      allow create: if isSignedIn() && request.resource.data.uid == request.auth.uid;
      allow update, delete: if isAdmin()
                    || (isSignedIn() && resource.data.uid == request.auth.uid);
    }

    // Links and shortcuts: strictly private to their owner (admins may read).
    match /links/{linkId} {
      allow read:   if isAdmin() || (isSignedIn() && resource.data.uid == request.auth.uid);
      allow write:  if isSignedIn() && request.resource.data.uid == request.auth.uid;
      allow delete: if isAdmin() || (isSignedIn() && resource.data.uid == request.auth.uid);
    }

    match /shortcuts/{shortcutId} {
      allow read:   if isAdmin() || (isSignedIn() && resource.data.uid == request.auth.uid);
      allow create: if isSignedIn() && request.resource.data.uid == request.auth.uid;
      allow update, delete: if isAdmin()
                    || (isSignedIn() && resource.data.uid == request.auth.uid);
    }

    // Audit log: append-only; admins read.
    match /accessLogs/{logId} {
      allow create: if isSignedIn();
      allow read:   if isAdmin();
    }
  }
}
```

### Creating the first admin

The first account is a normal `user`. Promote it once, manually, from the
Firebase console: **Firestore → `users` → your document → set `role` to `admin`**.

### Recommended composite indexes

The services fall back to client-side sorting when an index is missing, but for
best performance create:

| Collection | Fields |
| --- | --- |
| `notes` | `uid` ASC, `updatedAt` DESC |
| `notes` | `uid` ASC, `subject` ASC, `updatedAt` DESC |
| `notes` | `isPublic` ASC, `updatedAt` DESC |
| `links` | `uid` ASC, `updatedAt` DESC |
| `shortcuts` | `uid` ASC, `order` ASC |
| `accessLogs` | `uid` ASC, `timestamp` DESC |
| `accessLogs` | `timestamp` DESC |

---

## Design system

The stylesheet (`src/styles/style.css`) implements the Windows 11 / Fluent
language entirely with CSS custom properties:

- **Tokens** in `:root` and a `[data-theme='dark']` override (accent, surfaces,
  text, borders, semantic colours, radii, shadows, motion).
- **Acrylic / Mica** via `backdrop-filter: blur(...) saturate(...)` on the
  navbar, dock, cards, modals and toasts.
- **Rounded corners** of 8–12 px (`--radius`, `--radius-lg`).
- **Soft shadows** layered for depth rather than hard borders.
- Icons are **only** ever requested from Icons8 Fluency at 200 px:
  `https://img.icons8.com/fluency/200/[icon-name].png` — centralised in
  `iconUrl()` / `iconImg()` (`src/app.js`).

---

## Browser support

Any evergreen browser with ES modules, `backdrop-filter` and
`Intl.NumberFormat`: **Chrome/Edge 90+, Firefox 103+, Safari 15+**.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Blank page, console CORS/module error | Opened via `file://`. Serve over HTTP (see above). |
| "Configuration requise" modal | `src/env-config.js` still has placeholder keys — fill in your Base64 values. |
| `auth/operation-not-allowed` | Enable **Email/Password** in Firebase Authentication. |
| "Missing or insufficient permissions" | Publish the security rules above. |
| Notes list empty but data exists | A composite index is missing; check the console link Firestore prints, or rely on the built-in fallback. |
| Icons blank | Icons8 CDN blocked/offline — the logo has a local SVG fallback (`assets/logo-mark.svg`). |
| PDF import fails | The PDF.js worker is fetched from the CDN; a strictly offline network will block it. |

---

## License

MIT — see [LICENSE](LICENSE).
