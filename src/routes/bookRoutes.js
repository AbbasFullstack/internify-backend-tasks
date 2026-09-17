/**
 * Book routes — URL shape and the access rules for each one.
 *
 * Reads are public so the collection is browsable without an account.
 * Every write requires a valid token, and edits are limited to the caller's own
 * records (admins excepted). The middleware chain is where that lives, so each
 * controller stays free of permission logic.
 *
 * Chain order matters:
 *   validateObjectId -> loadResource -> requireOwnership -> validateUpdateBook
 *
 * The id is checked before a query is attempted, the document is fetched before
 * ownership is judged, and the body is validated last so a malformed id never
 * costs a body parse and a 404 is never reported as a 400.
 */
import { Router } from 'express';
import {
  createBook,
  getBooks,
  getMyBooks,
  getBookById,
  updateBook,
  deleteBook,
} from '../controllers/bookController.js';
import {
  validateCreateBook,
  validateUpdateBook,
  validateObjectId,
} from '../middleware/validateBook.js';
import { protect } from '../middleware/authMiddleware.js';
import { loadResource, requireOwnership } from '../middleware/roleMiddleware.js';
import Book from '../models/Book.js';

const router = Router();

// ---------------------------------------------------------------- collection
router
  .route('/')
  // Public: anyone may browse the catalogue.
  .get(getBooks)
  // Protected: any logged-in user may create a book; it is owned by them.
  .post(protect, validateCreateBook, createBook);

// ------------------------------------------------------------ /mine (before /:id)
/**
 * Declared before `/:id` on purpose. Express matches in order, and if `/:id`
 * came first then "mine" would be treated as an id and rejected by
 * validateObjectId with a 400.
 */
router.get('/mine', protect, getMyBooks);

// --------------------------------------------------------------------- single
router
  .route('/:id')
  // Public read.
  .get(validateObjectId, getBookById)
  // Owner or admin only. `loadResource` puts the document on req.resource so
  // `requireOwnership` has something real to test.
  .put(
    protect,
    validateObjectId,
    loadResource(Book, 'book'),
    requireOwnership(),
    validateUpdateBook,
    updateBook
  )
  .delete(
    protect,
    validateObjectId,
    loadResource(Book, 'book'),
    requireOwnership(),
    deleteBook
  );

export default router;
