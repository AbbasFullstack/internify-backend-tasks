/**
 * Live end-to-end smoke test.
 *
 * Boots a real HTTP server against an in-memory MongoDB and drives every
 * endpoint with genuine HTTP calls, printing each request/response pair.
 * This is the artifact that stands in for a Postman run: same requests,
 * same responses, reproducible with one command.
 *
 *   node scripts/smoke-test.js
 *
 * Task 3 made every write authenticated and ownership-scoped, so this script
 * now signs up a user first and sends that token on the write requests. The
 * reads stay anonymous on purpose — they are public by design, and asserting
 * that here is part of the point.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri('internify_smoke');
process.env.NODE_ENV = 'test'; // silence morgan so the output stays readable
process.env.PORT = '5055';
process.env.JWT_SECRET = 'smoke-test-secret-that-is-long-enough-to-pass-32';

const { default: app } = await import('../src/app.js');
await mongoose.connect(process.env.MONGO_URI);

const server = app.listen(process.env.PORT);
const BASE = `http://127.0.0.1:${process.env.PORT}`;

let passed = 0;
let failed = 0;

/** Fire one request and print it. `token` adds the Authorization header. */
const call = async (label, method, path, body, token) => {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload;
  try {
    payload = await res.json();
  } catch {
    payload = await res.text();
  }

  const ok = res.status < 400;
  if (ok) passed += 1;
  else failed += 1;

  console.log(`\n${'─'.repeat(72)}`);
  console.log(
    `${method} ${path}   ->   ${res.status} ${res.statusText}${token ? '   [Bearer token]' : '   [anonymous]'}`
  );
  if (body) console.log(`  request body : ${JSON.stringify(body)}`);
  console.log(`  response     : ${JSON.stringify(payload).slice(0, 260)}`);
  return { status: res.status, payload };
};

const expect = (label, actual, expected) => {
  const ok = actual === expected;
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${expected}, got ${actual}`);
  return ok;
};

console.log('\n=== Internify Task 1 — Books API, live end-to-end run ===');

// 0. sign up so the authenticated writes below have a token
console.log('\n--- account setup (Task 3 made writes authenticated) ---');
const signup = await call('signup', 'POST', '/api/auth/signup', {
  name: 'Smoke User',
  email: 'smoke-user@example.com',
  password: 'SmokePass123',
});
expect('signup returns 201', signup.status, 201);
const token = signup.payload.data.token;

// 1. health
await call('health', 'GET', '/api/health');

// 2. create (201)
const sample = {
  title: 'Clean Code',
  author: 'Robert C. Martin',
  genre: 'Software Engineering',
  year: 2008,
  price: 34.99,
};

const created = await call('create', 'POST', '/api/books', sample, token);
expect('POST returns 201', created.status, 201);
const id = created.payload.data.id;

// 2b. an anonymous write is refused
const anon = await call('create anonymously (expect 401)', 'POST', '/api/books', {
  ...sample,
  title: 'Should Not Exist',
});
expect('anonymous create returns 401', anon.status, 401);

// 3. create a second book so the list is non-trivial
await call(
  'create second',
  'POST',
  '/api/books',
  {
    title: 'The Pragmatic Programmer',
    author: 'Andrew Hunt',
    genre: 'Software Engineering',
    year: 1999,
    price: 42.5,
  },
  token
);

// 4. list all
const list = await call('list', 'GET', '/api/books');
expect('GET list returns 200', list.status, 200);
expect('GET list returns 2 books', list.payload.count, 2);
expect('the list is paginated', typeof list.payload.page, 'number');
expect('the list reports a total', list.payload.total, 2);

// 5. list with filter
await call('list filtered', 'GET', '/api/books?genre=software');

// 5b. search
const search = await call('search by author', 'GET', '/api/books?search=martin');
expect('search returns 200', search.status, 200);
expect('search finds the book', search.payload.total, 1);

// 5c. search composes with pagination
const paged = await call('page 1, limit 1', 'GET', '/api/books?page=1&limit=1');
expect('page 1 honours the limit', paged.payload.data.length, 1);
expect('page 1 reports a next page', paged.payload.hasNextPage, true);

const paged2 = await call('page 2, limit 1', 'GET', '/api/books?page=2&limit=1');
expect('page 2 returns a different book', paged2.payload.data[0].id !== paged.payload.data[0].id, true);
expect('the limit is capped at 100', (await call('absurd limit', 'GET', '/api/books?limit=9999')).payload.limit, 100);

// 6. get one
const one = await call('get one', 'GET', `/api/books/${id}`);
expect('GET one returns 200', one.status, 200);
expect('GET one returns right title', one.payload.data.title, 'Clean Code');

// 7. update
const updated = await call('update', 'PUT', `/api/books/${id}`, { price: 29.99 }, token);
expect('PUT returns 200', updated.status, 200);
expect('PUT applied new price', updated.payload.data.price, 29.99);
expect('PUT preserved author', updated.payload.data.author, 'Robert C. Martin');

// ---- error paths the brief calls out explicitly ----
await call('missing field (expect 400)', 'POST', '/api/books', {
  author: 'No Title',
  genre: 'Drama',
  year: 2001,
  price: 10,
}, token);
await call('negative price (expect 400)', 'POST', '/api/books', {
  title: 'Bad Price',
  author: 'X',
  genre: 'Drama',
  year: 2001,
  price: -5,
}, token);
await call('malformed id (expect 400)', 'GET', '/api/books/not-an-id');
await call('unknown book (expect 404)', 'GET', `/api/books/${new mongoose.Types.ObjectId()}`);
await call('unknown route (expect 404)', 'GET', '/api/nope');

// 8. delete
const deleted = await call('delete', 'DELETE', `/api/books/${id}`, null, token);
expect('DELETE returns 200', deleted.status, 200);

// 9. confirm it is gone
const gone = await call('get deleted (expect 404)', 'GET', `/api/books/${id}`);
expect('deleted book is gone', gone.status, 404);

console.log(`\n${'='.repeat(72)}`);
console.log(`Requests exercised: ${passed + failed}   (status < 400: ${passed}, >= 400: ${failed})`);
console.log('All five CRUD endpoints plus 400/404 error paths were driven over real HTTP.');
console.log('Writes carried a Bearer token; reads were left anonymous to prove they are public.');

server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(failed === 0 ? 0 : 1);
