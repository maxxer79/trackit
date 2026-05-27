import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { STORES } from './stores';

const prisma = new PrismaClient();

const PRODUCTS = [
  { name: 'NVIDIA GeForce RTX 5090 Founders Edition', slug: 'nvidia-rtx-5090-founders-edition', category: 'GPU', imageUrl: 'https://placehold.co/400x300/1a1a2e/ffffff?text=RTX+5090', tags: ['gpu', 'nvidia', 'graphics-card'], isFeatured: true },
  { name: 'NVIDIA GeForce RTX 5080 Founders Edition', slug: 'nvidia-rtx-5080-founders-edition', category: 'GPU', imageUrl: 'https://placehold.co/400x300/1a1a2e/ffffff?text=RTX+5080', tags: ['gpu', 'nvidia', 'graphics-card'], isFeatured: true },
  { name: 'NVIDIA GeForce RTX 5070 Ti', slug: 'nvidia-rtx-5070-ti', category: 'GPU', imageUrl: 'https://placehold.co/400x300/1a1a2e/ffffff?text=RTX+5070+Ti', tags: ['gpu', 'nvidia', 'graphics-card'], isFeatured: true },
  { name: 'AMD Radeon RX 9070 XT', slug: 'amd-radeon-rx-9070-xt', category: 'GPU', imageUrl: 'https://placehold.co/400x300/ed1c24/ffffff?text=RX+9070+XT', tags: ['gpu', 'amd', 'graphics-card'], isFeatured: true },
  { name: 'Nintendo Switch 2', slug: 'nintendo-switch-2', category: 'Console', imageUrl: 'https://placehold.co/400x300/e4000f/ffffff?text=Switch+2', tags: ['console', 'nintendo'], isFeatured: true, isNew: true },
  { name: 'Nintendo Switch 2 + Mario Kart World Bundle', slug: 'nintendo-switch-2-mario-kart-world', category: 'Console', imageUrl: 'https://placehold.co/400x300/e4000f/ffffff?text=Switch+2+Bundle', tags: ['console', 'nintendo', 'bundle'], isNew: true },
  { name: 'PlayStation 5 Pro', slug: 'playstation-5-pro', category: 'Console', imageUrl: 'https://placehold.co/400x300/003087/ffffff?text=PS5+Pro', tags: ['console', 'playstation', 'sony'] },
  { name: 'Xbox Series X', slug: 'xbox-series-x', category: 'Console', imageUrl: 'https://placehold.co/400x300/107c10/ffffff?text=Xbox+Series+X', tags: ['console', 'xbox', 'microsoft'] },
  { name: 'ROG Xbox Ally X', slug: 'rog-xbox-ally-x', category: 'Gaming Handheld', imageUrl: 'https://placehold.co/400x300/107c10/ffffff?text=ROG+Ally+X', tags: ['handheld', 'asus', 'rog'], isNew: true },
  { name: 'Legion Go 2 - AMD Ryzen Z2 Extreme', slug: 'legion-go-2-amd-ryzen-z2-extreme', category: 'Gaming Handheld', imageUrl: 'https://placehold.co/400x300/e2231a/ffffff?text=Legion+Go+2', tags: ['handheld', 'lenovo', 'gaming'], isNew: true },
  { name: 'Fujifilm X100VI - Silver', slug: 'fujifilm-x100vi-silver', category: 'Camera', imageUrl: 'https://placehold.co/400x300/888888/ffffff?text=X100VI+Silver', tags: ['camera', 'fujifilm'], isFeatured: true },
  { name: 'Fujifilm X100VI - Black', slug: 'fujifilm-x100vi-black', category: 'Camera', imageUrl: 'https://placehold.co/400x300/333333/ffffff?text=X100VI+Black', tags: ['camera', 'fujifilm'] },
  { name: 'Pokemon Journey Together Elite Trainer Box', slug: 'pokemon-journey-together-etb', category: 'Trading Cards', imageUrl: 'https://placehold.co/400x300/ffcb05/000000?text=Pokemon+ETB', tags: ['pokemon', 'trading-cards', 'tcg'], isFeatured: true },
  { name: 'Pokemon Journey Together Booster Box', slug: 'pokemon-journey-together-booster-box', category: 'Trading Cards', imageUrl: 'https://placehold.co/400x300/ffcb05/000000?text=Pokemon+Booster', tags: ['pokemon', 'trading-cards', 'tcg'] },
  { name: 'Magic: The Gathering - Final Fantasy Collector Booster Box', slug: 'mtg-final-fantasy-collector-booster', category: 'Trading Cards', imageUrl: 'https://placehold.co/400x300/a83232/ffffff?text=MTG+FF', tags: ['mtg', 'magic', 'trading-cards'] },
  { name: 'ASUS TUF Gaming GeForce RTX 5090 32GB', slug: 'asus-tuf-rtx-5090-32gb', category: 'GPU', imageUrl: 'https://placehold.co/400x300/1a1a2e/ffffff?text=TUF+5090', tags: ['gpu', 'asus', 'rtx-5090'] },
  { name: 'MSI Gaming GeForce RTX 5090 32GB TRIO OC', slug: 'msi-rtx-5090-gaming-trio-oc', category: 'GPU', imageUrl: 'https://placehold.co/400x300/1a1a2e/ffffff?text=MSI+5090', tags: ['gpu', 'msi', 'rtx-5090'] },
  { name: 'POP MART Labubu Macaron Assorted Box', slug: 'popmart-labubu-macaron-box', category: 'Collectibles', imageUrl: 'https://placehold.co/400x300/ff69b4/ffffff?text=Labubu', tags: ['popmart', 'labubu', 'collectibles'], isFeatured: true },
  { name: 'AMD Ryzen 9 9950X3D', slug: 'amd-ryzen-9-9950x3d', category: 'CPU', imageUrl: 'https://placehold.co/400x300/ed1c24/ffffff?text=9950X3D', tags: ['cpu', 'amd', 'processor'], isNew: true },
  { name: 'ASUS ROG Astral GeForce RTX 5090 32GB OC', slug: 'asus-rog-astral-rtx-5090-oc', category: 'GPU', imageUrl: 'https://placehold.co/400x300/1a1a2e/ffffff?text=ROG+5090', tags: ['gpu', 'asus', 'rog', 'rtx-5090'] },
  { name: 'Kendamil Goat Infant Formula 28.2oz', slug: 'kendamil-goat-infant-formula', category: 'Baby & Kids', imageUrl: 'https://placehold.co/400x300/90ee90/000000?text=Kendamil', tags: ['baby', 'formula', 'kendamil'] },
  { name: 'Stanley 40oz H2.0 Flowstate Quencher', slug: 'stanley-40oz-flowstate-quencher', category: 'Kitchen', imageUrl: 'https://placehold.co/400x300/228b22/ffffff?text=Stanley', tags: ['stanley', 'tumbler', 'kitchen'] },
  { name: 'Nintendo Joy-Con 2 Controllers', slug: 'nintendo-joy-con-2', category: 'Accessories', imageUrl: 'https://placehold.co/400x300/e4000f/ffffff?text=Joy-Con+2', tags: ['nintendo', 'controller', 'accessories'], isNew: true },
  { name: 'Nintendo Switch 2 Pro Controller', slug: 'nintendo-switch-2-pro-controller', category: 'Accessories', imageUrl: 'https://placehold.co/400x300/e4000f/ffffff?text=Pro+Controller', tags: ['nintendo', 'controller', 'accessories'], isNew: true },
  { name: 'ASUS ROG Swift 32" 4K OLED PG32UCDMR', slug: 'asus-rog-swift-pg32ucdmr', category: 'Monitor', imageUrl: 'https://placehold.co/400x300/1a1a2e/ffffff?text=ROG+OLED+32', tags: ['monitor', 'asus', 'oled'], isNew: true },
];

