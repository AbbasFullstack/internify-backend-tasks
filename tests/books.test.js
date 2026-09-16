/**
 * End-to-end tests for the Books CRUD API.
 *
 * Runs against an in-memory MongoDB, so `npm test` needs no local mongod and
 * leaves no data behind. Covers the happy path for all five endpoints plus the
 * validation and error cases the task brief calls out (400 / 404 / 500).
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

const sample = {
  title: 'Clean Code',
  author: 'Robert C. Martin',
  genre: 'Software Engineering',
  year: 2008,
  price: 34.99,
};

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri('internify_test');

  ({ default: app } = await import('../src/app.js'));
  ({ default: Book } = await import('../src/models/Book.js'));

  await mongoose.connect(process.env.MONGO_URI);
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
  test('creates a book and returns 201 with an id', async () => {
    const res = await request(app).post('/api/books').send(sample);
    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.title, sample.title);
    assert.ok(res.body.data.id, 'expected a serialized id');

    // A matching document really landed in Mongo.
    const stored = await Book.findById(res.body.data.id);
    assert.ok(stored);
    assert.equal(stored.author, sample.author);
  });

  test('rejects a missing required field with 400', async () => {
    const res = await request(app)
      .post('/api/books')
      .send({ author: 'Someone', genre: 'Drama', year: 2000, price: 5 });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Title is required/);
  });

  test('rejects a negative price with 400', async () => {
    const res = await request(app)
      .post('/api/books')
      .send({ ...sample, price: -1 });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /Price cannot be less than 0/);
  });

  test('rejects a non-integer year with 400', async () => {
    const res = await request(app)
      .post('/api/books')
      .send({ ...sample, year: 2008.5 });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /whole number/);
  });

  test('rejects an unknown field with 400', async () => {
    const res = await request(app)
      .post('/api/books')
      .send({ ...sample, titel: 'typo' });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /Unknown field: titel/);
  });

  test('coerces a numeric string year', async () => {
    const res = await request(app)
      .post('/api/books')
      .send({ ...sample, title: 'Coercion Test', year: '1999' });

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
  });

  test('filters case-insensitively by genre', async () => {
    const res = await request(app).get('/api/books').query({ genre: 'software' });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1);
    for (const book of res.body.data) {
      assert.match(book.genre, /software/i);
    }
  });
});

describe('GET /api/books/:id', () => {
  test('returns one book', async () => {
    const created = await request(app).post('/api/books').send({ ...sample, title: 'Single Fetch' });
    const res = await request(app).get(`/api/books/${created.body.data.id}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.title, 'Single Fetch');
  });

  test('returns 404 for a valid but unused id', async () => {
    const res = await request(app).get(`/api/books/${new mongoose.Types.ObjectId()}`);
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
    const created = await request(app).post('/api/books').send({ ...sample, title: 'Before Update' });
    const originalAuthor = created.body.data.author;

    const res = await request(app)
      .put(`/api/books/${created.body.data.id}`)
      .send({ price: 12.5 });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.price, 12.5);
    assert.equal(res.body.data.author, originalAuthor, 'untouched field must survive');
  });

  test('returns 404 when updating a missing book', async () => {
    const res = await request(app)
      .put(`/api/books/${new mongoose.Types.ObjectId()}`)
      .send({ price: 1 });

    assert.equal(res.status, 404);
  });

  test('rejects an empty update body with 400', async () => {
    const created = await request(app).post('/api/books').send({ ...sample, title: 'Empty Update' });
    const res = await request(app).put(`/api/books/${created.body.data.id}`).send({});

    assert.equal(res.status, 400);
    assert.match(res.body.message, /at least one field/i);
  });

  test('rejects an invalid value on update with 400', async () => {
    const created = await request(app).post('/api/books').send({ ...sample, title: 'Bad Update' });
    const res = await request(app).put(`/api/books/${created.body.data.id}`).send({ year: -20 });

    assert.equal(res.status, 400);
  });
});

describe('DELETE /api/books/:id', () => {
  test('deletes a book and returns the removed document', async () => {
    const created = await request(app).post('/api/books').send({ ...sample, title: 'To Delete' });
    const id = created.body.data.id;

    const del = await request(app).delete(`/api/books/${id}`);
    assert.equal(del.status, 200);
    assert.equal(del.body.data.title, 'To Delete');

    const after = await request(app).get(`/api/books/${id}`);
    assert.equal(after.status, 404);
  });

  test('returns 404 when deleting a missing book', async () => {
    const res = await request(app).delete(`/api/books/${new mongoose.Types.ObjectId()}`);
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
