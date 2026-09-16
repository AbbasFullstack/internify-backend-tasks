# Internify Backend Internship — Tasks

Backend development internship tasks for **Internify**.
Abbas Hussain · [github.com/AbbasFullstack](https://github.com/AbbasFullstack)

| Task | Topic | Status |
|------|-------|--------|
| 1 | RESTful CRUD API — Books (Node.js, Express, MongoDB, Mongoose) | ✅ Complete |
| 2 | User authentication — signup / login with JWT + bcrypt | ✅ Complete |
| 3 | TBD | ⏳ Pending |
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
│   │   └── User.js               # user schema, bcrypt pre-save hook
│   ├── controllers/
│   │   ├── bookController.js     # CRUD logic
│   │   └── authController.js     # signup, login, getMe
│   ├── routes/
│   │   ├── bookRoutes.js         # URL -> middleware -> controller
│   │   ├── authRoutes.js         # /api/auth
│   │   └── protectedRoutes.js    # /api/protected (JWT-guarded)
│   ├── middleware/
│   │   ├── validateBook.js       # body + ObjectId validation
│   │   ├── validateAuth.js       # signup / login body validation
│   │   ├── authMiddleware.js     # reusable `protect` JWT guard
│   │   └── errorHandler.js       # 404 + central error handler
│   └── utils/
│       ├── AppError.js           # error with an HTTP status code
│       ├── asyncHandler.js       # forwards async rejections to Express
│       └── jwt.js                # sign / verify / extract Bearer token
├── postman/
│   ├── Internify-Task1-Books.postman_collection.json
│   └── Internify-Task2-Auth.postman_collection.json
├── scripts/
│   ├── smoke-test.js             # live HTTP run of every Books endpoint
│   └── auth-smoke-test.js        # live HTTP run of the whole auth flow
└── tests/
    ├── books.test.js             # 20 automated tests (in-memory MongoDB)
    └── auth.test.js              # 28 automated tests (in-memory MongoDB)
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

48 tests across 13 suites, run against an in-memory MongoDB — no local `mongod`
required, and nothing is left behind.

```bash
npm test          # everything (48 tests)
npm run test:auth # auth only  (28 tests)
```

```
# tests 48
# pass 48
# fail 0
```

Task 1 (`tests/books.test.js`, 20 tests) covers the Books CRUD happy path plus
its `400` / `404` error cases. Task 2 (`tests/auth.test.js`, 28 tests) covers
signup, login, the protected routes and every auth error path — including that
the unknown-email and wrong-password messages are identical, that two users with
the same password get different hashes, and that an expired, tampered,
wrong-secret or deleted-account token is rejected.

### Live HTTP smoke test

```bash
node scripts/smoke-test.js      # Task 1 — Books
npm run smoke:auth              # Task 2 — authentication
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

### Postman

Two collections live in [`postman/`](./postman):

- `Internify-Task1-Books.postman_collection.json` — all five Books endpoints
  plus the error cases.
- `Internify-Task2-Auth.postman_collection.json` — the full auth flow plus eight
  error requests. Requests 1 and 2 capture the JWT into a collection variable,
  so the protected requests run without copy-pasting.

Import either one, set `baseUrl`, and run the folder.

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

---

MIT © Abbas Hussain
