import { gql } from '@apollo/client';

export const ME_QUERY = gql`
  query Me {
    me {
      id
      email
      role
      emailVerified
      createdAt
    }
  }
`;

export const USER_PROFILE_QUERY = gql`
  query UserProfile($email: String!) {
    userProfile(email: $email) {
      ok
      error
      user {
        id
        email
        role
        emailVerified
      }
    }
  }
`;

export const ALL_RESTAURANTS_QUERY = gql`
  query AllRestaurants($input: AllRestaurantsInput!) {
    restaurants(input: $input) {
      ok
      error
      totalPages
      totalResults
      results {
        id
        name
        coverImage
        address
        isPromoted
        promotedUntil
        category {
          id
          name
          slug
        }
      }
    }
  }
`;

export const RESTAURANT_QUERY = gql`
  query Restaurant($input: RestaurantInput!) {
    restaurant(input: $input) {
      ok
      error
      restaurant {
        id
        name
        coverImage
        address
        isPromoted
        category {
          id
          name
          slug
        }
        menu {
          id
          name
          priceCents
          photo
          description
          options {
            name
            extraCents
            choices {
              name
              extraCents
            }
          }
        }
      }
    }
  }
`;

export const ALL_CATEGORIES_QUERY = gql`
  query AllCategories {
    allCategories {
      ok
      error
      categories {
        id
        name
        coverImage
        slug
        restaurantCount
      }
    }
  }
`;

export const CATEGORY_QUERY = gql`
  query Category($input: CategoryInput!) {
    category(input: $input) {
      ok
      error
      totalPages
      totalResults
      category {
        id
        name
        coverImage
        slug
      }
      restaurants {
        id
        name
        coverImage
        address
        isPromoted
      }
    }
  }
`;

export const SEARCH_RESTAURANT_QUERY = gql`
  query SearchRestaurant($input: SearchRestaurantInput!) {
    searchRestaurant(input: $input) {
      ok
      error
      totalPages
      totalResults
      restaurants {
        id
        name
        coverImage
        address
        isPromoted
        category {
          name
          slug
        }
      }
    }
  }
`;

export const MY_RESTAURANTS_QUERY = gql`
  query MyRestaurants {
    myRestaurants {
      ok
      error
      restaurants {
        id
        name
        coverImage
        address
        isPromoted
        promotedUntil
        category {
          name
        }
        menu {
          id
          name
          priceCents
        }
      }
    }
  }
`;

export const MY_RESTAURANT_QUERY = gql`
  query MyRestaurant($input: MyRestaurantInput!) {
    myRestaurant(input: $input) {
      ok
      error
      restaurant {
        id
        name
        coverImage
        address
        isPromoted
        promotedUntil
        category {
          name
          slug
        }
        menu {
          id
          name
          priceCents
          photo
          description
          options {
            name
            extraCents
            choices {
              name
              extraCents
            }
          }
        }
      }
    }
  }
`;

export const GET_ORDERS_QUERY = gql`
  query GetOrders($input: GetOrdersInput!) {
    getOrders(input: $input) {
      ok
      error
      totalPages
      totalResults
      orders {
        id
        status
        totalCents
        paymentStatus
        createdAt
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
          coverImage
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
  }
`;

export const GET_ORDER_QUERY = gql`
  query GetOrder($input: GetOrderInput!) {
    getOrder(input: $input) {
      ok
      error
      code
      order {
        id
        status
        totalCents
        paymentStatus
        checkoutUrl
        createdAt
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
          coverImage
          address
        }
        items {
          id
          dish {
            id
            name
            priceCents
            photo
          }
          options {
            name
            choice
          }
        }
      }
    }
  }
`;

export const GET_PAYMENTS_QUERY = gql`
  query GetPayments {
    getPayments {
      ok
      error
      payments {
        id
        transactionId
        restaurantId
        createdAt
      }
    }
  }
`;
