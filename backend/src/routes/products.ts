import { Router } from 'express';
import { getProducts, getProductBySlug, getCategories, getFeaturedProducts, getNewProducts, getStores } from '../controllers/productController';

const router = Router();

router.get('/', getProducts);
router.get('/featured', getFeaturedProducts);
router.get('/new', getNewProducts);
router.get('/categories', getCategories);
router.get('/stores', getStores);
router.get('/:slug', getProductBySlug);

export default router;
