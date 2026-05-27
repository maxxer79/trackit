import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/database';
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

    res.json({ stats: { users, products, trackings, alertsToday: alerts }, recentUsers, topTracked });
  } catch (error) {
    logger.error('GetDashboardStats error', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
};

export const getUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = '1', limit = '20', q } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const where: any = {};
    if (q) where.OR = [{ name: { contains: q as string, mode: 'insensitive' } }, { email: { contains: q as string, mode: 'insensitive' } }];

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

    res.json({ users, total });
  } catch (error) {
    logger.error('GetUsers error', error);
    res.status(500).json({ error: 'Failed to fetch users' });
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
