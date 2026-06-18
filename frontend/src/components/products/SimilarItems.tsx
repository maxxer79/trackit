import { useSimilarProducts } from '../../hooks/useProducts';
import ProductCard from './ProductCard';

export default function SimilarItems({ slug }: { slug: string }) {
  const { data, isLoading } = useSimilarProducts(slug);

  if (isLoading || !data || data.length === 0) return null;

  // If any pick came from real co-tracking signal, lead with that framing;
  // otherwise it's a category-based suggestion.
  const hasCoTracked = data.some((p) => p.similarSource === 'co-tracked');

  return (
    <section className="mt-8 mb-6">
      <h2 className="text-title2 font-bold text-dark-label1 mb-1">
        {hasCoTracked ? 'People also track' : 'Similar products'}
      </h2>
      <p className="text-caption1 text-dark-label2 mb-4">
        {hasCoTracked
          ? 'Other items tracked by people watching this one.'
          : 'More products in the same category.'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.map((product, i) => (
          <ProductCard key={product.id} product={product} index={i} />
        ))}
      </div>
    </section>
  );
}
