'use client';

import {
  ApolloClient,
  InMemoryCache,
  createHttpLink,
  split,
  from,
} from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';

let client: ApolloClient<any> | null = null;

export function getApolloClient() {
  if (client) return client;

  const httpUri =
    process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT || '/api/graphql';

  const httpLink = createHttpLink({
    uri: httpUri,
  });

  const authLink = setContext((_, { headers }) => {
    let token = '';
    if (typeof window !== 'undefined') {
      token = localStorage.getItem('token') || '';
    }
    return {
      headers: {
        ...headers,
        authorization: token,
      },
    };
  });

  let splitLink = from([authLink, httpLink]);

  if (typeof window !== 'undefined') {
    try {
      const wsUri =
        process.env.NEXT_PUBLIC_WS_GRAPHQL_ENDPOINT || 'ws://localhost:4000/graphql';

      const wsClient = createClient({
        url: wsUri,
        connectionParams: () => {
          const token = localStorage.getItem('token') || '';
          return {
            Authorization: token,
          };
        },
        retryAttempts: 3,
        shouldRetry: () => true,
        lazy: true,
      });

      const wsLink = new GraphQLWsLink(wsClient);

      splitLink = split(
        ({ query }) => {
          const definition = getMainDefinition(query);
          return (
            definition.kind === 'OperationDefinition' &&
            definition.operation === 'subscription'
          );
        },
        wsLink,
        from([authLink, httpLink])
      );
    } catch (e) {
      console.warn('WebSocket subscription initialization failed, falling back to HTTP:', e);
    }
  }

  client = new ApolloClient({
    link: splitLink,
    cache: new InMemoryCache(),
    defaultOptions: {
      watchQuery: {
        fetchPolicy: 'cache-and-network',
      },
    },
  });

  return client;
}
