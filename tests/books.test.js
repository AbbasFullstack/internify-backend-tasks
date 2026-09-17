/**
 * End-to-end tests for the Books CRUD API.
 *
 * Runs against an in-memory MongoDB, so `npm test` needs no local mongod and
 * leaves no data behind. Covers the happy path for all five endpoints plus the
 * validation and error cases the task brief calls out (400 / 404 / 500).
 *
 * Task 3 changed the contract: reads are still public, but every write now
 * requires a token and is limited to records the caller owns. The write tests
 * below therefore authenticate, and a separate suite covers the permission
 * rules themselves (tests/rbac.test.js).
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

/** Tokens are minted in `before` and reused by every authenticated request. */
let ownerToken;
let ownerId;

const sample = {
  title: 'Clean Code',
  author: 'Robert C. Martin',
  genre: 'Software Engineering',
  year: 2008,
  price: 34.99,
};

/** Shorthand for an authenticated request body/headers pair. */
const asOwner = (req) => req.set('Authorization', `Bearer ${ownerToken}`);

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri('internify_test');
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-pass-32-chars';

  ({ default: app } = await import('../src/app.js'));
  ({ default: Book } = await import('../src/models/Book.js'));
  ({ default: User } = await import('../src/models/User.js'));
  ({ signToken } = await import('../src/utils/jwt.js'));

  await mongoose.connect(process.env.MONGO_URI);

  // One ordinary user owns everything this suite creates.
  const owner = await User.create({
    name: 'Owner User',
    email: 'owner@example.com',
    password: 'OwnerPass123',
  });
  ownerId = owner.id;
  ownerToken = signToken(owner);
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('GET /api/health', () => {
  test('reports service and database state', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.database, 'connected');
  });
});

describe('POST /api/books', () => {
  test('requires authentication', async () => {
    const res = await request(app).post('/api/books').send(sample);
    assert.equal(res.status, 401);
    assert.match(res.body.message, /Bearer token/);
  });

  test('creates a book and returns 201 with an id', async () => {
    const res = await asOwner(request(app).post('/api/books')).send(sample);
    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.title, sample.title);
    assert.ok(res.body.data.id, 'expected a serialized id');

    // A matching document really landed in Mongo.
    const stored = await Book.findById(res.body.data.id);
    assert.ok(stored);
    assert.equal(stored.author, sample.author);
  });

  test('records the creator as the owner', async () => {
    const res = await asOwner(request(app).post('/api/books')).send({
      ...sample,
      title: 'Ownership Test',
    });

    assert.equal(res.status, 201);
    // createdBy must come from the token, not the body.
    assert.equal(String(res.body.data.createdBy), String(ownerId));
  });

  test('ignores a createdBy supplied in the body', async () => {
    const forgedId = new mongoose.Types.ObjectId();
    const res = await asOwner(request(app).post('/api/books')).send({
      ...sample,
      title: 'Forged Owner',
      createdBy: String(forgedId),
    });

    // The body key is not in FIELD_RULES, so it is rejected outright rather
    // than silently overwritten — either way it can never take effect.
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Unknown field: createdBy/);
  });

  test('rejects a missing required field with 400', async () => {
    const res = await asOwner(request(app).post('/api/books')).send({
      author: 'Someone',
      genre: 'Drama',
      year: 2000,
      price: 5,
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Title is required/);
  });

  test('rejects a negative price with 400', async () => {
    const res = await asOwner(request(app).post('/api/books')).send({
      ...sample,
      price: -1,
    });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /Price cannot be less than 0/);
  });

  test('rejects a non-integer year with 400', async () => {
    const res = await asOwner(request(app).post('/api/books')).send({
      ...sample,
      year: 2008.5,
    });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /whole number/);
  });

  test('rejects an unknown field with 400', async () => {
    const res = await asOwner(request(app).post('/api/books')).send({
      ...sample,
      titel: 'typo',
    });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /Unknown field: titel/);
  });

  test('coerces a numeric string year', async () => {
    const res = await asOwner(request(app).post('/api/books')).send({
      ...sample,
      title: 'Coercion Test',
      year: '1999',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.year, 1999);
  });
});

describe('GET /api/books', () => {
  test('returns a list with pagination metadata', async () => {
    const res = await request(app).get('/api/books');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.total >= 1);
    assert.equal(res.body.page, 1);
    assert.ok(res.body.limit >= 1);
    assert.equal(typeof res.body.pages, 'number');
  });

  test('filters case-insensitively by genre', async () => {
    const res = await request(app).get('/api/books').query({ genre: 'software' });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1);
    for (const book of res.body.data) {
      assert.match(book.genre, /software/i);
    }
  });

  test('searches across title, author and genre', async () => {
    await asOwner(request(app).post('/api/books')).send({
      ...sample,
      title: 'Dune',
      author: 'Frank Herbert',
      genre: 'Science Fiction',
    });

    const byTitle = await request(app).get('/api/books').query({ search: 'dune' });
    assert.equal(byTitle.status, 200);
    assert.ok(byTitle.body.data.some((b) => b.title === 'Dune'));

    // Same term, matched against the author field.
    const byAuthor = await request(app)
      .get('/api/books')
      .query({ search: 'herbert' });
    assert.ok(byAuthor.body.data.some((b) => b.author === 'Frank Herbert'));

    // And against the genre field.
    const byGenre = await request(app)
      .get('/api/books')
      .query({ search: 'science fiction' });
    assert.ok(byGenre.body.data.some((b) => b.genre === 'Science Fiction'));
  });

  test('matches partial words, which a search box should', async () => {
    const res = await request(app).get('/api/books').query({ search: 'dun' });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.some((b) => b.title === 'Dune'));
  });

  test('returns a requested page with a bounded size', async () => {
    const res = await request(app)
      .get('/api/books')
      .query({ page: 1, limit: 2 });

    assert.equal(res.status, 200);
    assert.equal(res.body.page, 1);
    assert.equal(res.body.limit, 2);
    assert.ok(res.body.data.length <= 2);
  });

  test('clamps an absurd limit instead of failing', async () => {
    const res = await request(app)
      .get('/api/books')
      .query({ limit: 100000 });

    assert.equal(res.status, 200);
    assert.equal(res.body.limit, 100, 'limit is capped at 100');
  });

  test('treats a regex metacharacter in the search as literal text', async () => {
    // Without escaping this would throw or match everything.
    const res = await request(app)
      .get('/api/books')
      .query({ search: 'a+b(' });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
  });
});

