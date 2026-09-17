/**
 * Create or promote an administrator.
 *
 *   node scripts/make-admin.js <email>                 # promote existing user
 *   node scripts/make-admin.js <email> <password>       # create if missing
 *
 * Why this exists: the first admin cannot be made through the API. Signup
 * deliberately refuses a `role` field, and /api/admin/users/:id/role requires an
 * admin to call it — a closed loop with no entry point. This script is the
 * entry point, run by someone who already has server access.
 *
 * It is idempotent: running it again just re-asserts the admin role.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';
import User, { ROLES } from '../src/models/User.js';

const [, , emailArg, passwordArg] = process.argv;

if (!emailArg) {
  console.error('Usage: node scripts/make-admin.js <email> [password]');
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();

const run = async () => {
  await connectDB();

  const existing = await User.findOne({ email });

  if (existing) {
    if (existing.role === ROLES.ADMIN) {
      console.log(`[make-admin] ${email} is already an admin — nothing to do`);
    } else {
      existing.role = ROLES.ADMIN;
      await existing.save();
      console.log(`[make-admin] promoted ${email} from user to admin`);
    }
  } else {
    if (!passwordArg) {
      console.error(
        `[make-admin] no account for ${email}. Pass a password to create one:\n` +
          '  node scripts/make-admin.js <email> <password>'
      );
      await mongoose.disconnect();
      process.exit(1);
    }

    // Created with role admin directly — the pre-save hook still hashes the
    // password, so this is the same path normal signup takes.
    const created = await User.create({
      name: 'Administrator',
      email,
      password: passwordArg,
      role: ROLES.ADMIN,
    });
    console.log(`[make-admin] created admin ${created.email}`);
  }

  const total = await User.countDocuments({ role: ROLES.ADMIN });
  console.log(`[make-admin] admin accounts now: ${total}`);

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('[make-admin] failed:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
