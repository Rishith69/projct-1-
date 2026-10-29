import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const roles = ['donor', 'recipient', 'admin'];
const categories = ['Prepared meals', 'Produce', 'Bakery', 'Dairy', 'Pantry', 'Other'];
const activeRequestStatuses = ['pending', 'accepted', 'picked_up'];
const secret = () => {
  const value = process.env.JWT_SECRET;
  if (!value && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production.');
  return value || 'local-demo-secret-change-before-deploy-2026';
};
const timestamp = () => new Date().toISOString();
const parseDate = (value) => new Date(value).getTime();
const emailSchema = z.string().trim().email().max(200);
const registerSchema = z.object({
  name: z.string().trim().min(2).max(80), email: emailSchema,
  password: z.string().min(8).max(100), role: z.enum(['donor', 'recipient']),
  organization: z.string().trim().min(2).max(120), phone: z.string().trim().min(7).max(40),
  address: z.string().trim().min(5).max(180), serviceArea: z.string().trim().max(180).optional().default(''),
});
const listingSchema = z.object({
  name: z.string().trim().min(2).max(100), description: z.string().trim().min(8).max(700),
  category: z.enum(categories), quantity: z.coerce.number().positive().max(10000),
  unit: z.string().trim().min(1).max(30), preparedAt: z.string().datetime(),
  pickupLocation: z.string().trim().min(5).max(180),
  pickupStart: z.string().datetime(), pickupEnd: z.string().datetime(),
  useBy: z.string().datetime().optional().or(z.literal('')).default(''),
  handling: z.string().trim().min(8).max(500), allergens: z.string().trim().max(200).default(''),
});
function listingTimingError(data) {
  const currentTime = Date.now();
  const preparedAt = parseDate(data.preparedAt);
  const pickupStart = parseDate(data.pickupStart);
  const pickupEnd = parseDate(data.pickupEnd);
  const useBy = data.useBy ? parseDate(data.useBy) : null;
  if ([preparedAt, pickupStart, pickupEnd, ...(useBy ? [useBy] : [])].some(Number.isNaN)) return 'Enter valid dates and times.';
  if (preparedAt > currentTime + 10 * 60000) return 'Preparation time cannot be in the future.';
  if (pickupStart <= currentTime || pickupEnd <= pickupStart || pickupEnd - pickupStart > 7 * 86400000) return 'Choose a future pickup window no longer than seven days.';
  if (useBy && (useBy < pickupEnd || useBy - currentTime > 30 * 86400000)) return 'Use-by guidance must be after pickup and within 30 days.';
  return '';
}
const profileSchema = z.object({
  name: z.string().trim().min(2).max(80), organization: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(40), address: z.string().trim().min(5).max(180),
  serviceArea: z.string().trim().max(180).optional().default(''),
});
const reportSchema = z.object({
  reason: z.enum(['Inaccurate details', 'Food-safety concern', 'Inappropriate content', 'Other']),
  details: z.string().trim().min(8).max(500),
});

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, organization: user.organization, phone: user.phone, address: user.address, serviceArea: user.service_area };
}
function addHistory(db, listingId, requestId, fromStatus, toStatus, actor, note = '') {
  db.prepare(`INSERT INTO status_history(listing_id,request_id,from_status,to_status,actor_id,actor_role,note,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(listingId, requestId ?? null, fromStatus, toStatus, actor?.id ?? null, actor?.role ?? 'system', note, timestamp());
}
function serializeListing(row) {
  return { ...row, donorName: row.donor_name, donorOrganization: row.donor_organization, pickupStart: row.pickup_start,
    pickupEnd: row.pickup_end, pickupLocation: row.pickup_location, preparedAt: row.prepared_at, useBy: row.use_by,
    createdAt: row.created_at, requestCount: row.request_count ?? 0 };
}
const listingSelect = `SELECT l.*, u.name AS donor_name, u.organization AS donor_organization, u.phone AS donor_phone,
  (SELECT COUNT(*) FROM requests r WHERE r.listing_id=l.id AND r.status='pending') AS request_count
  FROM listings l JOIN users u ON u.id=l.donor_id`;

export function createApp(db) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  const requireAuth = (req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
    try {
      const payload = jwt.verify(token, secret());
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(payload.sub);
      if (!user) return res.status(401).json({ error: 'Your session is no longer valid.' });
      req.user = publicUser(user);
      next();
    } catch {
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    }
  };
  const allow = (...allowedRoles) => (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to do that.' });
    next();
  };
  const validate = (schema, input) => {
    const result = schema.safeParse(input);
    if (!result.success) return { error: result.error.issues[0]?.message || 'Please check the information provided.' };
    return { data: result.data };
  };
  function expireOldListings() {
    const expired = db.prepare(`SELECT id,status FROM listings WHERE status IN ('available','requested','reserved') AND pickup_end <= ?`).all(timestamp());
    const transaction = db.transaction(() => {
      for (const listing of expired) {
        db.prepare("UPDATE listings SET status='expired' WHERE id=?").run(listing.id);
        const active = db.prepare("SELECT id,status FROM requests WHERE listing_id=? AND status IN ('pending','accepted')").all(listing.id);
        for (const request of active) {
          db.prepare("UPDATE requests SET status='expired',updated_at=? WHERE id=?").run(timestamp(), request.id);
          addHistory(db, listing.id, request.id, request.status, 'expired', null, 'Pickup window ended.');
        }
        addHistory(db, listing.id, null, listing.status, 'expired', null, 'Pickup window ended.');
      }
    });
    transaction();
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.post('/api/auth/register', (req, res) => {
    const { data, error } = validate(registerSchema, req.body);
    if (error) return res.status(400).json({ error });
    try {
      const result = db.prepare(`INSERT INTO users(name,email,password_hash,role,organization,phone,address,service_area,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(data.name, data.email, bcrypt.hashSync(data.password, 10), data.role, data.organization, data.phone, data.address, data.serviceArea, timestamp());
      const user = publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid));
      return res.status(201).json({ token: jwt.sign({ sub: user.id }, secret(), { expiresIn: '12h' }), user });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'An account with that email already exists.' });
      throw error;
    }
  });
  app.post('/api/auth/login', (req, res) => {
    const parsed = z.object({ email: emailSchema, password: z.string().min(1).max(100) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' });
    const user = db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE').get(parsed.data.email);
    if (!user || !bcrypt.compareSync(parsed.data.password, user.password_hash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
    return res.json({ token: jwt.sign({ sub: user.id }, secret(), { expiresIn: '12h' }), user: publicUser(user) });
  });
  app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));
  app.patch('/api/profile', requireAuth, (req, res) => {
    const { data, error } = validate(profileSchema, req.body);
    if (error) return res.status(400).json({ error });
    db.prepare('UPDATE users SET name=?,organization=?,phone=?,address=?,service_area=? WHERE id=?')
      .run(data.name, data.organization, data.phone, data.address, data.serviceArea, req.user.id);
    return res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
  });

  app.get('/api/listings', requireAuth, (req, res) => {
    expireOldListings();
    const conditions = [];
    const values = [];
    if (req.user.role === 'donor') { conditions.push('l.donor_id=?'); values.push(req.user.id); }
    else if (req.user.role === 'recipient') conditions.push("l.status IN ('available','requested')");
    else if (req.query.status) { conditions.push('l.status=?'); values.push(String(req.query.status)); }
    if (req.query.search) { conditions.push('(l.name LIKE ? OR l.description LIKE ?)'); values.push(`%${req.query.search}%`, `%${req.query.search}%`); }
    if (req.query.category) { conditions.push('l.category=?'); values.push(String(req.query.category)); }
    if (req.query.location) { conditions.push('l.pickup_location LIKE ?'); values.push(`%${req.query.location}%`); }
    const sql = `${listingSelect}${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY l.pickup_end ASC`;
    return res.json({ listings: db.prepare(sql).all(...values).map(serializeListing) });
  });
  app.get('/api/listings/:id', requireAuth, (req, res) => {
    expireOldListings();
    const listing = db.prepare(`${listingSelect} WHERE l.id=?`).get(Number(req.params.id));
    if (!listing || (req.user.role === 'donor' && listing.donor_id !== req.user.id)) return res.status(404).json({ error: 'Listing not found.' });
    return res.json({ listing: serializeListing(listing), history: db.prepare('SELECT * FROM status_history WHERE listing_id=? ORDER BY created_at').all(listing.id) });
  });
  app.post('/api/listings', requireAuth, allow('donor'), (req, res) => {
    const { data, error } = validate(listingSchema, req.body);
    if (error) return res.status(400).json({ error });
    const timingError = listingTimingError(data);
    if (timingError) return res.status(400).json({ error: timingError });
    const result = db.prepare(`INSERT INTO listings(donor_id,name,description,category,quantity,unit,prepared_at,pickup_location,pickup_start,pickup_end,use_by,handling,allergens,status,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'available',?)`).run(req.user.id, data.name, data.description, data.category, data.quantity, data.unit, data.preparedAt, data.pickupLocation, data.pickupStart, data.pickupEnd, data.useBy, data.handling, data.allergens, timestamp());
    addHistory(db, Number(result.lastInsertRowid), null, 'new', 'available', req.user, 'Listing published.');
    return res.status(201).json({ listing: serializeListing(db.prepare(`${listingSelect} WHERE l.id=?`).get(result.lastInsertRowid)) });
  });
  app.put('/api/listings/:id', requireAuth, allow('donor'), (req, res) => {
    const listing = db.prepare('SELECT * FROM listings WHERE id=? AND donor_id=?').get(Number(req.params.id), req.user.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (listing.status !== 'available') return res.status(409).json({ error: 'Only available listings can be edited. Remove it and publish an updated listing instead.' });
    const { data, error } = validate(listingSchema, req.body);
    if (error) return res.status(400).json({ error });
    const timingError = listingTimingError(data);
    if (timingError) return res.status(400).json({ error: timingError });
    db.prepare(`UPDATE listings SET name=?,description=?,category=?,quantity=?,unit=?,prepared_at=?,pickup_location=?,pickup_start=?,pickup_end=?,use_by=?,handling=?,allergens=? WHERE id=?`)
      .run(data.name, data.description, data.category, data.quantity, data.unit, data.preparedAt, data.pickupLocation, data.pickupStart, data.pickupEnd, data.useBy, data.handling, data.allergens, listing.id);
    return res.json({ listing: serializeListing(db.prepare(`${listingSelect} WHERE l.id=?`).get(listing.id)) });
  });
  app.delete('/api/listings/:id', requireAuth, allow('donor'), (req, res) => {
    const listing = db.prepare('SELECT * FROM listings WHERE id=? AND donor_id=?').get(Number(req.params.id), req.user.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (!['available', 'requested'].includes(listing.status)) return res.status(409).json({ error: 'This listing can no longer be removed.' });
    const transaction = db.transaction(() => {
      db.prepare("UPDATE listings SET status='removed' WHERE id=?").run(listing.id);
      const pending = db.prepare("SELECT id FROM requests WHERE listing_id=? AND status='pending'").all(listing.id);
      for (const request of pending) {
        db.prepare("UPDATE requests SET status='cancelled',updated_at=? WHERE id=?").run(timestamp(), request.id);
        addHistory(db, listing.id, request.id, 'pending', 'cancelled', req.user, 'Listing removed by donor.');
      }
      addHistory(db, listing.id, null, listing.status, 'removed', req.user, 'Removed by donor.');
    });
    transaction();
    return res.json({ ok: true });
  });

  app.post('/api/listings/:id/requests', requireAuth, allow('recipient'), (req, res) => {
    const listingId = Number(req.params.id);
    const message = z.string().trim().max(300).optional().default('').safeParse(req.body?.message);
    if (!message.success) return res.status(400).json({ error: 'Request note must be 300 characters or fewer.' });
    const createRequest = db.transaction(() => {
      const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
      if (!listing || !['available', 'requested'].includes(listing.status) || parseDate(listing.pickup_end) <= Date.now()) return { error: 'This listing is no longer available.', status: 409 };
      const duplicate = db.prepare(`SELECT id FROM requests WHERE listing_id=? AND recipient_id=? AND status IN ('pending','accepted','picked_up')`).get(listingId, req.user.id);
      if (duplicate) return { error: 'Your organization already has an active request for this listing.', status: 409 };
      const result = db.prepare("INSERT INTO requests(listing_id,recipient_id,status,message,created_at,updated_at) VALUES(?,?,'pending',?,?,?)")
        .run(listingId, req.user.id, message.data, timestamp(), timestamp());
      if (listing.status === 'available') db.prepare("UPDATE listings SET status='requested' WHERE id=? AND status='available'").run(listingId);
      addHistory(db, listingId, Number(result.lastInsertRowid), 'available', 'requested', req.user, 'Recipient submitted a request.');
      return { id: Number(result.lastInsertRowid) };
    });
    const result = createRequest();
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.status(201).json({ request: db.prepare('SELECT * FROM requests WHERE id=?').get(result.id) });
  });

  const requestSelect = `SELECT r.*, l.name AS listing_name,l.category,l.quantity,l.unit,l.pickup_location,l.pickup_start,l.pickup_end,l.use_by,l.handling,l.allergens,l.status AS listing_status,l.donor_id,
    d.organization AS donor_organization,d.name AS donor_name,d.phone AS donor_phone,
    o.name AS recipient_name,o.organization AS recipient_organization,o.phone AS recipient_phone,o.address AS recipient_address
    FROM requests r JOIN listings l ON l.id=r.listing_id JOIN users d ON d.id=l.donor_id JOIN users o ON o.id=r.recipient_id`;
  app.get('/api/requests', requireAuth, (req, res) => {
    expireOldListings();
    let where = '';
    let values = [];
    if (req.user.role === 'donor') { where = ' WHERE l.donor_id=?'; values = [req.user.id]; }
    if (req.user.role === 'recipient') { where = ' WHERE r.recipient_id=?'; values = [req.user.id]; }
    const requests = db.prepare(`${requestSelect}${where} ORDER BY r.updated_at DESC`).all(...values).map((row) => ({
      ...row, listingName: row.listing_name, pickupLocation: row.pickup_location, pickupStart: row.pickup_start,
      pickupEnd: row.pickup_end, useBy: row.use_by, donorOrganization: row.donor_organization,
      donorName: row.donor_name, donorPhone: row.donor_phone, recipientName: row.recipient_name,
      recipientOrganization: row.recipient_organization,
      recipientPhone: activeRequestStatuses.includes(row.status) && row.status !== 'pending' ? row.recipient_phone : '',
      recipientAddress: activeRequestStatuses.includes(row.status) && row.status !== 'pending' ? row.recipient_address : '',
      donorPhone: activeRequestStatuses.includes(row.status) && row.status !== 'pending' ? row.donor_phone : '',
      createdAt: row.created_at, updatedAt: row.updated_at,
    }));
    return res.json({ requests });
  });
  app.post('/api/requests/:id/action', requireAuth, (req, res) => {
    expireOldListings();
    const action = z.enum(['accept', 'reject', 'cancel', 'pickup', 'complete']).safeParse(req.body?.action);
    if (!action.success) return res.status(400).json({ error: 'Choose a valid request action.' });
    const requestId = Number(req.params.id);
    const result = db.transaction(() => {
      const row = db.prepare(`${requestSelect} WHERE r.id=?`).get(requestId);
      if (!row) return { error: 'Request not found.', status: 404 };
      const isDonor = req.user.role === 'donor' && row.donor_id === req.user.id;
      const isRecipient = req.user.role === 'recipient' && row.recipient_id === req.user.id;
      const operation = action.data;
      if ((operation === 'accept' || operation === 'reject' || operation === 'complete') && !isDonor) return { error: 'Only this listing’s donor can do that.', status: 403 };
      if ((operation === 'cancel' || operation === 'pickup') && !isRecipient) return { error: 'Only the requesting organization can do that.', status: 403 };
      if (operation === 'accept' && row.status !== 'pending') return { error: 'Only pending requests can be accepted.', status: 409 };
      if (operation === 'reject' && row.status !== 'pending') return { error: 'Only pending requests can be rejected.', status: 409 };
      if (operation === 'cancel' && !['pending', 'accepted'].includes(row.status)) return { error: 'This request can no longer be cancelled.', status: 409 };
      if (operation === 'pickup' && row.status !== 'accepted') return { error: 'Pickup can only be confirmed for an accepted request.', status: 409 };
      if (operation === 'complete' && row.status !== 'picked_up') return { error: 'Completion can only be confirmed after pickup.', status: 409 };
      const transitions = { accept: 'accepted', reject: 'rejected', cancel: 'cancelled', pickup: 'picked_up', complete: 'completed' };
      const nextStatus = transitions[operation];
      const oldListingStatus = db.prepare('SELECT status FROM listings WHERE id=?').get(row.listing_id).status;
      if (operation === 'accept') {
        const reserved = db.prepare("UPDATE listings SET status='reserved' WHERE id=? AND status IN ('available','requested')").run(row.listing_id);
        if (reserved.changes !== 1) return { error: 'Another organization has already reserved this listing.', status: 409 };
      }
      db.prepare('UPDATE requests SET status=?,updated_at=? WHERE id=?').run(nextStatus, timestamp(), requestId);
      addHistory(db, row.listing_id, requestId, row.status, nextStatus, req.user, '');
      if (operation === 'accept') {
        const otherRequests = db.prepare("SELECT id FROM requests WHERE listing_id=? AND id<>? AND status='pending'").all(row.listing_id, requestId);
        for (const other of otherRequests) {
          db.prepare("UPDATE requests SET status='rejected',updated_at=? WHERE id=?").run(timestamp(), other.id);
          addHistory(db, row.listing_id, other.id, 'pending', 'rejected', req.user, 'Another organization was accepted.');
        }
        addHistory(db, row.listing_id, null, oldListingStatus, 'reserved', req.user, 'Request accepted.');
      } else if (operation === 'reject') {
        const stillPending = db.prepare("SELECT COUNT(*) AS count FROM requests WHERE listing_id=? AND status='pending'").get(row.listing_id).count;
        if (stillPending === 0 && oldListingStatus === 'requested') db.prepare("UPDATE listings SET status='available' WHERE id=? AND status='requested'").run(row.listing_id);
        addHistory(db, row.listing_id, null, oldListingStatus, stillPending ? 'requested' : 'available', req.user, 'Request rejected.');
      } else if (operation === 'cancel') {
        const listingStatus = row.status === 'accepted' ? 'available' : (db.prepare("SELECT COUNT(*) AS count FROM requests WHERE listing_id=? AND status='pending'").get(row.listing_id).count ? 'requested' : 'available');
        db.prepare('UPDATE listings SET status=? WHERE id=?').run(listingStatus, row.listing_id);
        addHistory(db, row.listing_id, null, oldListingStatus, listingStatus, req.user, 'Request cancelled.');
      } else if (operation === 'pickup') {
        db.prepare("UPDATE listings SET status='picked_up' WHERE id=? AND status='reserved'").run(row.listing_id);
        addHistory(db, row.listing_id, null, oldListingStatus, 'picked_up', req.user, 'Recipient confirmed pickup.');
      } else if (operation === 'complete') {
        db.prepare("UPDATE listings SET status='completed' WHERE id=? AND status='picked_up'").run(row.listing_id);
        addHistory(db, row.listing_id, null, oldListingStatus, 'completed', req.user, 'Donor confirmed donation completion.');
      }
      return { requestId };
    });
    const outcome = result();
    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
    return res.json({ request: db.prepare('SELECT * FROM requests WHERE id=?').get(requestId) });
  });

  app.post('/api/listings/:id/reports', requireAuth, allow('recipient'), (req, res) => {
    const listing = db.prepare('SELECT id FROM listings WHERE id=?').get(Number(req.params.id));
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    const { data, error } = validate(reportSchema, req.body);
    if (error) return res.status(400).json({ error });
    const reportId = db.prepare("INSERT INTO reports(listing_id,reporter_id,reason,details,status,created_at) VALUES(?,?,?,?,'open',?)")
      .run(listing.id, req.user.id, data.reason, data.details, timestamp()).lastInsertRowid;
    return res.status(201).json({ id: Number(reportId), status: 'open' });
  });
  app.get('/api/reports', requireAuth, allow('admin'), (_req, res) => {
    const reports = db.prepare(`SELECT rp.*,l.name AS listing_name,l.status AS listing_status,l.donor_id,u.organization AS reporter_organization
      FROM reports rp JOIN listings l ON l.id=rp.listing_id JOIN users u ON u.id=rp.reporter_id ORDER BY CASE rp.status WHEN 'open' THEN 0 ELSE 1 END,rp.created_at DESC`).all();
    const actions = db.prepare('SELECT * FROM admin_actions ORDER BY created_at DESC').all();
    return res.json({ reports, actions });
  });
  app.post('/api/reports/:id/action', requireAuth, allow('admin'), (req, res) => {
    const parsed = z.object({ action: z.enum(['dismiss', 'remove']), note: z.string().trim().max(300).optional().default('') }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose dismiss or remove.' });
    const report = db.prepare('SELECT * FROM reports WHERE id=?').get(Number(req.params.id));
    if (!report) return res.status(404).json({ error: 'Report not found.' });
    if (report.status !== 'open') return res.status(409).json({ error: 'This report has already been reviewed.' });
    const transact = db.transaction(() => {
      const next = parsed.data.action === 'dismiss' ? 'dismissed' : 'removed';
      db.prepare('UPDATE reports SET status=?,resolved_at=?,resolved_by=? WHERE id=?').run(next, timestamp(), req.user.id, report.id);
      if (parsed.data.action === 'remove') {
        const listing = db.prepare('SELECT status FROM listings WHERE id=?').get(report.listing_id);
        if (listing && !['removed', 'completed', 'expired'].includes(listing.status)) {
          db.prepare("UPDATE listings SET status='removed' WHERE id=?").run(report.listing_id);
          const pending = db.prepare("SELECT id,status FROM requests WHERE listing_id=? AND status IN ('pending','accepted')").all(report.listing_id);
          for (const request of pending) {
            db.prepare("UPDATE requests SET status='cancelled',updated_at=? WHERE id=?").run(timestamp(), request.id);
            addHistory(db, report.listing_id, request.id, request.status, 'cancelled', req.user, 'Listing removed after admin review.');
          }
          addHistory(db, report.listing_id, null, listing.status, 'removed', req.user, 'Removed after report review.');
        }
      }
      db.prepare('INSERT INTO admin_actions(admin_id,report_id,listing_id,action,note,created_at) VALUES(?,?,?,?,?,?)')
        .run(req.user.id, report.id, report.listing_id, parsed.data.action, parsed.data.note, timestamp());
    });
    transact();
    return res.json({ ok: true });
  });

  app.get('/api/listings/:id/history', requireAuth, (req, res) => {
    const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(Number(req.params.id));
    if (!listing || (req.user.role === 'donor' && listing.donor_id !== req.user.id)) return res.status(404).json({ error: 'Listing not found.' });
    const history = db.prepare(`SELECT h.*,u.name AS actor_name FROM status_history h LEFT JOIN users u ON u.id=h.actor_id WHERE h.listing_id=? ORDER BY h.created_at`).all(listing.id);
    return res.json({ history });
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}
