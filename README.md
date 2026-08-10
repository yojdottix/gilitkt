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
- **Backup & Restore** — one JSON file with every asset and island, plus assets-only CSV export and a snapshot/read-budget panel
- Hard reset database (password + typed confirmation required)
- Change Superuser password from the UI — applies immediately on every device, no redeploy. Requires the current password, and enforces a 12-character minimum with penalties for predictable shapes
- Failed unlock attempts trigger an escalating cooldown (15s doubling to 5 minutes) after 5 tries

## 🎨 Design System

Follows **tiket.com Passport 4.6**.

- **Color:** full primitive + semantic token layers (Background / Text / Icon / Stroke), light and dark, plus Festive and Tier gradients
- **Typography:** Tiket Odyssey (self-hosted woff2), Passport type ladder from Heading 1 down to Extra Small Print
- **Buttons:** TDS variants — Primary, Secondary, Tertiary, Invert, Alert — flat fills, no gradients
- **Radius:** 8px
- **Grid:** 16-column dashboard (28px margin) and 12-column desktop (120px margin), 24px gutter
- **Icons:** in-house solid 24×24 set plus a stroke set generated from Figma, `currentColor` throughout so dark mode works. `npm run icons` regenerates the Figma set from the SVGs in `src/app/assets/icons`
- **Surfaces:** glassmorphic menus for kebab and popover surfaces, defined once in `globals.css`

## ⚙️ Tech
- **Backend:** Appwrite Cloud (Frankfurt)
- **Cache:** IndexedDB, no expiry; a single freshness request per load decides whether to re-sync
- **Import:** Retry-safe, skips already imported rows, pausable and resumable
- **Deployment:** Vercel with automatic GitHub deployments

## 🚀 Running locally

```bash
npm i
npm run dev
```

## 📝 Changelog

### 2.0.0
Full visual and interaction revamp against the new Figma design, desktop first. Major version because the navigation, the Superuser entry point and the "Projects" vocabulary all changed — no data migration is required, but muscle memory from 1.x will not survive.

**Islands replace Projects**
- "Project" is now "Island" throughout. This is a rename only: the `localStorage` key and its contents are unchanged, so every existing collection is still there under the new name
- Island cards render a collage of their contents instead of a bare row, so a collection is identifiable at a glance
- The four separate project dialogs — create, manage, the card dropdown and the add-to-project modal — collapse into one `IslandPicker` that both adds and removes, with search and inline creation. Adding an asset to a new island used to mean leaving the grid to create it first

**Navigation and controls**
- Sidebar rebuilt: asset types and admin tools are now distinct groups, the sync line carries the database status light, and the user menu holds the Superuser entry, dark mode and About
- View, Sort and Pagination move into three header popovers. Pagination state lifted from `AssetGrid` up to `AssetDashboard`, so the header and the grid can no longer disagree about the current page
- **The View and Sort menus never actually appeared.** Their chip is a custom component behind `<PopoverTrigger asChild>`, and it did not forward its ref — so Radix had no element to measure and anchored the menu against nothing, placing it a couple of hundred pixels above the top of the window. The chip forwards its ref now
- View and Sort adopt the same dark glassmorphic surface as the island and user menus, rather than the light popover they had been using. Card density is three discrete stops (4/6/8) on a segmented control, replacing a continuous 4–8 slider that could land on widths the design never drew
- The sidebar collapse control sits with the logo: always visible while the sidebar is open, revealed on hovering the logo once it is collapsed. It cross-fades with the logo rather than sitting beside it in the collapsed rail, which is only 68px wide
- Detail panel widened to 360px and given a Superuser-only "Edit in Manage Asset" jump

