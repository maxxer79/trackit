import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { initSocket } from './socket/index';
import { scheduleAllProducts, getWorkerHealth } from './workers/stockChecker';
import { pruneOldRecords } from './workers/prune';
import { errorHandler } from './middleware/errorHandler';
import { BACKEND_VERSION } from './version';

// Routes
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import trackingRoutes from './routes/tracking';
import purchaseRoutes from './routes/purchases';
import storeRoutes from './routes/stores';
import adminRoutes from './routes/admin';
import notificationRoutes from './routes/notifications';

const app = express();
const httpServer = http.createServer(app);

// Running behind a reverse proxy (nginx frontend container) — trust the
// first proxy hop so express-rate-limit sees real client IPs instead of
// throwing ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

// ─── Security & Middleware ─────────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: false, // handled by frontend
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Rate Limiting ─────────────────────────────────────────────────────────────

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: parseInt(process.env.RATE_LIMIT_MAX || '300'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  // Admin routes are JWT-protected and include bulk operations like
  // "Test All Scrapers" (60+ requests at once) — don't rate-limit them.
  skip: (req) => req.path.startsWith('/admin'),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many authentication attempts, please try again later.' },
});

app.use('/api', globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ─── Health Check ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: BACKEND_VERSION, timestamp: new Date().toISOString() });
});

// Also reachable through the frontend proxy at /api/health
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: BACKEND_VERSION, timestamp: new Date().toISOString() });
});

// Worker liveness — unlike /health (HTTP only), this reports whether the Bull
// scheduler is actually alive and checking (Redis reachable + recent scrapes).
// Returns 503 when unhealthy so a monitor can alert on a silently-dead worker.
const workerHealthHandler = async (_req: express.Request, res: express.Response): Promise<void> => {
  try {
    const health = await getWorkerHealth();
    res.status(health.healthy ? 200 : 503).json(health);
  } catch (err: any) {
    res.status(503).json({ healthy: false, error: err.message });
  }
};
app.get('/health/worker', workerHealthHandler);
app.get('/api/health/worker', workerHealthHandler);

// ─── API Routes ────────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);

// ─── 404 Handler ──────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
// Central handler: maps AppError subclasses to their statusCode/code and logs
// via winston (see middleware/errorHandler.ts and errors/).

app.use(errorHandler);

// ─── Socket.io ────────────────────────────────────────────────────────────────

initSocket(httpServer);

// ─── Start Server ─────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3001');

/**
 * Idempotent additive schema sync — the container doesn't run prisma
 * migrations on boot, so new optional columns are added here.
 */
