# Patch Notes — Fiches & Cloud

---

## v1.2.4 — Editable public files in the admin panel
**Date:** 2026-10-19
**Scope:** A file-explorer-style browser for everybody's public fiches and links.

### Added
- **Fichiers publics** tab in the admin *Base de données* panel. It looks and
  behaves like the file explorer — folders with breadcrumb navigation,
  icon+name list **and** grid views, the Windows-style **Propriétés** dialog,
  a right-click menu and hover actions — but it lists **every user's public
  fiches and links** instead of your own.
- **Full admin editing** of that content: open a fiche in the Markdown editor,
  rename, move to any folder, edit a link (URL, title, subject, description,
  visibility), unpublish it (*Rendre privée / privé*) and delete it — including
  recursive folder deletion. Quota is recalculated for the file's **owner**, not
  for the admin pressing the button.
- The tab badge shows the number of public fiches + public links, and the
  pagination bar is hidden there (it is a browser, not a table).

### Notes
- Only folders that hold public content — or lead to some — are listed, so every
  branch opens onto something. Moving a file still offers *all* folders as a
  destination.
- Deleting a folder cascades over its private fiches/links too, so nothing is
  left orphaned behind a folder that no longer exists.
- Nothing new is exposed to non-admins: the tab lives behind the existing
  `isAdmin` dock gate, and every read/write is independently enforced by
  `firestore.rules`.

---

## v1.2.3 — Public links in the files view
**Date:** 2026-10-19
**Scope:** Public links merged into the file manager; popup background fixes.

### Changed
- **Public links now live in the files view.** The separate **Liens publics** tab
  is gone: links marked *public* — yours and everyone else's — appear directly in
  **Mes fichiers**, at the root level, mixed in with your folders, fiches and
  links. Your own public links still sit inside the folder you put them in.
- **Popups now always have a background.** The Properties dialog rendered
  transparent (it relied on a shared `.card` class it never had), and other
  dialogs only worked by luck of that class. Every file-explorer popup (new
  folder, rename, new link, move, properties) now uses an opaque, solid panel in
  both light and dark themes.
- **Public tabs degrade gracefully.** If the Firestore rules aren't published
  yet, the public views show an empty list with a clear toast instead of the
  full "Chargement impossible" error.

---

## v1.2.2 — Properties button & generic link icons
**Date:** 2026-10-19
**Scope:** One-click properties access for every explorer item; unified link icons.

### Added
- **Propriétés (ℹ) button** on **every** item — folders, fiches and links, in both
  list and grid views — next to the delete button. It opens the Windows-style
  properties dialog directly, no right-click needed (buttons appear on hover /
  selection, as before).

### Changed
- **Links now show a generic link icon** instead of the website's favicon
  (Google s2 favicon service) in list view, grid view and the properties dialog,
  so all links look uniform like Windows file types.
- Removed the now-unused favicon helpers and styles (`faviconUrl`,
  `file-item__favicon`, `file-card__favicon`, `props__favicon`).

---

## v1.2.1 — Properties panel
**Date:** 2026-10-19
**Scope:** Windows-style "Properties" info dialog for explorer items.

### Added
- **Propriétés** entry in the right-click menu of folders, fiches and links
  (placed at the bottom, as on Windows).
- Windows-style **properties dialog**: item icon + name header, then a labelled
  field list — type, location (breadcrumb path), and per-kind details:
  - *Dossier* — nesting totals (dossiers / fiches / liens), created and modified
    dates, owner.
  - *Fiche* — size (characters + words), subject, topic, visibility, created and
    modified dates, owner.
  - *Lien* — clickable address, domain, subject, description, created and modified
    dates, owner; plus **Copier l'URL** and **Ouvrir** shortcuts.

### Changed
- Explorer items now render **Windows-style**: each fiche, link and folder shows
  only its **icon and name** — badges (subject / public / Dossier), metadata
  lines (char count, dates, topic) and the boxed card chrome were removed.
  - Grid view is now a compact tile wall (icon above a centred name).
  - List view is a single-line icon + name row.
  - The delete button is revealed on hover / selection only, keeping the resting
    view clean.

---

## v1.2.0 — File manager with folders
**Date:** 2026-10-18
**Scope:** turn the explorer into a real hierarchical file manager and fold the
link app into it.