**Buttons**
- Three filled variants (Primary, Secondary, Invert) across three sizes (52/44/32px), rebuilt against the Figma component. The existing `default` / `secondary` / `outline` keys are unchanged, so no call site moved
- Each carries a 1px inside stroke that is a gradient from its colour at full opacity to 40%. `border-color` cannot express that, so the fill and the stroke are painted as two background layers (`.btn-gs` in `globals.css`) with a transparent border between them. The side effect is that `background-color` no longer reaches these buttons at all, so hover and active reassign the layers instead of setting a background
- Vertical padding is one pixel under the drawn value because Figma strokes inside the frame while CSS puts the border outside the padding box; this is what makes the heights land on 52/44/32 rather than 54/46/34

**Superuser**
- The full-screen unlock gate is now a modal over the dashboard, so signing in no longer hides the library
- Session state moved out of the gate component into a `SuperuserContext`. It was previously local to the gate, which meant nothing else could ask whether you were signed in — the sidebar and the cards can now show Superuser affordances directly
- Losing the session while an admin screen is open returns you to the dashboard instead of leaving admin tooling on screen behind an expired lock

**Layout matches the design 1:1**
- **The whole spacing scale was rendering at 87.5%.** `html` was pinned to `font-size: 14px`, and every rem-based Tailwind utility is measured against that — so a `p-4` the design specifies as 16px came out at 14, `size-5` icons at 17.5 instead of 20, and the 240px sidebar at 210. Tailwind's scale assumes a 16px root and so does the Figma file; the root is now 16px and the two agree. Type is unaffected, because every font size in the app resolves to a Passport token and those are declared in px
- **Icons were 5–50% oversized.** Figma exports the glyph's own bounding box, not the 24-unit frame it sits in, so rendering an export as-is stretches the glyph to fill the box and loses the inset. `scripts/gen-figma-icons.mjs` now widens each viewBox back out to the full frame and squares it, which restores the drawn size without touching path data
- The page is the sunken surface with the content on it as a floating white panel, the header carries the title/count, search and controls in one column, and the card is rebuilt to spec — 160px artwork on a sunken block, a bare `+` in the corner, an 18px title, and the copy action folded into the link chip rather than a separate blue button

**Foundations reconciled against Figma**
- Colour was checked token by token against the Colour Foundation board — all 9 palette ramps, the Neutral Dark ramp, alphas, gradients, brand, and the Background/Text/Icon/Stroke semantic layer. **No drift; nothing changed.**
- **Heading 3 was 28/30 and the foundation says 24/26.** 28 is not a rung on the desktop ramp at all. The likely source is the retired `🚫Heading 3` token, which is 22/28 — the 28 there is its line height, not its size. Affects the dashboard title and five admin/Analytics headings
- **Added the mobile type ramp, which had never been transcribed.** The foundation defines every token twice, Desktop and Mobile; only Desktop existed, so a 56px Heading 1 specified to drop to 32px on a 360px screen stayed at 56 and overflowed. Headings now step down below the 840px breakpoint
- The mobile *body* ramp is recorded but deliberately not switched on. Those tokens are what Tailwind's `--text-lg/base/sm` alias, so enabling them resizes most of the app's text, and Body 2 sets the font size of every input — anything under 16px makes iOS auto-zoom the page on focus. One consequence to be aware of: with headings ramped and body not, a mobile page title (18px) is the same size as a card title, so the two no longer separate

**Correctness**
- **Dark mode now applies everywhere at once.** `useTheme` kept per-component state, so each caller had its own copy — toggling from the sidebar left toasts and any other consumer on the old theme until remount. It is now a single module-level store
- **The create-asset signature no longer demands an `id` it ignores.** `createAsset` and `bulkCreateAssets` asked for `Omit<Asset, 'created_at' | 'updated_at'>`, which requires the Appwrite document `$id` — a value only Appwrite can mint, and one both functions discard in favour of `ID.unique()`. CSV rows could not satisfy it. Replaced with an explicit `AssetDraft` type

