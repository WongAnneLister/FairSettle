export enum UserRole {
  Client = 'Client',
  Owner = 'Owner',
  Delivery = 'Delivery',
}

export enum OrderStatus {
  Pending = 'Pending',
  Cooking = 'Cooking',
  Cooked = 'Cooked',
  PickedUp = 'PickedUp',
  Delivered = 'Delivered',
  DeliveryFailed = 'DeliveryFailed',
}

export enum DeliveryFailureReason {
  DRIVER_FAULT = 'DRIVER_FAULT',
  PLATFORM_FAULT = 'PLATFORM_FAULT',
}

export enum OrderPaymentStatus {
  NotRequired = 'NotRequired',
  AwaitingPayment = 'AwaitingPayment',
  Paid = 'Paid',
  Failed = 'Failed',
}

export interface User {
  id: number;
  email: string;
  role: UserRole;
  emailVerified: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface DishChoice {
  name: string;
  extraCents?: number | null;
}

export interface DishOption {
  name: string;
  choices?: DishChoice[] | null;
  extraCents?: number | null;
}

export interface Dish {
  id: number;
  name: string;
  priceCents: number;
  photo?: string | null;
  description: string;
  restaurantId?: number;
  options?: DishOption[] | null;
}

export interface Category {
  id: number;
  name: string;
  coverImage?: string | null;
  slug: string;
  restaurantCount?: number;
}

export interface Restaurant {
  id: number;
  name: string;
  coverImage: string;
  address: string;
  category?: Category | null;
  menu?: Dish[] | null;
  ownerId?: number;
  owner?: User | null;
  isPromoted: boolean;
  promotedUntil?: string | null;
  createdAt?: string;
}

export interface OrderItemOption {
  name: string;
  choice?: string | null;
}

export interface OrderItem {
  id: number;
  dish?: Dish | null;
  options?: OrderItemOption[] | null;
}

export interface Order {
  id: number;
  customerId: number;
  customer?: User | null;
  driverId?: number | null;
  driver?: User | null;
  restaurant?: Restaurant | null;
  items: OrderItem[];
  totalCents?: number | null;
  paymentStatus?: OrderPaymentStatus;
  checkoutUrl?: string | null;
  status: OrderStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface Payment {
  id: number;
  transactionId: string;
  userId: number;
  restaurantId: number;
  createdAt?: string;
}

// GraphQL Response wrappers
export interface CoreOutput {
  ok: boolean;
  error?: string | null;
  code?: string | null;
}

export interface LoginOutput extends CoreOutput {
  token?: string | null;
}

export type CreateAccountOutput = CoreOutput;

export interface CreateRestaurantOutput extends CoreOutput {
  restaurantId?: number;
}

export interface AllRestaurantsOutput extends CoreOutput {
  totalPages?: number;
  totalResults?: number;
  results?: Restaurant[];
}

export interface RestaurantOutput extends CoreOutput {
  restaurant?: Restaurant;
}

export interface AllCategoryOutput extends CoreOutput {
  categories?: Category[];
}

export interface CategoryOutput extends CoreOutput {
  category?: Category;
  restaurants?: Restaurant[];
  totalPages?: number;
  totalResults?: number;
}

export interface CreateOrderOutput extends CoreOutput {
  orderId?: number;
}

export interface GetOrdersOutput extends CoreOutput {
  totalPages?: number;
  totalResults?: number;
  orders?: Order[];
}

export interface AvailableOrdersOutput extends CoreOutput {
  totalPages?: number;
  totalResults?: number;
  orders?: Order[];
}

export interface GetOrderOutput extends CoreOutput {
  order?: Order;
}

export type TakeOrderOutput = CoreOutput;

export type EditOrderOutput = CoreOutput;

export interface MyRestaurantsOutput extends CoreOutput {
  restaurants?: Restaurant[];
}

export interface MyRestaurantOutput extends CoreOutput {
  restaurant?: Restaurant;
}
