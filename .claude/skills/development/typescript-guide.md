# TypeScript Development Guide

Comprehensive guide for TypeScript development including types, interfaces, generics, and best practices.

## Basic Types

### Primitive Types

```typescript
// String
let name: string = 'John';

// Number
let age: number = 30;

// Boolean
let isActive: boolean = true;

// Array
let numbers: number[] = [1, 2, 3];
let strings: Array<string> = ['a', 'b', 'c'];

// Tuple
let tuple: [string, number] = ['John', 30];

// Enum
enum Color {
  Red,
  Green,
  Blue
}
let color: Color = Color.Red;

// Any (avoid when possible)
let anything: any = 'hello';

// Unknown (safer than any)
let unknown: unknown = 'hello';
if (typeof unknown === 'string') {
  console.log(unknown.toUpperCase());
}

// Void
function logMessage(message: string): void {
  console.log(message);
}

// Null and Undefined
let nullable: string | null = null;
let optional: string | undefined = undefined;

// Never (for functions that never return)
function throwError(message: string): never {
  throw new Error(message);
}
```

## Interfaces

### Basic Interface

```typescript
interface User {
  id: string;
  name: string;
  email: string;
  age?: number; // Optional property
  readonly createdAt: Date; // Read-only property
}

const user: User = {
  id: '1',
  name: 'John Doe',
  email: 'john@example.com',
  createdAt: new Date()
};
```

### Extending Interfaces

```typescript
interface Person {
  name: string;
  age: number;
}

interface Employee extends Person {
  employeeId: string;
  department: string;
}

const employee: Employee = {
  name: 'John',
  age: 30,
  employeeId: 'EMP001',
  department: 'Engineering'
};
```

### Function Interfaces

```typescript
interface MathOperation {
  (a: number, b: number): number;
}

const add: MathOperation = (a, b) => a + b;
const subtract: MathOperation = (a, b) => a - b;
```

## Type Aliases

```typescript
// Basic type alias
type ID = string | number;

// Object type alias
type User = {
  id: ID;
  name: string;
  email: string;
};

// Union types
type Status = 'pending' | 'approved' | 'rejected';

// Intersection types
type Timestamped = {
  createdAt: Date;
  updatedAt: Date;
};

type User = Person & Timestamped;
```

## Generics

### Generic Functions

```typescript
function identity<T>(value: T): T {
  return value;
}

const num = identity<number>(42);
const str = identity<string>('hello');

// Generic with constraints
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

const user = { name: 'John', age: 30 };
const name = getProperty(user, 'name'); // Type: string
const age = getProperty(user, 'age'); // Type: number
```

### Generic Interfaces

```typescript
interface ApiResponse<T> {
  data: T;
  status: number;
  message: string;
}

interface User {
  id: string;
  name: string;
}

const response: ApiResponse<User> = {
  data: { id: '1', name: 'John' },
  status: 200,
  message: 'Success'
};
```

### Generic Classes

```typescript
class DataStore<T> {
  private data: T[] = [];

  add(item: T): void {
    this.data.push(item);
  }

  getAll(): T[] {
    return this.data;
  }

  find(predicate: (item: T) => boolean): T | undefined {
    return this.data.find(predicate);
  }
}

const userStore = new DataStore<User>();
userStore.add({ id: '1', name: 'John', email: 'john@example.com' });
```

## Utility Types

### Partial<T>

Makes all properties optional:

```typescript
interface User {
  id: string;
  name: string;
  email: string;
}

type PartialUser = Partial<User>;
// Equivalent to: { id?: string; name?: string; email?: string; }

function updateUser(user: User, updates: Partial<User>): User {
  return { ...user, ...updates };
}
```

### Required<T>

Makes all properties required:

```typescript
interface UserInput {
  name?: string;
  email?: string;
}

type RequiredUser = Required<UserInput>;
// Equivalent to: { name: string; email: string; }
```

### Readonly<T>

Makes all properties readonly:

```typescript
type ReadonlyUser = Readonly<User>;
// Equivalent to: { readonly id: string; readonly name: string; ... }
```

### Pick<T, K>

Selects specific properties:

```typescript
type UserPreview = Pick<User, 'id' | 'name'>;
// Equivalent to: { id: string; name: string; }
```

### Omit<T, K>

Removes specific properties:

```typescript
type UserWithoutEmail = Omit<User, 'email'>;
// Equivalent to: { id: string; name: string; }
```

### Record<K, T>

Creates object type with specific keys:

