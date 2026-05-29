import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/database';
import { checkStockForProduct, runStockCheck } from '../services/stockChecker';
import logger from '../utils/logger';

export const getDashboardStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [users, products, trackings, alerts] = await Promise.all([
      prisma.user.count(),
      prisma.product.count({ where: { isActive: true } }),
      prisma.tracking.count({ where: { isActive: true } }),
      prisma.alert.count({
        where: { sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
    ]);

    const recentUsers = await prisma.user.findMany({
      take: 5, orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    const topTracked = await prisma.product.findMany({
      where: { isActive: true },
      take: 5,
      orderBy: { viewCount: 'desc' },
      select: { id: true, name: true, slug: true, viewCount: true, _count: { select: { trackings: true } } },
    });

    res.json({
      totalUsers: users,
      activeUsers: users,
      totalProducts: products,
      activeTrackings: trackings,
      alertsToday: alerts,
      alertsThisWeek: alerts,
      totalAlerts: alerts,
      scraperErrors: 0,
      recentUsers,
      topProducts: topTracked.map((p: any) => ({ id: p.id, name: p.name, slug: p.slug, _count: { trackings: p._count.trackings } })),
    });
  } catch (error) {
    logger.error('GetDashboardStats error', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
};

export const getUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = '1', limit = '20', q, search } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const searchTerm = (search || q) as string | undefined;
    const where: any = {};
    if (searchTerm) where.OR = [{ name: { contains: searchTerm, mode: 'insensitive' } }, { email: { contains: searchTerm, mode: 'insensitive' } }];

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where, skip, take: parseInt(limit as string),
        select: {
          id: true, email: true, name: true, role: true,
          trackingLimit: true, isActive: true, createdAt: true, lastLoginAt: true,
          _count: { select: { trackings: { where: { isActive: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ data: users, total });
  } catch (error) {
    logger.error('GetUsers error', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

export const createAdminUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, role, trackingLimit } = req.body;
    if (!name || !email || !password) {
      res.status(400).json({ error: 'Name, email and password are required' });
      return;
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) { res.status(409).json({ error: 'Email already registered' }); return; }
    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email, password: hashed, role: role || 'USER', trackingLimit: trackingLimit ? parseInt(trackingLimit) : 10 },
      select: { id: true, email: true, name: true, role: true, trackingLimit: true, isActive: true, createdAt: true },
    });
    res.status(201).json(user);
  } catch (error) {
    logger.error('CreateAdminUser error', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { trackingLimit, role, isActive, name } = req.body;

    const user = await prisma.user.update({
      where: { id },
      data: { trackingLimit, role, isActive, name },
      select: { id: true, email: true, name: true, role: true, trackingLimit: true, isActive: true },
    });

    res.json(user);
  } catch (error) {
    logger.error('UpdateUser error', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.user.delete({ where: { id } });
    res.json({ message: 'User deleted' });
  } catch (error) {
    logger.error('DeleteUser error', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
};

export const getAdminProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = '1', limit = '20', search } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;
    const where: any = {};
    if (search) where.name = { contains: search as string, mode: 'insensitive' };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where, skip, take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { trackings: { where: { isActive: true } } } } },
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      data: products.map((p: any) => ({ ...p, trackingCount: p._count?.trackings ?? 0 })),
      total,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    logger.error('GetAdminProducts error', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};

export const createProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, slug, imageUrl, category, description, tags, isFeatured, isNew } = req.body;
    const product = await prisma.product.create({
      data: { name, slug, imageUrl, category, description, tags: tags || [], isFeatured: isFeatured || false, isNew: isNew || false },
    });
    res.status(201).json(product);
  } catch (error) {
    logger.error('CreateProduct error', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
};

export const updateProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = req.body;
    const product = await prisma.product.update({ where: { id }, data });
    res.json(product);
  } catch (error) {
    logger.error('UpdateProduct error', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
};

export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.product.update({ where: { id }, data: { isActive: false } });
    res.json({ message: 'Product deactivated' });
  } catch (error) {
    logger.error('DeleteProduct error', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
};

export const scrapeProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const storeProducts = await prisma.storeProduct.findMany({
      where: { productId: id },
      select: { id: true },
    });
    // Run in background
    Promise.allSettled(storeProducts.map(sp => checkStockForProduct(sp.id)));
    res.json({ message: `Scrape queued for ${storeProducts.length} listings` });
  } catch (error) {
    logger.error('ScrapeProduct error', error);
    res.status(500).json({ error: 'Failed to queue scrape' });
  }
};

export const scrapeAll = async (_req: Request, res: Response): Promise<void> => {
  try {
    // Run in background, respond immediately
    runStockCheck();
    res.json({ message: 'Full stock check queued' });
  } catch (error) {
    logger.error('ScrapeAll error', error);
    res.status(500).json({ error: 'Failed to queue scrape' });
  }
};

export const addStoreProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { productId, storeId, url, price } = req.body;
    const sp = await prisma.storeProduct.upsert({
      where: { productId_storeId: { productId, storeId } },
      update: { url, price },
      create: { productId, storeId, url, price },
      include: { store: true },
    });
    res.json(sp);
  } catch (error) {
    logger.error('AddStoreProduct error', error);
    res.status(500).json({ error: 'Failed to add store product' });
  }
};
