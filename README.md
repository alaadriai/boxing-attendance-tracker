# ARETE Boxing / Alaa's Corner

Personal attendance and session administration for Alaa Eddin Aldriai. This is
not an official RWTH application. Brand asset: the original ARETE Advisory logo
from https://advisoryarete.com/arete-logo.png.

## Run

```sh
node scripts/serve.mjs
```

Open http://127.0.0.1:4173/?demo=1 for an isolated, local-only preview. The normal
URL connects to the original Firebase project. `PORT` selects a different port.
The app also runs directly on GitHub Pages without a build step.

## Data compatibility

- Existing Firebase `sessions` documents are read in place. The original `c1`,
  `c2`, and `c3` IDs and `count`, `date`, `time`, `cancelled`, `reason`, and `ts`
  fields remain compatible with the old tracker.
- New records use a deterministic `courseId_YYYY-MM-DD` ID. Existing records
  retain their original document ID when edited. No automatic migration or
  deletion runs on startup.
- New fields include `schemaVersion`, `status`, `periodId`, `substituteName`,
  `notes`, `createdAt`, `updatedAt`, `revision`, and change history.
- `count: null` means the class happened but the count is unknown. `count: 0`
  is an explicit zero headcount. Cancellation is a separate outcome.
- Multiple active records for one slot/date are flagged and excluded from
  statistics and billing until reviewed. Archive is reversible (`deletedAt`),
  and full backups include archived records and pending writes.
- Archived documents also carry `cancelled: true` for older readers that only
  understand that flag. New integrations should filter `deletedAt` explicitly.
- Legacy records have no reliable entry date unless one was already stored.
  The application does not infer it from the class date.

## Periods and billing

The initial configuration includes only the confirmed first winter period in
2026/27. Future billing periods have explicit start/end dates, independent
course schedules, optional narrower course date ranges, HSZ listing aliases,
rates per teaching unit, and units per class. No quarterly assumption is used.
Copying a period clears the old per-course start/end restrictions.

One real teaching slot can have multiple HSZ listing numbers; it generates one
session, not one per listing. A replacement course should use a new slot ID and
its own start/end dates and rate. Earlier records retain their dates and IDs.

The period review distinguishes recorded taught sessions, cancellations,
substitutions, duplicates, NRW public holidays, upcoming sessions, missing
outcomes, and records outside the configured schedule. Estimated pay only
includes confirmed taught sessions without unresolved holiday conflicts.
Substitute payment needs a separate billing decision. A missing headcount does
not imply a cancellation. ISO calendar weeks use the correct ISO week year.

Billing JSON includes the complete selected configuration, source records,
calendar weeks, review reasons, and unresolved count. It does not create or send
official forms or emails. Existing billing/registration automations are unchanged.

## Private registration lists

The People view imports `registration_people_private.json` from the local
registration archive. It searches names, filters real teaching slots through
their HSZ listing numbers and period dates, and shows earlier same-name
registrations, both-day registrations, Plus listings, and PDF snapshot dates.
Latest snapshots determine the current list; historical snapshots remain
available in a person's registration history. These are registration records,
not individual attendance or proof of Plus-course password authorization.

The imported file stays in browser localStorage on that device. It is not sent
to Firebase, checked into GitHub, or included in the attendance backup. Import
the latest private file on each device after the registration archive changes.
The People view displays the source snapshot date and offers removal of the
device's local copy. Automatic cross-device name syncing is not enabled.

The sibling registration importer now emits the private JSON bundle alongside
the existing workbook on each export. Its standalone exporter reads SQLite in
read-only mode. Existing XLSX/CSV/raw-PDF archive behavior is unchanged.

## Saving and connectivity

Drafts are saved to localStorage on every change, including date/course context.
Explicitly saved records are placed in a durable local outbox. Firebase
transactions compare revisions before updating and block stale edits from
overwriting newer changes. Sync errors stay visible; full JSON backups include
the outbox. A conflicted local edit can be backed up before loading the server
version. Repeated saves update the same record.

Course settings are stored in `settings/arete-boxing-v2` when the existing
Firestore permissions allow it. If that collection is denied, the UI explicitly
reports that settings are local to the device; export them for backup. This
release does not modify Firebase authentication or security rules.

The service worker caches the app shell after a successful online visit. Cold
offline launches can use cached records and retain new edits locally; initial
installation, fonts, Firebase modules, and server sync need connectivity. Cached
records are not an independent archive: keep the JSON/CSV backups and OneDrive
workflow. Participant names and course passwords are not added to this public
frontend repository.

## Verification

```sh
node --test tests/core.test.mjs
node tests/browser.cjs
node tests/sync.cjs
```

Browser tests require Playwright and installed Chrome (or set
`TEST_BROWSER_CHANNEL`). `TRACKER_TEST_URL` overrides the local server URL.
They exercise desktop/mobile views and synthetic data only. The sync test
intercepts Firebase module requests and uses an in-memory mock; no live session
writes are performed. Screenshots go to ignored `test-results/`.

The self-hosted Lucide bundle is version 0.468.0 under its ISC license. Fonts
are Barlow Condensed and Source Sans 3 with system fallbacks.
