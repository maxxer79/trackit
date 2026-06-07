import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const stores = [
  // Original hotstock.io stores
  { slug: 'amd', name: 'AMD', websiteUrl: 'https://www.amd.com', logoUrl: '/stores/amd.png' },
  { slug: 'asus', name: 'ASUS', websiteUrl: 'https://www.asus.com', logoUrl: '/stores/asus.png' },
  { slug: 'adorama', name: 'Adorama', websiteUrl: 'https://www.adorama.com', logoUrl: '/stores/adorama.png' },
  { slug: 'amazon', name: 'Amazon', websiteUrl: 'https://www.amazon.com', logoUrl: '/stores/amazon.png' },
  { slug: 'antonline', name: 'Antonline', websiteUrl: 'https://www.antonline.com', logoUrl: '/stores/antonline.png' },
  { slug: 'bhphotovideo', name: 'B&H Photo Video', websiteUrl: 'https://www.bhphotovideo.com', logoUrl: '/stores/bhphotovideo.png' },
  { slug: 'bjs', name: "BJ's Wholesale", websiteUrl: 'https://www.bjs.com', logoUrl: '/stores/bjs.png' },
  { slug: 'bandainamco', name: 'Bandai Namco', websiteUrl: 'https://store.bandainamcous.com', logoUrl: '/stores/bandainamco.png' },
  { slug: 'bestbuy', name: 'Best Buy', websiteUrl: 'https://www.bestbuy.com', logoUrl: '/stores/bestbuy.png' },
  { slug: 'canon', name: 'Canon', websiteUrl: 'https://www.usa.canon.com', logoUrl: '/stores/canon.png' },
  { slug: 'costco', name: 'Costco', websiteUrl: 'https://www.costco.com', logoUrl: '/stores/costco.png' },
  { slug: 'dell', name: 'Dell', websiteUrl: 'https://www.dell.com', logoUrl: '/stores/dell.png' },
  { slug: 'disney', name: 'Disney', websiteUrl: 'https://www.shopdisney.com', logoUrl: '/stores/disney.png' },
  { slug: 'ebay', name: 'eBay', websiteUrl: 'https://www.ebay.com', logoUrl: '/stores/ebay.png' },
  { slug: 'fujifilm', name: 'Fujifilm', websiteUrl: 'https://www.fujifilm.com', logoUrl: '/stores/fujifilm.png' },
  { slug: 'gamefly', name: 'GameFly', websiteUrl: 'https://www.gamefly.com', logoUrl: '/stores/gamefly.png' },
  { slug: 'gamestop', name: 'GameStop', websiteUrl: 'https://www.gamestop.com', logoUrl: '/stores/gamestop.png' },
  { slug: 'gigabyte', name: 'Gigabyte', websiteUrl: 'https://www.gigabyte.com', logoUrl: '/stores/gigabyte.png' },
  { slug: 'govee', name: 'Govee', websiteUrl: 'https://www.govee.com', logoUrl: '/stores/govee.png' },
  { slug: 'hallmark', name: 'Hallmark', websiteUrl: 'https://www.hallmark.com', logoUrl: '/stores/hallmark.png' },
  { slug: 'homedepot', name: 'Home Depot', websiteUrl: 'https://www.homedepot.com', logoUrl: '/stores/homedepot.png' },
  { slug: 'kohls', name: "Kohl's", websiteUrl: 'https://www.kohls.com', logoUrl: '/stores/kohls.png' },
  { slug: 'kroger', name: 'Kroger', websiteUrl: 'https://www.kroger.com', logoUrl: '/stores/kroger.png' },
  { slug: 'lg', name: 'LG', websiteUrl: 'https://www.lg.com', logoUrl: '/stores/lg.png' },
  { slug: 'lego', name: 'LEGO', websiteUrl: 'https://www.lego.com', logoUrl: '/stores/lego.png' },
  { slug: 'lenovo', name: 'Lenovo', websiteUrl: 'https://www.lenovo.com', logoUrl: '/stores/lenovo.png' },
  { slug: 'mattel', name: 'Mattel', websiteUrl: 'https://www.mattel.com', logoUrl: '/stores/mattel.png' },
  { slug: 'meijer', name: 'Meijer', websiteUrl: 'https://www.meijer.com', logoUrl: '/stores/meijer.png' },
  { slug: 'microcenter', name: 'Micro Center', websiteUrl: 'https://www.microcenter.com', logoUrl: '/stores/microcenter.png' },
  { slug: 'microsoft', name: 'Microsoft', websiteUrl: 'https://www.microsoft.com', logoUrl: '/stores/microsoft.png' },
  { slug: 'msi', name: 'MSI', websiteUrl: 'https://www.msi.com', logoUrl: '/stores/msi.png' },
  { slug: 'newegg', name: 'Newegg', websiteUrl: 'https://www.newegg.com', logoUrl: '/stores/newegg.png' },
  { slug: 'ninjakitchen', name: 'Ninja Kitchen', websiteUrl: 'https://www.ninjakitchen.com', logoUrl: '/stores/ninjakitchen.png' },
  { slug: 'nintendo', name: 'Nintendo', websiteUrl: 'https://www.nintendo.com', logoUrl: '/stores/nintendo.png' },
  { slug: 'nvidia', name: 'Nvidia', websiteUrl: 'https://store.nvidia.com', logoUrl: '/stores/nvidia.png' },
  { slug: 'oculus', name: 'Meta/Oculus', websiteUrl: 'https://www.meta.com', logoUrl: '/stores/oculus.png' },
  { slug: 'officedepot', name: 'Office Depot', websiteUrl: 'https://www.officedepot.com', logoUrl: '/stores/officedepot.png' },
  { slug: 'playasia', name: 'Play-Asia', websiteUrl: 'https://www.play-asia.com', logoUrl: '/stores/playasia.png' },
  { slug: 'playstation', name: 'PlayStation Direct', websiteUrl: 'https://direct.playstation.com', logoUrl: '/stores/playstation.png' },
  { slug: 'pokemoncenter', name: 'Pokemon Center', websiteUrl: 'https://www.pokemoncenter.com', logoUrl: '/stores/pokemoncenter.png' },
  { slug: 'popmart', name: 'POP MART', websiteUrl: 'https://www.popmart.com', logoUrl: '/stores/popmart.png' },
  { slug: 'qvc', name: 'QVC', websiteUrl: 'https://www.qvc.com', logoUrl: '/stores/qvc.png' },
  { slug: 'samsclub', name: "Sam's Club", websiteUrl: 'https://www.samsclub.com', logoUrl: '/stores/samsclub.png' },
  { slug: 'stockx', name: 'StockX', websiteUrl: 'https://stockx.com', logoUrl: '/stores/stockx.png' },
  { slug: 'target', name: 'Target', websiteUrl: 'https://www.target.com', logoUrl: '/stores/target.png' },
  { slug: 'toysrus', name: 'ToysRUs', websiteUrl: 'https://www.toysrus.com', logoUrl: '/stores/toysrus.png' },
  { slug: 'verizon', name: 'Verizon', websiteUrl: 'https://www.verizon.com', logoUrl: '/stores/verizon.png' },
  { slug: 'walmart', name: 'Walmart', websiteUrl: 'https://www.walmart.com', logoUrl: '/stores/walmart.png' },
  { slug: 'zotac', name: 'Zotac', websiteUrl: 'https://www.zotac.com', logoUrl: '/stores/zotac.png' },
  // Additional stores
  { slug: 'apple', name: 'Apple Store', websiteUrl: 'https://www.apple.com', logoUrl: '/stores/apple.png' },
  { slug: 'nike', name: 'Nike / SNKRS', websiteUrl: 'https://www.nike.com', logoUrl: '/stores/nike.png' },
  { slug: 'footlocker', name: 'Foot Locker', websiteUrl: 'https://www.footlocker.com', logoUrl: '/stores/footlocker.png' },
  { slug: 'hasbro', name: 'Hasbro', websiteUrl: 'https://www.hasbro.com', logoUrl: '/stores/hasbro.png' },
  { slug: 'hasbropulse', name: 'Hasbro Pulse', websiteUrl: 'https://www.hasbropulse.com', logoUrl: '/stores/hasbropulse.png' },
  { slug: 'sony', name: 'Sony', websiteUrl: 'https://www.sony.com', logoUrl: '/stores/sony.png' },
  { slug: 'google', name: 'Google Store', websiteUrl: 'https://store.google.com', logoUrl: '/stores/google.png' },
  { slug: 'samsung', name: 'Samsung', websiteUrl: 'https://www.samsung.com', logoUrl: '/stores/samsung.png' },
  { slug: 'bambulabs', name: 'Bambu Labs', websiteUrl: 'https://bambulab.com', logoUrl: '/stores/bambulabs.png' },
  { slug: 'ubiquiti', name: 'Ubiquiti / Unifi', websiteUrl: 'https://store.ui.com', logoUrl: '/stores/ubiquiti.png' },
  { slug: 'lowes', name: "Lowe's", websiteUrl: 'https://www.lowes.com', logoUrl: '/stores/lowes.png' },
  { slug: 'valve', name: 'Valve / Steam Deck', websiteUrl: 'https://store.steampowered.com/steamdeck', logoUrl: '/stores/valve.png' },
];

async function main() {
  console.log('🌱 Seeding database...');

  // Create stores
  for (const store of stores) {
    await prisma.store.upsert({
      where: { slug: store.slug },
      update: store,
      create: store,
    });
  }
  console.log(`✅ Created ${stores.length} stores`);

  // Create admin user
  const adminPassword = process.env.ADMIN_PASSWORD || 'AdminPassword123!';
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@trackit.app';

  const hashedPassword = await bcrypt.hash(adminPassword, 12);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash: hashedPassword,
      name: 'Admin',
      role: 'ADMIN',
      trackingLimit: -1, // unlimited
    },
  });
  console.log(`✅ Created admin user: ${adminEmail}`);

  console.log('🎉 Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
