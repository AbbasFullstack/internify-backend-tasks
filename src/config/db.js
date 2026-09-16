/**
 * MongoDB connection helper.
 *
 * Mongoose buffers queries by default, which makes a misconfigured URI look
 * like a hang instead of an error. We set `bufferCommands: false` so a request
 * arriving before/without a connection fails fast and visibly.
 */
import mongoose from 'mongoose';

const connectDB = async () => {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('[db] MONGO_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  mongoose.set('strictQuery', true);

  try {
    const conn = await mongoose.connect(uri, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 10000,
    });

    console.log(`[db] MongoDB connected: ${conn.connection.host}`);

    mongoose.connection.on('error', (error) => {
      console.error('[db] connection error:', error.message);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('[db] MongoDB disconnected');
    });

    return conn;
  } catch (error) {
    console.error(`[db] connection failed: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
