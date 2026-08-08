import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import trackingRoutes from './routes/tracking';
import purchaseRoutes from './routes/purchases';
import scraperReportRoutes from './routes/scraperReports';
import { screenshotDir } from './services/screenshot';
import adminRoutes from './routes/admin';
import notificationRoutes from './routes/notifications';
import userRoutes from './routes/users';
import zipCheckRoutes from './routes/zipCheck';
import { errorHandler } from './middleware/errorHandler';
import logger from './utils/logger';

// ⚠️  THIS FILE IS NOT THE PRODUCTION SERVER. ⚠️
//
// src/index.ts builds its OWN express app and does not import this one — as of
// 2026-08-08 nothing in the codebase imports app.ts at all. A route registered
// here alone will 404 in production (index.ts's 404 handler returns
// {"error":"Not found"}, vs {"error":"Route not found"} here — that byte
// difference is the fastest way to tell which app answered you).
//
// Register new routes in src/index.ts. Ideally delete this file, or make
// index.ts import it, so the two can't drift again.
const app = express();

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  message: { error: 'Too many requests, please try again later.' },
  // Admin routes are JWT-protected and include bulk operations
  skip: (req) => req.path.startsWith('/admin'),
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(compression());

// Logging
app.use(morgan('combined', {
  stream: { write: (message) => logger.info(message.trim()) },
}));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'TrackIt API' });
});

// Restock proof screenshots (read-only), served under /api to ride the proxy.
app.use('/api/screenshots', express.static(screenshotDir(), { maxAge: '7d', fallthrough: false }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/scraper-reports', scraperReportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/zip-check', zipCheckRoutes);

// 404 handler
app.use('*', (_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use(errorHandler);

export default app;
