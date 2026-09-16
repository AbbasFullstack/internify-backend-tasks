# Internify Backend Internship — Tasks

Backend development internship tasks for **Internify**.
Abbas Hussain · [github.com/AbbasFullstack](https://github.com/AbbasFullstack)

| Task | Topic | Status |
|------|-------|--------|
| 1 | RESTful CRUD API — Books (Node.js, Express, MongoDB, Mongoose) | ✅ Complete |
| 2 | TBD | ⏳ Pending |
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
│   │   └── Book.js               # schema, types, validators, indexes
│   ├── controllers/
│   │   └── bookController.js     # CRUD logic
│   ├── routes/
│   │   └── bookRoutes.js         # URL -> middleware -> controller
│   ├── middleware/
│   │   ├── validateBook.js       # body + ObjectId validation
│   │   └── errorHandler.js       # 404 + central error handler
│   └── utils/
│       ├── AppError.js           # error with an HTTP status code
│       └── asyncHandler.js       # forwards async rejections to Express
├── scripts/
│   └── smoke-test.js             # live HTTP run of every endpoint
└── tests/
    └── books.test.js             # 20 automated tests (in-memory MongoDB)
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

`.env` is git-ignored. Only `.env.example` is committed.

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

20 tests across 8 suites, run against an in-memory MongoDB — no local `mongod`
required, and nothing is left behind.

```
# tests 20
# pass 20
# fail 0
```

### Live HTTP smoke test

```bash
node scripts/smoke-test.js
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

### Postman

A collection covering all five endpoints plus the error cases is in
[`postman/`](./postman). Import it, set `baseUrl`, and run the whole folder.

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

---

MIT © Abbas Hussain