```typescript
type Roles = 'admin' | 'user' | 'guest';
type Permissions = Record<Roles, string[]>;

const permissions: Permissions = {
  admin: ['read', 'write', 'delete'],
  user: ['read', 'write'],
  guest: ['read']
};
```

## Advanced Patterns

### Conditional Types

```typescript
type IsString<T> = T extends string ? 'yes' : 'no';

type A = IsString<string>; // 'yes'
type B = IsString<number>; // 'no'
```

### Mapped Types

```typescript
type Nullable<T> = {
  [K in keyof T]: T[K] | null;
};

type NullableUser = Nullable<User>;
// All properties can now be null
```

### Template Literal Types

```typescript
type EventName = 'click' | 'focus' | 'blur';
type EventHandler = `on${Capitalize<EventName>}`;
// 'onClick' | 'onFocus' | 'onBlur'
```

## Type Guards

### typeof Guard

```typescript
function processValue(value: string | number) {
  if (typeof value === 'string') {
    return value.toUpperCase(); // Type: string
  } else {
    return value.toFixed(2); // Type: number
  }
}
```

### instanceof Guard

```typescript
class Dog {
  bark() { console.log('Woof!'); }
}

class Cat {
  meow() { console.log('Meow!'); }
}

function makeSound(animal: Dog | Cat) {
  if (animal instanceof Dog) {
    animal.bark(); // Type: Dog
  } else {
    animal.meow(); // Type: Cat
  }
}
```

### Custom Type Guards

```typescript
interface Bird {
  fly(): void;
  layEggs(): void;
}

interface Fish {
  swim(): void;
  layEggs(): void;
}

function isFish(pet: Bird | Fish): pet is Fish {
  return (pet as Fish).swim !== undefined;
}

function move(pet: Bird | Fish) {
  if (isFish(pet)) {
    pet.swim(); // Type: Fish
  } else {
    pet.fly(); // Type: Bird
  }
}
```

## Best Practices

### 1. Enable Strict Mode

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictPropertyInitialization": true
  }
}
```

### 2. Avoid `any` Type

```typescript
// Bad
function process(data: any) {
  return data.value;
}

// Good
function process<T extends { value: unknown }>(data: T) {
  return data.value;
}
```

### 3. Use Type Inference

```typescript
// Unnecessary type annotation
const name: string = 'John';

// Better - TypeScript infers the type
const name = 'John';
```

### 4. Prefer Interfaces for Objects

```typescript
// Good for objects
interface User {
  id: string;
  name: string;
}

// Good for unions/intersections
type Status = 'active' | 'inactive';
type UserWithStatus = User & { status: Status };
```

### 5. Use Readonly for Immutable Data

```typescript
interface Config {
  readonly apiUrl: string;
  readonly timeout: number;
}

const config: Readonly<Config> = {
  apiUrl: 'https://api.example.com',
  timeout: 5000
};

// config.apiUrl = 'new-url'; // Error: Cannot assign to readonly property
```

### 6. Type Function Parameters and Return Values

```typescript
function calculateTotal(items: Item[], tax: number): number {
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  return subtotal * (1 + tax);
}
```

### 7. Use Discriminated Unions

```typescript
interface Success {
  type: 'success';
  data: User;
}

interface Error {
  type: 'error';
  message: string;
}

type Result = Success | Error;

function handleResult(result: Result) {
  if (result.type === 'success') {
    console.log(result.data); // Type: User
  } else {
    console.error(result.message); // Type: string
  }
}
```

## Common Errors and Solutions

### Error: Type 'X' is not assignable to type 'Y'

```typescript
// Problem
interface User {
  name: string;
}

const user: User = {
  name: 'John',
  age: 30 // Error: Object literal may only specify known properties
};

// Solution
interface User {
  name: string;
  age?: number; // Make age optional or add to interface
}
```

### Error: Property 'X' does not exist on type 'Y'

```typescript
// Problem
interface User {
  name: string;
}

const user: User = { name: 'John' };
console.log(user.age); // Error: Property 'age' does not exist

// Solution
interface User {
  name: string;
  age?: number; // Add property to interface
}

// Or use type assertion (less safe)
console.log((user as any).age);
```

### Error: Cannot find name 'X'

```typescript
// Problem
console.log(myVariable); // Error: Cannot find name 'myVariable'

// Solution
const myVariable = 'value'; // Declare before use
console.log(myVariable);
```

## Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [TypeScript Deep Dive](https://basarat.gitbook.io/typescript/)
- [TypeScript Playground](https://www.typescriptlang.org/play)
