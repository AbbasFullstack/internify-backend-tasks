# Internify Backend Internship — Tasks

Backend development internship tasks for **Internify**.
Abbas Hussain · [github.com/AbbasFullstack](https://github.com/AbbasFullstack)

| Task | Topic | Status |
|------|-------|--------|
| 1 | RESTful CRUD API — Books (Node.js, Express, MongoDB, Mongoose) | ✅ Complete |
| 2 | User authentication — signup / login with JWT + bcrypt | ✅ Complete |
| 3 | Role-based access control — roles, ownership, pagination, search | ✅ Complete |
| 4 | TBD | ⏳ Pending |

---

# Task 1 — RESTful API for a Simple CRUD Resource

A production-shaped Express + MongoDB API for a **Books** resource: full CRUD,
per-field input validation, a central error handler, and an MVC folder layout.

## Tech stack

- **Node.js** (ES Modules, Node 18+)
- **Express 4** — HTTP layer
- **MongoDB** + **Mongoose 8** — data layer
- **bcryptjs** — password hashing (Task 2)
- **jsonwebtoken** — signed access tokens (Task 2)
- **dotenv** — configuration
- **morgan**, **cors** — request logging and cross-origin access

## Project structure

```
internify-backend-tasks/
├── server.js                     # entry point: env, DB connect, listen, shutdown
├── package.json
├── .env.example                  # template — copy to .env
├── .gitignore
├── src/
│   ├── app.js                    # Express wiring (exported for tests)
│   ├── config/
│   │   └── db.js                 # Mongoose connection
│   ├── models/
│   │   ├── Book.js               # schema, types, validators, indexes
│   │   └── User.js               # user schema, role enum, bcrypt pre-save hook
│   ├── controllers/
│   │   ├── bookController.js     # CRUD logic, pagination, search
│   │   ├── authController.js     # signup, login, getMe
│   │   └── adminController.js    # user list, role change, delete (admin only)
│   ├── routes/
│   │   ├── bookRoutes.js         # URL -> middleware -> controller
│   │   ├── authRoutes.js         # /api/auth
│   │   ├── protectedRoutes.js    # /api/protected (JWT-guarded)
│   │   └── adminRoutes.js        # /api/admin (admin-only, one guard for the router)
│   ├── middleware/
│   │   ├── validateBook.js       # body + ObjectId validation
│   │   ├── validateAuth.js       # signup / login body validation
│   │   ├── authMiddleware.js     # reusable `protect` JWT guard
│   │   ├── roleMiddleware.js     # restrictTo(), requireOwnership(), loadResource()
│   │   └── errorHandler.js       # 404 + central error handler
│   └── utils/
│       ├── AppError.js           # error with an HTTP status code
│       ├── asyncHandler.js       # forwards async rejections to Express
│       └── jwt.js                # sign / verify / extract Bearer token
├── postman/
│   ├── Internify-Task1-Books.postman_collection.json
│   ├── Internify-Task2-Auth.postman_collection.json
│   └── Internify-Task3-RBAC.postman_collection.json
├── scripts/
│   ├── smoke-test.js             # live HTTP run of every Books endpoint
│   ├── auth-smoke-test.js        # live HTTP run of the whole auth flow
│   ├── rbac-smoke-test.js        # live HTTP run of the permission matrix
│   └── make-admin.js             # create/promote the first administrator
└── tests/
    ├── books.test.js             # 33 automated tests (in-memory MongoDB)
    ├── auth.test.js              # 28 automated tests (in-memory MongoDB)
    └── rbac.test.js              # 44 automated tests (in-memory MongoDB)
```

## Getting started

```bash
# 1. install
npm install

# 2. configure
cp .env.example .env      # then edit MONGO_URI if needed

# 3. run
npm run dev               # nodemon, auto-restart
# or
npm start
```

The server starts on `http://localhost:5000` by default.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | HTTP port |
| `NODE_ENV` | `development` | `development` includes stack traces in error responses |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/internify_books` | MongoDB connection string |
| `JWT_SECRET` | — (required) | Secret used to sign and verify access tokens. **Must be at least 32 characters** — the app refuses to sign or verify with anything shorter |
| `JWT_EXPIRES_IN` | `1h` | Token lifetime. Accepts `60s`, `15m`, `1h`, `7d`, or a plain number of seconds |

`.env` is git-ignored. Only `.env.example` is committed.

Generate a JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Data model

| Field | Type | Required | Rules |
|---|---|---|---|
| `title` | String | ✅ | trimmed, 1–200 chars |
| `author` | String | ✅ | trimmed, 1–120 chars |
| `genre` | String | ✅ | trimmed, 1–80 chars |
| `year` | Number | ✅ | integer, 1450 – current year + 1 |
| `price` | Number | ✅ | ≥ 0 |
| `createdAt` / `updatedAt` | Date | auto | from `timestamps: true` |

Indexes on `author`, `genre`, and `createdAt` support the common filtered reads.

## API reference

Base URL: `http://localhost:5000`

### Response envelope

Success:
```json
{ "success": true, "message": "...", "data": { } }
```
Failure:
```json
{ "success": false, "statusCode": 400, "message": "Title is required" }
```

### `GET /` — service index

Lists every available endpoint.

### `GET /api/health` — health check

```json
{ "success": true, "message": "Service healthy", "uptime": 12.34,
  "environment": "development", "database": "connected" }
```

### `POST /api/books` — create

```bash
curl -X POST http://localhost:5000/api/books \
  -H "Content-Type: application/json" \
  -d '{"title":"Clean Code","author":"Robert C. Martin","genre":"Software Engineering","year":2008,"price":34.99}'
```

**201 Created**
```json
{
  "success": true,
  "message": "Book created successfully",
  "data": {
    "title": "Clean Code",
    "author": "Robert C. Martin",
    "genre": "Software Engineering",
    "year": 2008,
    "price": 34.99,
    "createdAt": "2026-09-16T06:30:00.000Z",
    "updatedAt": "2026-09-16T06:30:00.000Z",
    "id": "66e7f1c2a4b8d9e0f1a2b3c4"
  }
}
```

### `GET /api/books` — list

Optional query parameters:

| Param | Example | Notes |
|---|---|---|
| `author` | `?author=martin` | case-insensitive partial match |
| `genre` | `?genre=software` | case-insensitive partial match |
| `sort` | `?sort=-createdAt` | any Mongoose sort string |
| `page` | `?page=2` | default `1` |
| `limit` | `?limit=10` | default `50`, max `100` |

```json
{ "success": true, "message": "Books fetched successfully",
  "count": 2, "total": 2, "page": 1, "pages": 1, "data": [ ] }
```

### `GET /api/books/:id` — fetch one

**200 OK** with the book, or **404** if no book has that id.
A malformed id (not a 24-char hex string) returns **400**.

### `PUT /api/books/:id` — update

Send only the fields you want to change; everything else is preserved.

```bash
curl -X PUT http://localhost:5000/api/books/66e7f1c2a4b8d9e0f1a2b3c4 \
  -H "Content-Type: application/json" \
  -d '{"price":29.99}'
```

An empty body returns **400** ("Provide at least one field to update").

### `DELETE /api/books/:id` — delete

**200 OK** with the removed document, or **404** if it never existed.

---

# Task 2 — User Authentication (JWT)

Signup and login with hashed passwords and signed access tokens, a reusable
JWT guard, and a protected route. Built on the same MVC layout and error
handling as Task 1.

## How authentication works

1. **Signup** stores the user with the password hashed by **bcrypt** (cost 12).
   The raw password is never written to the database and never returned.
2. **Login** compares the submitted password against the stored hash and, on
   success, signs a **JWT** containing the user id (`sub`) and email.
3. The client sends that token on every protected request as
   `Authorization: Bearer <token>`.
4. The **`protect`** middleware verifies the token, loads the matching user from
   MongoDB, and attaches it as `req.user`.

## Auth data model

| Field | Type | Rules |
|---|---|---|
| `name` | String | required, 2–80 characters, trimmed |
| `email` | String | required, unique, valid address, lowercased and trimmed |
| `password` | String | required, at least 8 characters, at least one letter and one number, **hashed before save** |
| `createdAt` / `updatedAt` | Date | added automatically |

Two details worth noting:

- **`password` is `select: false`.** The hash is excluded from every query by
  default; login opts in explicitly with `.select('+password')`. A `toJSON`
  transform also strips it, so the hash cannot leak through a serialised
  document even if a query asked for it.
- **The hash is never re-hashed.** The pre-save hook only runs when the
  password actually changed, so updating a user's name does not double-hash
  their existing password.

## Auth endpoints

### `POST /api/auth/signup` — register

```bash
curl -X POST http://localhost:5000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Abbas Hussain",
    "email": "abbas@example.com",
    "password": "SecurePass123"
  }'
```

**201 Created**

```json
{
  "success": true,
  "message": "Account created successfully",
  "data": {
    "user": {
      "id": "68c9f1a2b4e5d6f7a8b9c0d1",
      "name": "Abbas Hussain",
      "email": "abbas@example.com",
      "createdAt": "2026-09-16T12:00:00.000Z",
      "updatedAt": "2026-09-16T12:00:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

The token is returned immediately so a client can go straight to a protected
route without a separate login round-trip.

| Failure | Status | Message |
|---|---|---|
| email already registered | `409` | `A user with that email already exists` |
| missing `name` | `400` | `Name is required` |
| password under 8 characters | `400` | `Password must be at least 8 characters` |
| password with no digit | `400` | `Password must contain at least one letter and one number` |
| malformed email | `400` | `Email must be a valid address` |
| unexpected field | `400` | `Unknown field: role` |

### `POST /api/auth/login` — log in

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "abbas@example.com", "password": "SecurePass123" }'
```

**200 OK** — same `{ user, token }` shape as signup.

| Failure | Status | Message |
|---|---|---|
| wrong password | `401` | `Invalid email or password` |
| unknown email | `401` | `Invalid email or password` |
| missing password | `400` | `Password is required` |

**Both credential failures return the identical message on purpose.** Telling a
caller that an email is unregistered would let anyone enumerate which accounts
exist. There is a test that asserts the two responses are byte-for-byte equal.

Login also deliberately skips the signup password rules. A password that would
be too weak to register must still be able to log in, and rejecting it at the
validator would leak the same information the shared message hides.

### `GET /api/auth/me` — current user (protected)

```bash
curl http://localhost:5000/api/auth/me \
  -H "Authorization: Bearer <token>"
```

**200 OK**

```json
{
  "success": true,
  "message": "Current user fetched successfully",
  "data": {
    "id": "68c9f1a2b4e5d6f7a8b9c0d1",
    "name": "Abbas Hussain",
    "email": "abbas@example.com",
    "createdAt": "2026-09-16T12:00:00.000Z",
    "updatedAt": "2026-09-16T12:00:00.000Z"
  }
}
```

The record is read from MongoDB using the id inside the token, not decoded from
the token payload. That is a deliberate choice: it costs one indexed lookup and
means a deleted account stops working immediately, and `req.user` is always the
current document rather than a stale snapshot.

### `GET /api/protected/dashboard` — protected resource

A non-auth resource behind the same `protect` middleware, which shows the guard
is reusable rather than welded to the auth controller.

```json
{
  "success": true,
  "message": "You have reached a protected route",
  "data": {
    "greeting": "Welcome back, Abbas Hussain",
    "user": { "id": "...", "name": "Abbas Hussain", "email": "..." },
    "accountCreatedAt": "2026-09-16T12:00:00.000Z"
  }
}
```

## The `protect` middleware

`src/middleware/authMiddleware.js` is the single reusable guard. Attach it to
any route that needs a logged-in user:

```js
import { protect } from '../middleware/authMiddleware.js';

router.get('/me', protect, getMe);
```

It performs four steps and throws `AppError` on failure, so every rejection goes
through the same central error handler as the rest of the API:

1. Require an `Authorization: Bearer <token>` header — `401` if absent or
   malformed.
2. Verify the token's signature, expiry and issuer — `401` if invalid, with a
   message that distinguishes *expired* from *invalid*.
3. Load the user from MongoDB — `401` if the account no longer exists.
4. Attach the user as `req.user` and continue.

## Protected-route failures

| Situation | Status | Message |
|---|---|---|
| no `Authorization` header | `401` | `Not authorized — provide a Bearer token in the Authorization header` |
| header not in `Bearer <token>` form | `401` | same as above |
| token expired | `401` | `Token has expired — please log in again` |
| signature invalid / tampered | `401` | `Invalid token — please log in again` |
| token signed with a different secret | `401` | `Invalid token — please log in again` |
| valid token, account deleted | `401` | `The account for this token no longer exists` |

Legitimate requests with a valid token return `200`.

## Manual testing with Postman

Import
[`postman/Internify-Task2-Auth.postman_collection.json`](./postman/Internify-Task2-Auth.postman_collection.json),
set the `baseUrl` variable, then run the folder **in order**:

| # | Request | Expected |
|---|---|---|
| 1 | `POST /api/auth/signup` | `201` — token captured into a collection variable |
| 2 | `POST /api/auth/login` | `200` — token refreshed |
| 3 | `GET /api/auth/me` | `200` — the signed-up user |
| 4 | `GET /api/protected/dashboard` | `200` |
| E1 | signup with the same email | `409` |
| E2 | signup with no `name` | `400` |
| E3 | signup with `12345678` | `400` |
| E4 | login with a wrong password | `401` |
| E5 | login with an unknown email | `401` — message identical to E4 |
| E6 | `GET /api/auth/me` with no token | `401` |
| E7 | `GET /api/auth/me` with `Bearer not.a.real.token` | `401` |
| E8 | `GET /api/auth/me` with a tampered token | `401` |

Requests 1 and 2 have test scripts that store the returned JWT in the `token`
collection variable, so requests 3, 4 and E8 work without copy-pasting.

The equivalent command-line run is:

```bash
npm run smoke:auth
```

## Security notes

- **Password hashing.** bcrypt with a per-password salt at cost 12. The same
  password for two users produces two different hashes; there is a test for it.
- **No hash in any response.** Enforced twice — `select: false` on the field and
  a `toJSON` transform that deletes it.
- **Identical failure messages** for unknown-email and wrong-password, so the
  login endpoint cannot be used to enumerate accounts.
- **A 32-character minimum on `JWT_SECRET`,** checked at sign/verify time rather
  than at boot, so a weak secret fails loudly the first time it is used instead
  of silently issuing forgeable tokens.
- **Same secret checked at verify,** so a token signed with a different key is
  rejected. Verified by a test and by smoke check.
- **The token is never trusted for user data.** Only `sub` is read from it, and
  the user document is re-fetched.

## Status codes (authentication)

| Code | When |
|---|---|
| `200` | Successful login or protected GET |
| `201` | Account created |
| `400` | Auth validation failed (missing field, weak password, bad email, unknown field) |
| `401` | Invalid credentials, or a missing / malformed / expired / foreign token |
| `409` | Email already registered |
| `500` | `JWT_SECRET` missing or shorter than 32 characters |


## Status codes

| Code | When |
|---|---|
| `200` | Successful GET / PUT / DELETE |
| `201` | Book created |
| `400` | Validation failed, malformed id, malformed JSON, empty update |
| `404` | No book with that id, or unmatched route |
| `409` | Duplicate key on a unique index |
| `500` | Unexpected server error |
| `503` | Database unreachable |

## Validation

Each field is checked before the controller runs, and every failure returns a
single readable message:

| Request | Response |
|---|---|
| missing `title` | `400` — `Title is required` |
| `price: -1` | `400` — `Price cannot be less than 0` |
| `year: 2008.5` | `400` — `Year must be a whole number` |
| `year: "1999"` | accepted, coerced to `1999` |
| `titel: "typo"` | `400` — `Unknown field: titel` |
| `GET /api/books/abc` | `400` — `"abc" is not a valid book id` |
| malformed JSON body | `400` — `Request body contains invalid JSON` |

Unknown fields are rejected rather than silently dropped, so a typo in a field
name surfaces immediately instead of producing a confusing result.

## Testing

### Automated suite

```bash
npm test
```

105 tests across 24 suites, run against an in-memory MongoDB — no local `mongod`
required, and nothing is left behind.

```bash
npm test           # everything (105 tests)
npm run test:auth  # auth only  (28 tests)
npm run test:rbac  # RBAC only  (44 tests)
```

```
# tests 105
# suites 24
# pass 105
# fail 0
```

Task 1 (`tests/books.test.js`, 33 tests) covers the Books CRUD happy path plus
its `400` / `404` error cases, and — since Task 3 made writes authenticated —
asserts that anonymous writes are refused and that ownership is recorded from
the token rather than the body.

Task 2 (`tests/auth.test.js`, 28 tests) covers signup, login, the protected
routes and every auth error path — including that the unknown-email and
wrong-password messages are identical, that two users with the same password get
different hashes, and that an expired, tampered, wrong-secret or deleted-account
token is rejected.

Task 3 (`tests/rbac.test.js`, 44 tests) covers the permission matrix end to end:
a signup cannot promote itself, a non-owner's edit and delete are refused with
**403** *and the document is verified unchanged*, an admin may act on anyone's
record, pagination does not repeat or skip across pages, `?limit=9999` is capped
at 100, `?search=.*` is treated as literal text, and the admin routes return
**401** / **403** / **200** for anonymous / user / admin respectively.

### Live HTTP smoke test

```bash
node scripts/smoke-test.js      # Task 1 — Books
npm run smoke:auth              # Task 2 — authentication
npm run smoke:rbac              # Task 3 — the permission matrix
```

Boots a real server and drives every endpoint over HTTP, printing each
request and response. This is the reproducible equivalent of a Postman run:

```
POST   /api/books                 -> 201 Created
GET    /api/books                 -> 200 OK        (2 books)
GET    /api/books?genre=software  -> 200 OK
GET    /api/books/:id             -> 200 OK
PUT    /api/books/:id             -> 200 OK        (price updated, author preserved)
POST   /api/books                 -> 400 Bad Request  (missing field)
POST   /api/books                 -> 400 Bad Request  (negative price)
GET    /api/books/not-an-id       -> 400 Bad Request  (malformed id)
GET    /api/books/:unknownId      -> 404 Not Found
GET    /api/nope                  -> 404 Not Found
DELETE /api/books/:id             -> 200 OK
GET    /api/books/:deletedId      -> 404 Not Found
```

The auth smoke run prints the same way and covers 22 assertions:

```
POST   /api/auth/signup           -> 201 Created   (token issued, hash stored, password hidden)
POST   /api/auth/signup           -> 409 Conflict  (duplicate email)
POST   /api/auth/login            -> 401 Unauthorized (wrong password)
POST   /api/auth/login            -> 401 Unauthorized (unknown email, same message)
POST   /api/auth/login            -> 200 OK        (token issued)
GET    /api/auth/me               -> 401 Unauthorized (no token)
GET    /api/auth/me               -> 401 Unauthorized (bad token)
GET    /api/auth/me               -> 200 OK        (profile)
GET    /api/protected/dashboard   -> 200 OK
GET    /api/auth/me               -> 401 Unauthorized (expired token)
GET    /api/auth/me               -> 401 Unauthorized (wrong-secret token)
GET    /api/auth/me               -> 401 Unauthorized (account deleted)
```

The RBAC smoke run covers 56 assertions and prints the four-way matrix:

```
POST   /api/books                 -> 401 Unauthorized (anonymous)
POST   /api/books                 -> 400 Bad Request  (createdBy forged in the body)
POST   /api/books                 -> 201 Created      (owner recorded from the token)
PUT    /api/books/:id             -> 200 OK           (owner edits own)
PUT    /api/books/:id             -> 403 Forbidden    (non-owner refused, document unchanged)
PUT    /api/books/:id             -> 200 OK           (admin overrides)
DELETE /api/books/:id             -> 403 Forbidden    (non-owner refused, book survives)
GET    /api/books?page=1&limit=5  -> 200 OK           (pages do not overlap)
GET    /api/books?limit=9999      -> 200 OK           (limit capped at 100)
GET    /api/books?search=clean    -> 200 OK           (title / author / genre)
GET    /api/books?search=.*       -> 200 OK           (literal, 0 results)
GET    /api/admin/users           -> 401 / 403 / 200  (anonymous / user / admin)
GET    /api/admin/users           -> 403 Forbidden    (stale admin token after demotion)
```

### Postman

Two collections live in [`postman/`](./postman):

- `Internify-Task1-Books.postman_collection.json` — all five Books endpoints
  plus the error cases.
- `Internify-Task2-Auth.postman_collection.json` — the full auth flow plus eight
  error requests. Requests 1 and 2 capture the JWT into a collection variable,
  so the protected requests run without copy-pasting.
- `Internify-Task3-RBAC.postman_collection.json` — 29 requests walking the whole
  permission matrix. It signs up two users and logs in an admin, capturing all
  three tokens and the book id as it goes, then proves a non-owner is refused
  while an admin succeeds. Create the admin first with
  `node scripts/make-admin.js admin@example.com AdminPass123`.

Import either one, set `baseUrl`, and run the folder.

# Task 3 — Role-Based Access Control (RBAC)

Two roles, **user** and **admin**, with ownership on the Books resource.
Admins may act on any record; regular users may read everything but only create,
edit and delete their own. Records are paginated and searchable.

## The access matrix

| Action | Anonymous | User | Admin |
|---|---|---|---|
| `GET /api/books` (list, search, paginate) | ✅ 200 | ✅ 200 | ✅ 200 |
| `GET /api/books/:id` | ✅ 200 | ✅ 200 | ✅ 200 |
| `POST /api/books` | ❌ 401 | ✅ 201 | ✅ 201 |
| `GET /api/books/mine` | ❌ 401 | ✅ 200 (own only) | ✅ 200 (own only) |
| `PUT /api/books/:id` | ❌ 401 | ✅ 200 if owner, else **403** | ✅ 200 (any) |
| `DELETE /api/books/:id` | ❌ 401 | ✅ 200 if owner, else **403** | ✅ 200 (any) |
| `GET /api/admin/users` | ❌ 401 | ❌ **403** | ✅ 200 |
| `PATCH /api/admin/users/:id/role` | ❌ 401 | ❌ **403** | ✅ 200 |
| `DELETE /api/admin/users/:id` | ❌ 401 | ❌ **403** | ✅ 200 |

**401 vs 403.** 401 means *"I do not know who you are"* — no token, or a bad one.
403 means *"I know exactly who you are, and you may not do this."* Conflating them
tells a signed-in user to log in again when the real answer is that the record is
not theirs.

## Roles

`role` is an enum on the User model: `'user'` (default) or `'admin'`.

A role **cannot** be set at signup. The auth validator only accepts
`name`, `email` and `password`, so `{"role":"admin"}` in a signup body is
rejected with **400 Unknown field: role** rather than silently granted.
Elevation happens one of two ways:

```bash
# 1. The bootstrap script — for the very first admin, who has no admin to promote them
node scripts/make-admin.js you@example.com YourPassword123
```

```http
# 2. An existing admin, over HTTP
PATCH /api/admin/users/:id/role
Authorization: Bearer <admin token>
{ "role": "admin" }
```

The first-admin problem is real: the promote endpoint requires an admin to call
it, and signup refuses the field, so the loop has no entry point without
something like `make-admin.js` that runs with server access.

## Ownership

Every book carries `createdBy`, set from `req.user` — never from the request body,
so ownership cannot be forged. It is a required field, which matters: if it were
optional, a document without an owner would have nothing to compare against and
the ownership check would have to fail open.

The check itself lives in the route, not the controller:

```js
router.route('/:id')
  .put(protect, validateObjectId, loadResource(Book, 'book'), requireOwnership(), validateUpdateBook, updateBook)
```

`loadResource` fetches the document onto `req.resource`, `requireOwnership`
compares it against `req.user`, and only then does the controller run. The
controller never has to remember the rule, because it cannot run without it.

## Pagination

`GET /api/books` accepts `?page=` and `?limit=`, and returns the metadata a
client needs to build a pager:

```bash
curl "localhost:5000/api/books?page=2&limit=5"
```

```json
{
  "success": true,
  "count": 5,
  "total": 47,
  "page": 2,
  "pages": 10,
  "hasNextPage": true,
  "hasPrevPage": true,
  "limit": 5,
  "data": [ /* ... */ ]
}
```

- `limit` is capped at **100** so a client cannot ask for the whole collection in
  one request. `?limit=9999` returns `limit: 100`.
- A junk page (`?page=abc`) falls back to `1`; a page past the end is an empty
  page, not an error.
- `skip`/`limit` are used with `countDocuments` on the *same* filter, so `total`
  and `pages` describe the result set the caller actually asked for.

## Search and filters

One `?search=` parameter covers **title, author and genre**, so a single box
searches everything a person would type.

```bash
curl "localhost:5000/api/books?search=dune"          # matches the title
curl "localhost:5000/api/books?search=herbert"       # matches the author
curl "localhost:5000/api/books?search=cyberpunk"     # matches the genre
curl "localhost:5000/api/books?genre=software&page=1&limit=5"
```

Matching is **case-insensitive** and matches **partial words** — `dun` finds
`Dune`. That is a regex rather than MongoDB's `$text`, and a deliberate choice:
`$text` matches whole words only, which is wrong for a search box. The text index
stays on the model for full-phrase work.

User input is escaped before it reaches `RegExp`, so `?search=.*` matches the
literal characters `.*` and returns **zero** results instead of dumping the
collection. Two tests assert exactly that.

## RBAC endpoints

### `GET /api/books/mine` — the caller's own books (protected)

```bash
curl localhost:5000/api/books/mine -H "Authorization: Bearer <token>"
```

Scoped to `req.user.id` with no override — an admin wanting everything uses
`GET /api/books`. Declared **before** `/:id` in the router, because Express
matches in order and `mine` would otherwise be parsed as an object id and
rejected with a 400.

### `GET /api/admin/users` — list users (admin)

```bash
curl "localhost:5000/api/admin/users?role=admin&page=1&limit=10" -H "Authorization: Bearer <admin token>"
```

Same pagination shape as books, and the same `?search=` across name and email.
The password hash is never present in the response.

### `GET /api/admin/users/:id` — one user plus their book count (admin)

### `PATCH /api/admin/users/:id/role` — promote or demote (admin)

```bash
curl -X PATCH localhost:5000/api/admin/users/<id>/role \
  -H "Authorization: Bearer <admin token>" \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}'
```

Refuses self-demotion with **400**: an admin who demotes themselves loses access
to this very endpoint, and if they are the only admin there is no way back
without database access. Promote a second admin first.

### `DELETE /api/admin/users/:id` — remove an account (admin)

Refuses self-deletion with **400**. Reports how many books the account owned so
the caller can see what is being orphaned — the books are intentionally left in
place rather than cascade-deleted, because silently destroying data other admins
may still need is worse than a dangling reference.

## Setting up a local admin

```bash
# create (or promote) an admin, then log in normally
node scripts/make-admin.js admin@example.com AdminPass123

curl -X POST localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"AdminPass123"}'
```

## Status codes added by Task 3

| Code | Meaning in this task |
|---|---|
| **401** | No token, or a token that is expired / malformed / signed with the wrong key / points at a deleted account |
| **403** | Valid token, but the caller is neither the owner nor an admin, or the route needs a role they do not hold |
| **400** | Self-demotion, self-deletion, an invalid role value, or an unknown body field such as `createdBy` or `role` |

## Design notes

- **MVC separation.** URLs live in `routes/`, logic in `controllers/`, schema
  rules in `models/`, and cross-cutting checks in `middleware/`. Each file can
  be read without jumping around.
- **One error path.** Controllers throw `AppError`; `errorHandler` is the only
  place that writes an error response, so every failure has the same shape.
- **Mongoose errors are translated.** A `CastError`, `ValidationError`, or
  duplicate-key error becomes an `AppError` instead of leaking a stack trace.
- **Updates use `save()`,** not `findByIdAndUpdate`, so schema validators run on
  update the same way they do on create.
- **`app.js` is separate from `server.js`** so the test suite can import the app
  without binding a port.

### Design notes specific to Task 2

- **The hash never leaves the model.** `select: false` keeps it out of query
  results, `.select('+password')` is a deliberate opt-in used in exactly one
  place, and the `toJSON` transform deletes it as a second line of defence.
- **One guard, reused.** `protect` is a plain middleware with no knowledge of
  the auth controller. `GET /api/auth/me` and `GET /api/protected/dashboard`
  both use it, which is what makes it reusable rather than incidental.
- **Trust the token for identity, not for data.** Only `sub` is read from the
  payload; the user is re-fetched from MongoDB so a deleted account is rejected
  immediately and `req.user` is always current.
- **Fail closed on configuration.** A missing or under-32-character
  `JWT_SECRET` throws `500` at first use instead of silently signing tokens with
  a weak key.
- **Never confirm which half was wrong.** Login returns one message for both
  wrong-password and unknown-email, and a test asserts the two responses match.
- **Validation is asymmetric on purpose.** Signup enforces password strength;
  login does not, so an account created before a rule change can still sign in.

### Design notes specific to Task 3

- **Authorisation reads the database, not the token.** The JWT carries a `role`
  claim for the client's convenience, but `restrictTo` checks `req.user.role`,
  which `protect` loads fresh from MongoDB. A token minted while someone was an
  admin cannot be used to keep admin access after a demotion — a test mints a
  token, demotes the user in the database, and asserts the *same* token now
  gets a 403.
- **Ownership is enforced in the route, not the controller.** `loadResource` +
  `requireOwnership` run before the handler, so no controller can accidentally
  omit the check. Guards are composed rather than repeated.
- **A missing document is 404, not 403.** Returning 403 for an id that does not
  exist would confirm the id exists but is someone else's. 404 keeps both cases
  indistinguishable.
- **Self-demotion and self-deletion are refused.** Both are unrecoverable if the
  caller is the only admin, and neither is something a user means to do.
- **Regex metacharacters in `?search=` are escaped.** Without that, `?search=.*`
  is a wildcard that dumps the collection, and `?search=(` is a crash.
- **The admin router applies its guards once,** via `router.use(protect,
  restrictTo(ROLES.ADMIN))`. A new endpoint added below is admin-only by
  default, so forgetting a guard fails closed rather than open.
- **`ROLES` and `ROLE_VALUES` are exported from the model** so the enum, the
  guards and the validators all read from one source instead of repeating
  string literals.
- **Books are not cascade-deleted with their owner.** `DELETE /api/admin/users/:id`
  reports the count instead. Losing a user should not silently take their data
  with it.

---

MIT © Abbas Hussain
