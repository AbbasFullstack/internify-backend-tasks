/**
 * Request-body validation for the Blog resource.
 *
 * Multer parses multipart bodies, so every field arrives as a **string** —
 * `tags` may come as JSON, a comma list, or a repeated field. `coerceTags`
 * normalises all three before the checks run.
 *
 * Unknown keys are rejected rather than ignored. That is what stops a client
 * smuggling `createdBy`, `slug` or `image` into the body and having the
 * controller quietly honour it.
 */
import AppError from '../utils/AppError.js';

export const ALLOWED_BLOG_FIELDS = ['title', 'content', 'author', 'excerpt', 'tags'];

const LIMITS = {
  titleMin: 3,
  titleMax: 180,
  contentMin: 20,
  authorMax: 120,
  excerptMax: 300,
  maxTags: 10,
  maxTagLength: 30,
};

const safeParse = (text) => {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Accept ["a","b"], "a,b" or a repeated form field, and clean each entry. */
const coerceTags = (value) => {
  if (value === undefined || value === null || value === '') return [];

  let list;
  if (Array.isArray(value)) {
    list = value.flatMap((v) =>
      typeof v === 'string' && v.trim().startsWith('[') ? safeParse(v) : [v]
    );
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    list = trimmed.startsWith('[') ? safeParse(trimmed) : trimmed.split(',');
  } else {
    return null; // signals "invalid" to the caller
  }

  if (!Array.isArray(list)) return null;

  const cleaned = list.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  // Dedupe here too, so the validator and the model agree on what "3 tags"
  // means when the client sends the same tag twice.
  return [...new Set(cleaned)];
};

/** Per-field checks. Returns an array of messages (empty when all good). */
const checkFields = (body, { partial }) => {
  const errors = [];

  const present = (name) =>
    Object.prototype.hasOwnProperty.call(body, name) &&
    body[name] !== undefined &&
    body[name] !== null;

  if (!partial || present('title')) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      errors.push('Title is required');
    } else if (title.length < LIMITS.titleMin) {
      errors.push(`Title must be at least ${LIMITS.titleMin} characters`);
    } else if (title.length > LIMITS.titleMax) {
      errors.push(`Title cannot exceed ${LIMITS.titleMax} characters`);
    }
  }

  if (!partial || present('content')) {
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) {
      errors.push('Content is required');
    } else if (content.length < LIMITS.contentMin) {
      errors.push(`Content must be at least ${LIMITS.contentMin} characters`);
    }
  }

  if (!partial || present('author')) {
    const author = typeof body.author === 'string' ? body.author.trim() : '';
    if (!author) {
      errors.push('Author is required');
    } else if (author.length > LIMITS.authorMax) {
      errors.push(`Author cannot exceed ${LIMITS.authorMax} characters`);
    }
  }

  if (present('excerpt')) {
    const excerpt = typeof body.excerpt === 'string' ? body.excerpt.trim() : '';
    if (excerpt.length > LIMITS.excerptMax) {
      errors.push(`Excerpt cannot exceed ${LIMITS.excerptMax} characters`);
    }
  }

  if (present('tags')) {
    const tags = coerceTags(body.tags);
    if (tags === null) {
      errors.push('Tags must be an array or a comma-separated string');
    } else if (tags.length > LIMITS.maxTags) {
      errors.push(`A post cannot have more than ${LIMITS.maxTags} tags`);
    } else if (tags.some((t) => t.length > LIMITS.maxTagLength)) {
      errors.push(`Each tag must be ${LIMITS.maxTagLength} characters or fewer`);
    }
  }

  if (partial && Object.keys(body).length === 0) {
    errors.push('Provide at least one field to update');
  }

  return errors;
};

/** Reject keys the client is not allowed to set. */
const checkUnknownFields = (body) => {
  const unknown = Object.keys(body).filter((k) => !ALLOWED_BLOG_FIELDS.includes(k));
  if (unknown.length > 0) {
    return [
      `Unknown field(s): ${unknown.join(', ')}. Allowed: ${ALLOWED_BLOG_FIELDS.join(', ')}`,
    ];
  }
  return [];
};

const buildValidator =
  ({ partial }) =>
  (req, res, next) => {
    const body = req.body ?? {};

    const errors = [...checkUnknownFields(body), ...checkFields(body, { partial })];

    if (errors.length > 0) {
      return next(new AppError(errors.join('; '), 400));
    }

    // Write normalised values back so the controller never re-parses.
    if (typeof req.body.title === 'string') req.body.title = req.body.title.trim();
    if (typeof req.body.content === 'string') req.body.content = req.body.content.trim();
    if (typeof req.body.author === 'string') req.body.author = req.body.author.trim();
    if (typeof req.body.excerpt === 'string') req.body.excerpt = req.body.excerpt.trim();
    if (Object.prototype.hasOwnProperty.call(body, 'tags')) {
      req.body.tags = coerceTags(body.tags) ?? [];
    }

    return next();
  };

export const validateCreateBlog = buildValidator({ partial: false });
export const validateUpdateBlog = buildValidator({ partial: true });

/** Guard a malformed :id before it reaches Mongoose as a CastError. */
export const validateBlogId = (req, _res, next) => {
  const { id } = req.params;
  if (!/^[a-fA-F0-9]{24}$/.test(id)) {
    return next(new AppError(`"${id}" is not a valid blog id`, 400));
  }
  return next();
};

export default { validateCreateBlog, validateUpdateBlog, validateBlogId };
