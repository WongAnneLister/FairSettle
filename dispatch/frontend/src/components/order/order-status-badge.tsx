import React from 'react';
import { ORDER_STATUS_LABELS } from '@/lib/order-actions';
import { OrderStatus } from '@/lib/types';
import { Clock, Flame, CheckCircle, Bike, PackageCheck, XCircle } from 'lucide-react';
import { Badge } from '../ui/badge';

interface OrderStatusBadgeProps {
  status: OrderStatus;
  size?: 'sm' | 'md';
}

export function OrderStatusBadge({ status, size = 'md' }: OrderStatusBadgeProps) {
  switch (status) {
    case OrderStatus.Pending:
      return (
        <Badge variant="amber" size={size} className="gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          <span>{ORDER_STATUS_LABELS[status]}</span>
        </Badge>
      );
    case OrderStatus.Cooking:
      return (
        <Badge variant="brand" size={size} className="gap-1.5 animate-pulse-subtle">
          <Flame className="w-3.5 h-3.5" />
          <span>{ORDER_STATUS_LABELS[status]}</span>
        </Badge>
      );
    case OrderStatus.Cooked:
      return (
        <Badge variant="blue" size={size} className="gap-1.5">
          <CheckCircle className="w-3.5 h-3.5" />
          <span>{ORDER_STATUS_LABELS[status]}</span>
        </Badge>
      );
    case OrderStatus.PickedUp:
      return (
        <Badge variant="purple" size={size} className="gap-1.5">
          <Bike className="w-3.5 h-3.5" />
          <span>{ORDER_STATUS_LABELS[status]}</span>
        </Badge>
      );
    case OrderStatus.Delivered:
      return (
        <Badge variant="emerald" size={size} className="gap-1.5">
          <PackageCheck className="w-3.5 h-3.5" />
          <span>{ORDER_STATUS_LABELS[status]}</span>
        </Badge>
      );
    case OrderStatus.DeliveryFailed:
      return (
        <Badge variant="red" size={size} className="gap-1.5">
          <XCircle className="w-3.5 h-3.5" />
          <span>{ORDER_STATUS_LABELS[status]}</span>
        </Badge>
      );
    default:
      return (
        <Badge variant="slate" size={size}>
          {status}
        </Badge>
      );
  }
}
