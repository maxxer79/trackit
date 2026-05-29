import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { getDashboardStats, getUsers, updateUser, deleteUser, getAdminProducts, createProduct, updateProduct, deleteProduct, addStoreProduct } from '../controllers/adminController';

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/stats', getDashboardStats);
router.get('/users', getUsers);
router.patch('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.get('/products', getAdminProducts);
router.post('/products', createProduct);
router.patch('/products/:id', updateProduct);
router.delete('/products/:id', deleteProduct);
router.post('/products/:id/scrape', (_req, res) => res.json({ message: 'Scrape queued' }));
router.post('/store-products', addStoreProduct);

export default router;
