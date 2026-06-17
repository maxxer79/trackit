import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { getDashboardStats, getUsers, createAdminUser, updateUser, deleteUser, getAdminProducts, createProduct, updateProduct, deleteProduct, scrapeProduct, scrapeAll, fetchImage, addStoreProduct, getAdminStores, createAdminStore, updateAdminStore, deleteAdminStore } from '../controllers/adminController';
import { testScraper, testAllScrapers } from '../controllers/scraperHealthController';
import { validate } from '../middleware/validate';
import { createProductSchema, addStoreProductSchema, updateStockSchema, createAdminUserSchema, updateUserSchema } from '../schemas';

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/stats', getDashboardStats);
router.get('/logs', async (req, res) => {
  try {
    const { prisma } = await import('../config/database');
    const page = parseInt((req.query.page as string) ?? '1');
    const limit = parseInt((req.query.limit as string) ?? '50');
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      prisma.scraperLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
      }),
      prisma.scraperLog.count(),
    ]);
    res.json({ data, total, totalPages: Math.ceil(total / limit) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});
router.get('/users', getUsers);
router.post('/users', validate(createAdminUserSchema), createAdminUser);
router.patch('/users/:id', validate(updateUserSchema), updateUser);
router.delete('/users/:id', deleteUser);
router.get('/products', getAdminProducts);
router.post('/products', validate(createProductSchema), createProduct);
router.patch('/products/:id', updateProduct);
router.delete('/products/:id', deleteProduct);
router.post('/products/:id/scrape', scrapeProduct);
router.patch('/store-products/:id/stock', validate(updateStockSchema), async (req, res) => {
  try {
    const { prisma } = await import('../config/database');
    const { inStock, stockStatus } = req.body;
    const inStockBool = Boolean(inStock);
    // A manual override must set BOTH inStock and stockStatus. The product
    // detail API shows stockStatus in preference to inStock, so writing only
    // inStock left the badge stale (stuck on UNKNOWN) and made the toggle
    // one-way. Allow an explicit stockStatus, else derive it from inStock.
    const status =
      typeof stockStatus === 'string' && stockStatus
        ? stockStatus
        : inStockBool ? 'IN_STOCK' : 'OUT_OF_STOCK';
    const sp = await prisma.storeProduct.update({
      where: { id: req.params.id },
      data: { inStock: inStockBool, stockStatus: status, lastChecked: new Date() },
    });
    res.json(sp);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update stock' });
  }
});
router.post('/scrape-all', scrapeAll);
router.get('/fetch-image', fetchImage);
router.post('/store-products', validate(addStoreProductSchema), addStoreProduct);
router.get('/stores', getAdminStores);
router.post('/scrapers/test-all', testAllScrapers);
router.post('/scrapers/:slug/test', testScraper);
router.post('/stores', createAdminStore);
router.patch('/stores/:id', updateAdminStore);
router.delete('/stores/:id', deleteAdminStore);
router.delete('/store-products/:id', async (req, res) => {
  try {
    const { prisma } = await import('../config/database');
    await prisma.storeProduct.delete({ where: { id: req.params.id } });
    res.json({ message: 'Store link removed' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to remove store link' });
  }
});

export default router;
