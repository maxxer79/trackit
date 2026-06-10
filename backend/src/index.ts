import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { initSocket } from './socket/index';
import { scheduleAllProducts } from './workers/stockChecker';

// Routes
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import trackingRoutes from './routes/tracking';
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
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── API Routes ────────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);

// ─── 404 Handler ──────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// ─── Socket.io ────────────────────────────────────────────────────────────────

initSocket(httpServer);

// ─── Start Server ─────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3001');

httpServer.listen(PORT, async () => {
  console.log(`🚀 TrackIt backend running on port ${PORT}`);
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
});

export default app;
