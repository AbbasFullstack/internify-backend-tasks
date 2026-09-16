/**
 * Live end-to-end smoke test for the authentication system (Task 2).
 *
 * Boots a real HTTP server against an in-memory MongoDB and drives the full
 * journey with genuine HTTP calls, printing each request/response pair.
 * This is the artifact that stands in for a Postman run: same requests, same
 * responses, reproducible with one command.
 *
 *   node scripts/auth-smoke-test.js
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri('internify_auth_smoke');
process.env.NODE_ENV = 'test'; // silence morgan so the output stays readable
process.env.PORT = '5056';
process.env.JWT_SECRET = 'smoke-test-secret-that-is-long-enough-to-pass-32';

const { default: app } = await import('../src/app.js');
const { default: User } = await import('../src/models/User.js');
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

  // Redact the token so the console stays readable.
  const shown = JSON.parse(JSON.stringify(payload));
  if (shown?.data?.token) shown.data.token = `${String(shown.data.token).slice(0, 24)}...`;
  if (shown?.data?.user?.password) shown.data.user.password = '[REDACTED]';

  console.log(`\n${'─'.repeat(72)}`);
  console.log(`${method} ${path}   ->   ${res.status} ${res.statusText}${token ? '   [Bearer token]' : ''}`);
  if (body) console.log(`  request body : ${JSON.stringify(body)}`);
  console.log(`  response     : ${JSON.stringify(shown).slice(0, 300)}`);

  return { status: res.status, payload };
};

const expect = (label, actual, expected) => {
  const ok = actual === expected;
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${expected}, got ${actual}`);
  return ok;
};

console.log('\n=== Internify Task 2 — JWT authentication, live end-to-end run ===');

const user = {
  name: 'Abbas Hussain',
  email: 'abbas@example.com',
  password: 'SecurePass123',
};

// ---------------------------------------------------------- 1. validation
console.log('\n--- validation and error paths ---');
const missing = await call('signup missing field', 'POST', '/api/auth/signup', {
  email: user.email,
  password: user.password,
});
expect('signup without name returns 400', missing.status, 400);

const weak = await call('signup weak password', 'POST', '/api/auth/signup', {
  ...user,
  password: '12345678',
});
expect('signup with no letters returns 400', weak.status, 400);

// ------------------------------------------------------------- 2. signup
console.log('\n--- signup -> login -> protected route ---');
const created = await call('signup', 'POST', '/api/auth/signup', user);
expect('signup returns 201', created.status, 201);
expect('signup returns a token', typeof created.payload.data.token, 'string');
expect('signup hides the password', created.payload.data.user.password, undefined);
const signupToken = created.payload.data.token;

// Confirm what actually landed in Mongo.
const stored = await User.findOne({ email: user.email }).select('+password');
console.log(`  stored hash  : ${stored.password.slice(0, 32)}...`);
console.log(`  hash is bcrypt: ${stored.password.startsWith('$2')}   plaintext stored: ${stored.password === user.password}`);

// --------------------------------------------------------- 3. duplicate
const dup = await call('signup duplicate', 'POST', '/api/auth/signup', user);
expect('duplicate email returns 409', dup.status, 409);
expect('duplicate message is friendly', /already exists/i.test(dup.payload.message), true);

// ------------------------------------------------------------- 4. login
const wrong = await call('login wrong password', 'POST', '/api/auth/login', {
  email: user.email,
  password: 'WrongPass123',
});
expect('wrong password returns 401', wrong.status, 401);

const unknown = await call('login unknown email', 'POST', '/api/auth/login', {
  email: 'nobody@example.com',
  password: user.password,
});
expect('unknown email returns 401', unknown.status, 401);
expect(
  'unknown-email and wrong-password messages are identical',
  unknown.payload.message === wrong.payload.message,
  true
);

const loggedIn = await call('login', 'POST', '/api/auth/login', {
  email: user.email,
  password: user.password,
});
expect('login returns 200', loggedIn.status, 200);
expect('login returns a token', typeof loggedIn.payload.data.token, 'string');
const token = loggedIn.payload.data.token;

// --------------------------------------------------------- 5. protected
const noToken = await call('protected without token', 'GET', '/api/auth/me');
expect('protected route without token returns 401', noToken.status, 401);

const badToken = await call('protected with bad token', 'GET', '/api/auth/me', null, 'not.a.real.token');
expect('protected route with a bad token returns 401', badToken.status, 401);

const me = await call('protected profile', 'GET', '/api/auth/me', null, token);
expect('GET /api/auth/me returns 200', me.status, 200);
expect('profile is the right user', me.payload.data.email, user.email);
expect('profile hides the password', me.payload.data.password, undefined);

const dashboard = await call('protected dashboard', 'GET', '/api/protected/dashboard', null, token);
expect('GET /api/protected/dashboard returns 200', dashboard.status, 200);

// The token minted at signup must work without a separate login.
const viaSignupToken = await call('profile via signup token', 'GET', '/api/auth/me', null, signupToken);
expect('signup-issued token works on a protected route', viaSignupToken.status, 200);

// --------------------------------------------- 6. expired / foreign token
console.log('\n--- token integrity ---');
const expired = jwt.sign(
  { sub: stored.id, email: stored.email },
  process.env.JWT_SECRET,
  { expiresIn: '-1s', issuer: 'internify-backend-tasks' }
);
const expiredRes = await call('expired token', 'GET', '/api/auth/me', null, expired);
expect('expired token returns 401', expiredRes.status, 401);

const forged = jwt.sign(
  { sub: stored.id, email: stored.email },
  'a-completely-different-secret-that-is-long-enough',
  { expiresIn: '1h', issuer: 'internify-backend-tasks' }
);
const forgedRes = await call('forged token', 'GET', '/api/auth/me', null, forged);
expect('wrong-secret token returns 401', forgedRes.status, 401);

// 7. deleting the account invalidates its still-valid token.
await User.deleteMany({});
const ghost = await call('token for deleted user', 'GET', '/api/auth/me', null, token);
expect('token for a deleted account returns 401', ghost.status, 401);

console.log(`\n${'='.repeat(72)}`);
console.log(`Checks run: ${passed + failed}   (passed: ${passed}, failed: ${failed})`);
console.log('Flow covered: signup -> login -> protected route, plus 400/401/409 paths.');

server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(failed === 0 ? 0 : 1);
