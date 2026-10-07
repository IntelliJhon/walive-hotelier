/** An error whose message is safe to show to the guest. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** The PMS answered with statuscode = 1 (its message is meant for display). */
export class PmsError extends AppError {
  constructor(public action: string, message: string) {
    super(422, "PMS_ERROR", message || `The hotel system rejected the ${action} request.`);
  }
}
