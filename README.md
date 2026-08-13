# GILI

Asset management dashboard for organizing illustration assets.

**Version:** 2.0.1

## ✨ Features

### Asset Dashboard
- Browse by category (All Assets, Spot Illus, Micro Illustration, Icons, Supergraphic, Others) plus Islands
- Search by asset name, filename or type, matching each word separately — "train blue" finds `tds_ic_train_blue`, in any word order, and pasting a full filename works too
- Tag chips are multi-select filters: clicking adds a `#tag` to the search, several can be on at once (any of them matches), and active chips are highlighted
- **View, Sort and Pagination live in three header popovers**, so the controls sit in one place instead of being spread between the header and the end of the grid
- Sort by Most Recent (last touched — includes assets whose Lightroom link was replaced), Alphabetical, or Type
- **Asset Type chip** on All Assets and inside an island — a searchable multi-select; the chip names the type when one is on and carries a count when several are, and selected types group to the top of the menu
- Grid/List view with adjustable card size (4–10 columns)
- Pagination at 50 assets per page, driven from the header popover and available without scrolling to the bottom of the grid
- Asset detail panel (preview, metadata, tags, Source link that opens the asset in Lightroom, copy link, Download, Add to Island) — a bottom sheet with swipe-to-dismiss on mobile, a 360px right-side panel on desktop
- GILI brand mark in the mobile header, which also opens the About dialog
- Fullscreen image zoom — scroll to zoom, drag to pan, double-click for 2x, Esc to close
- Click a filename to copy it
- Loading spinner while fetching data
- Instant loads from a persistent local cache, with a "last synced" indicator in the sidebar that doubles as the database status light
- Dark mode (persists across sessions, follows system preference)
- Collapsible sidebar with active section highlight
- About dialog and the dark mode toggle live in the sidebar user menu

### Islands
*(formerly "Projects" — existing collections carry over untouched)*
- Group assets into named collections, created inline from any card or from the detail panel
- Island cards show a collage of their contents, so a collection is recognisable before you open it
- Glassmorphic kebab menu per island: Rename, Export to CSV, Export to TXT, Delete
- One picker handles both adding and removing, with search and inline island creation, replacing the four separate dialogs 1.x used for the same job

### Harbor
- Read-only shelves moored by the Superuser and published for everyone, so someone who doesn't know what an asset is called can browse a collection instead of guessing at the search box
- Same cards and same exports as your own islands; only Rename and Delete are absent, because only the Superuser can change one
- Published as a single JSON file to Appwrite Storage, like the library snapshot — no database reads for viewers, and no auth to arrange
- Membership is stored as filenames, so a collection never drifts from the library: an asset that has since been deleted simply stops appearing

### Superuser
*(formerly "Admin")*
- Sign in from the sidebar user menu, in a modal over the dashboard rather than a full-screen gate — the library stays visible behind it
- One Superuser, one password. The password is never stored — only a salted PBKDF2-SHA256 credential at 600,000 iterations, so it can't be read out of the bundle or out of Appwrite
- **About Image** — upload a 3:2 image for the About dialog, with drag-to-reposition, zoom and crop before saving. Stored in an Appwrite Storage bucket, so it's shared across every device and browser
- Password-protected Superuser panel *(client-side only)*
- **Session auto-locks after 15 minutes idle**, with a 60-second warning; any click or keypress extends it
- **Sessions never expire mid-import** — a running job holds the session open
- **Upload CSV** — bulk import with a downloadable template and auto-detected category
- **Manual Input** — add a few assets without a CSV: multi-row form with auto-derived name and type, per-row New/Replaced/Unchanged status, and duplicate detection both inside the form and against the library
- CSV preview with pagination (100 rows/page) and row-number sort (ascending/descending)
- **Database checker** — grades every CSV row as New, Replaced (filename matches but Lightroom issued a new link) or Unchanged, and reports missing rows as collapsed ranges you can copy
- **Three import selection modes** — "Not in database" (auto-selects new rows only), "Pick manually" (per-row checkboxes), and "Row range"
- **Pause / Resume / Stop an import**, from a floating panel available on every screen
- **Imports survive navigation** — going back to the dashboard mid-import does not restart it
- Re-uploaded assets are relinked automatically: a changed url_lightroom for an existing filename replaces the stored link, counted separately in the import summary
- Optional "update type only" mode for rows that already exist
- Edit & delete assets, including click-to-rename directly in the list — costs no database reads, so it works even while the read quota is exhausted
- Anonymous usage counting: active devices in the last 7/30 days, all-time devices split desktop/mobile, and total sessions — no IP, no user-agent, no personal data
- Analytics — total assets, per-category counts and shares, assets added in the last 7/30 days, and a data-health panel flagging uncategorised assets, missing Lightroom links and duplicate filenames
- **Harbor** — build the collections everyone sees: name them, search the library to add or drop assets in a list or a grid, and publish the whole set in one go, so a half-built shelf is never visible
- **Backup & Restore** — one JSON file with every asset and island, plus assets-only CSV export and a snapshot/read-budget panel
- Hard reset database (password + typed confirmation required)
- Change Superuser password from the UI — applies immediately on every device, no redeploy. Requires the current password, and enforces a 12-character minimum with penalties for predictable shapes
- Failed unlock attempts trigger an escalating cooldown (15s doubling to 5 minutes) after 5 tries
