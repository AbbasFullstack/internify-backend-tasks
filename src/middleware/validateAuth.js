/**
 * Request-body validation for the auth resource.
 *
 * Written the same way as validateBook.js: small, explicit rules and one
 * readable error string per failure, so a client always knows what to fix.
 *
 *   validateSignup — name, email, password all required
 *   validateLogin  — email and password required, no strength rules
 *
 * Note the deliberate asymmetry: login does not enforce the password rules.
 * A legacy or weak password must still be able to log in, and rejecting it at
 * the validator would leak which passwords exist.
 */
import AppError from '../utils/AppError.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // bcrypt only uses the first 72 bytes

const isBlank = (value) => typeof value === 'string' && value.trim() === '';

/** Validate a name. Returns an error string, or null when valid. */
const checkName = (value) => {
  if (typeof value !== 'string') return 'Name must be a string';
  if (isBlank(value)) return 'Name cannot be empty';
  const trimmed = value.trim();
  if (trimmed.length < 2) return 'Name must be at least 2 characters';
  if (trimmed.length > 80) return 'Name cannot exceed 80 characters';
  return null;
};

/** Validate an email. Returns an error string, or null when valid. */
const checkEmail = (value) => {
  if (typeof value !== 'string') return 'Email must be a string';
  if (isBlank(value)) return 'Email cannot be empty';
  const trimmed = value.trim();
  if (trimmed.length > 254) return 'Email cannot exceed 254 characters';
  if (!EMAIL_RE.test(trimmed)) return 'Email must be a valid address';
  return null;
};

/** Validate a password. `strict` applies the strength rules (signup only). */
const checkPassword = (value, { strict }) => {
  if (typeof value !== 'string') return 'Password must be a string';
  if (value === '') return 'Password cannot be empty';

  if (strict) {
    if (value.length < PASSWORD_MIN) {
      return `Password must be at least ${PASSWORD_MIN} characters`;
    }
    if (value.length > PASSWORD_MAX) {
      return `Password cannot exceed ${PASSWORD_MAX} characters`;
    }
    // Require at least one letter and one number — cheap, and blocks "12345678".
    if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
      return 'Password must contain at least one letter and one number';
    }
  }

  return null;
};

const buildValidator =
  ({ fields, strictPassword }) =>
  (req, _res, next) => {
    const body = req.body;

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return next(new AppError('Request body must be a JSON object', 400));
    }

    const errors = [];

    // Reject unknown keys so a typo like `emial` is reported, not ignored.
    for (const key of Object.keys(body)) {
      if (!fields.includes(key)) errors.push(`Unknown field: ${key}`);
    }

    const checks = {
      name: checkName,
      email: checkEmail,
      password: (value) => checkPassword(value, { strict: strictPassword }),
    };

    for (const field of fields) {
      const present = Object.prototype.hasOwnProperty.call(body, field);

      if (!present) {
        errors.push(`${field.charAt(0).toUpperCase() + field.slice(1)} is required`);
        continue;
      }

      if (body[field] === null || body[field] === undefined) {
        errors.push(`${field.charAt(0).toUpperCase() + field.slice(1)} cannot be null`);
        continue;
      }

      const error = checks[field](body[field]);
      if (error) errors.push(error);
    }

    if (errors.length > 0) {
      return next(new AppError(errors.join('; '), 400));
    }

    // Normalise before the controller sees it, so lookups always match the
    // lowercased value the schema stores.
    if (typeof req.body.email === 'string') {
      req.body.email = req.body.email.trim().toLowerCase();
    }
    if (typeof req.body.name === 'string') {
      req.body.name = req.body.name.trim();
    }

    return next();
  };

export const validateSignup = buildValidator({
  fields: ['name', 'email', 'password'],
  strictPassword: true,
});

export const validateLogin = buildValidator({
  fields: ['email', 'password'],
  strictPassword: false,
});

export default { validateSignup, validateLogin };
