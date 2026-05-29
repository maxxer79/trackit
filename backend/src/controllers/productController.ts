import { Request, Response } from 'express';
import { prisma } from '../config/database';
import logger from '../utils/logger';

export const getProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const { q, category, page = '1', limit = '24', sort = 'popular', featured, isNew } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const where: any = { isActive: true };
    if (q) { where.name = { contains: q as string, mode: 'insensitive' }; }
    if (category) { where.category = category as string; }
    if (featured === 'true') { where.isFeatured = true; }
    if (isNew === 'true') { where.isNew = true; }

    let orderBy: any = { viewCount: 'desc' };
    if (sort === 'newest') orderBy = { createdAt: 'desc' };
    if (sort === 'name') orderBy = { name: 'asc' };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where, skip, take: limitNum, orderBy,
        include: {
          storeListings: {
            include: { store: true },
            orderBy: { price: 'asc' },
          },
          _count: { select: { trackings: { where: { isActive: true } } } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      products,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    logger.error('GetProducts error', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};

export const getProductBySlug = async (req: Request, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;
    const product = await prisma.product.findUnique({
      where: { slug },
      include: {
        storeListings: {
          include: { store: true },
          orderBy: [{ inStock: 'desc' }, { price: 'asc' }],
        },
        _count: { select: { trackings: { where: { isActive: true } } } },
      },
    });

    if (!product) { res.status(404).json({ error: 'Product not found' }); return; }

    await prisma.product.update({ where: { id: product.id }, data: { viewCount: { increment: 1 } } });
    res.json(product);
  } catch (error) {
    logger.error('GetProductBySlug error', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
};

export const getCategories = async (_req: Request, res: Response): Promise<void> => {
  try {
    const categories = await prisma.product.groupBy({
      by: ['category'],
      where: { isActive: true, category: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });
    res.json(categories.map(c => c.category).filter(Boolean));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
};

export const getFeaturedProducts = async (_req: Request, res: Response): Promise<void> => {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true, isFeatured: true },
      take: 12,
      include: {
        storeListings: { include: { store: true }, take: 5, orderBy: { price: 'asc' } },
        _count: { select: { trackings: true } },
      },
      orderBy: { viewCount: 'desc' },
    });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch featured products' });
  }
};

export const getNewProducts = async (_req: Request, res: Response): Promise<void> => {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true, isNew: true },
      take: 12,
      include: {
        storeListings: { include: { store: true }, take: 5, orderBy: { price: 'asc' } },
        _count: { select: { trackings: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch new products' });
  }
};

export const getStores = async (_req: Request, res: Response): Promise<void> => {
  try {
    const stores = await prisma.store.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(stores);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stores' });
  }
};
