/**
 * Book model.
 *
 * Field rules:
 *  - title, author, genre : required non-empty strings
 *  - year                 : required integer within a sane range
 *  - price                : required number, cannot be negative
 *
 * `trim: true` on the strings means "  Dune  " is stored as "Dune", and
 * `minlength` guards against single-character junk.
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

const Book = mongoose.model('Book', bookSchema);

export default Book;
