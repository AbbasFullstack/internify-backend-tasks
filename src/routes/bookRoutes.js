/**
 * Book routes — URL shape only. Validation and logic live in the middleware
 * and controller so each layer stays readable on its own.
 */
import { Router } from 'express';
import {
  createBook,
  getBooks,
  getBookById,
  updateBook,
  deleteBook,
} from '../controllers/bookController.js';
import {
  validateCreateBook,
  validateUpdateBook,
  validateObjectId,
} from '../middleware/validateBook.js';

const router = Router();

router
  .route('/')
  .get(getBooks) //            GET    /api/books
  .post(validateCreateBook, createBook); // POST   /api/books

router
  .route('/:id')
  .get(validateObjectId, getBookById) //     GET    /api/books/:id
  .put(validateObjectId, validateUpdateBook, updateBook) //  PUT    /api/books/:id
  .delete(validateObjectId, deleteBook); //  DELETE /api/books/:id

export default router;
