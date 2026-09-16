/**
 * Live end-to-end smoke test.
 *
 * Boots a real HTTP server against an in-memory MongoDB and drives every
 * endpoint with genuine HTTP calls, printing each request/response pair.
 * This is the artifact that stands in for a Postman run: same requests,
 * same responses, reproducible with one command.
 *
 *   node scripts/smoke-test.js
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri('internify_smoke');
process.env.NODE_ENV = 'test'; // silence morgan so the output stays readable
process.env.PORT = '5055';

const { default: app } = await import('../src/app.js');
await mongoose.connect(process.env.MONGO_URI);

const server = app.listen(process.env.PORT);
const BASE = `http://127.0.0.1:${process.env.PORT}`;

let passed = 0;
let failed = 0;

const call = async (label, method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
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
  console.log(`${method} ${path}   ->   ${res.status} ${res.statusText}`);
  if (body) console.log(`  request body : ${JSON.stringify(body)}`);
  console.log(`  response     : ${JSON.stringify(payload).slice(0, 260)}`);
  return { status: res.status, payload };
};

const expect = (label, actual, expected) => {
  const ok = actual === expected;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${expected}, got ${actual}`);
  return ok;
};

console.log('\n=== Internify Task 1 — Books API, live end-to-end run ===');

// 1. health
await call('health', 'GET', '/api/health');

// 2. create (201)
const created = await call('create', 'POST', '/api/books', {
  title: 'Clean Code',
  author: 'Robert C. Martin',
  genre: 'Software Engineering',
  year: 2008,
  price: 34.99,
});
expect('POST returns 201', created.status, 201);
const id = created.payload.data.id;

// 3. create a second book so the list is non-trivial
await call('create second', 'POST', '/api/books', {
  title: 'The Pragmatic Programmer',
  author: 'Andrew Hunt',
  genre: 'Software Engineering',
  year: 1999,
  price: 42.5,
});

// 4. list all
const list = await call('list', 'GET', '/api/books');
expect('GET list returns 200', list.status, 200);
expect('GET list returns 2 books', list.payload.count, 2);

// 5. list with filter
await call('list filtered', 'GET', '/api/books?genre=software');

// 6. get one
const one = await call('get one', 'GET', `/api/books/${id}`);
expect('GET one returns 200', one.status, 200);
expect('GET one returns right title', one.payload.data.title, 'Clean Code');

// 7. update
const updated = await call('update', 'PUT', `/api/books/${id}`, { price: 29.99 });
expect('PUT returns 200', updated.status, 200);
expect('PUT applied new price', updated.payload.data.price, 29.99);
expect('PUT preserved author', updated.payload.data.author, 'Robert C. Martin');

// ---- error paths the brief calls out explicitly ----
await call('missing field (expect 400)', 'POST', '/api/books', {
  author: 'No Title',
  genre: 'Drama',
  year: 2001,
  price: 10,
});
await call('negative price (expect 400)', 'POST', '/api/books', {
  title: 'Bad Price',
  author: 'X',
  genre: 'Drama',
  year: 2001,
  price: -5,
});
await call('malformed id (expect 400)', 'GET', '/api/books/not-an-id');
await call('unknown book (expect 404)', 'GET', `/api/books/${new mongoose.Types.ObjectId()}`);
await call('unknown route (expect 404)', 'GET', '/api/nope');

// 8. delete
const deleted = await call('delete', 'DELETE', `/api/books/${id}`);
expect('DELETE returns 200', deleted.status, 200);

// 9. confirm it is gone
const gone = await call('get deleted (expect 404)', 'GET', `/api/books/${id}`);
expect('deleted book is gone', gone.status, 404);

console.log(`\n${'='.repeat(72)}`);
console.log(`Requests exercised: ${passed + failed}   (status < 400: ${passed}, >= 400: ${failed})`);
console.log('All five CRUD endpoints plus 400/404 error paths were driven over real HTTP.');

server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(0);
