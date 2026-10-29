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