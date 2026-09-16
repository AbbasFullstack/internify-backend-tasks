/**
 * Book controllers — the only layer that talks to Mongoose.
 *
 * Every handler is wrapped in asyncHandler so a rejected promise reaches the
 * central error middleware. Not-found cases throw AppError(404) rather than
 * responding directly, keeping a single response shape across the API.
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

  const book = await Book.create({ title, author, genre, year, price });

  return ok(res, 201, book, 'Book created successfully');
});

/**
 * GET /api/books
 * List books. Supports optional ?author= ?genre= ?sort= plus pagination,
 * so the endpoint stays useful once the collection grows past a handful.
 */
export const getBooks = asyncHandler(async (req, res) => {
  const { author, genre, sort = '-createdAt', page = 1, limit = 50 } = req.query;

  const filter = {};
  if (author) filter.author = new RegExp(String(author).trim(), 'i');
  if (genre) filter.genre = new RegExp(String(genre).trim(), 'i');

  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 50));

  const [books, total] = await Promise.all([
    Book.find(filter)
      .sort(sort)
      .skip((pageNum - 1) * perPage)
      .limit(perPage),
    Book.countDocuments(filter),
  ]);

  return res.status(200).json({
    success: true,
    message: 'Books fetched successfully',
    count: books.length,
    total,
    page: pageNum,
    pages: Math.ceil(total / perPage) || 1,
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
 */
export const updateBook = asyncHandler(async (req, res) => {
  const book = await Book.findById(req.params.id);

  if (!book) {
    throw new AppError(`No book found with id ${req.params.id}`, 404);
  }

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
  const book = await Book.findByIdAndDelete(req.params.id);

  if (!book) {
    throw new AppError(`No book found with id ${req.params.id}`, 404);
  }

  return ok(res, 200, book, 'Book deleted successfully');
});
