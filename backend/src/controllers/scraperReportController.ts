import { Request, Response } from 'express';
import { prisma } from '../config/database';
import logger from '../utils/logger';
import { AuthRequest } from '../middleware/auth';

// POST /api/scraper-reports — any signed-in user flags a broken scraper. The
// suggestion is stored for admin review only; nothing is ever auto-applied.
export const createScraperReport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId, productName, storeSlug, storeName, productUrl, issueType, description, suggestedSelector } = req.body;

    const report = await prisma.scraperReport.create({
      data: {
        userId: req.user!.id,
        productId: productId || null,
        productName: productName || null,
        storeSlug: storeSlug || null,
        storeName: storeName || null,
        productUrl: productUrl || null,
        issueType,
        description: description.trim(),
        suggestedSelector: suggestedSelector?.trim() || null,
      },
    });
    res.status(201).json({ id: report.id, message: 'Thanks — your report was sent to the admins' });
  } catch (error) {
    logger.error('CreateScraperReport error', error);
    res.status(500).json({ error: 'Failed to submit report' });
  }
};

// GET /api/admin/scraper-reports?status=OPEN — admin queue, newest first.
export const getScraperReports = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = (req.query.status as string) || undefined;
    const where = status ? { status } : {};

    const [reports, counts] = await Promise.all([
      prisma.scraperReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      prisma.scraperReport.groupBy({ by: ['status'], _count: { status: true } }),
    ]);

    const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count.status]));
    res.json({ reports, counts: byStatus });
  } catch (error) {
    logger.error('GetScraperReports error', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
};

// PATCH /api/admin/scraper-reports/:id — triage: change status / add a note.
export const updateScraperReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, adminNote } = req.body;

    const data: Record<string, unknown> = {};
    if (status !== undefined) data.status = status;
    if (adminNote !== undefined) data.adminNote = typeof adminNote === 'string' && adminNote.trim() ? adminNote.trim() : null;

    const updated = await prisma.scraperReport.update({ where: { id }, data });
    res.json(updated);
  } catch (error) {
    logger.error('UpdateScraperReport error', error);
    res.status(500).json({ error: 'Failed to update report' });
  }
};
