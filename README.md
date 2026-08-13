# Expense Report Service

A small self-hosted web app for tracking expense reports and receipts.
Each person creates their own account — nobody can see anyone else's data.
Receipts are uploaded into your personal inbox as you collect them; when
you're ready to submit, you open a report and check off which ones belong
in it. Each report can be exported to a single PDF (a summary page plus one
page per receipt) and "submitted" (locked) when you're done.

## Features

- Multi-user accounts (username + password, passwords hashed with bcrypt)
- Each user has their own private inbox and reports, isolated from other users
- **Collect-then-assign workflow:** upload receipts any time (weekly,
  as they happen, whatever) — they sit in your inbox until you check them
  off to include in a specific report. A receipt can be pulled back out of
  a report into the inbox at any point while the report is still a draft
- Upload a receipt (JPEG/PNG/PDF), and the app OCR-scans it to suggest a
  date and total — you always confirm/edit before it's saved
- Each receipt records: date, total, **project name/number**, who attended
  (optional), and notes
- Create as many reports as you like, named however you like (defaults to
  today's date, but renameable) — weekly, monthly, quarterly, per-trip
- Draft reports can be freely edited; "Submit" locks a report from further
  changes (and can be reopened if you need to fix something). Deleting a
  report doesn't delete its receipts — they just go back to your inbox
- **Export to PDF:** one click produces a PDF with a summary table of every
  receipt in the report, followed by one page per receipt (its date, total,
  project, attendees, notes, and the original receipt image/PDF)
- Light/dark mode toggle (remembers your preference)
- Runs fully offline — OCR uses a bundled language model, no external API
  keys or cloud services required
- Single SQLite database file, easy to back up

## Requirements

- Ubuntu server (or any Linux) with Node.js 18+ installed
- No external database server needed (uses SQLite)

## Local development

```bash
npm install
cp .env.example .env
# Edit .env and set SESSION_SECRET to a long random string, e.g.:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npm start
# Visit http://localhost:3000
```

The first run creates a `data/` folder containing the SQLite database
(`expense-reports.db`) and uploaded receipt files under `data/uploads/`.

## Deploying with Docker Compose (recommended)

This is the easiest way to run it on your Ubuntu server — you only need
Docker installed, not Node.js itself.

1. **Install Docker**, if it's not already on the server:

   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER   # log out/in afterwards to pick this up
   ```

2. **Copy this project** onto the server (scp, git clone, rsync — however
   you'd like), then from inside the project folder:

   ```bash
   cp .env.example .env
   nano .env
   ```

   Set `SESSION_SECRET` to a long random value:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   # (or, without Node installed locally: docker run --rm node:20-bookworm-slim \
   #   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
   ```

   Leave `COOKIE_SECURE=false` until you've put HTTPS in front of this (see
   step 5), then switch it to `true`. Leave `DATA_DIR` as `./data` — the
   compose file already maps that to the right place inside the container.

3. **Create the data folder with the right ownership.** The container runs
   as a non-root user (uid 1000) for security, so the bind-mounted `data/`
   folder needs to be writable by that user on the host:

   ```bash
   mkdir -p data
   sudo chown -R 1000:1000 data
   ```

   (If you skip this, the container will fail to write the database with a
   permissions error — just run the `chown` above and restart it.)

4. **Build and start it:**

   ```bash
   docker compose up -d --build
   docker compose logs -f     # watch it come up; Ctrl+C to stop watching
   ```

   Visit `http://your-server-ip:3000` and register your account. To stop
   it: `docker compose down` (your data in `./data` is untouched). To
   update after pulling new code: `docker compose up -d --build` again.

5. **Put nginx (or another reverse proxy) in front of it** for a real
   domain name and HTTPS, the same way as the non-Docker setup below —
   point it at `http://127.0.0.1:3000` (see `deploy/nginx-example.conf`
   and the Certbot step in the manual instructions). There's also a
   commented-out `nginx` service in `docker-compose.yml` if you'd rather
   run the proxy as another container on the same Docker network — in that
   case point its `proxy_pass` at `http://app:3000` instead.

**Note:** I built and reviewed this Dockerfile/compose setup carefully
(multi-stage build, non-root user, healthcheck, verified the npm
dependency lockfile installs cleanly), but wasn't able to run a full
`docker compose up` end-to-end myself since my sandbox can't reach Docker
Hub to pull the base image. Your server should have normal internet
access, so `docker compose up -d --build` should just work — but do treat
the first run as a quick verification step, and let me know if anything
doesn't come up cleanly.

## Updating an existing installation

To pull in new code (e.g. a newer version of this app), replace the project
files but leave the `data/` folder alone — that's where your database and
receipts live — then rebuild:

```bash
docker compose down
# replace the project files with the new version, keeping data/ as-is
docker compose up -d --build
```

**If you copy the `data/` folder to a new location as part of updating**
(e.g. into a freshly-unzipped project folder), use `cp -a` instead of
`cp -r`, or re-apply ownership afterward:

```bash
sudo chown -R 1000:1000 data
```

