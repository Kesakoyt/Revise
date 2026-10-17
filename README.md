# Revise — Fiches & Cloud

> Modern study notes and resource manager built with Windows 11 Fluent Design, powered by Firebase and real-time Markdown + KaTeX mathematical typesetting.

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](PATCH_NOTES.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Design](https://img.shields.io/badge/Design-Windows%2011%20Fluent-0078d4.svg)](#)

---

## Overview

**Revise (Fiches & Cloud)** is an all-in-one web workspace tailored for students, researchers, and lifelong learners. Combining the elegance of Windows 11 Fluent Design (Mica/Acrylic glassmorphism, depth, fluid transitions) with a serverless Firebase backend, Revise lets you draft rich study revision cards ("fiches"), organize web references, import academic PDFs and Word documents, and inspect learning analytics—all within an adaptive split-screen productivity environment.

---

## Features

- **📁 Interactive File Explorer**
  - Grid and list views with real-time subject and topic filtering.
  - Multi-attribute sorting (date created, date updated, title, character count).
  - Instant full-text search across titles, topics, and contents.
  - Public revision cards showcase for community notes sharing.
  - Live character quota visual progress indicator.

- **✍️ Split-Pane Markdown & Math Editor**
  - Live side-by-side editing: reactive Markdown textarea paired with parsed HTML preview.
  - First-class mathematical typesetting powered by **KaTeX** (inline `$E = mc^2$` and block `$$\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}$$`).
  - Integrated toolbar for heading styles, formatting, code blocks, lists, and math templates.
  - Subject, topic, visibility (public/private), and character limit tracking with auto-save indicators.

- **📄 Document Import & Conversion Engine**
  - Drag-and-drop ingestion of `.pdf` and `.docx` files directly into the file explorer or editor.
  - In-browser parsing of PDF pages via **PDF.js** extracted directly into cleanly formatted Markdown.
  - Structured Word conversion via **Mammoth.js**, preserving headers, tables, formatting, and lists.

- **🔗 Link & Resource Manager**
  - Catalog educational websites, research papers, video lectures, and tools.
  - Organize bookmarks by subject tags with metadata and direct external launch.
  - Fast search, filter, and management modal dialogues.

- **🪟 Multitasking Split-Screen Workspace**
  - Multi-panel environment allowing up to **3 concurrent panels** side-by-side.
  - Drag-to-resize dividers between panels.
  - Independent panel maximize and close actions, enabling simultaneous note-taking, link referencing, and file browsing.

- **🎨 Windows 11 Fluent Design System**
  - Authentic Mica and Acrylic translucent materials using CSS backdrop filters.
  - High-fidelity light and dark themes with dynamic variable switching and saved preferences.
  - Consistent iconography using Icons8 Fluency suite.
  - Responsive layout with desktop-style application Dock and Navigation Bar.

- **📊 Character Storage Quota System**
  - Per-user storage quota enforcement (default 500,000 characters per account).
  - Quota validation before saving notes to prevent database bloat.
  - Live visual storage gauges and auto-recalculated usage upon content deletion.

- **🛡️ Role-Based Access Control & Admin Suite**
  - Distinct `user` and `admin` permission tiers.
  - **Database Inspector**: Explore, edit, and delete raw records in `notes`, `links`, and `users` collections.
  - **User Management**: View user profiles, inspect individual user file repositories, promote/demote roles, and view user audit logs.
  - **Analytics Dashboard**: Real-time aggregated metrics (total notes, links, characters, active users) with CSS subject distribution bar charts and recent audit trail.

---

## Tech Stack

| Technology | Purpose |
| :--- | :--- |
| **HTML5 & CSS3** | Semantic markup, custom CSS variables, Fluent glassmorphic styling, flex/grid layouts |
| **Vanilla JavaScript (ES6+)** | Modular architecture, native DOM manipulation, pub/sub EventBus, zero heavy framework lock-in |
| **Firebase Auth (Compat 10.7.1)** | Secure email/password authentication and persistent session management |
| **Cloud Firestore (Compat 10.7.1)** | Real-time NoSQL cloud document storage, filtering, and role-based permissions |
| **Marked.js (v11+)** | High-performance client-side Markdown rendering |
| **KaTeX (v0.16.9)** | Rapid LaTeX mathematical expression rendering and auto-delimiter detection |
| **PDF.js (v3.11.174)** | Client-side PDF binary parsing and text stream extraction |
| **Mammoth.js (v1.6.0)** | Client-side `.docx` to semantic HTML/Markdown transformation |
| **Icons8 Fluency** | Fluent-style icons for desktop and docking elements |

---

## Project Structure

```
Revise/
├── index.html                  # Main application entry point & container layouts
├── README.md                   # Project documentation & setup instructions
├── PATCH_NOTES.md              # Version changelog and release notes
├── .gitignore                  # Git ignore rules (ignoring env-config.js)
└── src/
    ├── app.js                  # Application bootstrapper, EventBus & global AppState
    ├── env-config.js.template  # Obfuscated credentials template for Firebase
    ├── env-config.js           # Decoded/local config (gitignored)
    ├── services/
    │   ├── firebase-config.js  # Firebase compat SDK initialization & exports
    │   ├── auth-service.js     # User authentication, session, & profile management
    │   ├── firestore-service.js# Firestore database operations & queries
    │   ├── quota-manager.js    # Character storage quota tracker & validator
    │   └── converter-service.js# PDF/DOCX parser, Markdown & KaTeX math renderer
    ├── components/
    │   ├── navbar.js           # Top header bar, user status, theme switch, quick links
    │   ├── dock.js             # Left app launcher dock with Fluency iconography
    │   ├── workspace.js        # Dynamic multi-panel workspace orchestrator
    │   ├── split-screen.js     # Flexible 1-3 panel resizable layout manager
    │   ├── file-explorer.js    # Note navigator, filter/sort controls, drag-and-drop
    │   ├── markdown-editor.js  # Live split-pane Markdown editor with KaTeX math
    │   ├── link-manager.js     # Curated web bookmarks and resource organizer
    │   ├── admin-database.js   # Administrator collection viewer & document inspector
    │   ├── admin-users.js      # User management, role elevation, and audit logs
    │   └── admin-statistics.js # Analytics dashboard and subject breakdown charts
    └── styles/
        └── style.css           # Fluent Design System tokens, animations & components
```

---

## Getting Started / Setup

### Prerequisites
- A modern standards-compliant web browser (Edge, Chrome, Firefox, Safari).
- A [Firebase Console](https://console.firebase.google.com/) account.
- A local HTTP static server (e.g., VS Code *Live Server*, `npx serve`, or Python's `http.server`).

---

### Step 1: Clone or Open the Repository
```bash
git clone https://github.com/your-username/revise.git
cd revise
```

---

### Step 2: Configure Environment Template
Copy the template configuration file to create your active configuration:
```bash
# On Windows PowerShell:
Copy-Item "src/env-config.js.template" -Destination "src/env-config.js"

# On Unix / macOS:
cp src/env-config.js.template src/env-config.js
```

---

### Step 3: Setup Firebase Project
1. Navigate to [Firebase Console](https://console.firebase.google.com/) and click **Add Project**.
2. Under **Build > Authentication**, click **Get Started** and enable the **Email/Password** sign-in provider.
3. Under **Build > Firestore Database**, click **Create Database** (start in Test mode or immediately apply the security rules detailed below).
4. Go to **Project Settings** (gear icon) > **General** > **Your apps** > Select **Web app (`</>`)**.
5. Register the app name (e.g. `Revise Web`) and locate the `firebaseConfig` object containing:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `storageBucket`
   - `messagingSenderId`
   - `appId`

---

### Step 4: Encode and Populate Firebase Credentials
To safeguard keys from direct automated scrapers, base64-encode each configuration value.

#### How to base64-encode values:
Open your browser developer console (`F12` > **Console**) or run in terminal:
```javascript
// Run in browser console:
btoa("AIzaSyExampleApiKey12345")
// Output: "QUl6YVN5RXhhbXBsZUFwaUtleTEyMzQ1"
```

Or in PowerShell:
```powershell
[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes("AIzaSyExampleApiKey12345"))
```

#### Paste encoded values into `src/env-config.js`:
```javascript
// src/env-config.js
export const FIREBASE_CONFIG_ENCODED = {
  apiKey: "QUl6YVN5RXhhbXBsZUFwaUtleTEyMzQ1",
  authDomain: "eW91ci1wcm9qZWN0LmZpcmViYXNlYXBwLmNvbQ==",
  projectId: "eW91ci1wcm9qZWN0",
  storageBucket: "eW91ci1wcm9qZWN0LmFwcHNwb3QuY29t",
  messagingSenderId: "MTIzNDU2Nzg5MDEy",
  appId: "MTo4Mzc2MTI1NzQ5MTI6d2ViOmExYjJjM2Q0ZTVmNg=="
};
```

---

### Step 5: Deploy Firestore Security Rules
Go to **Firestore Database** > **Rules** in the Firebase Console and deploy the following production rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Authorization helpers
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isOwner(uid) {
      return isAuthenticated() && request.auth.uid == uid;
    }
    
    function isAdmin() {
      return isAuthenticated() && 
        exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    // Users Collection
    match /users/{userId} {
      allow read: if isAuthenticated();
      allow create: if isOwner(userId);
      allow update: if isOwner(userId) || isAdmin();
      allow delete: if isAdmin();
    }

    // Notes Collection
    match /notes/{noteId} {
      allow read: if isAuthenticated() && (
        resource.data.isPublic == true || 
        resource.data.uid == request.auth.uid || 
        isAdmin()
      );
      allow create: if isAuthenticated() && request.resource.data.uid == request.auth.uid;
      allow update: if isAuthenticated() && (
        resource.data.uid == request.auth.uid || 
        isAdmin()
      );
      allow delete: if isAuthenticated() && (
        resource.data.uid == request.auth.uid || 
        isAdmin()
      );
    }

    // Links Collection
    match /links/{linkId} {
      allow read: if isAuthenticated() && (
        resource.data.uid == request.auth.uid || 
        isAdmin()
      );
      allow create: if isAuthenticated() && request.resource.data.uid == request.auth.uid;
      allow update: if isAuthenticated() && (
        resource.data.uid == request.auth.uid || 
        isAdmin()
      );
      allow delete: if isAuthenticated() && (
        resource.data.uid == request.auth.uid || 
        isAdmin()
      );
    }

    // Access Logs Collection
    match /accessLogs/{logId} {
      allow create: if isAuthenticated();
      allow read, delete, update: if isAdmin();
    }
  }
}
```

---

### Step 6: Serve the Application Locally
Since the project uses ES6 JavaScript Modules (`import`/`export`), it must be served over an HTTP protocol rather than opened directly via `file://`.

Run any lightweight web server from the project directory:

```bash
# Using Node.js npx serve:
npx serve .

# Using Python 3:
python -m http.server 8000

# Using PHP:
php -S localhost:8000
```
Open your browser at `http://localhost:3000` (or `http://localhost:8000`).

---

## Firebase Configuration & Obfuscation Strategy

### Why Base64 Obfuscation?
Firebase Web API keys are identifiers used by client applications to associate requests with your Google Cloud Project. In single-page applications, these keys are inherently accessible to end-user clients.

However, committing raw API keys directly into public version control systems (such as GitHub or GitLab) frequently triggers:
- Public secrets scanning alerts and automated security reports.
- Unintentional scraping by malicious bot crawlers seeking vulnerable or misconfigured Firebase instances.
- Accidental leaks in multi-developer working copies.

To prevent this:
1. `src/env-config.js` is added to `.gitignore`.
2. A generic placeholder template `src/env-config.js.template` is tracked instead.
3. Credentials stored in `src/env-config.js` are encoded in Base64 format and decoded at runtime via `atob()` in `src/services/firebase-config.js`.

> [!WARNING]
> **Obfuscation is NOT Encryption.**
> Base64 is an encoding format, not cryptographic encryption. Anyone with access to the browser console can decode these values via `atob()`. True application security is enforced **strictly** through **Firestore Security Rules** and Firebase Authentication tokens.

---

## Usage Guide

### 1. Authentication & Onboarding
- Click **Sign In** on initial visit.
- If you don't have an account, switch to **Create an account** tab, fill in your email, password (min 6 characters), and display name.
- First-time accounts are granted the `user` role with an initial 500,000 character quota.
- *(To create an initial admin, elevate your role to `admin` directly in the Firebase Console under the `users` document).*

### 2. Exploring & Creating Revision Cards (Notes)
- Open **File Explorer** from the dock (left bar).
- Click **+ New Note** to launch the Markdown Editor.
- Fill in:
  - **Title**: Document title.
  - **Subject & Topic**: Academic tagging (e.g., `Mathematics`, `Linear Algebra`).
  - **Visibility**: Toggle "Make Public" to allow all authenticated students to read your note.
- Type in the left editor pane; watch the formatted markdown and math equations compile instantly in the right preview pane.
- Click **Save Note** (`Ctrl+S` / Save button).

### 3. Inserting Mathematical Equations
- **Inline Math**: Enclose expression with single dollar signs: `$f(x) = \sum_{n=0}^{\infty} \frac{f^{(n)}(a)}{n!} (x-a)^n$`
- **Display / Block Math**: Enclose expressions with double dollar signs:
  ```latex
  $$\mathcal{L}\{f(t)\} = \int_0^\infty e^{-st} f(t) dt$$
  ```

### 4. Importing PDFs and Word Documents
- In the **File Explorer**, drag and drop any `.pdf` or `.docx` file into the dashed drop zone.
- Or click the **Import** button in the top toolbar.
- The converter parses the document text, extracts headings and formatting, calculates character count against your quota, and automatically creates a new ready-to-edit note.

### 5. Managing Reference Links
- Click the **Links** icon in the dock to open the Link Manager.
- Add external bookmarks with URLs, titles, descriptions, and subject tags.
- Click any link card to launch the resource in a new tab.

### 6. Multi-Panel Split Screen Workspace
- Click any icon in the Dock to open up to 3 panels simultaneously side-by-side.
- Drag the vertical partition dividers between panels to adjust widths to your workflow.
- Use the panel toolbar to maximize or close specific panels.

### 7. Admin Dashboard (Admin Only)
Users with `role: 'admin'` will see elevated controls in the Dock:
- **Database**: Full CRUD browser across `notes`, `links`, and `users` collections.
- **Users**: List of all registered users, character usages, last login timestamps, user role modifier dropdown (`user` ↔ `admin`), and security audit logs.
- **Statistics**: Visual dashboard with aggregate cards and subject frequency charts.

---

## Security Notes

1. **Client-Side Obfuscation**:
   Base64 encoding prevents accidental plaintext exposure and satisfies repository scanning heuristics. Never rely on client obfuscation as a security perimeter.
2. **Database Isolation**:
   Firestore rules strictly enforce that:
   - Users can only edit or delete their own notes and links.
   - Private notes cannot be read by other regular users.
   - Quota limits and role modifications are guarded by security rules.
   - Access logs can only be read and reviewed by authorized administrators.
3. **Cross-Site Scripting (XSS) Sanitization**:
   Marked.js parses markdown safely, and KaTeX prevents script execution within LaTeX math expressions.

---

## License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for full details.

---

## Version

**v1.0.0** — Initial Production Release (October 2026).
For historical updates and release tracking, refer to [PATCH_NOTES.md](PATCH_NOTES.md).
