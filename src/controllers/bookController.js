/**
 * Book controllers — the only layer that talks to Mongoose.
 *
 * Every handler is wrapped in asyncHandler so a rejected promise reaches the
 * central error middleware. Not-found cases throw AppError(404) rather than
 * responding directly, keeping a single response shape across the API.
 *
 * RBAC (Task 3):
 *  - Ownership is enforced in the route, not here. By the time `updateBook` or
 *    `deleteBook` runs, `loadResource` has fetched the document and
 *    `requireOwnership` has confirmed the caller owns it or is an admin. The
 *    controller therefore cannot forget the check — it never has to remember one.
 *  - `createdBy` is set from `req.user`, never from the request body, so a
 *    caller cannot forge ownership of a record they create.
 */
import Book from '../models/Book.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';

/** Uniform success envelope so clients parse one shape everywhere. */
const ok = (res, statusCode, data, message) =>
  res.status(statusCode).json({ success: true, message, data });

/**
 * POST /api/books
 * Create a book. Body already validated by validateCreateBook.
 */
export const createBook = asyncHandler(async (req, res) => {
  const { title, author, genre, year, price } = req.body;

  const book = await Book.create({
    title,
    author,
    genre,
    year,
    price,
    // Ownership comes from the authenticated caller, never the body.
    createdBy: req.user.id,
  });

  return ok(res, 201, book, 'Book created successfully');
});

/**
 * GET /api/books
 * List books with pagination, search and filters.
 *
 * Supported query parameters:
 *   ?page=1          page number (default 1)
 *   ?limit=10        page size (default 10, max 100)
 *   ?search=dune     case-insensitive match across title, author and genre
 *   ?author=martin   exact-ish filter on author
 *   ?genre=scifi     exact-ish filter on genre
 *   ?sort=-createdAt sort field, prefix with - for descending
 *
 * Search uses a regex across the three text fields rather than the text index:
 * it matches partial words ("dun" finds "Dune"), which is what a search box
 * should do, where MongoDB's $text only matches whole words. The text index
 * stays on the model for full-phrase queries.
 */
export const getBooks = asyncHandler(async (req, res) => {
  const {
    author,
    genre,
    search,
    sort = '-createdAt',
    page = 1,
    limit = 10,
  } = req.query;

  const filter = {};

  if (author) filter.author = new RegExp(escapeRegex(String(author).trim()), 'i');
  if (genre) filter.genre = new RegExp(escapeRegex(String(genre).trim()), 'i');

  // Search spans the human-readable fields, so one box covers all three.
  if (search && String(search).trim()) {
    const term = new RegExp(escapeRegex(String(search).trim()), 'i');
    filter.$or = [{ title: term }, { author: term }, { genre: term }];
  }

  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 10));

  const [books, total] = await Promise.all([
    Book.find(filter)
      .sort(sort)
      .skip((pageNum - 1) * perPage)
      .limit(perPage),
    Book.countDocuments(filter),
  ]);

  const pages = Math.ceil(total / perPage) || 1;

  return res.status(200).json({
    success: true,
    message: 'Books fetched successfully',
    count: books.length,
    total,
    page: pageNum,
    pages,
    // Ready-made links so a client does not rebuild the query string itself.
    hasNextPage: pageNum < pages,
    hasPrevPage: pageNum > 1,
    limit: perPage,
    data: books,
  });
});

/**
 * GET /api/books/:id
 * Fetch one book. `id` format already guarded by validateObjectId.
 */
export const getBookById = asyncHandler(async (req, res) => {
  const book = await Book.findById(req.params.id);

  if (!book) {
    throw new AppError(`No book found with id ${req.params.id}`, 404);
  }

  return ok(res, 200, book, 'Book fetched successfully');
});

/**
 * PUT /api/books/:id
 * Update a book. Only the fields supplied are changed; validation already
 * rejected unknown keys, so a stray `titel` returns 400 instead of silently
 * doing nothing.
 *
 * `req.resource` was loaded and ownership-checked by the route middleware, so
 * this handler never re-fetches and never needs an ownership branch.
 */
export const updateBook = asyncHandler(async (req, res) => {
  const book = req.resource;

  for (const field of ['title', 'author', 'genre', 'year', 'price']) {
    if (req.body[field] !== undefined) book[field] = req.body[field];
  }

  // save() (not findByIdAndUpdate) so schema validators run.
  await book.save();

  return ok(res, 200, book, 'Book updated successfully');
});

/**
 * DELETE /api/books/:id
 * Remove a book and return the deleted document.
 */
export const deleteBook = asyncHandler(async (req, res) => {
  const book = req.resource;

  await book.deleteOne();

  return ok(res, 200, book, 'Book deleted successfully');
});

/**
 * GET /api/books/mine
 * Every book the caller created, newest first. Available to any logged-in user
 * and deliberately scoped to `req.user.id` with no override — an admin wanting
 * everything uses GET /api/books.
 */
export const getMyBooks = asyncHandler(async (req, res) => {
  const books = await Book.find({ createdBy: req.user.id }).sort('-createdAt');

  return res.status(200).json({
    success: true,
    message: 'Your books fetched successfully',
    count: books.length,
    total: books.length,
    data: books,
  });
});

/**
 * Escape a user-supplied string before it reaches a RegExp.
 * Without this, a search for "a+" or "(x" is either a wrong match or a crash.
 */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
