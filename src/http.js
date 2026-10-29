/**
 * A known, user-facing failure: a plain message, an HTTP status and an
 * optional machine code the client can switch on ("no_consent", "too_small").
 * `extra` fields (retryAfter, tip) are sent next to the message. The router
 * answers these as JSON; anything else is logged and becomes a 500.
 */
export class HttpError extends Error {
  constructor(message, status = 400, code = undefined, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