### Added
- **`folders` collection** modelled with `uid`, `name` and `parentId`; notes and
  links gained a `parentId` field (`null` = root).
- `FirestoreService`: `createFolder`, `getFolder`, `getUserFolders`,
  `updateFolder`, `deleteFolder`, `getAllFolders`; `parentId` support on
  `createNote` / `createLink`.
- File explorer: **breadcrumb navigation**, sub-folders, create / rename / move /
  delete folders (recursive, with confirmation), and a unified list/grid mixing
  folders, fiches and links.
- In-explorer **link creation / editing** modal (URL, title, subject,
  description) with copy-URL and open-in-tab actions.
- `folders` tab in the admin **Database** inspector.

### Changed
- **Removed the standalone `link-manager` app** (dock, registry, empty state,
  shortcut destinations); `src/components/link-manager.js` and its CSS were
  deleted. Links are now managed from the file explorer.
- New notes land in the folder you are browsing (the editor accepts a
  `parentId`).
- Empty-state cards now offer **Fichiers** and **Mon profil** instead of
  "Liens utiles"; default shortcuts updated accordingly.
- Fixed broken Icons8 slugs: `folder` → `opened-folder`, `grid` → `thumbnails`,
  `logout` → `logout-rounded`; legacy shortcut values are auto-remapped.
- Dock / explorer labels shortened to "Fichiers & dossiers".
- README data model, security rules (`folders`), indexes and structure updated.

### Notes
- Add a `folders` rule block in the Firestore console (see README §Security
  rules). Existing notes/links without `parentId` are treated as root-level.
- Deleting a folder recursively deletes everything inside it.

---

## v1.1.0 — User profile
**Date:** 2026-10-17
**Scope:** add a real, editable account profile for every signed-in user.

### Added
- **`src/components/user-profile.js`** — "Mon profil" panel opened from the
  account chip in the navigation bar. Shows identity (avatar, name, email, role,
  member-since), lets the owner edit **display name**, **bio** and **avatar
  colour**, displays storage usage (quota bar + note/link/character counts) and
  sends a **password-reset email**.
- `AuthService.sendPasswordReset(email)` and `updatedAt` stamping on
  `AuthService.updateUserProfile()`.
- `bio` and `avatarColor` defaults on new `users/{uid}` documents (sign-up and
  first sign-in).
- `profile:updated` EventBus event; the navbar re-renders on it.
- `user-profile` entry in the workspace `APP_REGISTRY` (icon `guest-male`).

### Changed
- Navbar account block is now a button (with avatar) that opens the profile;
  sign-out stays a separate control.
- README data model / project structure / event list updated accordingly.

### Notes
- No security-rule change required: owners may already update any field except
  `role` and `quotaLimit`.

---

## v1.0.0 — Initial production rebuild
**Date:** 2026-10-17
**Scope:** full clean-room regeneration of the application from the project
specification (Windows 11 Fluent UI study workspace with Firebase backend).

---

## 1. Files created / rewritten

### Root
| File | Status | Purpose |
| --- | --- | --- |
| `index.html` | rewritten | App shell, CDN tags, mount points, boot splash |
| `README.md` | rewritten | Features, architecture, setup, data model, security rules |
| `LICENSE` | **created** | MIT license |
| `PATCH_NOTES.md` | **created** | This document |
| `.gitignore` | rewritten | Ignores `src/env-config.js` (real keys), OS/editor noise |
| `assets/README.md` | **created** | Explains the local-asset + Icons8 icon policy |
| `assets/logo-mark.svg` | **created** | Offline SVG fallback for the brand logo |

### `src/`
| File | Status | Purpose |
| --- | --- | --- |
| `src/app.js` | rewritten | EventBus, AppState, `iconUrl()`/`iconImg()`, toasts, modals, auth modal, bootstrap |
| `src/env-config.js` | rewritten | Base64 Firebase credentials (project `revise-61c6b`), git-ignored |
| `src/env-config.js.template` | rewritten | Copy-me template (now includes `measurementId`) |

