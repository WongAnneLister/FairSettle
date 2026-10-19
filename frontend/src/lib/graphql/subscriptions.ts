import { gql } from '@apollo/client';

export const ORDER_UPDATES_SUBSCRIPTION = gql`
  subscription OrderUpdates($input: OrderUpdatesInput!) {
    orderUpdates(input: $input) {
      id
      status
      totalCents
      customer {
        id
        email
      }
      driver {
        id
        email
      }
      restaurant {
        id
        name
        address
      }
      items {
        id
        dish {
          id
          name
          priceCents
        }
        options {
          name
          choice
        }
      }
    }
  }
`;

export const PENDING_ORDERS_SUBSCRIPTION = gql`
  subscription PendingOrders {
    pendingOrders {
      id
      status
      totalCents
      createdAt
      customer {
        id
        email
      }
      restaurant {
        id
        name
      }
      items {
        id
        dish {
          id
          name
          priceCents
        }
        options {
          name
          choice
        }
      }
    }
  }
`;

export const COOKED_ORDERS_SUBSCRIPTION = gql`
  subscription CookedOrders {
    cookedOrders {
      id
      status
      totalCents
      createdAt
      restaurant {
        id
        name
        address
      }
      items {
        id
        dish {
          id
          name
          priceCents
        }
      }
    }
  }
`;
