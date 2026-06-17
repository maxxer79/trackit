import { z } from 'zod';

/**
 * Central request-body schemas. Keep these aligned with what each controller
 * reads from `req.body` (and with prisma/schema.prisma column types) — the
 * validate() middleware strips any key not listed here, so an omitted field
 * a handler relies on would silently disappear.
 *
 * Note on email: we validate format + trim but deliberately DO NOT lowercase
 * here. Existing accounts may have been stored with mixed-case emails before
 * normalization existed; lowercasing at login would break those sign-ins.
 * updateProfile normalizes case itself where it's safe to do so.
 */

const emailField = z.string().trim().email('Please enter a valid email address');
const newPasswordField = z.string().min(8, 'Password must be at least 8 characters');

// ── Auth ──────────────────────────────────────────────────────────────────────

export const registerSchema = z.object({
  email: emailField,
  password: newPasswordField,
  name: z.string().trim().min(1, 'Name is required'),
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Password is required'),
});

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1, 'Name cannot be empty').optional(),
    email: emailField.optional(),
    emailAlerts: z.boolean().optional(),
    pushAlerts: z.boolean().optional(),
    browserAlerts: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: newPasswordField,
});

// ── Tracking ────────────────────────────────────────────────────────────────

export const addTrackingSchema = z.object({
  productId: z.string().min(1, 'productId is required'),
  // Frontend sends this; addTracking doesn't persist it yet, but keep it in the
  // schema so validate() doesn't silently strip it if the handler starts using it.
  watchStores: z.array(z.string()).optional(),
});

// ── Comments ──────────────────────────────────────────────────────────────────

export const createCommentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Comment cannot be empty')
    .max(1000, 'Comment too long (max 1000 chars)'),
});

// ── Notification preferences (Settings → Notification Channels) ────────────────
// Empty strings are allowed for phone/discordWebhook so the user can clear them.

export const updatePreferencesSchema = z.object({
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  discordEnabled: z.boolean().optional(),
  autoBuyEnabled: z.boolean().optional(),
  // nullish: the GET→PUT round-trip sends null for an unset phone/webhook.
  phone: z.string().trim().nullish(),
  discordWebhook: z
    .union([z.string().url('Enter a valid webhook URL'), z.literal('')])
    .nullish(),
});

// ── Admin: products & store listings ──────────────────────────────────────────
// Admin routes are already JWT + requireAdmin gated; these schemas mainly guard
// the product URL (which feeds the scrapers) and the image URL format. Optional
// fields stay permissive to avoid rejecting valid admin-UI payloads.

const optionalUrl = z.union([z.string().url(), z.literal('')]).nullish();

export const createProductSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  slug: z.string().trim().min(1).optional(),
  imageUrl: optionalUrl,
  category: z.string().nullish(),
  description: z.string().nullish(),
  modelNumber: z.string().nullish(),
  tags: z.array(z.string()).optional(),
  isFeatured: z.boolean().optional(),
  isNew: z.boolean().optional(),
});

export const addStoreProductSchema = z.object({
  productId: z.string().min(1, 'productId is required'),
  storeId: z.string().min(1, 'storeId is required'),
  url: z.string().url('Enter a valid product URL'),
  price: z.number().nullish(),
});

export const updateStockSchema = z.object({
  inStock: z.boolean().optional(),
  stockStatus: z
    .enum(['IN_STOCK', 'OUT_OF_STOCK', 'LIMITED', 'PREORDER', 'UNKNOWN'])
    .optional(),
});

// ── Admin: users ──────────────────────────────────────────────────────────────

export const createAdminUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: emailField,
  password: newPasswordField,
  role: z.enum(['USER', 'ADMIN']).optional(),
  trackingLimit: z.number().int().optional(),
});

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    email: emailField.optional(),
    password: newPasswordField.optional(),
    role: z.enum(['USER', 'ADMIN']).optional(),
    trackingLimit: z.coerce.number().int().optional(), // createForm sends '10' as a string
    isActive: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });
