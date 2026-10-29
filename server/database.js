import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';

const now = () => new Date().toISOString();
const plusHours = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

export function createDatabase(databasePath = process.env.DATABASE_PATH || './data/harvest-share.sqlite') {
  if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('donor','recipient','admin')),
      organization TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
      service_area TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY, donor_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL,
      description TEXT NOT NULL, category TEXT NOT NULL, quantity REAL NOT NULL CHECK(quantity > 0),
      unit TEXT NOT NULL, prepared_at TEXT NOT NULL, pickup_location TEXT NOT NULL,
      pickup_start TEXT NOT NULL, pickup_end TEXT NOT NULL, use_by TEXT NOT NULL DEFAULT '',
      handling TEXT NOT NULL, allergens TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('available','requested','reserved','picked_up','completed','removed','expired')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES listings(id),
      recipient_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL
      CHECK(status IN ('pending','accepted','rejected','cancelled','picked_up','completed','expired')),
      message TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_request_per_org_listing
      ON requests(listing_id, recipient_id) WHERE status IN ('pending','accepted','picked_up');
    CREATE INDEX IF NOT EXISTS requests_listing_status ON requests(listing_id, status);
    CREATE TABLE IF NOT EXISTS status_history (
      id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES listings(id),
      request_id INTEGER REFERENCES requests(id), from_status TEXT NOT NULL, to_status TEXT NOT NULL,
      actor_id INTEGER REFERENCES users(id), actor_role TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES listings(id),
      reporter_id INTEGER NOT NULL REFERENCES users(id), reason TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('open','dismissed','removed')),
      created_at TEXT NOT NULL, resolved_at TEXT NOT NULL DEFAULT '', resolved_by INTEGER REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS admin_actions (
      id INTEGER PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES users(id), report_id INTEGER NOT NULL REFERENCES reports(id),
      listing_id INTEGER NOT NULL REFERENCES listings(id), action TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
  `);
  seed(db);
  return db;
}

function seed(db) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count > 0) return;
  const passwordHash = bcrypt.hashSync('Harvest2026!', 10);
  const insertUser = db.prepare(`INSERT INTO users(name,email,password_hash,role,organization,phone,address,service_area,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  const donorOne = insertUser.run('Maya Chen', 'donor@harvest.test', passwordHash, 'donor', 'Juniper & Grain Kitchen', '(555) 010-2401', '18 Orchard Row, Brookhaven', '', now()).lastInsertRowid;
  const donorTwo = insertUser.run('Luis Alvarez', 'kitchen@harvest.test', passwordHash, 'donor', 'Common Table Catering', '(555) 010-2402', '72 Market Street, Brookhaven', '', now()).lastInsertRowid;
  insertUser.run('Amina Brooks', 'shelter@harvest.test', passwordHash, 'recipient', 'Northside Community Pantry', '(555) 010-3301', '205 Willow Walk, Brookhaven', 'Northside, Old Town', now());
  insertUser.run('Theo Martin', 'center@harvest.test', passwordHash, 'recipient', 'Open Door Family Center', '(555) 010-3302', '9 Lantern Court, Brookhaven', 'Central, Northside', now());
  insertUser.run('Sofia Patel', 'mutualaid@harvest.test', passwordHash, 'recipient', 'Brookhaven Mutual Aid', '(555) 010-3303', '41 Garden Square, Brookhaven', 'South Market, Central', now());
  insertUser.run('Platform Admin', 'admin@harvest.test', passwordHash, 'admin', 'Harvest Share', '(555) 010-9000', '100 Civic Lane, Brookhaven', '', now());

  const items = [
    ['Roasted vegetable grain bowls', 'Brown rice, roasted seasonal vegetables, lemon tahini on the side.', 'Prepared meals', 18, 'bowls', 6, '18 Orchard Row, Brookhaven', 'Roasted at 10:30 AM; kept chilled after service.', 'Sesame'],
    ['Fresh sourdough loaves', 'Unsliced country sourdough from this morning’s bake.', 'Bakery', 12, 'loaves', 8, '18 Orchard Row, Brookhaven', 'Cooled fully; store in a dry place.', 'Wheat'],
    ['Seasonal fruit boxes', 'Mixed apples, pears, and oranges, packed for sharing.', 'Produce', 9, 'boxes', 12, '18 Orchard Row, Brookhaven', 'Keep cool and dry; inspect produce on receipt.', 'None declared'],
    ['Lentil and tomato soup', 'Vegetarian red lentil soup in sealed 1-quart containers.', 'Prepared meals', 10, 'quarts', 5, '72 Market Street, Brookhaven', 'Prepared at 11:15 AM; refrigerated promptly.', 'Celery'],
    ['Garden salad kits', 'Washed greens, cucumber, and dressing packed separately.', 'Produce', 8, 'kits', 7, '72 Market Street, Brookhaven', 'Keep refrigerated; dressing is packed separately.', 'Mustard'],
    ['Cheese and spinach pastries', 'Baked hand pies, individually wrapped.', 'Bakery', 16, 'pieces', 10, '18 Orchard Row, Brookhaven', 'Baked at 9:00 AM; keep chilled.', 'Wheat, milk, egg'],
    ['Pasta primavera', 'Penne with seasonal vegetables; sauce packed separately.', 'Prepared meals', 14, 'portions', 6, '72 Market Street, Brookhaven', 'Prepared at 12:00 PM; keep refrigerated.', 'Wheat'],
    ['Carrot and apple snack packs', 'Sliced carrots and apples packed for easy distribution.', 'Produce', 20, 'packs', 4, '18 Orchard Row, Brookhaven', 'Prepared at 1:00 PM; keep chilled.', 'None declared'],
    ['Chickpea curry', 'Mild chickpea and spinach curry with basmati rice.', 'Prepared meals', 12, 'portions', 9, '72 Market Street, Brookhaven', 'Prepared at 10:00 AM; refrigerate promptly.', 'None declared'],
    ['Oat breakfast muffins', 'Blueberry oat muffins baked this morning.', 'Bakery', 24, 'muffins', 14, '18 Orchard Row, Brookhaven', 'Cooled and packed; best shared today.', 'Wheat, oats'],
    ['Roasted squash trays', 'Two hotel pans of roasted squash and onions.', 'Prepared meals', 2, 'trays', 11, '72 Market Street, Brookhaven', 'Prepared at 9:30 AM; temperature log available on pickup.', 'None declared'],
  ];
  const insertListing = db.prepare(`INSERT INTO listings(donor_id,name,description,category,quantity,unit,prepared_at,pickup_location,pickup_start,pickup_end,use_by,handling,allergens,status,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'available',?)`);
  const startOffsets = [1, 2, 1, 3, 5, 2, 6, 1, 4, 8, 3];
  const endOffsets = [6, 8, 9, 7, 10, 11, 12, 6, 13, 16, 14];
  items.forEach((item, index) => {
    const donor = index % 2 === 0 ? donorOne : donorTwo;
    insertListing.run(donor, item[0], item[1], item[2], item[3], item[4], plusHours(-index - 1), item[6], plusHours(startOffsets[index]), plusHours(endOffsets[index]), plusHours(endOffsets[index] + 8), item[7], item[8], now());
  });
}
