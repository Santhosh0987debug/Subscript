/**
 * Gateway failures are kept separate from billing-state conflicts so routers
 * can return provider/network errors as 502/503 instead of 409.
 */
export class GatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class GatewayConfigurationError extends GatewayError {
  constructor(message = "The payment gateway is not configured.") {
    super(message);
  }
}

export class GatewayRequestError extends GatewayError {
  readonly providerStatus: number | null;

  constructor(message: string, providerStatus: number | null = null) {
    super(message);
    this.providerStatus = providerStatus;
  }
}

export class GatewaySignatureError extends GatewayError {
  constructor(message = "The payment signature could not be verified.") {
    super(message);
  }
}

export class GatewayPayloadError extends GatewayError {
  constructor(message = "The gateway event payload is malformed.") {
    super(message);
  }
}

export class GatewayWebhookInProgressError extends GatewayError {
  constructor(message = "This webhook event is already being processed.") {
    super(message);
  }
}
