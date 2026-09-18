/**
 * End-to-end tests for the Blog resource (Task 4).
 *
 * Runs against an in-memory MongoDB. Covers what the brief calls out: file
 * upload, the third-party email call, role-based access, validation, the image
 * lifecycle, pagination and search.
 *
 * The email transport is replaced with a recorder rather than a real SMTP
 * server: the suite asserts *that* a confirmation was attempted, with the right
 * recipient and subject, without credentials and without sending mail. The
 * `__setTransportForTests` seam exists for exactly this.
 *
 * Three actors, as in the RBAC suite:
 *   owner — an ordinary user who owns most fixtures
 *   other — a second ordinary user, to prove cross-user access is refused
 *   admin — an administrator, who may act on anyone's posts
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';

let mongod;
let app;
let Blog;
let User;
let signToken;
let mailer;
let uploadConfig;

const actors = {};
const sentEmails = [];

/** Smallest valid PNG (1x1 transparent) — a real image, not a fake buffer. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const sample = {
  title: 'Shipping a Blog with File Uploads',
  content:
    'A blog post needs a title, a body, an author and an optional image. This post exists to prove the whole path works end to end.',
  author: 'Abbas Hussain',
  excerpt: 'How the upload path works.',
};

const auth = (req, who) => req.set('Authorization', `Bearer ${actors[who].token}`);

/**
 * Post to /api/blogs the way a browser form would.
 *
 * Superagent refuses `.send()` once `.attach()` has been used, so every field
 * goes through `.field()` instead. `tags` is serialised to JSON because a
 * multipart body cannot carry an array natively — which is exactly why the
 * validator accepts a JSON string as well as a comma list.
 */
const postBlog = (who, fields = {}, { image = null } = {}) => {
  let req = auth(request(app).post('/api/blogs'), who);

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    req = req.field(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
  }

  if (image) {
    req = req.attach('image', image.buffer, {
      filename: image.filename,
      contentType: image.contentType || 'image/png',
    });
  }

  return req;
};

/** Same shape for the update route. */
const putBlog = (who, id, fields = {}, { image = null } = {}) => {
  let req = auth(request(app).put(`/api/blogs/${id}`), who);

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    req = req.field(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
  }

  if (image) {
    req = req.attach('image', image.buffer, {
      filename: image.filename,
      contentType: image.contentType || 'image/png',
    });
  }

  return req;
};

const coverImage = (buffer = PNG_1x1, filename = 'cover.png') => ({
  buffer,
  filename,
  contentType: 'image/png',
});

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri('internify_blog');
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-pass-32-chars';
  process.env.MAX_IMAGE_BYTES = String(64 * 1024); // small, but fits the fixture

  ({ default: app } = await import('../src/app.js'));
  ({ default: Blog } = await import('../src/models/Blog.js'));
  ({ default: User } = await import('../src/models/User.js'));
  ({ signToken } = await import('../src/utils/jwt.js'));
  mailer = await import('../src/utils/mailer.js');
  uploadConfig = await import('../src/config/upload.js');

  await mongoose.connect(process.env.MONGO_URI);

  const specs = [
    ['owner', { name: 'Owner Writer', email: 'owner@blog.test', role: 'user' }],
    ['other', { name: 'Other Writer', email: 'other@blog.test', role: 'user' }],
    ['admin', { name: 'Admin Writer', email: 'admin@blog.test', role: 'admin' }],
  ];
  for (const [key, spec] of specs) {
    const user = await User.create({ ...spec, password: 'Password123' });
    actors[key] = { user, token: signToken(user), id: user.id, email: user.email };
  }
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Blog.deleteMany({});
  sentEmails.length = 0;

  // Credentials first, then a fake transport: the mailer builds its real
  // transport lazily, and resetting before setting the fake guarantees the real
  // one is never constructed during the suite.
  process.env.EMAIL_USER = 'noreply@blog.test';
  process.env.EMAIL_PASS = 'fake-app-password';

  mailer.__resetTransportForTests();
  mailer.__setTransportForTests({
    sendMail: async (options) => {
      sentEmails.push(options);
      return { messageId: `<fake-${sentEmails.length}@blog.test>` };
    },
  });
});

/**
 * Create a post owned by `who`, optionally with an image.
 *
 * Always goes through `postBlog` (multipart `.field()`), never `.send()`:
 * superagent rejects `.send()` once `.attach()` has been used, and using one
 * path for every fixture means the image and non-image cases exercise the same
 * request shape the API actually receives.
 */
