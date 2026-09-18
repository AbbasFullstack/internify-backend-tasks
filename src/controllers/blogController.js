/**
 * Blog controllers — the only layer that talks to Mongoose.
 *
 * Every handler is wrapped in asyncHandler so a rejected promise reaches the
 * central error middleware, and failures throw AppError rather than responding
 * directly, keeping one response shape across the API.
 *
 * Ownership is enforced in the route, not here: by the time `updateBlog` or
 * `deleteBlog` runs, `loadResource` has fetched the document and
 * `requireOwnership` has confirmed the caller owns it or is an admin.
 *
 * Two things specific to this resource:
 *
 *  - Uploaded files are cleaned up on failure by `cleanupUploadOnError`, which
 *    sits in the error pipeline rather than in these handlers — a request
 *    rejected in middleware never reaches a controller.
 *  - The confirmation email must never fail the request.
 *    `sendPostConfirmation` resolves with `{ sent, reason }` instead of
 *    throwing, and the outcome is reported in the response.
 */
import Blog from '../models/Blog.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { fileToImageRef, removeUploadedFile } from '../config/upload.js';
import { sendPostConfirmation } from '../utils/mailer.js';

/** Uniform success envelope so clients parse one shape everywhere. */
const ok = (res, statusCode, data, message) =>
  res.status(statusCode).json({ success: true, message, data });

/**
 * POST /api/blogs
 * Create a post. Body validated by validateCreateBlog; the optional image is
 * already on disk thanks to Multer.
 */
export const createBlog = asyncHandler(async (req, res) => {
  const { title, content, author, excerpt, tags } = req.body;

  const image = fileToImageRef(req.file);
  const slug = await Blog.buildUniqueSlug(title);

  const post = await Blog.create({
    title,
    slug,
    content,
    author,
    excerpt,
    tags,
    image,
    // Ownership comes from the authenticated caller, never the body.
    createdBy: req.user.id,
  });

  // Best-effort: a mail failure is reported, never thrown.
  const email = await sendPostConfirmation({
    to: req.user.email,
    author: post.author,
    title: post.title,
    excerpt: post.excerpt,
  });

  return ok(
    res,
    201,
    {
      post,
      notification: email.sent ? { sent: true } : { sent: false, reason: email.reason },
    },
    email.sent
      ? 'Blog post created and confirmation email sent'
      : 'Blog post created; confirmation email not sent'
  );
});

/**
 * GET /api/blogs
 * Public list with pagination and search.
 *   ?page=1&limit=10&search=&tag=&author=&sort=newest|oldest
 */
export const getBlogs = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(
    Math.max(1, Number.parseInt(req.query.limit, 10) || 10),
    100 // hard ceiling so one request cannot ask for everything
  );
  const skip = (page - 1) * limit;

  const filter = {};

  if (req.query.search) {
    // Escape regex metacharacters: without this, `?search=.*` returns every
    // document and `?search=(` throws a 500 from an invalid regex.
    const term = String(req.query.search)
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { title: { $regex: term, $options: 'i' } },
      { content: { $regex: term, $options: 'i' } },
      { author: { $regex: term, $options: 'i' } },
    ];
  }

  if (req.query.tag) filter.tags = String(req.query.tag).trim().toLowerCase();

  if (req.query.author) {
    const who = String(req.query.author).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.author = { $regex: who, $options: 'i' };
  }

  const sort = req.query.sort === 'oldest' ? { createdAt: 1 } : { createdAt: -1 };

  // One filter object drives both, so total and page can never disagree.
  const [posts, total] = await Promise.all([
    Blog.find(filter).sort(sort).skip(skip).limit(limit),
    Blog.countDocuments(filter),
  ]);

  const pages = Math.max(1, Math.ceil(total / limit));

  return ok(
    res,
    200,
    {
      posts,
      pagination: { total, page, limit, pages, hasNext: page < pages, hasPrev: page > 1 },
    },
    'Blog posts fetched'
  );
});

/**
 * GET /api/blogs/mine
 * The caller's own posts. Declared before /:id in the router.
 */
export const getMyBlogs = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(Math.max(1, Number.parseInt(req.query.limit, 10) || 10), 100);

  const filter = { createdBy: req.user.id };
  const [posts, total] = await Promise.all([
    Blog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Blog.countDocuments(filter),
  ]);

  return ok(
    res,
    200,
    {
      posts,
      pagination: {
        total,
        page,
        limit,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    },
    'Your blog posts fetched'
  );
});

/** GET /api/blogs/:id — public single read. */
export const getBlogById = asyncHandler(async (req, res) => {
  // loadResource has already fetched it onto req.resource.
  return ok(res, 200, { post: req.resource }, 'Blog post fetched');
});

/** GET /api/blogs/slug/:slug — public read by slug. */
export const getBlogBySlug = asyncHandler(async (req, res) => {
  const post = await Blog.findOne({ slug: String(req.params.slug).toLowerCase() });
  if (!post) throw new AppError(`No blog post with slug "${req.params.slug}"`, 404);
  return ok(res, 200, { post }, 'Blog post fetched');
});

/**
 * PUT /api/blogs/:id
 * Owner or admin. Replacing the image deletes the previous file.
 */
export const updateBlog = asyncHandler(async (req, res) => {
  const post = req.resource; // set by loadResource
  const { title, content, author, excerpt, tags } = req.body;

  if (title !== undefined) {
    post.title = title;
    // The title changed, so the slug should follow — unless it collides.
    post.slug = await Blog.buildUniqueSlug(title, post._id);
  }
  if (content !== undefined) post.content = content;
  if (author !== undefined) post.author = author;
  if (excerpt !== undefined) post.excerpt = excerpt;
  if (tags !== undefined) post.tags = tags;

  if (req.file) {
    const previous = post.image?.filename ? { ...post.image } : null;
    post.image = fileToImageRef(req.file);

    // Save first. Only then is it safe to delete the old file — the reverse
    // order would destroy the image the stored document still points at if
    // the save then failed.
    await post.save();
    if (previous) await removeUploadedFile(previous);

    return ok(res, 200, { post }, 'Blog post updated and image replaced');
  }

  await post.save();
  return ok(res, 200, { post }, 'Blog post updated');
});

/**
 * DELETE /api/blogs/:id
 * Owner or admin. The uploaded file is removed too.
 */
export const deleteBlog = asyncHandler(async (req, res) => {
  const post = req.resource;

  await post.deleteOne();

  // After the document is gone, so a file-removal problem cannot leave a
  // deleted post behind. removeUploadedFile swallows its own errors.
  if (post.image?.filename) await removeUploadedFile(post.image);

  return ok(res, 200, { post }, 'Blog post deleted');
});

/**
 * DELETE /api/blogs/:id/image
 * Remove just the image, keeping the post.
 */
export const deleteBlogImage = asyncHandler(async (req, res) => {
  const post = req.resource;

  if (!post.image?.filename) {
    throw new AppError('This post has no image to remove', 404);
  }

  const previous = { ...post.image };
  post.image = undefined;
  await post.save();
  await removeUploadedFile(previous);

  return ok(res, 200, { post }, 'Blog post image removed');
});

export default {
  createBlog,
  getBlogs,
  getMyBlogs,
  getBlogById,
  getBlogBySlug,
  updateBlog,
  deleteBlog,
  deleteBlogImage,
};