### `src/services/`
| File | Status | Purpose |
| --- | --- | --- |
| `firebase-config.js` | rewritten | Base64 decode, Firebase init, `isConfigured` flag |
| `auth-service.js` | rewritten | Email/password auth + `users/{uid}` profile sync, `DEFAULT_SHORTCUTS` |
| `firestore-service.js` | rewritten | Notes / Links / **Shortcuts** / Logs / Admin CRUD + `getStats()` |
| `quota-manager.js` | rewritten | Character accounting, `checkQuota`, `formatQuota` |
| `converter-service.js` | rewritten | PDF/DOCX → Markdown, Markdown → HTML, KaTeX auto-render |

### `src/components/`
| File | Status | Purpose |
| --- | --- | --- |
| `navbar.js` | rewritten | Brand, user-configurable shortcut bar, theme toggle, account badge |
| `dock.js` | rewritten | App launcher, admin section revealed by role |
| `workspace.js` | rewritten | `APP_REGISTRY`, panel open/close/focus/maximize, welcome state |
| `split-screen.js` | rewritten | 1–3 panel flex layout with draggable dividers |
| `file-explorer.js` | rewritten | Notes browser, search/filter/sort, drag-drop import, quota bar |
| `markdown-editor.js` | rewritten | Split editor, live preview, quota-guarded save/delete |
| `link-manager.js` | rewritten | Bookmark CRUD with favicons |
| `admin-database.js` | rewritten | Inspector for **Notes / Links / Shortcuts / Users** + JSON viewer |
| `admin-users.js` | rewritten | Accounts, roles, per-user documents, access log |
| `admin-statistics.js` | rewritten | Metrics dashboard + subject breakdown |

### `src/styles/`
| File | Status | Purpose |
| --- | --- | --- |
| `style.css` | rewritten | Complete Fluent stylesheet authored against the actual emitted class names |

> **Total:** 25 tracked files (6 root + 19 under `src/`), plus `assets/`.

---

## 2. Implemented & verified features

### Authentication
- [x] Email/password **sign-in** and **sign-up** with display name.
- [x] Automatic `users/{uid}` profile creation, `lastLogin` refresh.
- [x] Role resolution (`user` / `admin`) driving the admin dock section.
- [x] Friendly, mapped French error messages; non-dismissible auth modal.
- [x] Non-dismissible **configuration warning** when keys are placeholders.

### Study content
- [x] Markdown notes with live split-pane preview.
- [x] **KaTeX** rendering for `$…$`, `$$…$$`, `\(…\)`, `\[…\]`.
- [x] **PDF import** (PDF.js text extraction) and **DOCX import** (Mammoth +
      HTML→Markdown reducer) → Markdown, client-side only.
- [x] Drag-and-drop zone plus file picker.
- [x] Title / subject / topic, public/private toggle.
- [x] Public-note browsing tab.

### Organisation
- [x] Search across title, subject, topic and content.
- [x] Subject filter, five sort modes, list ⇄ grid views.
- [x] Link manager with favicons, subject filter and search.

### Quota
- [x] Account-wide character allowance, enforced **before** every save.
- [x] Live quota bar with warning (≥70 %) and danger (≥90 %) states.
- [x] Recalculation after save/delete; cross-panel `quota:updated` refresh.

### Shell
- [x] **User-configurable shortcut bar** persisted in the `shortcuts` collection
      (create dialog: label, icon, in-app destination or external URL).
- [x] Up to **3 side-by-side panels** with draggable dividers, maximize/restore,
      per-panel close, and a focus glow.
- [x] **Light / dark** themes (OS default, persisted, live toggle).
- [x] Toasts, modal system, navigation reset on sign-out.

### Admin
- [x] **Database**: browse/delete `notes`, `links`, `shortcuts`, `users`;
      pagination; JSON inspector with clipboard copy.
- [x] **Users**: account list, role switching, per-user documents, access log.
- [x] **Statistics**: notes / links / shortcuts / characters / active users /
      subjects, with a normalised per-subject bar chart.

### Verification performed
- [x] **Class-name parity audit** across every JS module against `style.css`:
      all classes emitted by components are defined. (Earlier generations had a
      ~70 % mismatch; this rebuild closes it.)
- [x] Static review of every `GET`/`write` path for missing `null` guards and
      Firestore index fallbacks.
- [x] Confirmed no binary content is ever written to Firestore.

---

## 3. Architectural decisions