**Housekeeping**
- TypeScript checking added (`npm run typecheck`), strict and clean, including `noUnusedLocals`/`noUnusedParameters`
- Removed the orphaned `src/app/imports/` Figma export folder, the dead `AssetFilters` component, and duplicate `generateThumbnail`/`generateTags` helpers defined in two files and called from neither
- Dropped 38 unused dependencies — including three whole UI kits (MUI, Emotion, lucide-react) that nothing imported — and 24 unused shadcn components, halving the UI layer. CSS bundle 143kB → 108kB

### 1.1.0
- **Filenames now match case-insensitively.** `Halim.png` and `halim.png` are one asset, not two. Comparisons used the raw string everywhere, so a re-upload spelled with different capitalisation was graded **New** instead of **Replaced** — the link was never replaced, the old artwork stayed live, and the import created a **second row** for the same asset with no way to tell which was current. The in-batch duplicate guard missed it too, so a CSV carrying both spellings imported both without complaint
- One `assetKey()` helper is now the single definition of "same filename", used by the database checker, Manual Input, the CSV viewer, the import engine's existing-row lookup and its in-batch duplicate guard, and the Analytics duplicate check — which was itself reporting case-variant duplicates as two healthy assets
- **Stored filenames are untouched.** `assetKey()` is for lookups only; `nama_file` keeps whatever casing it was created with, because it is the string people copy, paste and search for. Normalising it would silently rename thousands of assets
- Assets already duplicated by casing resolve deterministically — first row wins — and are logged, rather than depending on list order. Analytics now counts them so they can be cleaned up
- **Removed the asset download entirely**, from the card overlay, the card kebab and the detail panel, along with `utils/download.ts` and `helpers/runDownload.ts`. Two implementations, both dead ends: `<a download>` is ignored cross-origin, and the fetch-to-blob replacement needs `Access-Control-Allow-Origin` from `s-light.tiket.photos`, which is not sent. No client-side approach can work until that header exists or the app proxies the file through its own origin
- **"Download" in Manage Asset was relabelled, not removed** — its entire body was `window.open`, so it never downloaded anything either. Now reads "Open in Lightroom"
- Every blob-based download still works and is untouched: backup `.json`, backup assets `.csv`, project export to CSV and TXT, and the CSV import template

### 1.0.53
- **Download now saves the file instead of opening Lightroom in a tab.** Not intended behaviour — a browser rule. The `<a download>` attribute is IGNORED for cross-origin URLs, and the assets are on `s-light.tiket.photos` while the app is on Vercel, so the attribute was always discarded and the click degraded to navigation; `target="_blank"` then made sure it opened in a tab. Now fetches the bytes and downloads them through a same-origin `blob:` URL, where `download` does apply
- **This depends on the asset CDN allowing cross-origin reads.** If `s-light.tiket.photos` does not send `Access-Control-Allow-Origin`, no client-side code can produce a true download. In that case it falls back to opening the image and *says so* — "Opened in a new tab", with instructions to save from there — rather than claiming "Download started!" for a file that was never written, which is what the old code did on every single click
- **Download is now in the asset detail panel.** The card's Preview/Download overlay is `hidden lg:flex` and also suppressed at 7+ columns, so on a phone or a dense grid there was no way to download an asset *anywhere* in the app: the card hid the control and the panel never had one. Both entry points now share one download path, so they cannot disagree about what happened
- About dialog reads "Crafted & developed with JOY ✶". The star is `aria-hidden` — a screen reader would otherwise announce "black six pointed star" mid-sentence

### 1.0.52
- **The project kebab menu is now reachable on mobile.** It was `opacity-0 group-hover:opacity-100`, and it is the only entry point to Rename, Export to CSV, Export to TXT and Delete Project — so on a phone all four were unreachable, not just hidden
- Swept the whole app for the same pattern rather than fixing only the reported one, and found a third: the asset kebab in **Manage Asset**, the only way to Edit or Delete an asset. Also fixed
- The two remaining hover-reveal elements are deliberately left alone. Both are the type-label pill on a card image — a label, not a control, so hiding it behind hover costs nobody an action. Making them always-visible would put a black pill over every card at every width

