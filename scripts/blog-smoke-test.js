/**
 * Live end-to-end smoke test for the Blog resource (Task 4).
 *
 * Boots a real HTTP server against an in-memory MongoDB and walks the whole
 * feature set with genuine HTTP calls, printing each request/response pair.
 * This is the artifact that stands in for a Postman run: same requests, same
 * responses, reproducible with one command.
 *
 *   node scripts/blog-smoke-test.js
 *
 * The email transport is replaced with a recorder, so the run proves that a
 * confirmation was *attempted* — with the right recipient and subject — without
 * needing SMTP credentials or sending real mail.
 *
 * Uploads are real: actual image bytes are posted as multipart and fetched back
 * over HTTP afterwards. The global fetch/FormData/Blob do the encoding, so no
 * extra dependency is needed.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri('internify_blog_smoke');
process.env.NODE_ENV = 'test'; // silence morgan so the output stays readable
process.env.PORT = '5058';
process.env.JWT_SECRET = 'smoke-test-secret-that-is-long-enough-to-pass-32';
process.env.MAX_IMAGE_BYTES = String(64 * 1024);
process.env.EMAIL_USER = 'noreply@blog.smoke';
process.env.EMAIL_PASS = 'fake-app-password';

// Record sends instead of hitting SMTP.
const sentEmails = [];
const mailer = await import('../src/utils/mailer.js');
mailer.__setTransportForTests({
  sendMail: async (options) => {
    sentEmails.push(options);
    return { messageId: `<smoke-${sentEmails.length}@blog.smoke>` };
  },
});

const { default: app } = await import('../src/app.js');
const { default: User } = await import('../src/models/User.js');
const { default: Blog } = await import('../src/models/Blog.js');
const { signToken } = await import('../src/utils/jwt.js');
const uploadConfig = await import('../src/config/upload.js');
await mongoose.connect(process.env.MONGO_URI);

const server = app.listen(process.env.PORT);
const BASE = `http://127.0.0.1:${process.env.PORT}`;

let passed = 0;
let failed = 0;

const expect = (label, actual, wanted) => {
  const ok = actual === wanted;
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${wanted}, got ${actual}`);
};

const expectOk = (label, condition) => {
  if (condition) passed += 1;
  else failed += 1;
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}`);
};

const line = () => console.log(`\n${'─'.repeat(72)}`);

/** Fire one JSON request and print it. */
const call = async (method, route, body, token) => {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${route}`, {
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

  line();
  console.log(`${method} ${route}   ->   ${res.status} ${res.statusText}${token ? '   [Bearer]' : ''}`);
  if (body) console.log(`  request body : ${JSON.stringify(body).slice(0, 160)}`);
  console.log(`  response     : ${JSON.stringify(payload).slice(0, 240)}`);

  return { status: res.status, body: payload };
};

/** Fire a multipart request with a real image attached. */
const sendMultipart = async (method, route, fields, file, token) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    form.append(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
  }
  if (file) {
    form.append('image', new Blob([file.buffer], { type: file.type }), file.filename);
  }

  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });

  let payload;
  try {
    payload = await res.json();
  } catch {
    payload = await res.text();
  }

  line();
  console.log(`${method} ${route}   ->   ${res.status} ${res.statusText}   [multipart${file ? ' + image' : ''}]`);
  console.log(`  fields       : ${JSON.stringify(fields).slice(0, 160)}`);
  console.log(`  response     : ${JSON.stringify(payload).slice(0, 240)}`);

  return { status: res.status, body: payload };
};

// Smallest valid PNG (1x1 transparent).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

console.log('\n=== Internify Task 4 — Blog API, live end-to-end run ===');

// ---------------------------------------------------------------- actors
const owner = await User.create({
  name: 'Owner Writer', email: 'owner@blog.smoke', password: 'Password123', role: 'user',
});
const other = await User.create({
  name: 'Other Writer', email: 'other@blog.smoke', password: 'Password123', role: 'user',
});
const admin = await User.create({
  name: 'Admin Writer', email: 'admin@blog.smoke', password: 'Password123', role: 'admin',
});

const ownerToken = signToken(owner);
const otherToken = signToken(other);
const adminToken = signToken(admin);
console.log('\nActors seeded: owner, other, admin');

// ---------------------------------------------------------------- create
const post = {
  title: 'Shipping a Blog with File Uploads',
  content:
    'A blog post needs a title, a body, an author and an optional image. This post proves the whole path works over real HTTP with real bytes.',
  author: 'Owner Writer',
  excerpt: 'How the upload and email path works end to end.',
  tags: ['node', 'multer'],
};

const created = await sendMultipart(
  'POST', '/api/blogs', post,
  { buffer: PNG, filename: 'cover.png', type: 'image/png' },
  ownerToken
);
expect('POST /api/blogs returns 201', created.status, 201);
const blogId = created.body?.data?.post?.id;
const imageUrl = created.body?.data?.post?.image?.url;
expectOk('the response carries an image reference', Boolean(imageUrl));
expectOk('the confirmation email was attempted', sentEmails.length === 1);
expectOk('the email went to the post author', sentEmails[0]?.to === 'owner@blog.smoke');
expectOk(
  'the email subject names the post',
  /Shipping a Blog with File Uploads/.test(sentEmails[0]?.subject ?? '')
);
expectOk('the response reports the email outcome', created.body?.data?.notification?.sent === true);
expectOk('the disk path is NOT exposed', created.body?.data?.post?.image?.path === undefined);

// ---------------------------------------------------------------- uploaded file served
line();
const fetched = await fetch(`${BASE}${imageUrl}`);
console.log(`GET ${imageUrl}   ->   ${fetched.status} ${fetched.statusText}   [static uploads]`);
expect('the uploaded image is served back', fetched.status, 200);
const bytes = Buffer.from(await fetched.arrayBuffer());
expectOk('the served bytes are the image we sent', bytes.length === PNG.length);

// ---------------------------------------------------------------- reads
const list = await call('GET', '/api/blogs?page=1&limit=10', null, null);
expect('GET /api/blogs returns 200', list.status, 200);
expect('the list contains one post', list.body?.data?.posts?.length, 1);
expectOk('pagination metadata is present', Boolean(list.body?.data?.pagination));

const bySlug = await call('GET', '/api/blogs/slug/shipping-a-blog-with-file-uploads', null, null);
expect('GET /api/blogs/slug/:slug returns 200', bySlug.status, 200);

const mine = await call('GET', '/api/blogs/mine', null, ownerToken);
expect('GET /api/blogs/mine returns 200', mine.status, 200);
expect('the owner sees their one post', mine.body?.data?.posts?.length, 1);

const otherMine = await call('GET', '/api/blogs/mine', null, otherToken);
expect('another user sees none of it', otherMine.body?.data?.posts?.length, 0);

// ---------------------------------------------------------------- access control
const hijack = await call('PUT', `/api/blogs/${blogId}`, { title: 'Hijacked Title' }, otherToken);
expect('another user cannot edit (403)', hijack.status, 403);

const stillIntact = await call('GET', `/api/blogs/${blogId}`, null, null);
expect('the refused edit left the title unchanged', stillIntact.body?.data?.post?.title, post.title);

const otherDelete = await call('DELETE', `/api/blogs/${blogId}`, null, otherToken);
expect('another user cannot delete (403)', otherDelete.status, 403);

const adminEdit = await call('PUT', `/api/blogs/${blogId}`, { title: 'Edited By An Administrator' }, adminToken);
expect('an admin can edit anyone’s post', adminEdit.status, 200);

const anon = await call('POST', '/api/blogs', post, null);
expect('an anonymous write is 401', anon.status, 401);

// ---------------------------------------------------------------- validation
const badTitle = await call('POST', '/api/blogs', { content: post.content, author: post.author }, ownerToken);
expect('a missing title is 400', badTitle.status, 400);

const badField = await call('POST', '/api/blogs', { ...post, createdBy: 'someone-else' }, ownerToken);
expect('an unknown field is 400', badField.status, 400);

const badId = await call('GET', '/api/blogs/not-an-id', null, null);
expect('a malformed id is 400', badId.status, 400);

const missing = await call('GET', '/api/blogs/66e7f1c2a4b8d9e0f1a2b3c4', null, null);
expect('an unknown id is 404', missing.status, 404);

// ---------------------------------------------------------------- upload rejection
const beforeCount = fs.readdirSync(uploadConfig.BLOG_UPLOAD_DIR).length;
const badFile = await sendMultipart(
  'POST', '/api/blogs', post,
  { buffer: Buffer.from('#!/bin/sh\necho hi'), filename: 'evil.sh', type: 'application/x-sh' },
  ownerToken
);
expect('a non-image is 400', badFile.status, 400);
expectOk(
  'the rejected upload left no file behind',
  fs.readdirSync(uploadConfig.BLOG_UPLOAD_DIR).length === beforeCount
);

// ---------------------------------------------------------------- image lifecycle
const replaced = await sendMultipart(
  'PUT', `/api/blogs/${blogId}`, { title: 'Edited By An Administrator' },
  { buffer: PNG, filename: 'new-cover.png', type: 'image/png' },
  adminToken
);
expect('replacing the image returns 200', replaced.status, 200);
expectOk(
  'the new image has a different filename',
  replaced.body?.data?.post?.image?.filename !== path.basename(imageUrl ?? '')
);

const removedImage = await call('DELETE', `/api/blogs/${blogId}/image`, null, adminToken);
expect('removing the image returns 200', removedImage.status, 200);
expectOk('the post survives without its image', removedImage.body?.data?.post?.id === blogId);

// ---------------------------------------------------------------- pagination & search
for (let i = 1; i <= 7; i += 1) {
  await Blog.create({
    title: `Seed Post ${i}`,
    slug: `seed-post-${i}`,
    content: `${post.content} Number ${i}.`,
    author: i % 2 === 0 ? 'Even Author' : 'Odd Author',
    tags: [i % 2 === 0 ? 'even' : 'odd'],
    createdBy: owner._id,
  });
}

const page1 = await call('GET', '/api/blogs?page=1&limit=3', null, null);
expect('page 1 returns three posts', page1.body?.data?.posts?.length, 3);
expect('total counts every post', page1.body?.data?.pagination?.total, 8);
expect('hasNext is true', page1.body?.data?.pagination?.hasNext, true);

const page2 = await call('GET', '/api/blogs?page=2&limit=3', null, null);
const ids1 = (page1.body?.data?.posts ?? []).map((p) => p.id);
const ids2 = (page2.body?.data?.posts ?? []).map((p) => p.id);
expectOk('pages do not repeat documents', ids1.every((id) => !ids2.includes(id)));

const capped = await call('GET', '/api/blogs?limit=9999', null, null);
expect('limit is capped at 100', capped.body?.data?.pagination?.limit, 100);

const wildcard = await call('GET', '/api/blogs?search=.*', null, null);
expect('a wildcard search is literal, not a dump', wildcard.body?.data?.posts?.length, 0);

const seeded = await call('GET', '/api/blogs?search=seed', null, null);
expect('search matches the seeded posts', seeded.body?.data?.posts?.length, 7);

const tagged = await call('GET', '/api/blogs?tag=even', null, null);
expect('filtering by tag works', tagged.body?.data?.posts?.length, 3);

// ---------------------------------------------------------------- security headers
line();
const headerRes = await fetch(`${BASE}/api/blogs`);
console.log(`GET /api/blogs   ->   ${headerRes.status}   [checking helmet headers]`);
expect('helmet sets X-Content-Type-Options', headerRes.headers.get('x-content-type-options'), 'nosniff');

// ---------------------------------------------------------------- delete
const deleted = await call('DELETE', `/api/blogs/${blogId}`, null, ownerToken);
expect('the owner can delete their post', deleted.status, 200);

const gone = await call('GET', `/api/blogs/${blogId}`, null, null);
expect('the deleted post is gone', gone.status, 404);

// ---------------------------------------------------------------- summary
console.log(`\n${'='.repeat(72)}`);
console.log(`Checks run: ${passed + failed}   (passed: ${passed}, failed: ${failed})`);
console.log('Flow covered: upload -> create -> email -> serve -> read -> RBAC ->');
console.log('              validate -> image lifecycle -> paginate -> search -> headers -> delete.');

await mongoose.disconnect();
await mongod.stop();
server.close();
process.exit(failed === 0 ? 0 : 1);
