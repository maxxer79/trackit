import { Router } from 'express';
import { getProducts, getProductBySlug, getCategories, getFeaturedProducts, getNewProducts, getStores } from '../controllers/productController';
import { getComments, createComment, deleteComment, getStockHistory } from '../controllers/commentController';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

router.get('/', getProducts);
router.get('/featured', getFeaturedProducts);
router.get('/new', getNewProducts);
router.get('/categories', getCategories);
router.get('/stores', getStores);
router.get('/:slug', getProductBySlug);
router.get('/:slug/comments', getComments);
router.post('/:slug/comments', authenticate, createComment);
router.delete('/comments/:id', authenticate, requireAdmin, deleteComment);
router.get('/:slug/stock-history', getStockHistory);

export default router;
