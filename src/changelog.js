// Hand-curated, newest first - not generated from git history. Keep entries
// to the highlights a user would actually notice, not every file touched.
// CHANGELOG[0].version is the single source of truth for the version number
// shown in the footer, so bump it here whenever a new entry is added.
const CHANGELOG = [
  {
    version: '1.1.0',
    date: '2026-08-13',
    highlights: [
      'Optional email receipt confirmations on upload',
      '"Missing info" badge for incomplete profiles',
      'Site-wide admin broadcast banner',
      'Multi-page PDF receipts now export in full, not just the first page',
      'Uploads auto-submit as soon as a file is chosen',
      'Removed the separate "Attendees" field (now just part of Description)',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-08-10',
    highlights: ['Initial release'],
  },
];

module.exports = { CHANGELOG };
