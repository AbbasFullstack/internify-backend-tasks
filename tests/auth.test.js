/**
 * End-to-end tests for the JWT authentication system (Task 2).
 *
 * Runs against an in-memory MongoDB, so `npm test` needs no local mongod and
 * leaves no data behind. Covers the full flow the brief calls for
 * (signup -> login -> protected route) plus every error path:
 *
 *   400  validation failures
 *   401  invalid credentials, missing / malformed / expired / foreign token
 *   409  duplicate email
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
// Set before the app is imported — the jwt helper validates length on use.
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32';

let mongod;
let app;
let User;

const sample = {
  name: 'Abbas Hussain',
  email: 'abbas@example.com',
  password: 'SecurePass123',
};

/** Sign up and return the parsed response. */
const signup = (overrides = {}) =>
  request(app).post('/api/auth/signup').send({ ...sample, ...overrides });

/** Sign up, then log in, returning a usable token. */
const signupAndLogin = async (overrides = {}) => {
  await signup(overrides);
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: overrides.email ?? sample.email, password: overrides.password ?? sample.password });
  return res.body.data.token;
};

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri('internify_auth_test');

  ({ default: app } = await import('../src/app.js'));
  ({ default: User } = await import('../src/models/User.js'));

  await mongoose.connect(process.env.MONGO_URI);
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
});

// ------------------------------------------------------------------ signup
describe('POST /api/auth/signup', () => {
  test('creates a user, returns 201 with a token and no password hash', async () => {
    const res = await signup();

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.user.name, sample.name);
    assert.equal(res.body.data.user.email, sample.email);
    assert.ok(res.body.data.token, 'expected a token');
    assert.ok(res.body.data.user.id, 'expected a serialized id');

    // The hash must never appear in the response.
    assert.equal(res.body.data.user.password, undefined);
    assert.ok(!JSON.stringify(res.body).includes(sample.password), 'raw password leaked');
  });

  test('stores the password as a bcrypt hash, not plaintext', async () => {
    await signup();

    const stored = await User.findOne({ email: sample.email }).select('+password');
    assert.ok(stored.password.startsWith('$2'), 'expected a bcrypt hash');
    assert.notEqual(stored.password, sample.password);
  });

  test('hashes to a different value each time (unique salt)', async () => {
    await signup();
    await signup({ email: 'second@example.com' });

    const [a, b] = await Promise.all([
      User.findOne({ email: sample.email }).select('+password'),
      User.findOne({ email: 'second@example.com' }).select('+password'),
    ]);

    // Same plaintext, different hash — proves a per-user salt.
    assert.notEqual(a.password, b.password);
  });

  test('lowercases and trims the email so duplicates cannot slip through', async () => {
    const res = await signup({ email: '  MixedCase@Example.COM  ' });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.user.email, 'mixedcase@example.com');
  });

  test('rejects a duplicate email with 409', async () => {
    await signup();
    const res = await signup();

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /already exists/i);
  });

  test('treats a differently-cased duplicate email as a duplicate', async () => {
    await signup();
    const res = await signup({ email: 'ABBAS@EXAMPLE.COM' });

    assert.equal(res.status, 409);
  });

  test('rejects a missing field with 400', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'x@example.com', password: 'SecurePass123' });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /Name is required/);
  });

  test('rejects a short password with 400', async () => {
    const res = await signup({ password: 'Ab1' });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /at least 8 characters/);
  });

  test('rejects a password with no digit with 400', async () => {
    const res = await signup({ password: 'onlyletters' });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /letter and one number/);
  });

  test('rejects an invalid email with 400', async () => {
    const res = await signup({ email: 'not-an-email' });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /valid address/);
  });

  test('rejects an unknown field with 400', async () => {
    const res = await signup({ role: 'admin' });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /Unknown field: role/);
  });
});

