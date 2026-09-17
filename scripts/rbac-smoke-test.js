/**
 * Live end-to-end smoke test for role-based access control (Task 3).
 *
 * Boots a real HTTP server against an in-memory MongoDB and walks the whole
 * permission matrix with genuine HTTP calls, printing each request/response
 * pair. This is the artifact that stands in for a Postman run: same requests,
 * same responses, reproducible with one command.
 *
 *   node scripts/rbac-smoke-test.js
 *
 * Three actors are used so every allow/deny outcome is visible:
 *   owner   — an ordinary user
 *   other   — a second ordinary user, to prove cross-user writes are refused
 *   admin   — an administrator, who may act on anyone's records
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri('internify_rbac_smoke');
process.env.NODE_ENV = 'test'; // silence morgan so the output stays readable
process.env.PORT = '5057';
process.env.JWT_SECRET = 'smoke-test-secret-that-is-long-enough-to-pass-32';

const { default: app } = await import('../src/app.js');
const { default: User } = await import('../src/models/User.js');
const { default: Book } = await import('../src/models/Book.js');
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

  // Redact tokens so the console stays readable.
  const shown = JSON.parse(JSON.stringify(payload));
  const redact = (t) => (t ? `${String(t).slice(0, 20)}...` : t);
  if (shown?.data?.token) shown.data.token = redact(shown.data.token);
  if (shown?.data?.user?.token) shown.data.user.token = redact(shown.data.user.token);

  console.log(`\n${'─'.repeat(72)}`);
  console.log(
    `${method} ${path}   ->   ${res.status} ${res.statusText}${token ? '   [Bearer token]' : '   [anonymous]'}`
  );
  if (body) console.log(`  request body : ${JSON.stringify(body)}`);
  console.log(`  response     : ${JSON.stringify(shown).slice(0, 280)}`);

  return { status: res.status, payload };
};

const expect = (label, actual, expected) => {
  const ok = actual === expected;
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${expected}, got ${actual}`);
  return ok;
};

console.log('\n=== Internify Task 3 — role-based access control, live end-to-end run ===');

// ------------------------------------------------------------- 1. accounts
console.log('\n--- accounts: signup defaults, admin bootstrap ---');

const signupOwner = await call('signup owner', 'POST', '/api/auth/signup', {
  name: 'Owner User',
  email: 'owner@smoke.test',
  password: 'OwnerPass123',
});
expect('signup returns 201', signupOwner.status, 201);
expect('a new account is a regular user', signupOwner.payload.data.user.role, 'user');
expect('signup hides the password', signupOwner.payload.data.user.password, undefined);
const ownerToken = signupOwner.payload.data.token;

const signupOther = await call('signup other', 'POST', '/api/auth/signup', {
  name: 'Other User',
  email: 'other@smoke.test',
  password: 'OtherPass123',
});
expect('second signup returns 201', signupOther.status, 201);
const otherToken = signupOther.payload.data.token;

// Privilege escalation attempt: a role in the signup body must be refused.
const escalate = await call('signup trying to self-promote', 'POST', '/api/auth/signup', {
  name: 'Sneaky User',
  email: 'sneaky@smoke.test',
  password: 'SneakyPass123',
  role: 'admin',
});
expect('a role in the signup body is rejected with 400', escalate.status, 400);
expect(
  'no account was created by the rejected signup',
  await User.countDocuments({ email: 'sneaky@smoke.test' }),
  0
);

// The bootstrap script path: create the admin directly.
const admin = await User.create({
  name: 'Admin User',
  email: 'admin@smoke.test',
  password: 'AdminPass123',
  role: 'admin',
});
const loginAdmin = await call('login admin', 'POST', '/api/auth/login', {
  email: 'admin@smoke.test',
  password: 'AdminPass123',
});
expect('admin login returns 200', loginAdmin.status, 200);
const adminToken = loginAdmin.payload.data.token;

const [, adminPayloadB64] = adminToken.split('.');
const adminClaims = JSON.parse(Buffer.from(adminPayloadB64, 'base64url').toString());
console.log(`  admin token claims : role=${adminClaims.role}, sub=${adminClaims.sub}`);
expect('the token carries the role claim', adminClaims.role, 'admin');

// --------------------------------------------------------------- 2. create
console.log('\n--- who may create ---');

const anonCreate = await call('create anonymously', 'POST', '/api/books', {
  title: 'Anonymous Book',
  author: 'Nobody',
  genre: 'Test',
  year: 2020,
  price: 10,
});
expect('anonymous create returns 401', anonCreate.status, 401);

const ownerCreate = await call(
  'create as owner',
  'POST',
  '/api/books',
  { title: 'Clean Code', author: 'Robert C. Martin', genre: 'Software Engineering', year: 2008, price: 34.99 },
  ownerToken
);
expect('owner create returns 201', ownerCreate.status, 201);
expect(
  'the creator is recorded as owner',
  String(ownerCreate.payload.data.createdBy),
  String(signupOwner.payload.data.user.id)
);
const ownerBookId = ownerCreate.payload.data.id;

const forge = await call(
  'create with a forged owner',
  'POST',
  '/api/books',
  { title: 'Forged', author: 'X', genre: 'Y', year: 2020, price: 1, createdBy: String(admin.id) },
  ownerToken
);
expect('a createdBy in the body is rejected with 400', forge.status, 400);

// seed a few more so pagination and search have something to work with
for (let i = 1; i <= 12; i += 1) {
  await call(
    `seed book ${i}`,
    'POST',
    '/api/books',
    {
      title: `Pagination Book ${String(i).padStart(2, '0')}`,
      author: 'Page Author',
      genre: 'Pagination',
      year: 2020,
      price: 10 + i,
    },
    ownerToken
  );
}

// ----------------------------------------------------------- 3. permission
console.log('\n--- who may edit and delete ---');

const ownerEdit = await call(
  'owner edits own book',
  'PUT',
  `/api/books/${ownerBookId}`,
  { price: 29.99 },
  ownerToken
);
expect('owner edit returns 200', ownerEdit.status, 200);
expect('the new price is applied', ownerEdit.payload.data.price, 29.99);

const otherEdit = await call(
  'other user edits someone else\u2019s book',
  'PUT',
  `/api/books/${ownerBookId}`,
  { price: 1 },
  otherToken
);
expect('a non-owner edit returns 403', otherEdit.status, 403);

const survived = await Book.findById(ownerBookId);
expect('the refused edit did not change the document', survived.price, 29.99);

const adminEdit = await call(
  'admin edits someone else\u2019s book',
  'PUT',
  `/api/books/${ownerBookId}`,
  { price: 15.5 },
  adminToken
);
expect('admin override edit returns 200', adminEdit.status, 200);
expect('the admin edit is applied', adminEdit.payload.data.price, 15.5);

const otherDelete = await call(
  'other user deletes someone else\u2019s book',
  'DELETE',
  `/api/books/${ownerBookId}`,
  null,
  otherToken
);
expect('a non-owner delete returns 403', otherDelete.status, 403);
expect('the book survives the refused delete', Boolean(await Book.findById(ownerBookId)), true);

// ------------------------------------------------------------------ 4. read
console.log('\n--- reads stay public ---');

const publicList = await call('list anonymously', 'GET', '/api/books');
expect('anonymous list returns 200', publicList.status, 200);
expect('the list has results', publicList.payload.total >= 1, true);

const mine = await call('my books', 'GET', '/api/books/mine', null, ownerToken);
expect('GET /api/books/mine returns 200', mine.status, 200);
const mineOwnedByCaller = mine.payload.data.every(
  (b) => String(b.createdBy) === String(signupOwner.payload.data.user.id)
);
expect('every book returned by /mine is owned by the caller', mineOwnedByCaller, true);

// ------------------------------------------------------------ 5. pagination
console.log('\n--- pagination ---');

const page1 = await call('page 1, limit 5', 'GET', '/api/books?page=1&limit=5');
expect('page 1 returns 200', page1.status, 200);
expect('page 1 reports page=1', page1.payload.page, 1);
expect('page 1 honours the limit', page1.payload.data.length, 5);
expect('page 1 has a next page', page1.payload.hasNextPage, true);

const page2 = await call('page 2, limit 5', 'GET', '/api/books?page=2&limit=5');
expect('page 2 returns 200', page2.status, 200);
expect('page 2 reports page=2', page2.payload.page, 2);

const p1 = page1.payload.data.map((b) => b.id);
const p2 = page2.payload.data.map((b) => b.id);
expect('pages do not overlap', p1.some((id) => p2.includes(id)), false);

const clamped = await call('absurd limit', 'GET', '/api/books?limit=9999');
expect('an absurd limit is capped at 100', clamped.payload.limit, 100);

const junk = await call('junk page value', 'GET', '/api/books?page=abc');
expect('a junk page falls back to 1', junk.payload.page, 1);

// ---------------------------------------------------------------- 6. search
console.log('\n--- search and filters ---');

const byTitle = await call('search by title', 'GET', '/api/books?search=clean+code');
expect('title search returns 200', byTitle.status, 200);
expect('title search finds the book', byTitle.payload.data.some((b) => b.title === 'Clean Code'), true);

const byAuthor = await call('search by author', 'GET', '/api/books?search=martin');
expect('author search finds the book', byAuthor.payload.data.some((b) => /Martin/i.test(b.author)), true);

const byGenre = await call('search by genre', 'GET', '/api/books?search=software');
expect('genre search finds the book', byGenre.payload.data.some((b) => /software/i.test(b.genre)), true);

const partial = await call('partial word', 'GET', '/api/books?search=pagination');
expect('a partial word matches', partial.payload.total >= 10, true);

const withPaging = await call('search with pagination', 'GET', '/api/books?search=pagination&limit=3');
expect('search composes with pagination', withPaging.payload.data.length, 3);

const noMatch = await call('search with no matches', 'GET', '/api/books?search=zzzz-nothing');
expect('a search with no matches returns 200', noMatch.status, 200);
expect('a search with no matches is an empty page', noMatch.payload.total, 0);

const wildcard = await call('regex wildcard', 'GET', '/api/books?search=.*');
expect('a regex wildcard is treated literally', wildcard.payload.total, 0);

// ----------------------------------------------------------- 7. admin only
console.log('\n--- admin-only routes ---');

const anonAdmin = await call('admin route anonymously', 'GET', '/api/admin/users');
expect('anonymous admin route returns 401', anonAdmin.status, 401);

const userAdmin = await call('admin route as a regular user', 'GET', '/api/admin/users', null, ownerToken);
expect('a regular user gets 403', userAdmin.status, 403);

const adminList = await call('admin lists users', 'GET', '/api/admin/users', null, adminToken);
expect('an admin lists users with 200', adminList.status, 200);
expect('the user list is paginated', typeof adminList.payload.page, 'number');

const leaksHash = JSON.stringify(adminList.payload).includes('$2a$');
expect('the user list never leaks a password hash', leaksHash, false);

const roleFilter = await call('filter users by role', 'GET', '/api/admin/users?role=admin', null, adminToken);
expect('role filter returns only admins', roleFilter.payload.data.every((u) => u.role === 'admin'), true);

const promote = await call(
  'promote the other user',
  'PATCH',
  `/api/admin/users/${signupOther.payload.data.user.id}/role`,
  { role: 'admin' },
  adminToken
);
expect('promoting a user returns 200', promote.status, 200);
expect('the user is now an admin', promote.payload.data.role, 'admin');

const demote = await call(
  'demote them again',
  'PATCH',
  `/api/admin/users/${signupOther.payload.data.user.id}/role`,
  { role: 'user' },
  adminToken
);
expect('demoting returns 200', demote.status, 200);
expect('the user is back to user', demote.payload.data.role, 'user');

const selfDemote = await call(
  'admin demotes themselves',
  'PATCH',
  `/api/admin/users/${admin.id}/role`,
  { role: 'user' },
  adminToken
);
expect('self-demotion is refused with 400', selfDemote.status, 400);

const selfDelete = await call(
  'admin deletes their own account',
  'DELETE',
  `/api/admin/users/${admin.id}`,
  null,
  adminToken
);
expect('self-deletion is refused with 400', selfDelete.status, 400);

// ------------------------------------------- 8. stale token after demotion
console.log('\n--- a demoted admin loses access immediately ---');

const tempAdmin = await User.create({
  name: 'Temporary Admin',
  email: 'temp-admin@smoke.test',
  password: 'TempPass123',
  role: 'admin',
});
const tempLogin = await call('login the temporary admin', 'POST', '/api/auth/login', {
  email: 'temp-admin@smoke.test',
  password: 'TempPass123',
});
const tempToken = tempLogin.payload.data.token;

const tempAllowed = await call('temp admin uses an admin route', 'GET', '/api/admin/users', null, tempToken);
expect('the temp admin is allowed while an admin', tempAllowed.status, 200);

// Demote in the database, keeping the OLD token in hand.
tempAdmin.role = 'user';
await tempAdmin.save();

const tempDenied = await call(
  'the same token after demotion',
  'GET',
  '/api/admin/users',
  null,
  tempToken
);
expect('the stale admin token is now refused with 403', tempDenied.status, 403);

console.log(`\n${'='.repeat(72)}`);
console.log(`Checks run: ${passed + failed}   (passed: ${passed}, failed: ${failed})`);
console.log('Matrix covered: anonymous / user / other-user / admin, across create, read,');
console.log('update, delete, pagination, search and the admin-only routes.');

server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(failed === 0 ? 0 : 1);
