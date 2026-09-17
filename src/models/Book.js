/**
 * Book model.
 *
 * Field rules:
 *  - title, author, genre : required non-empty strings
 *  - year                 : required integer within a sane range
 *  - price                : required number, cannot be negative
 *  - createdBy            : required reference to the User who created it
 *
 * `trim: true` on the strings means "  Dune  " is stored as "Dune", and
 * `minlength` guards against single-character junk.
 *
 * Ownership (Task 3):
 *  - `createdBy` is what the RBAC rules hang off. It is required, so a document
 *    can never exist without an owner — otherwise "only the owner may edit"
 *    would have nothing to compare against and the guard would have to fail
 *    open. The controller sets it from `req.user`, never from the request body.
 *  - Indexed because every ownership check filters on it.
 *
 * Search (Task 3):
 *  - A text index over title/author/genre backs the `?search=` query. A regex
 *    would also work, but a text index lets MongoDB do the work instead of
 *    scanning every document, and it ranks by relevance.
 */
import mongoose from 'mongoose';

const bookSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      minlength: [1, 'Title cannot be empty'],
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    author: {
      type: String,
      required: [true, 'Author is required'],
      trim: true,
      minlength: [1, 'Author cannot be empty'],
      maxlength: [120, 'Author cannot exceed 120 characters'],
    },
    genre: {
      type: String,
      required: [true, 'Genre is required'],
      trim: true,
      minlength: [1, 'Genre cannot be empty'],
      maxlength: [80, 'Genre cannot exceed 80 characters'],
    },
    year: {
      type: Number,
      required: [true, 'Year is required'],
      validate: {
        validator: Number.isInteger,
        message: 'Year must be a whole number',
      },
      min: [1450, 'Year must be 1450 or later'], // Gutenberg's press
      max: [new Date().getFullYear() + 1, 'Year cannot be in the far future'],
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
      validate: {
        validator: (value) => Number.isFinite(value),
        message: 'Price must be a valid number',
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'A book must have an owner'],
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        // Present a stable `id` alongside Mongo's `_id`.
        ret.id = ret._id;
        delete ret._id;
        return ret;
      },
    },
  }
);

// Speeds up the common "filter by author / genre, newest first" reads.
bookSchema.index({ author: 1 });
bookSchema.index({ genre: 1 });
bookSchema.index({ createdAt: -1 });

// Backs ?search= across the three human-readable fields.
bookSchema.index({ title: 'text', author: 'text', genre: 'text' });

/**
 * Does this user own the document?
 *
 * Takes the whole user document rather than a bare id so the admin short-circuit
 * is impossible to forget, and returns a boolean so callers can decide whether
 * that means 403 or "carry on".
 */
bookSchema.methods.isOwnedBy = function isOwnedBy(user) {
  if (!user) return false;
  if (user.isAdmin?.()) return true;
  return String(this.createdBy) === String(user.id ?? user._id);
};

const Book = mongoose.model('Book', bookSchema);

export default Book;