The container runs as a non-root user (uid 1000) that needs write access
to `data/` for the SQLite database and its WAL journal files. A plain
`cp -r` run as root resets ownership to root, and the app will fail to
start with `SQLITE_READONLY: attempt to write a readonly database` —
`docker compose ps` will show the container stuck in a restart loop. This
is a host-filesystem permissions issue, not a code bug; no rebuild is
needed to fix it, just the `chown` above and `docker compose up -d` again.

**One-time note for anyone updating from the very first version of this
app:** the database schema changed to support the receipt inbox
(receipts moved from "belongs to exactly one report" to "belongs to you,
optionally assigned to a report") and added the project name/number field.
There's no automatic migration for that jump — if your existing `data/`
folder only has test data in it, the simplest path is to stop the
container and delete the `data/` folder so it starts fresh:

```bash
docker compose down
rm -rf data
docker compose up -d --build
```

If you'd already put real receipts in there that you need to keep, don't
delete it — ask for a migration script instead.

## Deploying without Docker (manual Node.js + systemd)

1. **Install Node.js** (if not already installed). Node 18 or newer:

   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   node -v
   ```

2. **Create a dedicated user and directory** (recommended over running as root):

   ```bash
   sudo useradd --system --create-home --shell /usr/sbin/nologin expense
   sudo mkdir -p /opt/expense-report-service
   sudo chown expense:expense /opt/expense-report-service
   ```

3. **Copy the app files** to `/opt/expense-report-service` on the server
   (scp, git clone, rsync — whatever you prefer), then install dependencies:

   ```bash
   cd /opt/expense-report-service
   sudo -u expense npm install --omit=dev
   ```

4. **Configure environment variables:**

   ```bash
   sudo -u expense cp .env.example .env
   sudo -u expense nano .env
   ```

   At minimum, set `SESSION_SECRET` to a long random value (see the command
   above). Leave `COOKIE_SECURE=false` until you have HTTPS set up (step 6),
   then switch it to `true`.

5. **Install the systemd service:**

   ```bash
   sudo cp deploy/expense-reports.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now expense-reports
   sudo systemctl status expense-reports
   ```

   The app will be listening on `127.0.0.1:3000` (change `PORT` in `.env`
   if you need a different port). Check logs with:

   ```bash
   sudo journalctl -u expense-reports -f
   ```

6. **Put nginx in front of it** (recommended, so you can use a normal domain
   name and HTTPS instead of exposing Node directly). A starter config is in
   `deploy/nginx-example.conf`:

   ```bash
   sudo cp deploy/nginx-example.conf /etc/nginx/sites-available/expense-reports
   sudo nano /etc/nginx/sites-available/expense-reports   # set server_name
   sudo ln -s /etc/nginx/sites-available/expense-reports /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

   Then get a free TLS certificate with Certbot:

   ```bash
   sudo apt-get install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d expenses.example.com
   ```

   Once HTTPS is working, set `COOKIE_SECURE=true` in `.env` and restart
   the service (`sudo systemctl restart expense-reports`).

7. **Create your account** by visiting the site and clicking "Register".
   The first user isn't automatically an admin — this app doesn't have an
   admin role; every user just manages their own reports.

## Backups

Everything the app needs is under the `data/` directory (or wherever
`DATA_DIR` points):

- `data/expense-reports.db` — the SQLite database (all users, reports, receipts)
- `data/uploads/` — the original receipt files

Back up that whole folder regularly, e.g. a nightly cron job:

```bash
tar czf /var/backups/expense-reports-$(date +%F).tar.gz -C /opt/expense-report-service data
```

(If you're running with Docker Compose, `data/` is the same bind-mounted
folder next to your `docker-compose.yml` — back that up directly, no need
to go through Docker to reach it.)

## How the OCR works

When you upload a receipt image, the server runs Tesseract OCR against it
and looks for a total (near words like "total", "amount due", "balance
due") and a date in common formats. Those suggestions pre-fill the "Date"
and "Total" fields on the confirmation screen — always double-check them,
since OCR on receipts (especially crumpled or low-quality photos) isn't
perfect. Project name/number, who attended, and notes are always filled in
manually. PDF receipts skip OCR (only JPEG/PNG are scanned) — just enter
the date and total by hand for those. (WEBP images aren't accepted — the
PDF export feature embeds images directly and its library only supports
JPEG/PNG; convert a WEBP receipt to one of those first if you run into it.)

The English language model is bundled as an npm package, so OCR works
without any internet access on the server at runtime.

## Notes on scale and security

This is built for a small team (a handful to a few dozen people), not as
an internet-facing SaaS product. A few things to be aware of:

- There's no "admin" console, password reset flow, or email integration —
  if someone forgets their password, you'll need to reset it directly in
  the database or add a reset flow yourself.
- Uploaded files are capped at 15 MB each.
- Run it behind nginx with HTTPS in production (see step 6) rather than
  exposing port 3000 directly — session cookies rely on `COOKIE_SECURE`
  being accurate.
