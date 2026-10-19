export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public payload?: Record<string, unknown>,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, message);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, payload?: Record<string, unknown>) {
    super(400, message, payload);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message: string, payload?: Record<string, unknown>) {
    super(422, message, payload);
  }
}

