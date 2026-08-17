// Hand-curated, newest first - not generated from git history. Keep entries
// to the highlights a user would actually notice, not every file touched.
// CHANGELOG[0].version is the single source of truth for the version number
// shown in the footer, so bump it here whenever a new entry is added.
const CHANGELOG = [
  {
    version: '1.1.3',
    date: '2026-08-17',
    highlights: [
      'Logged-out visitors now land on a plain-language welcome page (what this app is, plus a "Create an account" button) instead of getting bounced straight to the login form',
      'Added a Help page walking through the whole workflow, linked from the top nav',
      'Brand-new users (no reports yet) get a pointer to it on their dashboard',
    ],
  },
  {
    version: '1.1.2',
    date: '2026-08-16',
    highlights: [
      'Admin activity chart can now show logins, reports, exports, etc. - not just receipts',
      '"Choose Files" is now one clear accent-colored button instead of a plain file picker plus a separate upload button',
      'A few hidden surprises scattered around the app',
    ],
  },
  {
    version: '1.1.1',
    date: '2026-08-16',
    highlights: [
      'Broadcast banner is now red and easier to notice, plus a separate "new update" banner appears for 3 days after a release',
      'Removed the email field from the account page - upload confirmations aren\'t wired up yet',
    ],
  },
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
