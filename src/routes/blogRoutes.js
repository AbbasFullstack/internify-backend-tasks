/**
 * Blog routes — URL shape and the access rule for each one.
 *
 * Reads are public so the blog is browsable without an account. Every write
 * requires a valid token, and edits are limited to the caller's own posts
 * (admins excepted). The middleware chain is where that lives, so each
 * controller stays free of permission logic.
 *
 * Chain order matters:
 *   upload -> id guard -> load -> ownership -> body validation
 *
 * Upload runs first because Multer must consume the multipart stream before
 * anything can read `req.body`. Then the id guard (so a malformed id never
 * costs a body parse), then the fetch, then the ownership decision, and only
 * then the body rules — so a 404 is never reported as a 400.
 */
import { Router } from 'express';
import {
  createBlog,
  getBlogs,
  getMyBlogs,
  getBlogById,
  getBlogBySlug,
  updateBlog,
  deleteBlog,
  deleteBlogImage,
} from '../controllers/blogController.js';
import {
  validateCreateBlog,
  validateUpdateBlog,
  validateBlogId,
} from '../middleware/validateBlog.js';
import { protect } from '../middleware/authMiddleware.js';
import { loadResource, requireOwnership } from '../middleware/roleMiddleware.js';
import { uploadBlogImage, handleUploadErrors } from '../config/upload.js';
import { writeLimiter } from '../middleware/security.js';
import Blog from '../models/Blog.js';

const router = Router();

// ---------------------------------------------------------------- collection
router
  .route('/')
  // Public: anyone may read the blog.
  .get(getBlogs)
  // Protected: any logged-in user may post; the post is owned by them.
  // writeLimiter because each create also spends an email.
  .post(
    protect,
    writeLimiter,
    uploadBlogImage,
    handleUploadErrors,
    validateCreateBlog,
    createBlog
  );

// ------------------------------------------------------- literal routes first
/**
 * Declared before `/:id` on purpose. Express matches in order, so if `/:id`
 * came first then "mine" would be treated as an id and rejected with a 400.
 */
router.get('/mine', protect, getMyBlogs);
router.get('/slug/:slug', getBlogBySlug);

// --------------------------------------------------------------------- single
router
  .route('/:id')
  // Public read. loadResource fetches onto req.resource so the controller and
  // the ownership guard share one query.
  .get(validateBlogId, loadResource(Blog, 'blog post'), getBlogById)
  // Owner or admin only.
  .put(
    protect,
    validateBlogId,
    uploadBlogImage,
    handleUploadErrors,
    loadResource(Blog, 'blog post'),
    requireOwnership(),
    validateUpdateBlog,
    updateBlog
  )
  .delete(
    protect,
    validateBlogId,
    loadResource(Blog, 'blog post'),
    requireOwnership(),
    deleteBlog
  );

// ------------------------------------------------------------ image sub-route
router.delete(
  '/:id/image',
  protect,
  validateBlogId,
  loadResource(Blog, 'blog post'),
  requireOwnership(),
  deleteBlogImage
);

export default router;