### 1.0.51
- **New logo.** Supplied as two files — white wordmark and black wordmark — but they are identical apart from that fill, so this ships as one component with the wordmark on `currentColor`. It follows light/dark mode with no theme check to keep in sync, and the mark can't drift out of step with the wordmark. The 80% opacity the white file carried on its wordmark was treated as an artefact of the export, not a dark-mode treatment; say so if it was deliberate
- Fixed a latent bug while replacing it: the gradient's `<defs>` id was hardcoded, and the logo renders twice at once (sidebar and dashboard). SVG ids are global, so the second instance was resolving to the first one's gradient — unmounting that one would have left the other's mark unfilled. Now uses `useId()`
- **Mobile now shows 2 columns instead of 1.** The single column existed because a 2-up grid at 360px left ~160px cards that couldn't fit the card's contents. The real cause was that AssetCard sized its padding, type and controls off `gridColumns` — a *desktop* density setting — so a phone got a card built for a 300px slot. The card now compacts at the base breakpoint and expands at `lg`, which is what made 2 columns viable
- **Add-to-project now works on mobile.** The button was `opacity-0 group-hover:opacity-100` at every width, and touch screens have no hover — so it was permanently invisible on phones and there was no way to add an asset to a project from the grid at all. Visible by default below `lg`; hover-reveal kept where a pointer exists

### 1.0.50
- **Paste a spreadsheet straight into Manual Input.** Copy the filename and link columns out of Sheets, Numbers or the Appwrite console and paste them into the collapsible box at the top of the tab — each line becomes a row with the name and type already filled in. Folded into Manual Input rather than given its own Superuser menu entry, because it produces exactly the rows below it: it is a faster way to fill this form, not a separate operation
- The parser anchors on the **link**, not on column headers, since a paste has none. Whichever cell starts with `http` is the link and the rest is the filename, so the columns work in either order and a sheet title line above the data falls out on its own. Tab, comma, semicolon and multi-space separators are all accepted; a single space is not, because filenames contain them
- **A link used by two different filenames is now flagged.** This imported cleanly before and looked correct in the grid — both entries resolve, one to the wrong artwork — so it was only discoverable by downloading the file. It comes from a copy-paste slip in the source sheet. Warned rather than blocked: the same artwork does legitimately serve two names sometimes, and only the person pasting knows which case it is
- Pasted rows route through the same `deriveAssetName` / `detectType` pair the typed path uses, so a pasted row and a typed row are indistinguishable once in the form

### 1.0.49
- **Most Recent now includes re-uploaded assets.** It sorted on `created_at` alone, so an asset relinked to fresh artwork stayed buried at its original position. Now sorts by last-touched
- Fixed the underlying reason that wouldn't have worked on its own: when a link was replaced, the locally-assembled snapshot kept the asset's **old** `updated_at`, so no sort could have surfaced it until an authoritative rebuild. The fresh timestamp now comes from the update response
- **Click an asset name in Manage Asset to rename it** — Enter saves, Esc cancels. Superuser only, by virtue of the gate
- Renames and edits cost **zero database reads**: they use the document id the snapshot already carries instead of looking the row up by filename, so they also work while the quota is exhausted
- The grid view no longer title-cases names on screen, which would have rewritten your casing on every rename

### 1.0.48
- **Toasts now actually appear.** The `<Toaster />` host had never been mounted, so all 74 `toast()` calls across the app — added to project, link copied, import finished, backup downloaded, password changed — silently did nothing
- Bottom-right on desktop, top-centre on mobile, where the fixed pager and the 85%-height detail sheet would otherwise cover them
- Toasts follow the app's own dark-mode toggle; the wrapper was reading next-themes, which has no provider here and always reported "system"
- While a CSV import is running, toasts lift above the progress widget instead of landing on top of it