async function makePost(who, overrides = {}, { image = false } = {}) {
  const res = await postBlog(
    who,
    { ...sample, ...overrides },
    { image: image ? coverImage() : null }
  );
  assert.equal(res.status, 201, `fixture creation failed: ${res.body.message}`);
  return res.body.data.post;
}

// ---------------------------------------------------------------------------
describe('Blog model', () => {
  test('derives a slug from the title', async () => {
    const post = await makePost('owner');
    assert.equal(post.slug, 'shipping-a-blog-with-file-uploads');
  });

  test('collision on a title produces a suffixed slug', async () => {
    const a = await makePost('owner');
    const b = await makePost('owner', { content: `${sample.content} Second one.` });
    assert.equal(a.slug, 'shipping-a-blog-with-file-uploads');
    assert.equal(b.slug, 'shipping-a-blog-with-file-uploads-2');
  });

  test('normalises tags: case, spaces and duplicates', async () => {
    const post = await makePost('owner', { tags: ' Node , EXPRESS ,node ' });
    assert.deepEqual(post.tags, ['node', 'express']);
  });

  test('accepts tags as a JSON array string', async () => {
    const post = await makePost('owner', { tags: '["api","mongo"]' });
    assert.deepEqual(post.tags, ['api', 'mongo']);
  });

  test('exposes an id and hides the disk path', async () => {
    const post = await makePost('owner', {}, { image: true });
    assert.ok(post.id, 'expected an id');
    assert.equal(post.image.path, undefined, 'disk path must never be exposed');
    assert.ok(post.image.url.startsWith('/uploads/blogs/'));
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/blogs — creation and email', () => {
  test('creates a post and returns 201', async () => {
    const res = await postBlog('owner', sample);
    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.post.title, sample.title);
    assert.equal(res.body.data.post.createdBy, actors.owner.id);
  });

  test('sends a confirmation email to the post author', async () => {
    const res = await postBlog('owner', sample);
    assert.equal(res.status, 201);

    assert.equal(sentEmails.length, 1, 'expected exactly one email');
    const mail = sentEmails[0];
    assert.equal(mail.to, actors.owner.email);
    assert.match(mail.subject, /Shipping a Blog with File Uploads/);
    assert.match(mail.text, /published successfully/);
    assert.ok(mail.html.includes(sample.title));
    assert.equal(res.body.data.notification.sent, true);
  });

  test('a post is still created when email is not configured', async () => {
    const savedUser = process.env.EMAIL_USER;
    const savedPass = process.env.EMAIL_PASS;
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASS;
    mailer.__resetTransportForTests();

    try {
      const res = await postBlog('owner', sample);
      assert.equal(res.status, 201, 'email failure must not fail the request');
      assert.equal(res.body.data.notification.sent, false);
      assert.equal(res.body.data.notification.reason, 'not-configured');
      assert.equal(await Blog.countDocuments(), 1, 'the post should exist');
    } finally {
      process.env.EMAIL_USER = savedUser;
      process.env.EMAIL_PASS = savedPass;
    }
  });

  test('an SMTP error does not fail the request', async () => {
    mailer.__resetTransportForTests();
    mailer.__setTransportForTests({
      sendMail: async () => {
        throw new Error('smtp exploded');
      },
    });

    const res = await postBlog('owner', sample);
    assert.equal(res.status, 201);
    assert.equal(res.body.data.notification.sent, false);
    assert.equal(res.body.data.notification.reason, 'error');
    assert.equal(await Blog.countDocuments(), 1);
  });

  test('escapes HTML in the email body', async () => {
    await postBlog('owner', { ...sample, title: '<script>alert(1)</script>' });

    assert.equal(sentEmails.length, 1);
    assert.ok(
      !sentEmails[0].html.includes('<script>'),
      'raw markup must not reach the email HTML'
    );
    assert.ok(sentEmails[0].html.includes('&lt;script&gt;'));
  });

  test('rejects an anonymous request with 401', async () => {
    const res = await request(app).post('/api/blogs').send(sample);
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------------
describe('Image upload', () => {
  test('stores the file and records a reference', async () => {
    const res = await postBlog('owner', sample, { image: coverImage() });

    assert.equal(res.status, 201);
    const { image } = res.body.data.post;
    assert.ok(image, 'expected an image reference');
    assert.equal(image.mimetype, 'image/png');
    assert.ok(image.size > 0);

    const onDisk = path.join(uploadConfig.BLOG_UPLOAD_DIR, image.filename);
    assert.ok(fs.existsSync(onDisk), 'file should exist on disk');
  });

  test('the uploaded file is reachable over HTTP', async () => {
    const res = await postBlog('owner', sample, { image: coverImage() });

    const { url } = res.body.data.post.image;
    const fetched = await request(app).get(url);
    assert.equal(fetched.status, 200);
  });

  test('rejects a non-image file with 400', async () => {
    const res = await postBlog('owner', sample, {
      image: coverImage(Buffer.from('#!/bin/sh\necho hi'), 'evil.sh'),
    });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /Unsupported file type/i);
  });

  test('rejects an image over the size limit with 400', async () => {
    const big = Buffer.alloc(200 * 1024, 1); // 200 KB, limit is 64 KB
    const res = await postBlog('owner', sample, { image: coverImage(big, 'big.png') });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /too large/i);
  });

  test('a rejected upload does not leave an orphan file', async () => {
    const before = fs.readdirSync(uploadConfig.BLOG_UPLOAD_DIR).length;

    // Title too short -> validation fails after the file has been written.
    const res = await postBlog('owner', { title: 'x' }, { image: coverImage() });

    assert.equal(res.status, 400);
    const after = fs.readdirSync(uploadConfig.BLOG_UPLOAD_DIR).length;
    assert.equal(after, before, 'no file should survive a rejected post');
  });

  test('replacing an image deletes the previous file', async () => {
    const post = await makePost('owner', {}, { image: true });
    const first = path.join(uploadConfig.BLOG_UPLOAD_DIR, post.image.filename);
    assert.ok(fs.existsSync(first));

    const res = await putBlog(
      'owner',
      post.id,
      { title: 'Renamed With A New Cover' },
      { image: coverImage() }
    );

    assert.equal(res.status, 200);
    const second = res.body.data.post.image.filename;
    assert.notEqual(second, post.image.filename);
    assert.ok(!fs.existsSync(first), 'the old file should be gone');
  });

  test('deleting a post removes its file', async () => {
    const post = await makePost('owner', {}, { image: true });
    const onDisk = path.join(uploadConfig.BLOG_UPLOAD_DIR, post.image.filename);
    assert.ok(fs.existsSync(onDisk));

    const res = await auth(request(app).delete(`/api/blogs/${post.id}`), 'owner');
    assert.equal(res.status, 200);
    assert.ok(!fs.existsSync(onDisk), 'the file should be gone with the post');
  });

  test('DELETE /:id/image removes the file but keeps the post', async () => {
    const post = await makePost('owner', {}, { image: true });
    const onDisk = path.join(uploadConfig.BLOG_UPLOAD_DIR, post.image.filename);

    const res = await auth(
      request(app).delete(`/api/blogs/${post.id}/image`),
      'owner'
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.post.image, undefined);
    assert.ok(!fs.existsSync(onDisk));
    assert.ok(await Blog.findById(post.id), 'the post itself should remain');
  });
});

// ---------------------------------------------------------------------------
describe('Validation', () => {
  test('missing title is a 400', async () => {
    const res = await postBlog('owner', {
      content: sample.content,
      author: sample.author,
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Title is required/);
  });

  test('short content is a 400', async () => {
    const res = await postBlog('owner', { ...sample, content: 'too short' });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /at least 20 characters/);
  });

  test('unknown fields are rejected, not ignored', async () => {
    const res = await postBlog('owner', { ...sample, createdBy: 'someone-else' });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Unknown field/i);
  });

  test('too many tags is a 400', async () => {
    const res = await postBlog('owner', {
      ...sample,
      tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /more than 10 tags/);
  });

  test('a malformed id is a 400, not a 500', async () => {
    const res = await request(app).get('/api/blogs/not-an-id');
    assert.equal(res.status, 400);
    assert.match(res.body.message, /not a valid blog id/);
  });

  test('an unknown id is a 404', async () => {
    const res = await request(app).get('/api/blogs/66e7f1c2a4b8d9e0f1a2b3c4');
    assert.equal(res.status, 404);
  });
});

// ---------------------------------------------------------------------------
describe('Access control', () => {
  test('reads are public', async () => {
    await makePost('owner');
    const list = await request(app).get('/api/blogs');
    assert.equal(list.status, 200);
    assert.equal(list.body.data.posts.length, 1);
  });

  test("another user cannot edit a post (403)", async () => {
    const post = await makePost('owner');
    const res = await putBlog('other', post.id, { title: 'Hijacked Title' });
    assert.equal(res.status, 403);

    const unchanged = await Blog.findById(post.id);
    assert.equal(unchanged.title, sample.title, 'the write must not have landed');
  });

  test('another user cannot delete a post (403)', async () => {
    const post = await makePost('owner');
    const res = await auth(request(app).delete(`/api/blogs/${post.id}`), 'other');
    assert.equal(res.status, 403);
    assert.ok(await Blog.findById(post.id), 'the post must survive');
  });

  test("an admin can edit anyone's post", async () => {
    const post = await makePost('owner');
    const res = await putBlog('admin', post.id, { title: 'Edited By An Administrator' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.post.title, 'Edited By An Administrator');
  });

  test("GET /mine returns only the caller's posts", async () => {
    await makePost('owner');
    await makePost('other');

    const res = await auth(request(app).get('/api/blogs/mine'), 'owner');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.posts.length, 1);
    assert.equal(res.body.data.posts[0].createdBy, actors.owner.id);
  });

  test('an anonymous write is a 401, not a 403', async () => {
    const res = await request(app).post('/api/blogs').send(sample);
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------------
describe('Pagination and search', () => {
  beforeEach(async () => {
    for (let i = 1; i <= 7; i += 1) {
      await makePost('owner', {
        title: `Seed Post ${i}`,
        content: `${sample.content} Number ${i}.`,
        author: i % 2 === 0 ? 'Even Author' : 'Odd Author',
        tags: i % 2 === 0 ? 'even' : 'odd',
      });
    }
  });

  test('page 1 and page 2 do not overlap', async () => {
    const p1 = await request(app).get('/api/blogs?page=1&limit=3');
    const p2 = await request(app).get('/api/blogs?page=2&limit=3');

    assert.equal(p1.body.data.posts.length, 3);
    assert.equal(p1.body.data.pagination.total, 7);
    assert.equal(p1.body.data.pagination.pages, 3);
    assert.equal(p1.body.data.pagination.hasNext, true);

    const ids1 = p1.body.data.posts.map((p) => p.id);
    const ids2 = p2.body.data.posts.map((p) => p.id);
    assert.equal(ids1.filter((id) => ids2.includes(id)).length, 0, 'pages must not repeat documents');
  });

  test('limit is capped at 100', async () => {
    const res = await request(app).get('/api/blogs?limit=9999');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.pagination.limit, 100);
  });

  test('a page past the end is empty, not an error', async () => {
    const res = await request(app).get('/api/blogs?page=99&limit=3');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.posts.length, 0);
    assert.equal(res.body.data.pagination.hasPrev, true);
    assert.equal(res.body.data.pagination.hasNext, false);
  });

  test('search matches title text', async () => {
    const res = await request(app).get('/api/blogs?search=seed');
    assert.equal(res.body.data.posts.length, 7);
  });

  test('search is regex-escaped, so ".*" is literal', async () => {
    const res = await request(app).get('/api/blogs?search=.*');
    assert.equal(
      res.body.data.posts.length,
      0,
      'a wildcard must not return the whole collection'
    );
  });

  test('filter by tag', async () => {
    const res = await request(app).get('/api/blogs?tag=even');
    assert.equal(res.body.data.posts.length, 3);
  });

  test('filter by author, case-insensitively', async () => {
    const res = await request(app).get('/api/blogs?author=even');
    assert.equal(res.body.data.posts.length, 3);
  });

  test('GET /slug/:slug returns one post', async () => {
    const res = await request(app).get('/api/blogs/slug/seed-post-1');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.post.title, 'Seed Post 1');
  });
});

// ---------------------------------------------------------------------------
describe('Security headers', () => {
  test('helmet headers are present', async () => {
    const res = await request(app).get('/api/blogs');
    // x-content-type-options is one of helmet's defaults and proves it ran.
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });

  test('uploads are served with a permissive CORP so other origins can embed them', async () => {
    const post = await makePost('owner', {}, { image: true });
    const res = await request(app).get(post.image.url);
    assert.equal(res.status, 200);
    assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin');
  });
});
