import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { createApp } from './app.js';
import { createDatabase } from './database.js';

let db;
let client;
let tokens;

const future = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
const listingPayload = (overrides = {}) => ({
  name: 'Community grain bowls', description: 'Rice bowls with roasted vegetables, packed in sealed containers.',
  category: 'Prepared meals', quantity: 12, unit: 'portions', preparedAt: new Date().toISOString(),
  pickupLocation: '18 Orchard Row, Brookhaven', pickupStart: future(2), pickupEnd: future(5),
  useBy: future(12), handling: 'Refrigerated promptly after preparation; keep chilled.', allergens: 'Sesame', ...overrides,
});
async function login(email) {
  const response = await client.post('/api/auth/login').send({ email, password: 'Harvest2026!' });
  assert.equal(response.status, 200);
  return response.body.token;
}
async function createListing() {
  const response = await client.post('/api/listings').set('Authorization', `Bearer ${tokens.donor}`).send(listingPayload());
  assert.equal(response.status, 201, response.body.error);
  return response.body.listing;
}
async function requestListing(listingId, token) {
  return client.post(`/api/listings/${listingId}/requests`).set('Authorization', `Bearer ${token}`).send({});
}

beforeEach(async () => {
  db = createDatabase(':memory:');
  client = supertest(createApp(db));
  tokens = {
    donor: await login('donor@harvest.test'),
    recipient: await login('shelter@harvest.test'),
    otherRecipient: await login('center@harvest.test'),
    admin: await login('admin@harvest.test'),
  };
});
afterEach(() => db.close());

test('seed provides eleven listings and demo role access is enforced by the API', async () => {
  const listings = await client.get('/api/listings').set('Authorization', `Bearer ${tokens.recipient}`);
  assert.equal(listings.status, 200);
  assert.ok(listings.body.listings.length >= 10);

  const forbidden = await client.post('/api/listings').set('Authorization', `Bearer ${tokens.recipient}`).send(listingPayload());
  assert.equal(forbidden.status, 403);
  const unauthorized = await client.get('/api/listings');
  assert.equal(unauthorized.status, 401);
  const adminOnly = await client.get('/api/reports').set('Authorization', `Bearer ${tokens.recipient}`);
  assert.equal(adminOnly.status, 403);
});

test('invalid quantities and invalid pickup windows are rejected server-side', async () => {
  const invalidQuantity = await client.post('/api/listings').set('Authorization', `Bearer ${tokens.donor}`).send(listingPayload({ quantity: 0 }));
  assert.equal(invalidQuantity.status, 400);
  const invalidWindow = await client.post('/api/listings').set('Authorization', `Bearer ${tokens.donor}`).send(listingPayload({ pickupEnd: future(1) }));
  assert.equal(invalidWindow.status, 400);
  const badCategory = await client.post('/api/listings').set('Authorization', `Bearer ${tokens.donor}`).send(listingPayload({ category: 'Not a category' }));
  assert.equal(badCategory.status, 400);
});

test('contact details are private until the donor accepts a request', async () => {
  const listings = await client.get('/api/listings').set('Authorization', `Bearer ${tokens.recipient}`);
  assert.equal(Object.hasOwn(listings.body.listings[0], 'donorPhone'), false);
  const listing = await createListing();
  const created = await requestListing(listing.id, tokens.recipient);
  const pending = await client.get('/api/requests').set('Authorization', `Bearer ${tokens.recipient}`);
  const pendingRequest = pending.body.requests.find((item) => item.id === created.body.request.id);
  assert.equal(pendingRequest.donorPhone, '');
  assert.equal(pendingRequest.recipientPhone, '');
  await client.post(`/api/requests/${created.body.request.id}/action`).set('Authorization', `Bearer ${tokens.donor}`).send({ action: 'accept' });
  const accepted = await client.get('/api/requests').set('Authorization', `Bearer ${tokens.recipient}`);
  const acceptedRequest = accepted.body.requests.find((item) => item.id === created.body.request.id);
  assert.equal(acceptedRequest.donorPhone, '(555) 010-2401');
  assert.equal(acceptedRequest.recipientPhone, '(555) 010-3301');
});

test('duplicate active requests are blocked and competing requests cannot double book', async () => {
  const listing = await createListing();
  const first = await requestListing(listing.id, tokens.recipient);
  assert.equal(first.status, 201);
  const duplicate = await requestListing(listing.id, tokens.recipient);
  assert.equal(duplicate.status, 409);
  const competing = await requestListing(listing.id, tokens.otherRecipient);
  assert.equal(competing.status, 201);

  const prematureComplete = await client.post(`/api/requests/${first.body.request.id}/action`).set('Authorization', `Bearer ${tokens.donor}`).send({ action: 'complete' });
  assert.equal(prematureComplete.status, 409);
  const accepted = await client.post(`/api/requests/${first.body.request.id}/action`).set('Authorization', `Bearer ${tokens.donor}`).send({ action: 'accept' });
  assert.equal(accepted.status, 200);
  const recipientRequests = await client.get('/api/requests').set('Authorization', `Bearer ${tokens.otherRecipient}`);
  assert.equal(recipientRequests.body.requests[0].status, 'rejected');
  const unavailable = await requestListing(listing.id, tokens.otherRecipient);
  assert.equal(unavailable.status, 409);
  const listingState = await client.get(`/api/listings/${listing.id}`).set('Authorization', `Bearer ${tokens.donor}`);
  assert.equal(listingState.body.listing.status, 'reserved');
});