### 1.0.47
- Tags in the asset detail sheet are pill-shaped chips, matching the cards — they were square-cornered with a different unselected treatment, so the same tag looked like two different components depending on where you saw it
- Card and detail-panel chips now share one style definition, so they can't drift apart again
- Removed `getTypeColors` from the detail panel: it mapped 'instant'/'upgrade'/'gold', values a tag never has, so it always returned the default

### 1.0.46
- Card-size slider and the per-card copy button moved from B500 (#0064D2) to B400 (#007CFF), matching the copy button already used in the detail panel
- Selected tag chips are now a soft B100 fill with a 1px B400 outline and B400 text, instead of a solid blue block
- Added `--pp-chip-selected-bg` / `--pp-chip-selected-fg` so the selected chip stays readable in dark mode: reusing the blue-high/low pair directly would have given 3.19:1 contrast there

### 1.0.45
- **Manual Input**, under Upload CSV: type a filename and the asset name and type fill themselves in, add as many rows as you need, and each row is graded New / Replaced / Unchanged before you save. Saves through the same engine as CSV import, so behaviour is identical
- Removed anonymous visitor counting. It spent one database read per browser session and was the last thing costing reads during ordinary browsing
- Fixed `--pp-text-informative`, a CSS variable that was never defined — the "Replaced" badge text in the CSV viewer had been falling back to the inherited colour since 1.0.38

### 1.0.44
- Search now matches each word independently against underscore-separated names, so "train blue" finds `tds_ic_train_blue`. Previously it substring-matched the whole query, which meant every multi-word search failed against this library's own naming convention
- Pasting a whole filename into the search box works
- Tag chips accumulate instead of replacing the query: each click toggles a `#tag`, several can be active at once (matching **any** of them), and active chips are highlighted. Typed words still narrow, so `train #tds #refund` means "train, and tagged Tds or Refund"
- Manage Asset had its own copy of the old search logic and the same bug; both screens now share one engine

### 1.0.43
- Real link previews for Slack and anywhere else that scrapes Open Graph: proper title, description and a 1200x630 preview image. The old preview showed leftover scaffolding boilerplate about screen readers, because no OG tags existed and Slack fell back to the stray `<meta name="description">`
- The preview URL resolves itself from Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, so previews work with no configuration; set `VITE_SITE_URL` only to override it with a custom domain

### 1.0.42
- **"Publish from this browser's cache"** — publishes the snapshot with zero database reads, so a browser that already has the library can unblock everyone else even while the read quota is exhausted. Publishing from the database needs the reads you've run out of, which made the fix unreachable exactly when it was needed
- Removed a health check that ran `listDocuments` before every page load and discarded the result: it charged one database read per visitor per load, so "viewers cost zero reads" was off by one per load
- A read-quota block now says what it is and how to fix it, instead of showing "Connection Error" and an empty library

### 1.0.41
- **Viewers no longer read the database.** The library is published as a single JSON snapshot in Storage; clients read that, so database reads stay flat no matter how many people use GILI. Storage transfer is billed as bandwidth, not reads
- Imports no longer scan the collection twice (~9,000 reads at 4,486 assets) — both the CSV checker and the import pre-scan resolve from the snapshot for zero reads
- Single-asset edits republish the snapshot instead of invalidating every device's cache, which used to cost a full re-scan per viewer per edit
- **Backup & Restore** replaces Export CSV: a JSON backup covering assets *and* projects, which existed only in `localStorage` and were in no export at all
- A read-budget estimate against the 500,000/month free-tier limit, so the ceiling is visible before you hit it
- "Rebuild snapshot from database" for when you want authoritative counts after editing rows in the Appwrite console

### 1.0.40
- Anonymous usage counting, shown in Analytics: active devices over 7 and 30 days, all-time devices split desktop/mobile, and total sessions. Each browser gets a random local ID; no IP address, no user-agent, nothing identifying a person
- Counts one session per browser session, so refreshing doesn't inflate it, and silently does nothing until the `usage` collection exists

### 1.0.39
- Fixed Analytics reporting 100% "Other": it read `asset.category`, a field that doesn't exist, so every asset fell through to the default branch. Counting now goes through the same function that feeds the sidebar, so the two can't disagree
- Analytics gained the missing Supergraphic category, per-category shares, added-in-last-7/30-days, and a data-health panel for uncategorised assets, missing links and duplicate filenames
- Removed the Upload Asset menu; its CSV template moved into Upload CSV so nothing was lost
- Renamed CSV Viewer to **Upload CSV**

### 1.0.38
- Re-uploading an asset to Lightroom now updates its link on import instead of leaving the row pointing at the retired file; the CSV checker grades rows as New / Replaced / Unchanged so replacements are visible before importing
- Fixed the import summary counting the entire database as "already existed" — importing 10 rows into a 4,486-asset library reported 4,486 unchanged
- Mobile pager is fixed to the viewport, so it no longer stays invisible until you scroll far enough to reach it
- Asset details open as a bottom sheet on mobile, with a drag handle and swipe-to-dismiss, instead of a cramped 340px right-side panel
- A working cache no longer looks like an error: "Offline · showing cached" is now "Showing cached copy · synced 12m ago" in a neutral colour, and the sidebar says "Local" rather than "Inactive"

### 1.0.37
- Password can now be changed from Settings and takes effect on every device immediately — the salted credential lives in Appwrite Storage instead of being compiled in
- Iterations raised 200,000 → 600,000, with a random 16-byte salt per password and self-describing credentials so future parameter changes stay verifiable
- Changing the password now requires the current one, so a borrowed unlocked session can't lock the owner out
- Weak passwords are rejected rather than merely flagged: 12-character minimum, with penalties for wordlist entries and word-then-digits shapes
- Escalating cooldown after 5 failed unlock attempts
- Pointed the Storage bucket at its real Appwrite ID

### 1.0.36
- One Superuser instead of two; `joy1212` is retired
- The password is no longer stored anywhere — only a PBKDF2-SHA256 digest (200,000 iterations, salted) is compiled into the app, and unlocking compares digests with no network call
- Settings now generates the digest for a new password instead of pretending it can change one at runtime
- About image moved to an Appwrite Storage bucket, fixing images that looked saved but showed the placeholder in incognito and on other devices
- The shared-storage indicator no longer reports "shared" when writes are actually being rejected

### 1.0.35
- Dropped the superuser/admin split: `joy1212` and `gili1212` are now two keys to the same door, and anyone who unlocks can update the About image

### 1.0.34
- Asset cards truncate long names, filenames and tag rows instead of showing per-card horizontal scrollbars
- About Image falls back to device-local storage when the Appwrite `settings` collection is missing, and says so
- Password lookups memoised for the session (was re-hitting Appwrite, and 404ing, on every unlock attempt)

### 1.0.33
- Two access levels: superuser (`joy1212`) and admin (`gili1212`)
- Superuser-only **About Image** menu: upload, reposition, zoom and crop a 3:2 image for the About dialog
- Count and sort drop to their own line on mobile so they no longer collide with the breadcrumb

### 1.0.32
- Added an error boundary: a crash now shows the actual error and a copy button instead of a blank white page
- Reverted the desktop header pager from 1.0.31 (see note); mobile sticky pager and the bottom pager are unchanged

### 1.0.31
- Fixed the zoom overlay being trapped inside the grid area: it and the detail panel are now portalled to `<body>`, since a transformed ancestor was becoming the containing block for `position: fixed`
- Card "Preview" now opens the detail panel, so there's a single path: card → detail → zoom
- Sticky header keeps breadcrumb, count and sort visible while scrolling
- Page size 100 → 50, halving scroll depth from ~7 screens to ~3.5
- Changing page now scrolls back to the top of the grid
- Breadcrumb: "All Assets" is a single "Home" crumb; categories read "Home > Spot Illus"

### 1.0.30
- Top toolbar is a single row on mobile (search + view toggle no longer stack)
- Sort now sits beside the total-assets count instead of taking its own row

### 1.0.29
- Sort moved out of the top toolbar into its own right-aligned row directly above the grid
- GILI logo gets its own row at the top on mobile
- Removed the static "Manage and organize your graphic assets" line

### 1.0.28
- Removed the stub "Edit File Details" button from the detail panel; Add to Project is now full width
- GILI logo shown in the mobile header so the app is identifiable while the sidebar is closed

### 1.0.27
- Asset detail panel no longer drifts on mobile: page scroll is locked behind it, height uses dvh so the browser address bar can't resize it, and the slide-in animation is desktop-only
- Esc now closes the detail panel

### 1.0.26
- Fixed the copy-link button being pushed outside the card at 7–10 column density

### 1.0.25
- Responsive rebuilt on the tiket breakpoint spec: mobile 360–839px, desktop 840px and up
- Fixed 840–1023px rendering the mobile layout (Tailwind's `lg` was still 1024px)
- Column ladder recalibrated against content width, so cards never go narrower on desktop than on mobile
- Defined the 3xl/4xl breakpoints the 7–10 column settings referenced but never had
- Asset detail panel is full-width on mobile instead of a fixed 340px

### 1.0.24
- Fixed the sidebar showing a red "Offline" on a healthy cache hit (regression from 1.0.23)

### 1.0.23
- Asset cache moved from localStorage to IndexedDB and no longer expires on a timer
- Each load sends **one** freshness request instead of re-downloading all assets
- Serves the cached copy when Appwrite is unreachable, with a "last synced" line in the sidebar

### 1.0.22
- Asset detail panel gained a **Source** row that opens the asset directly in Lightroom
- About dialog copy is now "Crafted & developed with JOY"

### 1.0.21
- Clicking the version label in the sidebar opens an About dialog (3:2 image placeholder + "designed & developed by YOJ.")

### 1.0.20
- Project export (CSV and TXT) now writes only `nama_file` (raw database value) and `url_lightroom`
- Superuser session auto-locks after 15 minutes idle, and never locks during an active import
- Pause / Resume / Stop controls for CSV imports, in a floating panel available app-wide
- Imports keep running when you navigate back to the dashboard
- All UI copy switched to English
- Dashboard background set to white (N0)

### 1.0.19
- Buttons rebuilt on the TDS spec: five flat variants, no gradients, real disabled tokens
- 8px radius applied across the app
- Every icon now comes from the in-house SVG set, including the shadcn primitives
- "Most Recent" uses a sort icon; Admin renamed to **Superuser** with a lightning icon
- Dedicated zoom-in / zoom-out icons in the image inspector

### 1.0.18
- CSV database checker: see exactly which rows are missing before importing
- Three selection modes (not-in-database / manual / range), per-row status badges and filters

### 1.0.17
- Passport typography tokens and utility classes
- 16-column dashboard and 12-column desktop grid tokens

### 1.0.16
- Passport 4.6 color foundation wired into light and dark mode

### 1.0.15
- Tiket Odyssey self-hosted webfonts
- Semantic versioning introduced, version shown in the sidebar footer

## 🔒 Security note

The password itself is not stored anywhere: only a salted PBKDF2-SHA256 digest is
compiled into the bundle, so nobody can read the password out of the app, the
network tab, or the database. That is a real improvement, and it is where the
improvement stops.

The Superuser gate is still **not** a security boundary. GILI is a static site
with no backend, so the comparison happens in the browser and the unlock flag
lives in `sessionStorage` — anyone comfortable with devtools can set it by hand
and skip the gate entirely. It guards against accidents, not against a
determined person. Enforcing this properly would mean Appwrite accounts plus
collection-level permissions.
