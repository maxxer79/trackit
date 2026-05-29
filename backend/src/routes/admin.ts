import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { getDashboardStats, getUsers, createAdminUser, updateUser, deleteUser, getAdminProducts, createProduct, updateProduct, deleteProduct, scrapeProduct, scrapeAll, addStoreProduct } from '../controllers/adminController';

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
router.post('/scrape-all', scrapeAll);
router.post('/store-products', addStoreProduct);

export default router;
