import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { getDashboardStats, getUsers, updateUser, deleteUser, createProduct, updateProduct, deleteProduct, addStoreProduct } from '../controllers/adminController';

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/stats', getDashboardStats);
router.get('/users', getUsers);
router.patch('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.post('/products', createProduct);
router.patch('/products/:id', updateProduct);
router.delete('/products/:id', deleteProduct);
router.post('/store-products', addStoreProduct);

export default router;
