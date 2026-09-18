/**
 * Blog model.
 *
 * Fields:
 *  - title    : required, 3–180 chars
 *  - slug     : derived from the title, unique
 *  - content  : required, at least 20 chars
 *  - author   : required display name
 *  - image    : optional; a *reference* to an uploaded file, not the bytes
 *  - createdBy: required ref to the owning User
 *
 * `image` is an object rather than a bare string so a client never has to
 * build a URL and a delete never has to guess which file to remove. The
 * absolute disk path is `select: false` and stripped in `toJSON`, because
 * publishing the server's directory layout is a needless disclosure.
 */
import mongoose from 'mongoose';

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);

const blogSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      minlength: [3, 'Title must be at least 3 characters'],
      maxlength: [180, 'Title cannot exceed 180 characters'],
    },
    slug: { type: String, unique: true, index: true, lowercase: true },
    content: {
      type: String,
      required: [true, 'Content is required'],
      trim: true,
      minlength: [20, 'Content must be at least 20 characters'],
    },
    author: {
      type: String,
      required: [true, 'Author is required'],
      trim: true,
      maxlength: [120, 'Author cannot exceed 120 characters'],
    },
    excerpt: {
      type: String,
      trim: true,
      maxlength: [300, 'Excerpt cannot exceed 300 characters'],
    },
    tags: {
      type: [String],
      default: [],
      // Normalise so "Node", " node " and "NODE" do not become three tags,
      // and drop exact repeats.
      set: (tags) => {
        const list = Array.isArray(tags) ? tags : String(tags).split(',');
        const cleaned = list.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
        return [...new Set(cleaned)];
      },
    },
    image: {
      filename: { type: String },
      url: { type: String },
      mimetype: { type: String },
      size: { type: Number },
      // Server-side only — never sent to a client.
      path: { type: String, select: false },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'A blog post must have an owner'],
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        if (ret.image) delete ret.image.path;
        return ret;
      },
    },
  }
);

blogSchema.index({ title: 'text', content: 'text', author: 'text', tags: 'text' });
blogSchema.index({ createdAt: -1 });
blogSchema.index({ tags: 1 });

/**
 * Unique slug for a title. Suffixes `-2`, `-3`, … on collision rather than
 * failing, because two posts may legitimately share a title.
 */
blogSchema.statics.buildUniqueSlug = async function buildUniqueSlug(title, ignoreId = null) {
  const base = slugify(title) || 'post';
  let candidate = base;
  let n = 1;

  while (n < 200) {
    const query = { slug: candidate };
    if (ignoreId) query._id = { $ne: ignoreId };
    const existing = await this.exists(query);
    if (!existing) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }

  return `${base}-${Date.now()}`;
};

/** Owner or admin. */
blogSchema.methods.isOwnedBy = function isOwnedBy(user) {
  if (!user) return false;
  if (user.isAdmin?.()) return true;
  return String(this.createdBy) === String(user.id ?? user._id);
};

const Blog = mongoose.model('Blog', blogSchema);

export { slugify };
export default Blog;
