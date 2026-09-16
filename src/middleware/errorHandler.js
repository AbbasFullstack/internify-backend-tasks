/**
 * Central error handling.
 *
 *   notFound          — no route matched (404)
 *   errorHandler      — every thrown/passed error (400 / 404 / 500)
 *
 * Mongoose's own errors are translated into the same response shape as our
 * AppError ones, so a client never has to special-case a stack trace.
 */
import AppError from '../utils/AppError.js';

/** Catch-all for unmatched routes. */
export const notFound = (req, _res, next) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
};

/** Translate a Mongoose error into an AppError, or return null. */
const translateMongooseError = (error) => {
  // Bad ObjectId reaching a query (e.g. a route we forgot to guard).
  if (error.name === 'CastError') {
    return new AppError(`Invalid value for "${error.path}": ${error.value}`, 400);
  }

  // Schema validation failure — flatten into one readable sentence.
  if (error.name === 'ValidationError') {
    const details = Object.values(error.errors).map((e) => e.message);
    return new AppError(details.join('; '), 400);
  }

  // Duplicate key on a unique index.
  if (error.code === 11000) {
    const field = Object.keys(error.keyValue || {}).join(', ') || 'field';
    return new AppError(`A record with that ${field} already exists`, 409);
  }

  // Malformed JSON body from express.json().
  if (error.type === 'entity.parse.failed' || error instanceof SyntaxError) {
    return new AppError('Request body contains invalid JSON', 400);
  }

  // Query arrived without a live DB connection.
  if (error.name === 'MongooseError' && /buffering timed out/i.test(error.message)) {
    return new AppError('Database unavailable — please try again shortly', 503);
  }

  return null;
};

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity (4)
export const errorHandler = (error, req, res, _next) => {
  const translated = translateMongooseError(error);

  const statusCode =
    translated?.statusCode ??
    error.statusCode ??
    (res.statusCode && res.statusCode !== 200 ? res.statusCode : 500);

  const message =
    translated?.message ??
    error.message ??
    'Internal server error';

  if (statusCode >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl} -> ${statusCode}`);
    console.error(error.stack);
  }

  res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    // Stack only outside production, to keep debugging possible in dev.
    ...(process.env.NODE_ENV === 'development' ? { stack: error.stack } : {}),
  });
};

export default { notFound, errorHandler };
