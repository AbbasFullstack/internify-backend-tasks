/**
 * Request-body validation for the Book resource.
 *
 * Handwritten rather than pulling in a schema library: the rules are small
 * and explicit, and every failure returns a 400 with a per-field message so
 * a client can show exactly what to fix.
 *
 * Two helpers:
 *   validateCreateBook — all five fields required
 *   validateUpdateBook — partial; only checks the fields actually sent
 */
import AppError from '../utils/AppError.js';

const FIELD_RULES = {
  title: { type: 'string', label: 'Title', max: 200 },
  author: { type: 'string', label: 'Author', max: 120 },
  genre: { type: 'string', label: 'Genre', max: 80 },
  year: { type: 'integer', label: 'Year', min: 1450, max: new Date().getFullYear() + 1 },
  price: { type: 'number', label: 'Price', min: 0 },
};

const isBlank = (value) => typeof value === 'string' && value.trim() === '';

/**
 * Validate one field. Returns an error string, or null when valid.
 * An `undefined` value is only an error when the field is required —
 * that decision belongs to the caller.
 */
const checkField = (name, rawValue) => {
  const rule = FIELD_RULES[name];

  if (rule.type === 'string') {
    if (typeof rawValue !== 'string') return `${rule.label} must be a string`;
    if (isBlank(rawValue)) return `${rule.label} cannot be empty`;
    if (rawValue.trim().length > rule.max) {
      return `${rule.label} cannot exceed ${rule.max} characters`;
    }
    return null;
  }

  if (rule.type === 'integer') {
    if (typeof rawValue !== 'number' || !Number.isInteger(rawValue)) {
      return `${rule.label} must be a whole number`;
    }
    if (rule.min !== undefined && rawValue < rule.min) {
      return `${rule.label} must be ${rule.min} or later`;
    }
    if (rule.max !== undefined && rawValue > rule.max) {
      return `${rule.label} cannot be later than ${rule.max}`;
    }
    return null;
  }

  // number
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    return `${rule.label} must be a valid number`;
  }
  if (rule.min !== undefined && rawValue < rule.min) {
    return `${rule.label} cannot be less than ${rule.min}`;
  }
  return null;
};

/** Reject unknown keys so typos like `titel` do not silently disappear. */
const collectUnknownKeys = (body) =>
  Object.keys(body).filter((key) => !(key in FIELD_RULES)).map((key) => `Unknown field: ${key}`);

const buildValidator = ({ partial }) => (req, _res, next) => {
  const body = req.body;

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return next(new AppError('Request body must be a JSON object', 400));
  }

  const errors = collectUnknownKeys(body);

  for (const [name, rule] of Object.entries(FIELD_RULES)) {
    const present = Object.prototype.hasOwnProperty.call(body, name);

    if (!present) {
      if (!partial) errors.push(`${rule.label} is required`);
      continue;
    }

    if (body[name] === null || body[name] === undefined) {
      errors.push(`${rule.label} cannot be null`);
      continue;
    }

    // Coerce numeric strings ("1999") so form posts work as expected.
    if (rule.type !== 'string' && typeof body[name] === 'string' && body[name].trim() !== '') {
      const asNumber = Number(body[name]);
      if (Number.isFinite(asNumber)) req.body[name] = asNumber;
    }

    const error = checkField(name, req.body[name]);
    if (error) errors.push(error);
  }

  if (partial && Object.keys(body).length === 0) {
    errors.push('Provide at least one field to update');
  }

  if (errors.length > 0) {
    return next(new AppError(errors.join('; '), 400));
  }

  return next();
};

export const validateCreateBook = buildValidator({ partial: false });
export const validateUpdateBook = buildValidator({ partial: true });

/** Guard against a malformed :id so Mongoose throws a 500 CastError. */
export const validateObjectId = (req, _res, next) => {
  const { id } = req.params;
  const isObjectId = /^[a-fA-F0-9]{24}$/.test(id);

  if (!isObjectId) {
    return next(new AppError(`"${id}" is not a valid book id`, 400));
  }
  return next();
};

export default { validateCreateBook, validateUpdateBook, validateObjectId };
