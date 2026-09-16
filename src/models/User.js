/**
 * User model.
 *
 * Field rules:
 *  - name     : required non-empty string
 *  - email    : required, unique, lowercased and trimmed so
 *               "Abbas@Example.com" and "abbas@example.com" cannot both exist
 *  - password : required, minimum 8 characters, hashed before save
 *
 * Password handling:
 *  - The raw password is never stored. A pre-save hook hashes it with bcrypt,
 *    and only when it actually changed, so updating a user's name does not
 *    re-hash an already-hashed password.
 *  - `select: false` keeps the hash out of every query result by default.
 *    Login and any other flow that needs it must opt in with
 *    `.select('+password')`, which is a deliberate, greppable act.
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [80, 'Name cannot exceed 80 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email must be a valid address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        // Never let the hash leave the API, even if a query opted it in.
        delete ret.password;
        ret.id = ret._id;
        delete ret._id;
        return ret;
      },
    },
  }
);

// Speeds up the duplicate-email lookup that runs on every signup.
userSchema.index({ email: 1 }, { unique: true });

/**
 * Hash the password whenever it is new or changed.
 * Mongoose 8 resolves promises returned from middleware, so no `next` needed.
 */
userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, SALT_ROUNDS);
});

/**
 * Compare a candidate password against the stored hash.
 * Deliberately an instance method: the hash is never exposed to a controller.
 */
userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

const User = mongoose.model('User', userSchema);

export default User;
