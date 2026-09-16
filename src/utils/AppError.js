/**
 * A tiny AppError used to attach an HTTP status code to a thrown error.
 * The central error handler reads `.statusCode` to decide the response.
 */
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;
