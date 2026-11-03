declare global {
  namespace Express {
    interface Locals {
      requestId: string;
    }
  }
}

export {};
