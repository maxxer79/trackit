import axios from 'axios';

interface DiscordPayload {
  webhookUrl: string;
  productName: string;
  storeName: string;
  productUrl: string;
  price?: number | null;
  status: string;
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
  const { webhookUrl, productName, storeName, productUrl, price, status } = payload;

  if (!webhookUrl) return;

  const embed = {
    title: productName,
    url: productUrl,
    color: statusColor(status),
    description: `**${statusLabel(status)}** at **${storeName}**`,
    fields: [
      ...(price ? [{ name: '💰 Price', value: `$${price.toFixed(2)}`, inline: true }] : []),
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