### Offline-first, zero build
- Pure **ES modules**; **no** npm install, bundler or transpiler.
- Heavy libraries (Firebase compat, Marked, KaTeX, PDF.js, Mammoth) are loaded as
  pinned **CDN globals** in `index.html` and consumed through `window.*`. This
  keeps the repository dependency-free and directly runnable from any static
  server.
- Services degrade gracefully: ordered Firestore queries fall back to a
  client-side sort when a composite index is missing, so the UI never hard-fails.

### Credential obfuscation
- All Firebase values live in `src/env-config.js` (**git-ignored**), stored
  **Base64-encoded**, decoded at runtime in `firebase-config.js`.
- The README is explicit that Base64 is *obfuscation, not encryption* and that
  the real boundary is the Firestore security rules — which are documented and
  copy-pasteable.
- `isConfigured` distinguishes real keys from placeholders so the app warns
  instead of silently failing.

### Markdown as the storage format
- No PDF/DOCX is ever uploaded. `converter-service.js` converts **client-side**:
  PDF.js extracts text into Markdown; Mammoth produces HTML that a bespoke
  reducer turns into GFM (headings, lists, tables, quotes, code, links).
- This keeps documents tiny, diffable and directly editable — and makes the
  character quota meaningful.

### Component model
- Each component exports `render(container, params)` + `destroy()`.
- The workspace keeps **one instance per app id**, so module-level singleton
  `state` is safe and avoids re-render churn.
- Cross-component communication is strictly via **EventBus** events.

### Split screen
- Panels are created imperatively by `split-screen.js`, which interleaves
  draggable dividers and redistributes equal flex shares. Resizing is bounded by
  a 220 px minimum per panel.

### Design system
- One stylesheet, fully token-driven (`:root` + `[data-theme='dark']`), with
  Acrylic/Mica `backdrop-filter`, 8–12 px radii and layered soft shadows.
- The single mandated icon source — Icons8 Fluency at 200 px — is centralised in
  `iconUrl()` / `iconImg()`.

---

## 4. Known limitations & recommendations for V2

### Limitations
1. **True offline support is partial.** The shell and data layer are offline-first
   in spirit, but CDN assets need a first network load. Firestore's own offline
   cache is available but not enabled.
2. **Client-trusted authorization.** Roles and quotas are enforced in the UI;
   the real gate is the security rules. A malicious client could attempt writes
   the rules must reject (they do, if published as documented).
3. **No live collaboration.** Documents are last-write-wins; there is no presence,
   locking or conflict resolution.
4. **PDF extraction is text-only.** Scanned/image PDFs (no text layer) import
   poorly — OCR is out of scope.
5. **Statistics are computed on demand** by reading entire collections; fine at
   small scale, expensive at large scale.
6. **Firestore composite indexes** improve performance but are a manual step.
7. **Bilingual seams:** the UI is French while code/identifiers are English
   (intentional, but worth noting for contributors).

### V2 backlog
- [ ] **Service worker** to cache the shell + CDN assets for genuine offline use;
      enable Firestore `enablePersistence()`.
- [ ] **Vendor the CDN libraries locally** under `assets/vendor/` for air-gapped
      deployments.
- [ ] **Cloud Functions** to enforce quota/role invariants server-side and to
      maintain denormalised counters.
- [ ] **Versioned statistics** via scheduled aggregation instead of full reads.
- [ ] **Note versioning / trash** (soft delete) and richer history.
- [ ] **Tagging** beyond subject/topic, plus saved filters.
- [ ] **Export** a note (or a subject) to `.md` / print-to-PDF.
- [ ] **OCR** fallback for scanned PDFs.
- [ ] **Shortcut drag-reordering** and right-click context menus.
- [ ] **Accessibility pass** (full keyboard navigation, ARIA audit) and i18n
      extraction of all UI strings.

---

## 5. Upgrade / setup checklist

1. Serve over HTTP (`python -m http.server`, `npx serve .`, …) — ES modules
   require it.
2. In Firebase: enable **Email/Password** auth and create **Firestore**.
3. Paste the [security rules](README.md#security-rules) from the README.
4. Confirm `src/env-config.js` holds **your** Base64 keys (defaults target
   `revise-61c6b`).
5. Register, then promote your account to `admin` from the console.
6. (Optional) Create the recommended composite indexes.

---

*End of patch notes — v1.0.0.*