async function ensureSchema(): Promise<void> {
  try {
    const { prisma } = await import('./config/database');
    await prisma.$executeRawUnsafe('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "modelNumber" TEXT');
    await prisma.$executeRawUnsafe('ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "isRead" BOOLEAN NOT NULL DEFAULT false');
    await prisma.$executeRawUnsafe('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notifyPriceDrop" BOOLEAN NOT NULL DEFAULT false');
    await prisma.$executeRawUnsafe('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notifyLowStock" BOOLEAN NOT NULL DEFAULT false');
    await prisma.$executeRawUnsafe(`ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'LOW_STOCK'`);
    await prisma.$executeRawUnsafe('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false');
    await prisma.$executeRawUnsafe('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "quietHoursStart" INTEGER');
    await prisma.$executeRawUnsafe('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "quietHoursEnd" INTEGER');
    await prisma.$executeRawUnsafe('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezone" TEXT');
    await prisma.$executeRawUnsafe('ALTER TABLE "trackings" ADD COLUMN IF NOT EXISTS "note" TEXT');
    await prisma.$executeRawUnsafe(`ALTER TABLE "trackings" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT '{}'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "store_products" ADD COLUMN IF NOT EXISTS "condition" TEXT NOT NULL DEFAULT 'NEW'`);
    await prisma.$executeRawUnsafe('ALTER TABLE "trackings" ADD COLUMN IF NOT EXISTS "alertMaxPrice" DECIMAL');
    await prisma.$executeRawUnsafe(`ALTER TABLE "trackings" ADD COLUMN IF NOT EXISTS "alertDays" INTEGER[] NOT NULL DEFAULT '{}'`);

    // Performance indexes. Applied here rather than via `prisma migrate` (which
    // we don't run on boot); IF NOT EXISTS makes this safe to re-run every boot.
    // Names match Prisma's @@index convention (<table>_<col>_idx) so a future
    // `prisma migrate` stays idempotent. Supersedes the earlier
    // idx_scraper_logs_created_at index (renamed to the Prisma convention).
    await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "idx_scraper_logs_created_at"');

    // AutoBuy audit table (no prisma migrate on boot — create it here to match
    // the AutoBuyAttempt model in schema.prisma). Column types/names mirror what
    // Prisma generates so the client and the physical table agree.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "autobuy_attempts" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "productId" TEXT NOT NULL,
        "storeSlug" TEXT NOT NULL,
        "storeName" TEXT,
        "productUrl" TEXT,
        "price" DOUBLE PRECISION,
        "maxPrice" DOUBLE PRECISION,
        "outcome" TEXT NOT NULL,
        "message" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Purchases / delivery tracking table (created here to match the Purchase
    // model in schema.prisma — no prisma migrate on boot).
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "purchases" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "productId" TEXT NOT NULL,
        "productName" TEXT NOT NULL,
        "productSlug" TEXT,
        "storeName" TEXT,
        "storeSlug" TEXT,
        "price" DECIMAL,
        "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "carrier" TEXT,
        "trackingNumber" TEXT,
        "status" TEXT NOT NULL DEFAULT 'ORDERED',
        "deliveredAt" TIMESTAMP(3),
        "note" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const indexes = [
      'CREATE INDEX IF NOT EXISTS "trackings_productId_idx" ON "trackings" ("productId")',
      'CREATE INDEX IF NOT EXISTS "purchases_userId_purchasedAt_idx" ON "purchases" ("userId", "purchasedAt")',
      'CREATE INDEX IF NOT EXISTS "store_products_storeId_idx" ON "store_products" ("storeId")',
      'CREATE INDEX IF NOT EXISTS "alerts_userId_idx" ON "alerts" ("userId")',
      'CREATE INDEX IF NOT EXISTS "notifications_userId_idx" ON "notifications" ("userId")',
      'CREATE INDEX IF NOT EXISTS "comments_productId_idx" ON "comments" ("productId")',
      'CREATE INDEX IF NOT EXISTS "push_tokens_userId_idx" ON "push_tokens" ("userId")',
      'CREATE INDEX IF NOT EXISTS "scraper_logs_createdAt_idx" ON "scraper_logs" ("createdAt")',
      'CREATE INDEX IF NOT EXISTS "autobuy_attempts_userId_createdAt_idx" ON "autobuy_attempts" ("userId", "createdAt")',
      'CREATE INDEX IF NOT EXISTS "autobuy_attempts_createdAt_idx" ON "autobuy_attempts" ("createdAt")',
    ];
    for (const sql of indexes) {
      await prisma.$executeRawUnsafe(sql);
    }
    console.log('✅ Schema sync complete');
  } catch (err: any) {
    console.error('⚠️ Schema sync failed:', err.message);
  }
}

httpServer.listen(PORT, async () => {
  console.log(`🚀 TrackIt backend v${BACKEND_VERSION} running on port ${PORT}`);
  await ensureSchema();
  console.log(`📡 Socket.io initialized`);

  // Start stock checker worker and schedule all active products.
  // Retry on failure — if Redis isn't reachable at boot the scheduler
  // silently dying means NO automatic stock checks ever run.
  const trySchedule = async (attempt = 1): Promise<void> => {
    try {
      await scheduleAllProducts();
      console.log('\u2705 Stock check scheduling active');
    } catch (err: any) {
      console.error(`Failed to schedule products (attempt ${attempt}/10):`, err.message);
      if (attempt < 10) {
        setTimeout(() => trySchedule(attempt + 1), 30000);
      } else {
        console.error('\u274c GAVE UP scheduling stock checks \u2014 check REDIS_HOST/REDIS_PASSWORD env vars!');
      }
    }
  };
  await trySchedule();

  // Retention housekeeping: prune old ScraperLog / StockEvent rows once shortly
  // after boot, then daily. deleteMany on an indexed createdAt is cheap; failures
  // are swallowed inside pruneOldRecords so this never affects serving.
  setTimeout(() => void pruneOldRecords(), 60_000);
  setInterval(() => void pruneOldRecords(), 24 * 60 * 60 * 1000);
});

export default app;
