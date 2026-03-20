export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly requestPath: string;
  public readonly requestMethod?: string;
  public readonly responseBody: unknown;

  constructor(
    message: string,
    statusCode: number,
    requestPath: string,
    requestMethodOrBody?: string | unknown,
    responseBody?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.requestPath = requestPath;
    // Support both 4-arg (message, status, path, body) and 5-arg (message, status, path, method, body) forms
    if (responseBody !== undefined) {
      this.requestMethod = requestMethodOrBody as string;
      this.responseBody = responseBody;
    } else {
      this.responseBody = requestMethodOrBody;
    }
  }
}

export class AuthError extends ApiError {
  constructor(
    message: string,
    statusCode: number = 401,
    requestPath: string = "/v1/token",
    responseBody?: unknown,
  ) {
    super(message, statusCode, requestPath, responseBody);
    this.name = "AuthError";
  }
}

export class RateLimitError extends ApiError {
  public readonly retryAfterMs: number;

  constructor(
    message: string,
    requestPath: string,
    retryAfterMs: number,
    responseBody?: unknown,
  ) {
    super(message, 429, requestPath, responseBody);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export interface FieldError {
  field: string;
  message: string;
}

export class ValidationError extends Error {
  public readonly fieldErrors: FieldError[];

  constructor(message: string, fieldErrors: FieldError[] = []) {
    super(message);
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}
