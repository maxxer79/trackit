# TrackIt 🎯

> Real-time stock tracker & alert system for 70+ US retailers — PWA, dark mode, Apple-inspired UI.

[![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)](https://docs.docker.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://reactjs.org/)

TrackIt monitors 70+ major US retailers for hard-to-get products and alerts you the moment they're back in stock via push notification, email, SMS, or Discord.

---

## Features

- **70+ retailers** — Best Buy, Amazon, Walmart, Target, GameStop, Apple Store, Nike/SNKRS, Foot Locker, Hasbro, Sony, Google, Samsung, Bambu Labs, Ubiquiti, Lowe's, Steam and more
- **Real-time updates** via Socket.io — no polling on the client
- **PWA** — installable on iOS & Android, works offline
- **Multi-channel alerts** — Push Notifications, Email (SMTP/SendGrid), SMS (Twilio), Discord Webhooks
- **AutoBuy** — automatically purchases items when back in stock (per-item price cap)
- **Admin dashboard** — manage users, products, tracking limits, scraper logs, manual scrape triggers
- **Role-based access** — users default to 1 tracked item; admins can unlock limits or set unlimited (-1)
- **Apple-inspired dark UI** — SF Pro–style typography, glassmorphism, fluid animations (Framer Motion)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 · TypeScript · Vite 5 · Tailwind CSS · Framer Motion · Zustand · TanStack Query v5 |
| Backend | Node.js · Express · TypeScript · Prisma ORM · Socket.io |
| Database | PostgreSQL 15 |
| Queue | Redis 7 · BullMQ |
| Scraping | Axios · Cheerio (per-store scrapers) |
| Notifications | Web Push (VAPID) · Nodemailer · Twilio · Discord Webhooks |
| Auth | JWT (access + refresh token rotation) · bcryptjs |
| Deployment | Docker · docker-compose |

---

## Quick Start

### 1. Clone & configure

```bash
git clone https://github.com/maxxer79/trackit.git
cd trackit
cp .env.example .env
```

Edit `.env` and set:
- `POSTGRES_PASSWORD` / `REDIS_PASSWORD` — strong secrets
- `JWT_SECRET` / `JWT_REFRESH_SECRET` — min 32 random chars
- SMTP or SendGrid credentials (for email alerts)
- Twilio credentials (optional, for SMS)
- VAPID keys — generate with: `npx web-push generate-vapid-keys`

### 2. Launch

```bash
docker compose up -d --build
```

Services start in order: **postgres → redis → backend → frontend**

| Service | URL |
|---|---|
| Frontend (PWA) | http://localhost |
| Backend API | http://localhost/api |

### 3. Run migrations & seed

```bash
docker exec trackit_backend npx prisma migrate deploy
docker exec trackit_backend node dist/scripts/seed.js
```

Seed creates the admin account from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`, all 70+ stores, and sample products.

---

## Development

```bash
# Infrastructure only
docker compose up postgres redis -d

# Backend hot-reload
cd backend && npm install && npm run dev

# Frontend (Vite HMR)
cd frontend && npm install && npm run dev
```

Frontend: http://localhost:5173 · Backend: http://localhost:3001

---

## Project Structure

```
trackit/
├── backend/
│   ├── prisma/schema.prisma
│   └── src/
│       ├── config/       # DB + Redis clients
│       ├── middleware/   # Auth, rate-limit
│       ├── routes/       # auth, products, tracking, notifications, admin
│       ├── scrapers/     # Per-store scraper modules (70+)
│       ├── services/     # Email, SMS, Push, Discord
│       ├── workers/      # BullMQ stock-checker worker
│       └── index.ts
├── frontend/
│   ├── public/           # Icons, PWA manifest
│   └── src/
│       ├── components/   # UI primitives + layout
│       ├── pages/        # Route pages + admin pages
│       ├── hooks/        # useAuth, useTracking, useSocket …
│       ├── stores/       # Zustand stores
│       ├── lib/          # Axios instance, utils
│       └── types/        # Shared TypeScript types
├── docker-compose.yml
└── .env.example
```

---

## Admin Access

Go to `/admin` — only accessible to `ADMIN` role users.

Default admin credentials (set in `.env`):
```
ADMIN_EMAIL=admin@trackit.app
ADMIN_PASSWORD=change_this_admin_password
```

---

## License

MIT

## ✨ Features

- **Real-time stock monitoring** across 70+ US retailers
- **Instant alerts** via Push, Email, SMS (Twilio), and Discord
- **AutoBuy** — automatically attempt checkout when stock is detected
- **Apple-inspired UI** — clean, beautiful design with full dark mode
- **Progressive Web App** — install on iPhone, Android, or desktop
- **User & Admin system** — per-user tracking limits, admin controls
- **Admin dashboard** — manage users, products, tracking limits, scraper health

## 🏪 Tracked Retailers

AMD, ASUS, Adorama, Amazon, Antonline, Apple, B&H Photo, BJs, Bandai Namco, Best Buy, Bambu Labs, Canon, Costco, Dell, Disney, EVGA, Foot Locker, Fujifilm, GameFly, GameStop, Gigabyte, Google, Govee, Hasbro, Hallmark, Home Depot, Jazwares, Kohls, Kroger, LG, Lego, Lenovo, Lowes, MSI, Mattel, Meijer, Micro Center, Microsoft, Newegg, Ninja Kitchen, Nintendo, Nvidia, Oculus, Office Depot, POP MART, Play-Asia, PlayStation Direct, Pokemon Center, QVC, Sam's Club, Samsung, Sony, StockX, Target, ToysRUs, Ubiquiti/Unifi, Valve/Steam Deck, Verizon, Walmart, Zotac, eBay, Nike/SNKRS, and more.

## 🚀 Quick Start (Docker)

```bash
# Clone the repo
git clone https://github.com/maxxer79/trackit.git
cd trackit

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your API keys, SMTP settings, etc.

# Start everything with Docker Compose
docker-compose up -d

# The app will be available at:
# Frontend: http://localhost:5173
# Backend API: http://localhost:3001
```

## 🛠️ Local Development

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- Redis 7+

### Backend
```bash
cd backend
npm install
npx prisma migrate dev
npx prisma db seed
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## 📱 Mobile App (PWA)

TrackIt is a Progressive Web App (PWA). To install on your phone:
- **iPhone**: Open in Safari → Share → "Add to Home Screen"
- **Android**: Open in Chrome → Menu → "Add to Home Screen"

## 🔧 Configuration

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | JWT signing secret |
| `TWILIO_*` | Twilio SMS credentials |
| `VAPID_*` | Web push notification keys |
| `SMTP_*` | Email server credentials |

Generate VAPID keys:
```bash
cd backend && npx web-push generate-vapid-keys
```

## 🏗️ Architecture

```
trackit/
├── frontend/          # React + TypeScript + Vite PWA
├── backend/           # Node.js + Express + TypeScript
│   ├── src/
│   │   ├── routes/    # REST API endpoints
│   │   ├── scrapers/  # Per-retailer stock checkers
│   │   ├── workers/   # Bull queue jobs
│   │   └── services/  # Email, SMS, Push, Discord
│   └── prisma/        # Database schema
└── docker-compose.yml
```

## 👤 User Roles

- **User** — Can track items (default limit: 1, unlockable by admin)
- **Admin** — Full access, manage users, set tracking limits, manage product catalog

## 📄 License

MIT
