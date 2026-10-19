# CravingFast - On-Demand Order & Dispatch Frontend

Next.js 14+ / TypeScript / Tailwind CSS / Apollo Client 高颜值即时外卖点单与智能派单系统前端。

与后端的 NestJS 11 + GraphQL + TypeORM + Redis 派单引擎深度对齐，支持顾客点单、后厨出单与骑手原子抢单全流程。

---

## 🌟 核心特性与角色功能

### 1. 🛒 顾客端 (Client)
- **首页发现**：分类胶囊导航（披萨、汉堡、轻食、饮品等）、全城置顶推荐餐厅专区、实时防抖关键词搜索。
- **进店点单**：餐厅门面大图、多规格自选加料弹窗（`DishOptionModal`），选项实时联动计价。
- **全局购物车**：右侧平滑滑出抽屉（`CartDrawer`），多规格聚合、单项增减、清空、小计与费用明细。
- **下单结算**：确认收餐地址、联系方式、支付方式与备注，一键提交订单进入后厨队列。
- **实时五步订单流转追踪**：
  - `Pending` (下单成功) ➔ `Cooking` (后厨制作) ➔ `Cooked` (出餐待抢单) ➔ `PickedUp` (骑手配送) ➔ `Delivered` (送达)
  - 集成 WebSocket 订阅（`orderUpdates`）与智能轮询降级，步骤条配备微动效与脉冲呼吸灯。
- **历史订单**：按状态筛选进行中与已完成订单。

### 2. 👨‍🍳 餐厅店长工作台 (Owner)
- **餐厅管理**：创建新餐厅（名称、地址、分类、封面）、列表展示。
- **菜品与加料管理**：录入菜品（支持浮点输入转为后端标准的**整数分**精度 `priceCents`）、多级选项与加料价格配置。
- **后厨出单大屏（Kitchen Dispatch Screen）**：
  - 实时监听接收顾客新下单（`pendingOrders` 订阅 + 轮询）。
  - 一键流转状态：点击「开始烹饪」(`Cooking`) ➔ 点击「出餐完成·呼叫骑手」(`Cooked`)。
- **付费置顶推广**：模拟调用 `createPayment`，获得 7 天首页黄金展位置顶标志与专属金标。

### 3. 🛵 骑手配送大厅 (Delivery)
- **实时待抢单大厅**：
  - 监听所有已出餐（`Cooked`）且尚无骑手的订单（`cookedOrders` 订阅）。
  - **高并发原子抢单**：调用 `takeOrder`，单行 SQL 条件写锁拦截重派冲突，若被其他人抢先接走则优雅反馈 `CONFLICT` 提示，体验极佳。
- **当前配送任务看板**：
  - 查看已接单待取餐和送餐路线，一键确认到店取餐（`PickedUp`）与送达顾客（`Delivered`）。

### 4. ⚡ 开箱即用体验（一键角色填充）
登录页面提供 **「一键免密体验」** 快捷按钮：
- 快速以 **顾客视角** 登录
- 快速以 **店长视角** 登录
- 快速以 **骑手视角** 登录

若该角色账号在数据库中尚未创建，系统将自动调用 `createAccount` 注册并无缝登录！

---

## 🚀 启动指南

### 1. 确保后端已启动
```bash
# 在项目根目录下 (food-delivery-backend-main)
docker compose up -d          # 启动 Postgres 16 与 Redis 7
npm run start:dev             # 后端运行在 http://localhost:4000/graphql
```

### 2. 启动前端
```bash
# 进入 frontend 目录
cd frontend

# 安装依赖 (如尚未安装)
npm install

# 启动开发服务器
npm run dev
```

浏览器访问 `http://localhost:3000` 即可畅享完整外卖派单全链路！

---

## 🎨 视觉与工程设计
- **框架与语言**：Next.js 14.2 (App Router) + React 18 + TypeScript
- **样式与动效**：Tailwind CSS + Tailwind Animate + 毛玻璃拟态（Glassmorphism）+ 渐变弥散阴影 + Lucide React
- **网络代理**：内置 Next.js Rewrites `/api/graphql` ➔ `http://localhost:4000/graphql`，消除跨域阻碍。
