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
import { notFound, errorHandler } from './middleware/errorHandler.js';
import AppError from './utils/AppError.js';

const app = express();

// ---------------------------------------------------------------- middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Quiet during tests, verbose in development.
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ---------------------------------------------------------------- routes
app.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'Internify Backend Tasks — Books CRUD API + JWT authentication',
    endpoints: {
      health: 'GET /api/health',
      listBooks: 'GET /api/books',
      createBook: 'POST /api/books',
      getBook: 'GET /api/books/:id',
      updateBook: 'PUT /api/books/:id',
      deleteBook: 'DELETE /api/books/:id',
      signup: 'POST /api/auth/signup',
      login: 'POST /api/auth/login',
      profile: 'GET /api/auth/me (protected)',
      dashboard: 'GET /api/protected/dashboard (protected)',
    },
  });
});

/**
 * Health check reports the live DB state, which is the first thing you want
 * when a request is failing.
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
  });
});

app.use('/api/books', bookRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/protected', protectedRoutes);

// Unmatched route -> 404, then the central error handler.
app.use(notFound);
app.use(errorHandler);

export default app;
