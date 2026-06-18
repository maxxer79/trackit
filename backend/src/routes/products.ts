import { Router } from 'express';
import { getProducts, getProductBySlug, getCategories, getFeaturedProducts, getNewProducts, getStores, liveCheckProduct, getSimilarProducts } from '../controllers/productController';
import { getComments, createComment, deleteComment, getStockHistory, getRestockFrequency, getStockTimeline } from '../controllers/commentController';
import { authenticate, requireAdmin } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createCommentSchema } from '../schemas';

const router = Router();

router.get('/', getProducts);
router.get('/featured', getFeaturedProducts);
router.get('/new', getNewProducts);
router.get('/categories', getCategories);
router.get('/stores', getStores);
router.get('/:slug', getProductBySlug);
router.get('/:slug/comments', getComments);
router.post('/:slug/comments', authenticate, validate(createCommentSchema), createComment);
router.delete('/comments/:id', authenticate, requireAdmin, deleteComment);
router.get('/:slug/stock-history', getStockHistory);
router.get('/:slug/restock-frequency', getRestockFrequency);
router.get('/:slug/timeline', getStockTimeline);
router.get('/:slug/similar', getSimilarProducts);
router.get('/:slug/live-check', liveCheckProduct);

export default router;