async function main() {
  console.log('🌱 Seeding database...');

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123!', 10);
  await prisma.user.upsert({
    where: { email: 'admin@trackit.io' },
    update: {},
    create: {
      email: 'admin@trackit.io',
      password: adminPassword,
      name: 'TrackIt Admin',
      role: 'ADMIN',
      trackingLimit: -1,
    },
  });

  // Create demo user
  const userPassword = await bcrypt.hash('demo123!', 10);
  await prisma.user.upsert({
    where: { email: 'demo@trackit.io' },
    update: {},
    create: {
      email: 'demo@trackit.io',
      password: userPassword,
      name: 'Demo User',
      role: 'USER',
      trackingLimit: 1,
    },
  });

  // Seed stores
  for (const store of STORES) {
    await prisma.store.upsert({
      where: { slug: store.slug },
      update: {},
      create: store,
    });
  }

  // Seed products
  for (const product of PRODUCTS) {
    await prisma.product.upsert({
      where: { slug: product.slug },
      update: {},
      create: product,
    });
  }

  // Seed some store listings
  const products = await prisma.product.findMany({ take: 10 });
  const stores = await prisma.store.findMany({ where: { slug: { in: ['amazon', 'bestbuy', 'walmart', 'newegg', 'microcenter'] } } });

  for (const product of products) {
    for (const store of stores) {
      await prisma.storeProduct.upsert({
        where: { productId_storeId: { productId: product.id, storeId: store.id } },
        update: {},
        create: {
          productId: product.id,
          storeId: store.id,
          url: `https://${store.domain}/search?q=${encodeURIComponent(product.name)}`,
          price: Math.round((299 + Math.random() * 1500) * 100) / 100,
          inStock: Math.random() > 0.7,
          lastChecked: new Date(),
        },
      });
    }
  }

  console.log('✅ Seeding complete!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
