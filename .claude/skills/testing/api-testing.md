# API Testing Guide

Complete guide for testing REST and GraphQL APIs with authentication, error handling, and best practices.

## REST API Testing

### Testing GET Requests

```javascript
// Basic GET request
const response = await fetch('/api/users');
const data = await response.json();

expect(response.status).toBe(200);
expect(data).toHaveProperty('users');
expect(Array.isArray(data.users)).toBe(true);
```

### Testing POST with Authentication

```javascript
// POST with Bearer token
const response = await fetch('/api/users', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'John Doe',
    email: 'john@example.com'
  })
});

const data = await response.json();
expect(response.status).toBe(201);
expect(data).toHaveProperty('id');
```

### Testing PUT/PATCH Updates

```javascript
// Update existing resource
const response = await fetch(`/api/users/${userId}`, {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Jane Doe'
  })
});

expect(response.status).toBe(200);
```

### Testing DELETE

```javascript
const response = await fetch(`/api/users/${userId}`, {
  method: 'DELETE',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

expect(response.status).toBe(204);
```

## Error Handling

### Handling 4xx Errors

```javascript
const response = await fetch('/api/users', { /* ... */ });

if (!response.ok) {
  if (response.status === 401) {
    throw new Error('Unauthorized: Token invalid or expired');
  }
  if (response.status === 403) {
    throw new Error('Forbidden: Insufficient permissions');
  }
  if (response.status === 404) {
    throw new Error('Not Found: Resource does not exist');
  }

  const error = await response.json();
  throw new Error(error.message || 'Request failed');
}
```

### Handling Network Errors

```javascript
try {
  const response = await fetch('/api/users');
  // ... handle response
} catch (error) {
  if (error.name === 'NetworkError') {
    console.error('Network connection failed');
  } else if (error.name === 'TimeoutError') {
    console.error('Request timed out');
  } else {
    console.error('Request failed:', error.message);
  }
}
```

## Authentication Patterns

### Bearer Token

```javascript
const token = localStorage.getItem('authToken');

const headers = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
};
```

### API Key

```javascript
const headers = {
  'X-API-Key': process.env.API_KEY,
  'Content-Type': 'application/json'
};
```

### Basic Auth

```javascript
const username = 'user';
const password = 'pass';
const encoded = btoa(`${username}:${password}`);

const headers = {
  'Authorization': `Basic ${encoded}`,
  'Content-Type': 'application/json'
};
```

## GraphQL API Testing

### Query Testing

```javascript
const query = `
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      name
      email
    }
  }
`;

const response = await fetch('/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    query,
    variables: { id: userId }
  })
});

const { data, errors } = await response.json();

expect(errors).toBeUndefined();
expect(data.user).toBeDefined();
```

### Mutation Testing

```javascript
const mutation = `
  mutation CreateUser($input: CreateUserInput!) {
    createUser(input: $input) {
      id
      name
      email
    }
  }
`;

const response = await fetch('/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    query: mutation,
    variables: {
      input: {
        name: 'John Doe',
        email: 'john@example.com'
      }
    }
  })
});

const { data, errors } = await response.json();

expect(errors).toBeUndefined();
expect(data.createUser.id).toBeDefined();
```

## Best Practices

### 1. Test All HTTP Methods

- GET (retrieve)
- POST (create)
- PUT/PATCH (update)
- DELETE (remove)

### 2. Test Authentication

- Valid tokens
- Expired tokens
- Invalid tokens
- Missing tokens

### 3. Test Error Cases

- 400 Bad Request (invalid input)
- 401 Unauthorized (no/invalid token)
- 403 Forbidden (insufficient permissions)
- 404 Not Found (resource doesn't exist)
- 500 Internal Server Error (server issues)

### 4. Validate Response Schemas

```javascript
const schema = {
  id: expect.any(String),
  name: expect.any(String),
  email: expect.stringMatching(/^.+@.+\..+$/),
  createdAt: expect.any(String)
};

expect(data.user).toMatchObject(schema);
```

### 5. Test Rate Limiting

```javascript
// Send multiple requests rapidly
const requests = Array(100).fill().map(() =>
  fetch('/api/users', { headers })
);

const responses = await Promise.all(requests);
const rateLimited = responses.filter(r => r.status === 429);

expect(rateLimited.length).toBeGreaterThan(0);
```

### 6. Test Pagination

```javascript
// First page
const page1 = await fetch('/api/users?page=1&limit=10');
const data1 = await page1.json();

expect(data1.users.length).toBeLessThanOrEqual(10);
expect(data1).toHaveProperty('nextPage');

// Second page
const page2 = await fetch(`/api/users?page=${data1.nextPage}&limit=10`);
const data2 = await page2.json();

expect(data2.users[0].id).not.toBe(data1.users[0].id);
```

### 7. Test Timeouts

```javascript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);

try {
  const response = await fetch('/api/slow-endpoint', {
    signal: controller.signal
  });
  clearTimeout(timeout);
  // ... handle response
} catch (error) {
  if (error.name === 'AbortError') {
    console.error('Request timed out after 5 seconds');
  }
}
```

## Testing Tools

- **fetch** - Native browser API
- **axios** - Popular HTTP client
- **supertest** - HTTP assertions (Node.js)
- **jest** - Testing framework
- **Postman** - API development/testing tool
- **Insomnia** - API client

## Common Patterns

### Retry Logic

```javascript
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;

      // Retry on server errors (5xx)
      if (response.status >= 500 && i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }

      return response;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}
```

### Request Mocking (Jest)

```javascript
// Mock fetch
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ users: [] })
  })
);

// Test
const response = await fetch('/api/users');
const data = await response.json();

expect(fetch).toHaveBeenCalledWith('/api/users');
expect(data.users).toEqual([]);
```
