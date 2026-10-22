import { gql } from '@apollo/client';

export const LOGIN_MUTATION = gql`
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      ok
      error
      token
    }
  }
`;

export const CREATE_ACCOUNT_MUTATION = gql`
  mutation CreateAccount($input: CreateAccountInput!) {
    createAccount(input: $input) {
      ok
      error
    }
  }
`;

export const EDIT_PROFILE_MUTATION = gql`
  mutation EditProfile($input: EditProfileInput!) {
    editProfile(input: $input) {
      ok
      error
    }
  }
`;

export const CREATE_RESTAURANT_MUTATION = gql`
  mutation CreateRestaurant($input: CreateRestaurantInput!) {
    createRestaurant(input: $input) {
      ok
      error
      restaurantId
    }
  }
`;

export const EDIT_RESTAURANT_MUTATION = gql`
  mutation EditRestaurant($input: EditRestaurentInput!) {
    editRestaurant(input: $input) {
      ok
      error
    }
  }
`;

export const DELETE_RESTAURANT_MUTATION = gql`
  mutation DeleteRestaurant($input: DeleteRestaurentInput!) {
    deleteRestaurant(input: $input) {
      ok
      error
    }
  }
`;

export const CREATE_DISH_MUTATION = gql`
  mutation CreateDish($input: CreateDishInput!) {
    createDish(input: $input) {
      ok
      error
    }
  }
`;

export const EDIT_DISH_MUTATION = gql`
  mutation EditDish($input: EditDishInput!) {
    editDish(input: $input) {
      ok
      error
    }
  }
`;

export const DELETE_DISH_MUTATION = gql`
  mutation DeleteDish($input: DeleteDishInput!) {
    deleteDish(input: $input) {
      ok
      error
    }
  }
`;

export const CREATE_ORDER_MUTATION = gql`
  mutation CreateOrder($input: CreateOrderInput!) {
    createOrder(input: $input) {
      ok
      error
      code
      orderId
    }
  }
`;

export const EDIT_ORDER_MUTATION = gql`
  mutation EditOrder($input: EditOrderInput!) {
    editOrder(input: $input) {
      ok
      error
      code
    }
  }
`;

export const TAKE_ORDER_MUTATION = gql`
  mutation TakeOrder($input: TakeOrderInput!) {
    takeOrder(input: $input) {
      ok
      error
      code
    }
  }
`;

export const CREATE_PAYMENT_MUTATION = gql`
  mutation CreatePayment($input: CreatePaymentInput!) {
    createPayment(input: $input) {
      ok
      error
      code
    }
  }
`;
