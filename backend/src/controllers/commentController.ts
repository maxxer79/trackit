import { Request, Response } from 'express';
import { prisma } from '../config/database';
import logger from '../utils/logger';
import { restockFrequency, restockPrediction, buildStockTimeline } from '../services/analytics';

export const getComments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;
    const product = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
    if (!product) { res.status(404).json({ error: 'Product not found' }); return; }

    const comments = await prisma.comment.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });

    res.json(comments);
  } catch (error) {
    logger.error('GetComments error', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
};

export const createComment = async (req: Request & { user?: any }, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;
    const { body } = req.body;

    if (!body?.trim()) { res.status(400).json({ error: 'Comment cannot be empty' }); return; }
    if (body.length > 1000) { res.status(400).json({ error: 'Comment too long (max 1000 chars)' }); return; }

    const product = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
    if (!product) { res.status(404).json({ error: 'Product not found' }); return; }

    const comment = await prisma.comment.create({
      data: { productId: product.id, userId: req.user.id, body: body.trim() },
      include: { user: { select: { id: true, name: true, role: true } } },
    });

    res.status(201).json(comment);
  } catch (error) {
    logger.error('CreateComment error', error);
    res.status(500).json({ error: 'Failed to post comment' });
  }
};

export const deleteComment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.comment.delete({ where: { id } });
    res.json({ message: 'Comment deleted' });
  } catch (error) {
    logger.error('DeleteComment error', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
};

export const getStockHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;
    const product = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
    if (!product) { res.status(404).json({ error: 'Product not found' }); return; }

    const events = await prisma.stockEvent.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json(events);
  } catch (error) {
    logger.error('GetStockHistory error', error);
    res.status(500).json({ error: 'Failed to fetch stock history' });
  }
};

// How often this product typically comes back in stock, from its global
// StockEvent history (out→in transitions only). Public, like stock-history.
export const getRestockFrequency = async (req: Request, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;
    const product = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
    if (!product) { res.status(404).json({ error: 'Product not found' }); return; }

    // Oldest→newest so transition detection reads in chronological order.
    const events = await prisma.stockEvent.findMany({
      where: { productId: product.id },
      select: { status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 1000,
    });

    const freq = restockFrequency(events);
    const prediction = restockPrediction(events);
    res.json({ ...freq, prediction });
  } catch (error) {
    logger.error('GetRestockFrequency error', error);
    res.status(500).json({ error: 'Failed to compute restock frequency' });
  }
};

// Visual in/out timeline from the product's global StockEvent history.
export const getStockTimeline = async (req: Request, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;
    const product = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
    if (!product) { res.status(404).json({ error: 'Product not found' }); return; }

    const events = await prisma.stockEvent.findMany({
      where: { productId: product.id },
      select: { status: true, createdAt: true, storeSlug: true, storeName: true },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });

    res.json(buildStockTimeline(events));
  } catch (error) {
    logger.error('GetStockTimeline error', error);
    res.status(500).json({ error: 'Failed to build stock timeline' });
  }
};
