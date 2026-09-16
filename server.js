/**
 * Application entry point.
 *
 * Responsibilities are deliberately thin: load environment variables,
 * connect to MongoDB, start the HTTP server, and shut down cleanly.
 * All Express wiring lives in `src/app.js` so the app can be imported
 * directly by the test suite without opening a real port.
 */
import 'dotenv/config';
import app from './src/app.js';
import connectDB from './src/config/db.js';

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();

  const server = app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`[server] environment: ${process.env.NODE_ENV || 'development'}`);
  });

  // Fail loudly rather than leaving a half-dead process behind.
  const shutdown = (signal) => async (error) => {
    if (error) {
      console.error(`[server] ${signal} error:`, error);
      process.exitCode = 1;
    }
    server.close(() => {
      console.log(`[server] ${signal} received — shutting down`);
      process.exit(process.exitCode || 0);
    });
  };

  process.on('unhandledRejection', shutdown('unhandledRejection'));
  process.on('uncaughtException', shutdown('uncaughtException'));

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(() => {
        console.log(`[server] ${signal} received — shutting down`);
        process.exit(0);
      });
    });
  }
};

start().catch((error) => {
  console.error('[server] failed to start:', error.message);
  process.exit(1);
});
