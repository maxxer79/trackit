import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { getDashboardStats, getUsers, createAdminUser, updateUser, deleteUser, getAdminProducts, createProduct, updateProduct, deleteProduct, scrapeProduct, scrapeAll, fetchImage, addStoreProduct, getAdminStores, createAdminStore, updateAdminStore, deleteAdminStore } from '../controllers/adminController';

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/stats', getDashboardStats);
router.get('/users', getUsers);
router.post('/users', createAdminUser);
router.patch('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.get('/products', getAdminProducts);
router.post('/products', createProduct);
router.patch('/products/:id', updateProduct);
router.delete('/products/:id', deleteProduct);
router.post('/products/:id/scrape', scrapeProduct);
router.patch('/store-products/:id/stock', async (req, res) => {
  try {
    const { prisma } = await import('../config/database');
    const { inStock } = req.body;
    const sp = await prisma.storeProduct.update({
      where: { id: req.params.id },
      data: { inStock: Boolean(inStock), lastChecked: new Date() },
    });
    res.json(sp);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update stock' });
  }
});
router.post('/scrape-all', scrapeAll);
router.get('/fetch-image', fetchImage);
router.post('/store-products', addStoreProduct);
router.get('/stores', getAdminStores);
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
