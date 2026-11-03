# CravingFast - On-Demand Order & Dispatch Frontend

Next.js 14+ / TypeScript / Tailwind CSS / Apollo Client frontend for food delivery and driver dispatch.

Works with the NestJS 11 + GraphQL + TypeORM + Redis dispatch backend, covering customer orders, kitchen preparation and driver claims.

---

## 🌟 Features and roles

### 1. 🛒 Customer (Client)
- **Discover restaurants**: category filters (pizza, burgers, salads, drinks and more), featured restaurants and debounced keyword search.
- **Order from a restaurant**: restaurant cover images and a dish options modal (`DishOptionModal`) with prices that update as options change.
- **Shared cart**: a slide-out drawer (`CartDrawer`) with grouped options, quantity controls, item removal, subtotal and total.
- **Checkout**: confirm the delivery address, contact details, payment method and notes, then place an order.
- **Live order tracking in five steps**:
  - `Pending` (Order placed) ➔ `Cooking` (Cooking) ➔ `Cooked` (Ready for pickup) ➔ `PickedUp` (On the way) ➔ `Delivered` (Delivered)
  - WebSocket subscriptions (`orderUpdates`) with polling fallback, animated steps and live indicators.
- **Order history**: filter active and completed orders.

### 2. 👨‍🍳 Restaurant owner dashboard (Owner)
- **Restaurant management**: create restaurants with a name, address, category and cover image, and browse your restaurant list.
- **Dishes and extras**: enter dish prices in dollars, converted to the backend standard of **integer cents** (`priceCents`), and configure option groups and extra prices.
- **Kitchen order board (Kitchen Dispatch Screen)**:
  - Receive new customer orders through the `pendingOrders` subscription and polling.
  - Update status: select "Start cooking" (`Cooking`) ➔ select "Mark ready and request a driver" (`Cooked`).
- **Paid featured promotion**: simulate `createPayment` to feature a restaurant on the home page for 7 days with a gold badge.

### 3. 🛵 Driver dashboard (Delivery)
- **Available orders**:
  - Subscribe to ready orders (`Cooked`) that have no assigned driver (`cookedOrders` subscription).
  - **Atomic order claims**: `takeOrder` uses a conditional SQL write to prevent duplicate assignment. If another driver claims it first, the interface reports `CONFLICT`.
- **Active deliveries**:
  - View claimed orders awaiting pickup and delivery, then confirm pickup (`PickedUp`) and delivery to the customer (`Delivered`).

### 4. ⚡ One-click demo (role shortcuts)
The sign-in page offers **one-click demo** buttons:
- Sign in as a **Customer**
- Sign in as a **Restaurant owner**
- Sign in as a **Driver**

If an account for the role does not exist, the system calls `createAccount` to register it and signs in automatically.

---

## 🚀 Getting started

### 1. Start the backend
```bash
# In the project root (food-delivery-backend-main)
docker compose up -d          # Start Postgres 16 and Redis 7
npm run start:dev             # Backend at http://localhost:4000/graphql
```

### 2. Start the frontend
```bash
# Enter the frontend directory
cd frontend

# Install dependencies (if needed)
npm install

# Start the development server
npm run dev
```

Open `http://localhost:3001` in your browser to try ordering and dispatch.

---

## 🎨 Visual and engineering design
- **Framework and language**: Next.js 14.2 (App Router) + React 18 + TypeScript
- **Styling and animation**: Tailwind CSS + Tailwind Animate + glass effects (Glassmorphism) + gradient shadows + Lucide React
- **Network proxy**: Next.js Rewrites `/api/graphql` ➔ `http://localhost:4000/graphql` to avoid cross-origin requests.
