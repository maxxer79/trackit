/* TrackIt push handler.
 *
 * Imported into the Workbox-generated service worker via vite-plugin-pwa's
 * `workbox.importScripts`. The generated SW only does caching — it has no push
 * support — so these two listeners are what actually render restock/price-drop
 * notifications AND power the on-notification action buttons (Shop / Mute).
 *
 * Payload shape (see backend/src/services/push.ts):
 *   { title, body, icon, badge, tag, renotify, actions, url,
 *     data: { url, productUrl, productSlug, muteUrl } }
 */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch (_e) {
    payload = { title: 'TrackIt', body: event.data.text() };
  }

  const data = payload.data || {};
  const title = payload.title || 'TrackIt';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/badge-72.png',
    image: payload.image,
    tag: payload.tag,
    // Re-alert even when an older notification with the same tag is on screen.
    renotify: payload.renotify ?? Boolean(payload.tag),
    // Up to two buttons; platforms that don't support actions just ignore them.
    actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 2) : [],
    data: {
      url: data.url || payload.url || '/',
      muteUrl: data.muteUrl || null,
      productSlug: data.productSlug || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  notification.close();

  const data = notification.data || {};
  const action = event.action; // '' for a body tap, else the action id

  // Mute → in-app deep link (same origin) so the snooze runs where the auth
  // token lives. Shop / body tap → the retailer product URL.
  let target;
  if (action === 'mute' && data.muteUrl) {
    target = new URL(data.muteUrl, self.location.origin).href;
  } else {
    target = data.url || '/';
  }

  const isSameOrigin = (() => {
    try {
      return new URL(target, self.location.origin).origin === self.location.origin;
    } catch (_e) {
      return false;
    }
  })();

  event.waitUntil(
    (async () => {
      // For an in-app target, focus an existing tab and route it there instead
      // of spawning a duplicate. External retailer URLs always open fresh.
      if (isSameOrigin) {
        const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of wins) {
          if ('focus' in client) {
            await client.focus();
            if ('navigate' in client) {
              try {
                await client.navigate(target);
              } catch (_e) {
                /* cross-state navigation can throw on some browsers — ignore */
              }
            }
            return;
          }
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })()
  );
});
