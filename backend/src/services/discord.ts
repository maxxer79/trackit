import axios from 'axios';

interface DiscordPayload {
  webhookUrl: string;
  productName: string;
  storeName: string;
  productUrl: string;
  price?: number | null;
  status: string;
  kind?: 'RESTOCK' | 'PRICE_DROP' | 'LOW_STOCK' | 'PICKUP' | 'PRICE_TARGET';
  previousPrice?: number | null;
  targetPrice?: number | null;
}

function statusColor(status: string): number {
  switch (status) {
    case 'IN_STOCK': return 0x30d158;   // Green
    case 'LIMITED':  return 0xff9f0a;   // Orange
    case 'PREORDER': return 0x0071e3;   // Blue
    default:         return 0x636366;   // Gray
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'IN_STOCK': return '🟢 In Stock';
    case 'LIMITED':  return '🟡 Limited Stock';
    case 'PREORDER': return '🔵 Pre-order Available';
    default:         return '⚪ Available';
  }
}

export async function sendDiscordAlert(payload: DiscordPayload): Promise<void> {
  const { webhookUrl, productName, storeName, productUrl, price, status, kind, previousPrice, targetPrice } = payload;

  if (!webhookUrl) return;

  const isDrop = kind === 'PRICE_DROP';
  const isLow = kind === 'LOW_STOCK';
  const isTarget = kind === 'PRICE_TARGET';
  const priceField = isTarget
    ? { name: '🎯 Hit your target', value: `$${price?.toFixed(2) ?? '?'}${targetPrice ? ` (target $${targetPrice.toFixed(2)})` : ''}`, inline: true }
    : isDrop
      ? { name: '💸 Price drop', value: `$${price?.toFixed(2) ?? '?'}${previousPrice ? ` (was $${previousPrice.toFixed(2)})` : ''}`, inline: true }
      : price
        ? { name: '💰 Price', value: `$${price.toFixed(2)}`, inline: true }
        : null;

  const embed = {
    title: productName,
    url: productUrl,
    color: isTarget ? 0x30d158 : isDrop ? 0x0071e3 : isLow ? 0xff9f0a : statusColor(status),
    description: isTarget
      ? `**🎯 Hit your price target** at **${storeName}**`
      : isDrop
        ? `**💸 Price drop** at **${storeName}**`
        : isLow
          ? `**⚠️ Running low** at **${storeName}**`
          : `**${statusLabel(status)}** at **${storeName}**`,
    fields: [
      ...(priceField ? [priceField] : []),
      { name: '🏪 Store', value: storeName, inline: true },
    ],
    footer: {
      text: 'TrackIt Stock Alert',
      icon_url: 'https://trackit.app/icons/icon-72x72.png',
    },
    timestamp: new Date().toISOString(),
  };

  await axios.post(webhookUrl, {
    username: 'TrackIt Alerts',
    avatar_url: 'https://trackit.app/icons/icon-192x192.png',
    embeds: [embed],
  });
}
