// Common type definitions

// JSON type for settings and metadata
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Json = JsonValue;

// App Installation Settings
export interface AppSettings {
  // Add specific settings fields as needed
  theme?: string;
  notifications?: boolean;
  [key: string]: JsonValue | undefined;
}

// Stripe Customer Metadata
export interface StripeMetadata {
  userId?: string;
  [key: string]: string | undefined;
}

// API Response types
export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  page: number;
  pageSize: number;
  total: number;
}

// Session types
export interface SessionUser {
  id: string;
  email: string;
  name?: string;
  image?: string;
  emailVerified?: boolean;
}

export interface Session {
  user: SessionUser;
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    token: string;
    ipAddress?: string;
    userAgent?: string;
  };
}
