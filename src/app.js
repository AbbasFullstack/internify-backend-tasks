/**
 * Express application wiring.
 *
 * Exported separately from server.js so tests can import the app and drive it
 * with supertest — no open port, no real MongoDB required for unit checks.
 */
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import mongoose from 'mongoose';

import bookRoutes from './routes/bookRoutes.js';
import authRoutes from './routes/authRoutes.js';
import protectedRoutes from './routes/protectedRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import blogRoutes from './routes/blogRoutes.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { securityHeaders, globalLimiter } from './middleware/security.js';
import { UPLOAD_ROOT, cleanupUploadOnError } from './config/upload.js';

const app = express();

// ---------------------------------------------------------------- middleware
// Security headers first, so they are attached even to error responses.
app.use(securityHeaders);

app.use(cors());
// Body caps. Images do NOT travel through these parsers — Multer streams them
// to disk — so a small JSON ceiling is a defence, not a limitation.
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Rate limit after the body parsers so a rejected request is still cheap, but
// before the routes so nothing downstream runs for a throttled caller.
app.use(globalLimiter);

// Quiet during tests, verbose in development.
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ---------------------------------------------------------------- static files
/**
 * Uploaded images, served read-only from the uploads directory.
 *
 * `dotfiles: 'deny'` and no directory listing matter here: this is the one
 * place a request can name a file on disk, so it must not be able to walk
 * outside the folder or enumerate it.
 */
app.use(
  '/uploads',
  express.static(UPLOAD_ROOT, { dotfiles: 'deny', index: false, maxAge: '1d' })
);

// ---------------------------------------------------------------- routes
app.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    message:
      'Internify Backend Tasks — CRUD API, JWT auth, RBAC, and a blog with file upload',
    endpoints: {
      health: 'GET /api/health',

      signup: 'POST /api/auth/signup',
      login: 'POST /api/auth/login',
      profile: 'GET /api/auth/me (protected)',
      dashboard: 'GET /api/protected/dashboard (protected)',

      listBooks: 'GET /api/books?page=1&limit=10&search=&author=&genre=',
      createBook: 'POST /api/books (protected)',
      myBooks: 'GET /api/books/mine (protected)',
      getBook: 'GET /api/books/:id',
      updateBook: 'PUT /api/books/:id (owner or admin)',
      deleteBook: 'DELETE /api/books/:id (owner or admin)',

      listBlogs: 'GET /api/blogs?page=1&limit=10&search=&tag=&author=&sort=',
      createBlog: 'POST /api/blogs (protected, multipart: image field "image")',
      myBlogs: 'GET /api/blogs/mine (protected)',
      blogBySlug: 'GET /api/blogs/slug/:slug',
      getBlog: 'GET /api/blogs/:id',
      updateBlog: 'PUT /api/blogs/:id (owner or admin, multipart)',
      deleteBlog: 'DELETE /api/blogs/:id (owner or admin)',
      deleteBlogImage: 'DELETE /api/blogs/:id/image (owner or admin)',

      listUsers: 'GET /api/admin/users (admin)',
      getUser: 'GET /api/admin/users/:id (admin)',
      updateUserRole: 'PATCH /api/admin/users/:id/role (admin)',
      deleteUser: 'DELETE /api/admin/users/:id (admin)',
    },
  });
});

/**
 * Health check reports the live DB state and whether email is configured —
 * the two things you want first when a request is failing.
 */
app.get('/api/health', (_req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const dbState = states[mongoose.connection.readyState] || 'unknown';

  res.status(200).json({
    success: true,
    message: 'Service healthy',
    uptime: Number(process.uptime().toFixed(2)),
    environment: process.env.NODE_ENV || 'development',
    database: dbState,
    emailConfigured: Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS),
  });
});

app.use('/api/books', bookRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/protected', protectedRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/blogs', blogRoutes);

// Error pipeline. `cleanupUploadOnError` is a 4-arity handler, so Express skips
// every normal middleware and lands here first when a route throws — which is
// what removes an uploaded file on any downstream rejection (400 from the body
// rules, 403 from the ownership guard, 500 from Mongo). It re-throws, so the
// response itself is still produced by the central error handler below.
app.use(cleanupUploadOnError);
app.use(notFound);
app.use(errorHandler);

export default app;
