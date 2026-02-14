declare namespace Express {
  export interface Request {
    cookies: Record<string, string>;
    user?: {
      id?: string;
      accountId?: string;
      email?: string;
      roles?: string[];
      permissions?: string[];
    };
  }
}