// ------------------------------------------------------------------- login
describe('POST /api/auth/login', () => {
  test('returns 200 with a token for correct credentials', async () => {
    await signup();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: sample.email, password: sample.password });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.token);
    assert.equal(res.body.data.user.password, undefined);
  });

  test('accepts a differently-cased email', async () => {
    await signup();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ABBAS@EXAMPLE.COM', password: sample.password });

    assert.equal(res.status, 200);
  });

  test('rejects a wrong password with 401', async () => {
    await signup();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: sample.email, password: 'WrongPass123' });

    assert.equal(res.status, 401);
    assert.match(res.body.message, /Invalid email or password/);
  });

  test('rejects an unknown email with the SAME message as a wrong password', async () => {
    await signup();
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: sample.password });
    const wrongPass = await request(app)
      .post('/api/auth/login')
      .send({ email: sample.email, password: 'WrongPass123' });

    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.message, wrongPass.body.message,
      'messages must match, otherwise the response enumerates registered emails');
  });

  test('rejects a missing password with 400', async () => {
    await signup();
    const res = await request(app).post('/api/auth/login').send({ email: sample.email });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /Password is required/);
  });

  test('does not apply signup password rules at login', async () => {
    // A legacy weak password must still be able to log in.
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'legacy@example.com', password: 'short' });

    // Fails on credentials (401), not on the validator (400).
    assert.equal(res.status, 401);
  });
});

// -------------------------------------------------------------- protected
describe('GET /api/auth/me', () => {
  test('returns the logged-in user with a valid token', async () => {
    const token = await signupAndLogin();
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.email, sample.email);
    assert.equal(res.body.data.password, undefined);
  });

  test('rejects a request with no token with 401', async () => {
    const res = await request(app).get('/api/auth/me');

    assert.equal(res.status, 401);
    assert.match(res.body.message, /Not authorized/);
  });

  test('rejects a malformed Authorization header with 401', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Token abc');

    assert.equal(res.status, 401);
  });

  test('rejects a tampered token with 401', async () => {
    const token = await signupAndLogin();
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token.slice(0, -3)}xyz`);

    assert.equal(res.status, 401);
    assert.match(res.body.message, /Invalid token/);
  });

  test('rejects an expired token with 401', async () => {
    await signup();
    const user = await User.findOne({ email: sample.email });

    const expired = jwt.sign(
      { sub: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '-1s', issuer: 'internify-backend-tasks' }
    );

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expired}`);

    assert.equal(res.status, 401);
    assert.match(res.body.message, /expired/i);
  });

  test('rejects a token signed with the wrong secret with 401', async () => {
    await signup();
    const user = await User.findOne({ email: sample.email });

    const forged = jwt.sign(
      { sub: user.id, email: user.email },
      'an-entirely-different-secret-that-is-long-enough',
      { expiresIn: '1h', issuer: 'internify-backend-tasks' }
    );

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${forged}`);

    assert.equal(res.status, 401);
  });

  test('rejects a valid token whose user was deleted with 401', async () => {
    const token = await signupAndLogin();
    await User.deleteMany({});

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 401);
    assert.match(res.body.message, /no longer exists/);
  });
});

// -------------------------------------------------- protected generic route
describe('GET /api/protected/dashboard', () => {
  test('is reachable with a valid token and greets the caller by name', async () => {
    const token = await signupAndLogin();
    const res = await request(app)
      .get('/api/protected/dashboard')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.match(res.body.data.greeting, /Abbas Hussain/);
  });

  test('is blocked without a token (proves the middleware is reusable)', async () => {
    const res = await request(app).get('/api/protected/dashboard');

    assert.equal(res.status, 401);
  });
});

// ----------------------------------------------------------------- the flow
describe('full flow: signup -> login -> protected route', () => {
  test('a brand-new user can complete the whole journey', async () => {
    // 1. signup
    const created = await signup({ email: 'flow@example.com' });
    assert.equal(created.status, 201);

    // 2. login
    const loggedIn = await request(app)
      .post('/api/auth/login')
      .send({ email: 'flow@example.com', password: sample.password });
    assert.equal(loggedIn.status, 200);
    const { token } = loggedIn.body.data;

    // 3. protected route
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.data.email, 'flow@example.com');

    // 4. and a second protected route, same token
    const dashboard = await request(app)
      .get('/api/protected/dashboard')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(dashboard.status, 200);
  });

  test('the token issued at signup works without a separate login', async () => {
    const created = await signup({ email: 'direct@example.com' });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${created.body.data.token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.email, 'direct@example.com');
  });
});
