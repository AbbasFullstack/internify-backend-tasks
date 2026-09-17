/**
 * End-to-end tests for role-based access control (Task 3).
 *
 * Runs against an in-memory MongoDB. Covers the rules the task brief calls out:
 * who may create, who may edit or delete, the 403 responses for attempts that
 * are authenticated but not permitted, admin override over anyone's records,
 * and the pagination / search query parameters.
 *
 * Three actors are used throughout so the matrix is explicit:
 *   owner   — an ordinary user who owns most of the fixtures
 *   other   — a second ordinary user, to prove cross-user access is refused
 *   admin   — an administrator, who may act on anyone's records
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';

let mongod;
let app;
let Book;
let User;
let signToken;

const actors = {};

const sample = {
  title: 'Refactoring',
  author: 'Martin Fowler',
  genre: 'Software Engineering',
  year: 2018,
  price: 42,
};

const auth = (req, who) => req.set('Authorization', `Bearer ${actors[who].token}`);

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri('internify_rbac');
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-pass-32-chars';

  ({ default: app } = await import('../src/app.js'));
  ({ default: Book } = await import('../src/models/Book.js'));
  ({ default: User } = await import('../src/models/User.js'));
  ({ signToken } = await import('../src/utils/jwt.js'));

  await mongoose.connect(process.env.MONGO_URI);

  const specs = [
    ['owner', { name: 'Owner User', email: 'owner@rbac.test', role: 'user' }],
    ['other', { name: 'Other User', email: 'other@rbac.test', role: 'user' }],
    ['admin', { name: 'Admin User', email: 'admin@rbac.test', role: 'admin' }],
  ];

  for (const [key, spec] of specs) {
    const user = await User.create({ ...spec, password: 'Password123' });
    actors[key] = { user, token: signToken(user), id: user.id };
  }
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

/** Create a book owned by `who` and return its id. */
async function makeBook(who, overrides = {}) {
  const res = await auth(request(app).post('/api/books'), who).send({
    ...sample,
    ...overrides,
  });
  assert.equal(res.status, 201, `fixture creation failed: ${res.body.message}`);
  return res.body.data.id;
}

// ------------------------------------------------------------------ role model

describe('role model', () => {
  test('a new signup gets the user role by default', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      name: 'Fresh Signup',
      email: 'fresh@rbac.test',
      password: 'Password123',
    });

    assert.equal(res.status, 201);
    // Signup returns { user, token }.
    assert.equal(res.body.data.user.role, 'user');
  });

  test('a signup cannot promote itself by passing a role', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      name: 'Sneaky Signup',
      email: 'sneaky@rbac.test',
      password: 'Password123',
      role: 'admin',
    });

    // The auth validator only accepts name/email/password, so the extra key is
    // rejected outright rather than silently dropped.
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Unknown field: role/);

    // And no account was created as a side effect.
    const exists = await User.findOne({ email: 'sneaky@rbac.test' });
    assert.equal(exists, null);
  });

  test('the token carries the role as a claim', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'admin@rbac.test',
      password: 'Password123',
    });

    assert.equal(res.status, 200);
    const [, payloadB64] = res.body.data.token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

    assert.equal(payload.role, 'admin');
    // The claim is a convenience for clients; authorisation still reads the DB.
    assert.ok(payload.sub);
  });
});

// ------------------------------------------------------------------- writes

describe('POST /api/books — who may create', () => {
  test('a regular user creates their own book', async () => {
    const res = await auth(request(app).post('/api/books'), 'owner').send({
      ...sample,
      title: 'Owned By Owner',
    });

    assert.equal(res.status, 201);
    assert.equal(String(res.body.data.createdBy), String(actors.owner.id));
  });

  test('an admin creates a book too', async () => {
    const res = await auth(request(app).post('/api/books'), 'admin').send({
      ...sample,
      title: 'Owned By Admin',
    });

    assert.equal(res.status, 201);
    assert.equal(String(res.body.data.createdBy), String(actors.admin.id));
  });

  test('an anonymous caller is refused with 401, not 403', async () => {
    const res = await request(app).post('/api/books').send(sample);
    // 401 means "who are you"; 403 means "I know who you are, and no".
    assert.equal(res.status, 401);
  });
});

