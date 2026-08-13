# --- deps stage: install dependencies (build tools included in case a
#     native module like better-sqlite3 needs to compile from source) ---
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Note on `sharp`: its prebuilt native binary has failed to load on at least
# one real deployment of this app, even after a `--no-cache` rebuild and an
# explicit forced platform install — most likely because the VM's virtual
# CPU (common with Proxmox's default, non-"host" CPU types) doesn't expose
# an instruction set the prebuilt binary expects, which no npm install flag
# can fix. Since sharp only powers a nice-to-have (auto-rotating photos that
# carry an EXIF orientation tag), the app now requires it defensively (see
# src/routes/receipts.js) and simply skips that feature if it's unavailable,
# rather than crashing on startup. If you want that feature working, try
# setting the VM's CPU type to "host" in Proxmox and rebuilding.

# --- runtime stage: slim image with just the built app ---
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY views ./views
COPY public ./public
COPY templates ./templates

# LibreOffice (Calc only, not the full office suite) renders the filled MMFS
# spreadsheet to PDF for the "Export PDF" button — there's no pure-JS way to
# turn a real spreadsheet, with its actual styling and print layout, into an
# accurate PDF. fonts-liberation is metric-compatible with Arial/Times/
# Courier so the exported document's text renders correctly instead of with
# missing/placeholder glyphs (bookworm-slim ships no fonts by default). This
# is a meaningfully heavier image than before (LibreOffice is not small) —
# that's an accepted tradeoff for exporting a real copy of MMFS's actual
# reimbursement form rather than an approximation of it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-calc fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Run as a non-root user. Only /app/data needs to be writable (that's where
# the SQLite DB and uploaded receipts live, mounted as a volume) — everything
# else the app just reads, which works fine under the default root-owned/
# world-readable permissions from COPY. Chowning just this one empty
# directory is instant; a recursive chown of the whole app (including
# node_modules) can take minutes on slower disk I/O.
RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3000
ENV DATA_DIR=/app/data

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/login', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