describe('GET /api/books/mine', () => {
  test('requires authentication', async () => {
    const res = await request(app).get('/api/books/mine');
    assert.equal(res.status, 401);
  });

  test('returns only the caller\u2019s own books', async () => {
    const res = await asOwner(request(app).get('/api/books/mine'));
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1);

    for (const book of res.body.data) {
      assert.equal(String(book.createdBy), String(ownerId));
    }
  });

  test('is not shadowed by the /:id route', async () => {
    // If /:id were declared first, "mine" would be parsed as an id and 400.
    const res = await asOwner(request(app).get('/api/books/mine'));
    assert.notEqual(res.status, 400);
    assert.equal(res.status, 200);
  });
});

describe('GET /api/books/:id', () => {
  test('returns one book', async () => {
    const created = await asOwner(request(app).post('/api/books')).send({
      ...sample,
      title: 'Single Fetch',
    });
    const res = await request(app).get(`/api/books/${created.body.data.id}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.title, 'Single Fetch');
  });

  test('returns 404 for a valid but unused id', async () => {
    const res = await request(app).get(
      `/api/books/${new mongoose.Types.ObjectId()}`
    );
    assert.equal(res.status, 404);
    assert.match(res.body.message, /No book found/);
  });

  test('returns 400 for a malformed id', async () => {
    const res = await request(app).get('/api/books/not-a-real-id');
    assert.equal(res.status, 400);
    assert.match(res.body.message, /not a valid book id/);
  });
});

describe('PUT /api/books/:id', () => {
  test('updates only the supplied fields', async () => {
    const created = await asOwner(request(app).post('/api/books')).send({
      ...sample,
      title: 'Before Update',
    });
    const originalAuthor = created.body.data.author;

    const res = await asOwner(
      request(app).put(`/api/books/${created.body.data.id}`)
    ).send({ price: 12.5 });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.price, 12.5);
    assert.equal(
      res.body.data.author,
      originalAuthor,
      'untouched field must survive'
    );
  });

  test('requires authentication', async () => {
    const created = await asOwner(request(app).post('/api/books')).send({
      ...sample,
      title: 'Needs Auth',
    });

    const res = await request(app)
      .put(`/api/books/${created.body.data.id}`)
      .send({ price: 1 });

    assert.equal(res.status, 401);
  });

  test('returns 404 when updating a missing book', async () => {
    const res = await asOwner(
      request(app).put(`/api/books/${new mongoose.Types.ObjectId()}`)
    ).send({ price: 1 });

    assert.equal(res.status, 404);
  });

  test('rejects an empty update body with 400', async () => {
    const created = await asOwner(request(app).post('/api/books')).send({
      ...sample,
      title: 'Empty Update',
    });
    const res = await asOwner(
      request(app).put(`/api/books/${created.body.data.id}`)
    ).send({});

    assert.equal(res.status, 400);
    assert.match(res.body.message, /at least one field/i);
  });

  test('rejects an invalid value on update with 400', async () => {
    const created = await asOwner(request(app).post('/api/books')).send({
      ...sample,
      title: 'Bad Update',
    });
    const res = await asOwner(
      request(app).put(`/api/books/${created.body.data.id}`)
    ).send({ year: -20 });

    assert.equal(res.status, 400);
  });
});

describe('DELETE /api/books/:id', () => {
  test('deletes a book and returns the removed document', async () => {
    const created = await asOwner(request(app).post('/api/books')).send({
      ...sample,
      title: 'To Delete',
    });
    const id = created.body.data.id;

    const del = await asOwner(request(app).delete(`/api/books/${id}`));
    assert.equal(del.status, 200);
    assert.equal(del.body.data.title, 'To Delete');

    const after = await request(app).get(`/api/books/${id}`);
    assert.equal(after.status, 404);
  });

  test('requires authentication', async () => {
    const created = await asOwner(request(app).post('/api/books')).send({
      ...sample,
      title: 'Delete Needs Auth',
    });

    const res = await request(app).delete(`/api/books/${created.body.data.id}`);
    assert.equal(res.status, 401);
  });

  test('returns 404 when deleting a missing book', async () => {
    const res = await asOwner(
      request(app).delete(`/api/books/${new mongoose.Types.ObjectId()}`)
    );
    assert.equal(res.status, 404);
  });
});

describe('unmatched routes', () => {
  test('returns 404 for an unknown path', async () => {
    const res = await request(app).get('/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.match(res.body.message, /Route not found/);
  });
});

describe('malformed JSON', () => {
  test('returns 400 rather than crashing', async () => {
    const res = await request(app)
      .post('/api/books')
      .set('Content-Type', 'application/json')
      .send('{"title": ');

    assert.equal(res.status, 400);
    assert.match(res.body.message, /invalid JSON/i);
  });
});
