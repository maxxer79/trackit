# Trackit Browser Extension

A toolbar button that sends the current retailer product page to your self-hosted
Trackit instance with one click. It reuses your existing API — no backend changes.

- **Sign in once** (Options page): enter your Trackit URL + login. Only the
  resulting access token is stored locally; your password is never saved.
- **Track anything**: open a product page on any supported store, click the
  Trackit toolbar icon, hit **Track this item**. The server auto-detects the
  retailer and pulls in the product name, image, and price.
- **Floating button** (optional): on supported retailer **product** pages a
  small "＋ Track this item" button appears bottom-right so you can track without
  opening the popup. It's scoped to product URLs (e.g. Amazon `/dp/`, Walmart
  `/ip/`, Best Buy `….p`) and follows in-page navigation on single-page sites.
  Toggle it off anytime from the Options page, or dismiss it per-page with the ✕.

## How it works

| Action | Endpoint used |
| --- | --- |
| Connect / sign in | `POST {url}/api/auth/login` → stores the JWT |
| Track this item | `POST {url}/api/tracking/import` with `{ url }` |

Because the import scrape runs server-side, the extension only needs to send the
page URL — the same path as the in-app "paste a URL" import. Sites that block
server-side scraping (e.g. Amazon) may import with thin metadata, but tracking
still works.

## Install (unpacked)

### Chrome / Edge / Brave
1. Go to `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.
3. Click the Trackit icon → **Set up the extension** → enter your URL + login.

### Firefox
1. Go to `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → select `manifest.json` in this folder.
   (Temporary add-ons are removed on restart; package/sign for a permanent install.)

## Permissions

- `activeTab` — read the URL of the tab you're on, only when you click the icon.
- `storage` — keep your instance URL and access token locally.
- host access to **your instance only** — requested when you connect, so the
  extension can call your API.
- supported **retailer pages** — the floating button's content script runs on
  the stores Trackit supports (Amazon, Best Buy, Walmart, Target, etc.). It only
  reads `location.href` and never touches page content. Turn the button off in
  Options if you'd rather not run it.

## Notes

- Enter the same URL you use to open Trackit in a browser; the extension appends
  `/api` automatically (a trailing `/api` is also accepted).
- If you get "Session expired," just reconnect from the Options page.
