# Harvest Share

Food Donation Platform demo for hackathon challenge HACK-P197. Harvest Share connects local food donors with recipient organizations for coordinated pickup.

## Stack

- React 19, TypeScript, Vite, and Lucide icons
- Express 5 API with Zod validation and JWT sessions
- SQLite via better-sqlite3 for persistent local storage

SQLite was chosen to keep local setup simple while retaining real persistence, database constraints, and transactional booking behavior.

## Setup

Requires Node.js 20+ and npm.

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Set `JWT_SECRET` in `.env` to a long, random local value. The `.env.example` value is intentionally a placeholder. The app creates `data/harvest-share.sqlite` and seeds the demo accounts and listings on first startup.

```powershell
npm.cmd run dev
```

Open <http://localhost:5173>. Vite proxies `/api` requests to the Express API on port 3001. For a production frontend bundle, run `npm.cmd run build`; `npm.cmd start` starts the API. Serve the built `dist` directory from a static host or reverse proxy `/api` to the API server.

There are no separate migration commands: the server creates/updates the SQLite schema at startup. The database is persistent at `DATABASE_PATH` (default `./data/harvest-share.sqlite`). To reset the demo data, stop the server and remove that SQLite file; the next start recreates it. Do not remove a database containing data you need.

## Demo accounts

All demo accounts use the password `Harvest2026!`.

| Role | Email | Organization |
| --- | --- | --- |
| Donor | `donor@harvest.test` | Juniper & Grain Kitchen |
| Donor | `kitchen@harvest.test` | Common Table Catering |
| Recipient | `shelter@harvest.test` | Northside Community Pantry |
| Recipient | `center@harvest.test` | Open Door Family Center |
| Recipient | `mutualaid@harvest.test` | Brookhaven Mutual Aid |
| Admin | `admin@harvest.test` | Harvest Share |

All names, addresses, and phone numbers in the seed data are fictional. The app includes eleven listings.

## Main journey

1. Sign in as donor, publish a food listing with handling and pickup details.
2. Sign in as recipient, search/filter, then request the donation.
3. Sign back in as donor and accept one pending request. Other pending requests are rejected transactionally.
4. As recipient, explicitly confirm pickup. As donor, explicitly confirm completion.
5. Check each dashboard for status and request history.

Recipients can report a listing; admins can dismiss or remove the listing, with actions persisted in the database.

## Safety note

Harvest Share coordinates donations and does not inspect, test, or certify food as safe. Donors must provide accurate timing, handling, storage, and allergen information. All participants must follow applicable local food-safety rules and independently assess each handoff. Do not enter real personal information in this demo.

## Checks

```powershell
npm.cmd test
npm.cmd run build
```

The API tests cover validation, role authorization, duplicate and competing requests, cancellation, lifecycle transitions, history, and moderation.
