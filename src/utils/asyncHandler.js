/**
 * Wraps an async route handler so a rejected promise is forwarded to
 * Express's error middleware instead of becoming an unhandled rejection.
 *
 * Without this every async controller needs its own try/catch.
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export default asyncHandler;