test('simultaneous donor accept actions can reserve a listing only once', async () => {
  const listing = await createListing();
  const [firstRequest, secondRequest] = await Promise.all([
    requestListing(listing.id, tokens.recipient),
    requestListing(listing.id, tokens.otherRecipient),
  ]);
  assert.equal(firstRequest.status, 201);
  assert.equal(secondRequest.status, 201);
  const acceptResults = await Promise.all([firstRequest, secondRequest].map((response) => client
    .post(`/api/requests/${response.body.request.id}/action`)
    .set('Authorization', `Bearer ${tokens.donor}`)
    .send({ action: 'accept' })));
  assert.deepEqual(acceptResults.map((response) => response.status).sort(), [200, 409]);
  const donorListings = await client.get('/api/listings').set('Authorization', `Bearer ${tokens.donor}`);
  assert.equal(donorListings.body.listings.find((item) => item.id === listing.id).status, 'reserved');
});

test('cancellation restores availability and pickup then completion require explicit valid transitions', async () => {
  const listing = await createListing();
  const request = await requestListing(listing.id, tokens.recipient);
  const cancel = await client.post(`/api/requests/${request.body.request.id}/action`).set('Authorization', `Bearer ${tokens.recipient}`).send({ action: 'cancel' });
  assert.equal(cancel.status, 200);
  let donorListings = await client.get('/api/listings').set('Authorization', `Bearer ${tokens.donor}`);
  assert.equal(donorListings.body.listings.find((item) => item.id === listing.id).status, 'available');

  const renewed = await requestListing(listing.id, tokens.recipient);
  const accepted = await client.post(`/api/requests/${renewed.body.request.id}/action`).set('Authorization', `Bearer ${tokens.donor}`).send({ action: 'accept' });
  assert.equal(accepted.status, 200);
  const wrongActor = await client.post(`/api/requests/${renewed.body.request.id}/action`).set('Authorization', `Bearer ${tokens.otherRecipient}`).send({ action: 'pickup' });
  assert.equal(wrongActor.status, 403);
  const pickedUp = await client.post(`/api/requests/${renewed.body.request.id}/action`).set('Authorization', `Bearer ${tokens.recipient}`).send({ action: 'pickup' });
  assert.equal(pickedUp.status, 200);
  const completed = await client.post(`/api/requests/${renewed.body.request.id}/action`).set('Authorization', `Bearer ${tokens.donor}`).send({ action: 'complete' });
  assert.equal(completed.status, 200);

  donorListings = await client.get('/api/listings').set('Authorization', `Bearer ${tokens.donor}`);
  assert.equal(donorListings.body.listings.find((item) => item.id === listing.id).status, 'completed');
  const history = await client.get(`/api/listings/${listing.id}/history`).set('Authorization', `Bearer ${tokens.donor}`);
  const transitions = history.body.history.map((entry) => entry.to_status);
  for (const status of ['cancelled', 'available', 'requested', 'accepted', 'reserved', 'picked_up', 'completed']) assert.ok(transitions.includes(status));
  assert.ok(history.body.history.every((entry) => entry.created_at && entry.actor_role));
});

test('admin can remove a reported listing and the decision is recorded', async () => {
  const listing = await createListing();
  const report = await client.post(`/api/listings/${listing.id}/reports`).set('Authorization', `Bearer ${tokens.recipient}`).send({ reason: 'Inaccurate details', details: 'The posted pickup address does not match the donor information.' });
  assert.equal(report.status, 201);
  const removed = await client.post(`/api/reports/${report.body.id}/action`).set('Authorization', `Bearer ${tokens.admin}`).send({ action: 'remove', note: 'Verified mismatch in demo review.' });
  assert.equal(removed.status, 200);
  const reportList = await client.get('/api/reports').set('Authorization', `Bearer ${tokens.admin}`);
  assert.equal(reportList.body.reports[0].status, 'removed');
  assert.equal(reportList.body.actions[0].action, 'remove');
  const donorListings = await client.get('/api/listings').set('Authorization', `Bearer ${tokens.donor}`);
  assert.equal(donorListings.body.listings.find((item) => item.id === listing.id).status, 'removed');
});
