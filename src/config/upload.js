/**
 * Multer upload configuration.
 *
 * Storage is disk, under `uploads/blogs/`. The database stores a *reference*
 * (filename, url, mimetype, size, absolute path) rather than the bytes — a
 * 2 MB image in a document would bloat every query that returns a post.
 *
 * Three limits, each for a different reason:
 *  - fileSize     stops one request filling the disk
 *  - files        stops a batch arriving in one request
 *  - fileFilter   stops a .php/.svg being stored and later served as a script.
 *                 It matches the extension AND the declared mimetype, since
 *                 either alone is trivially spoofable.
 *
 * The filename is generated, never taken from the client: a client-supplied
 * name can contain `../` or collide with an existing file.
 */
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import AppError from '../utils/AppError.js';

const PROJECT_ROOT = path.resolve(process.cwd());

export const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(PROJECT_ROOT, 'uploads');

export const BLOG_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'blogs');

// Created eagerly so the first upload does not fail on a missing directory.
fs.mkdirSync(BLOG_UPLOAD_DIR, { recursive: true });

export const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES || 2 * 1024 * 1024);

export const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
export const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BLOG_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `blog-${unique}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(
      new AppError(
        `Unsupported file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
        400
      )
    );
  }

  if (!ALLOWED_MIMETYPES.includes(file.mimetype)) {
    return cb(
      new AppError(`Unsupported content type "${file.mimetype}". Send an image file.`, 400)
    );
  }

  return cb(null, true);
};

/** A single image field named `image`. */
export const uploadBlogImage = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 20 },
}).single('image');

/**
 * Translate Multer's own errors into the app's error shape.
 *
 * Multer throws MulterError with codes like LIMIT_FILE_SIZE, which would
 * otherwise surface as an opaque 500. Wrapping them keeps every client-facing
 * failure a 400 with a sentence a human can act on.
 */
export const handleUploadErrors = (err, _req, _res, next) => {
  if (!err) return next();

  if (err.code === 'LIMIT_FILE_SIZE') {
    return next(
      new AppError(
        `Image is too large. Maximum size is ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(1)} MB`,
        400
      )
    );
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return next(new AppError('Only one image may be uploaded per post', 400));
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return next(
      new AppError(`Unexpected file field "${err.field}". Send the image as "image".`, 400)
    );
  }

  return next(err);
};

/**
 * Delete an uploaded file from disk, ignoring "already gone".
 *
 * Failure is logged and swallowed: a leftover file is untidy, but it must never
 * turn a successful delete into a 500.
 */
export const removeUploadedFile = async (imageRef) => {
  if (!imageRef?.filename) return false;

  // Rebuild from the filename rather than trusting a stored absolute path, so a
  // tampered document cannot point the delete at /etc/passwd.
  const safeName = path.basename(imageRef.filename);
  const target = path.join(BLOG_UPLOAD_DIR, safeName);

  try {
    await fs.promises.unlink(target);
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[upload] could not remove ${safeName}: ${error.message}`);
    }
    return false;
  }
};

/**
 * Remove the just-uploaded file when a later middleware rejects the request.
 *
 * Multer writes to disk *before* validation or authorisation runs, so a 400
 * from the body rules or a 403 from the ownership guard would otherwise leave
 * an orphan behind. A controller's own catch cannot cover this, because a
 * request rejected in middleware never reaches a controller.
 *
 * This is a 4-arity error handler, so Express routes every downstream failure
 * here. The delete is awaited before the error is re-thrown, which makes the
 * cleanup finish before the response is sent — deterministic, not a race.
 *
 * Note the arity: `_next` must stay in the signature or Express treats this as
 * ordinary middleware and it never sees an error.
 */
export const cleanupUploadOnError = async (err, req, _res, next) => {
  if (req.file) {
    try {
      await removeUploadedFile({ filename: req.file.filename });
    } catch {
      // A stray file is untidy but must never mask the real error.
    }
  }
  next(err);
};

/**
 * Build the stored reference for a successfully uploaded file.
 * Returns null when no file was sent, so `image` stays optional.
 */
export const fileToImageRef = (file) => {
  if (!file) return null;
  return {
    filename: file.filename,
    url: `/uploads/blogs/${file.filename}`,
    mimetype: file.mimetype,
    size: file.size,
    path: file.path,
  };
};