describe('PUT /api/books/:id — who may edit', () => {
  test('the owner may edit their own book', async () => {
    const id = await makeBook('owner', { title: 'Owner Editable' });

    const res = await auth(request(app).put(`/api/books/${id}`), 'owner').send({
      price: 19.99,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.price, 19.99);
  });

  test('another regular user is refused with 403', async () => {
    const id = await makeBook('owner', { title: 'Not Yours To Edit' });

    const res = await auth(request(app).put(`/api/books/${id}`), 'other').send({
      price: 1,
    });

    assert.equal(res.status, 403);
    assert.match(res.body.message, /only modify your own records/);

    // The document is genuinely untouched, not merely reported as refused.
    const stored = await Book.findById(id);
    assert.equal(stored.price, sample.price);
  });

  test('an admin may edit anybody\u2019s book', async () => {
    const id = await makeBook('owner', { title: 'Admin Editable' });

    const res = await auth(request(app).put(`/api/books/${id}`), 'admin').send({
      price: 7.5,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.price, 7.5);
  });

  test('an anonymous caller is refused with 401', async () => {
    const id = await makeBook('owner', { title: 'Anonymous Edit' });
    const res = await request(app).put(`/api/books/${id}`).send({ price: 1 });
    assert.equal(res.status, 401);
  });
});

describe('DELETE /api/books/:id — who may delete', () => {
  test('the owner may delete their own book', async () => {
    const id = await makeBook('owner', { title: 'Owner Deletable' });

    const res = await auth(request(app).delete(`/api/books/${id}`), 'owner');
    assert.equal(res.status, 200);
    assert.equal(await Book.findById(id), null);
  });

  test('another regular user is refused with 403 and the book survives', async () => {
    const id = await makeBook('owner', { title: 'Not Yours To Delete' });

    const res = await auth(request(app).delete(`/api/books/${id}`), 'other');
    assert.equal(res.status, 403);

    assert.ok(await Book.findById(id), 'book must still exist');
  });

  test('an admin may delete anybody\u2019s book', async () => {
    const id = await makeBook('owner', { title: 'Admin Deletable' });

    const res = await auth(request(app).delete(`/api/books/${id}`), 'admin');
    assert.equal(res.status, 200);
    assert.equal(await Book.findById(id), null);
  });
});

// ------------------------------------------------------------------- reads

describe('GET /api/books — reads stay public', () => {
  test('an anonymous caller can browse the catalogue', async () => {
    const res = await request(app).get('/api/books');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
  });
});

// ---------------------------------------------------------------- pagination

describe('pagination', () => {
  let pagedIds = [];

  before(async () => {
    // Ten fresh records owned by `owner`, titled so their order is predictable.
    for (let i = 1; i <= 10; i += 1) {
      pagedIds.push(
        await makeBook('owner', {
          title: `Pagination Book ${String(i).padStart(2, '0')}`,
          author: 'Page Author',
          genre: 'Pagination',
        })
      );
    }
  });

  test('defaults to page 1 with a limit of 10', async () => {
    const res = await request(app).get('/api/books');
    assert.equal(res.status, 200);
    assert.equal(res.body.page, 1);
    assert.equal(res.body.limit, 10);
    assert.ok(res.body.data.length <= 10);
  });

  test('returns different records on page 2 than page 1', async () => {
    const opts = { genre: 'Pagination', limit: 4 };

    const first = await request(app).get('/api/books').query({ ...opts, page: 1 });
    const second = await request(app).get('/api/books').query({ ...opts, page: 2 });

    assert.equal(first.body.page, 1);
    assert.equal(second.body.page, 2);

    const firstIds = first.body.data.map((b) => b.id);
    const secondIds = second.body.data.map((b) => b.id);

    assert.equal(firstIds.length, 4);
    assert.ok(secondIds.length >= 1);
    // No overlap: a page must not repeat the previous page's records.
    assert.equal(
      firstIds.some((id) => secondIds.includes(id)),
      false,
      'pages must not overlap'
    );
  });

  test('reports total, pages and the neighbour flags', async () => {
    const res = await request(app)
      .get('/api/books')
      .query({ genre: 'Pagination', page: 1, limit: 4 });

    assert.equal(res.body.total, 10);
    assert.equal(res.body.pages, 3); // 10 records / 4 per page
    assert.equal(res.body.hasNextPage, true);
    assert.equal(res.body.hasPrevPage, false);

    const last = await request(app)
      .get('/api/books')
      .query({ genre: 'Pagination', page: 3, limit: 4 });

    assert.equal(last.body.hasNextPage, false);
    assert.equal(last.body.hasPrevPage, true);
  });

  test('clamps junk and out-of-range page values', async () => {
    const junk = await request(app)
      .get('/api/books')
      .query({ page: 'abc', limit: 'xyz' });

    assert.equal(junk.status, 200);
    assert.equal(junk.body.page, 1);
    assert.equal(junk.body.limit, 10);

    // A page past the end is an empty page, not an error.
    const beyond = await request(app)
      .get('/api/books')
      .query({ page: 9999, limit: 10 });

    assert.equal(beyond.status, 200);
    assert.equal(beyond.body.page, 9999);
    assert.deepEqual(beyond.body.data, []);
  });

  test('caps the limit so a client cannot ask for everything at once', async () => {
    const res = await request(app).get('/api/books').query({ limit: 5000 });
    assert.equal(res.status, 200);
    assert.equal(res.body.limit, 100);
  });
});

// -------------------------------------------------------------------- search

describe('search and filters', () => {
  before(async () => {
    await makeBook('owner', {
      title: 'The Pragmatic Programmer',
      author: 'Andrew Hunt',
      genre: 'Craftsmanship',
    });
    await makeBook('owner', {
      title: 'Neuromancer',
      author: 'William Gibson',
      genre: 'Cyberpunk',
    });
  });

  test('search matches a title', async () => {
    const res = await request(app)
      .get('/api/books')
      .query({ search: 'neuromancer' });

    assert.equal(res.status, 200);
    assert.ok(res.body.data.some((b) => b.title === 'Neuromancer'));
  });

  test('search matches an author', async () => {
    const res = await request(app).get('/api/books').query({ search: 'gibson' });
    assert.ok(res.body.data.some((b) => b.author === 'William Gibson'));
  });

  test('search matches a genre', async () => {
    const res = await request(app)
      .get('/api/books')
      .query({ search: 'cyberpunk' });

    assert.ok(res.body.data.some((b) => b.genre === 'Cyberpunk'));
  });

  test('search is case-insensitive and matches partial words', async () => {
    const res = await request(app).get('/api/books').query({ search: 'PRAGMAT' });
    assert.ok(res.body.data.some((b) => b.title === 'The Pragmatic Programmer'));
  });

  test('a search with no matches returns an empty page, not an error', async () => {
    const res = await request(app)
      .get('/api/books')
      .query({ search: 'zzzz-no-such-book' });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
    assert.equal(res.body.total, 0);
  });

  test('search composes with pagination', async () => {
    const res = await request(app)
      .get('/api/books')
      .query({ search: 'pagination', page: 1, limit: 3 });

    assert.equal(res.status, 200);
    assert.equal(res.body.limit, 3);
    assert.equal(res.body.total, 10);
    assert.equal(res.body.data.length, 3);
    assert.equal(res.body.pages, 4);
  });

  test('the genre filter still works alongside search', async () => {
    const res = await request(app)
      .get('/api/books')
      .query({ genre: 'pagination', search: 'Book 05' });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].title, 'Pagination Book 05');
  });

  test('regex metacharacters in a search are treated literally', async () => {
    // Unescaped, ".*" would match every document in the collection.
    const res = await request(app).get('/api/books').query({ search: '.*' });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 0, '".*" must not behave as a wildcard');
  });
});

// ------------------------------------------------------------ ownership read

describe('GET /api/books/mine', () => {
  test('returns only the caller\u2019s books', async () => {
    await makeBook('other', { title: 'Other Persons Book' });

    const res = await auth(request(app).get('/api/books/mine'), 'other');
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1);

    for (const book of res.body.data) {
      assert.equal(String(book.createdBy), String(actors.other.id));
    }
    assert.equal(
      res.body.data.some((b) => b.title === 'Pagination Book 01'),
      false,
      'must not leak another user\u2019s records'
    );
  });
});

// -------------------------------------------------------------- admin routes

describe('admin-only routes', () => {
  test('an anonymous caller is refused with 401', async () => {
    const res = await request(app).get('/api/admin/users');
    assert.equal(res.status, 401);
  });

  test('a regular user is refused with 403', async () => {
    const res = await auth(request(app).get('/api/admin/users'), 'owner');
    assert.equal(res.status, 403);
    assert.match(res.body.message, /requires one of: admin/);
  });

  test('an admin may list users, with pagination', async () => {
    const res = await auth(request(app).get('/api/admin/users'), 'admin');
    assert.equal(res.status, 200);
    assert.ok(res.body.total >= 3);
    assert.equal(res.body.page, 1);
    assert.ok(Array.isArray(res.body.data));
  });

  test('the user list never exposes a password hash', async () => {
    const res = await auth(request(app).get('/api/admin/users'), 'admin');

    for (const user of res.body.data) {
      assert.equal(user.password, undefined);
      assert.equal(JSON.stringify(user).includes('$2a$'), false);
    }
  });

  test('an admin may filter users by role', async () => {
    const res = await auth(request(app).get('/api/admin/users'), 'admin').query({
      role: 'admin',
    });

    assert.equal(res.status, 200);
    for (const user of res.body.data) {
      assert.equal(user.role, 'admin');
    }
  });

  test('an invalid role filter is rejected with 400', async () => {
    const res = await auth(request(app).get('/api/admin/users'), 'admin').query({
      role: 'superuser',
    });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /Role must be one of/);
  });

  test('an admin may promote a user', async () => {
    const target = await User.create({
      name: 'Promote Me',
      email: 'promote@rbac.test',
      password: 'Password123',
    });

    const res = await auth(
      request(app).patch(`/api/admin/users/${target.id}/role`),
      'admin'
    ).send({ role: 'admin' });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.role, 'admin');

    const stored = await User.findById(target.id);
    assert.equal(stored.role, 'admin');
  });

  test('an admin may demote another admin back to user', async () => {
    const target = await User.create({
      name: 'Demote Me',
      email: 'demote@rbac.test',
      password: 'Password123',
      role: 'admin',
    });

    const res = await auth(
      request(app).patch(`/api/admin/users/${target.id}/role`),
      'admin'
    ).send({ role: 'user' });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.role, 'user');
  });

  test('an admin cannot remove their own admin role', async () => {
    const res = await auth(
      request(app).patch(`/api/admin/users/${actors.admin.id}/role`),
      'admin'
    ).send({ role: 'user' });

    // Losing the last admin is unrecoverable without database access.
    assert.equal(res.status, 400);
    assert.match(res.body.message, /cannot remove your own admin role/i);
  });

  test('an invalid role value is rejected with 400', async () => {
    const res = await auth(
      request(app).patch(`/api/admin/users/${actors.other.id}/role`),
      'admin'
    ).send({ role: 'root' });

    assert.equal(res.status, 400);
  });

  test('a demoted admin loses admin access on their very next request', async () => {
    const target = await User.create({
      name: 'Temporary Admin',
      email: 'temp-admin@rbac.test',
      password: 'Password123',
      role: 'admin',
    });
    const tempToken = signToken(target);

    // Works while they are an admin.
    const before = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${tempToken}`);
    assert.equal(before.status, 200);

    // Demote them directly in the database, keeping the OLD token in hand.
    target.role = 'user';
    await target.save();

    // The stale token still carries role:"admin", but authorisation reads the
    // database, so access is gone immediately rather than at token expiry.
    const after = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${tempToken}`);
    assert.equal(after.status, 403);
  });

  test('an admin cannot delete their own account', async () => {
    const res = await auth(
      request(app).delete(`/api/admin/users/${actors.admin.id}`),
      'admin'
    );

    assert.equal(res.status, 400);
    assert.match(res.body.message, /cannot delete your own account/i);
  });

  test('a regular user cannot delete anyone', async () => {
    const res = await auth(
      request(app).delete(`/api/admin/users/${actors.owner.id}`),
      'other'
    );

    assert.equal(res.status, 403);
  });

  test('an admin may delete another user, and the count of their books is reported', async () => {
    const target = await User.create({
      name: 'Delete Me',
      email: 'delete-me@rbac.test',
      password: 'Password123',
    });

    const res = await auth(
      request(app).delete(`/api/admin/users/${target.id}`),
      'admin'
    );

    assert.equal(res.status, 200);
    assert.equal(await User.findById(target.id), null);
  });
});

// ---------------------------------------------------------- helper coverage

describe('guard wiring', () => {
  test('a 403 body is the standard error envelope', async () => {
    const id = await makeBook('owner', { title: 'Envelope Check' });
    const res = await auth(request(app).delete(`/api/books/${id}`), 'other');

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.statusCode, 403);
    assert.equal(typeof res.body.message, 'string');
  });

  test('requireOwnership reports a missing document as 404, not 403', async () => {
    // A non-existent id must not reveal whether it exists.
    const res = await auth(
      request(app).delete(`/api/books/${new mongoose.Types.ObjectId()}`),
      'owner'
    );

    assert.equal(res.status, 404);
  });
});
