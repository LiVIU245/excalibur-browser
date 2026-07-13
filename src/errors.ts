export class ApiError extends Error {
  constructor(readonly response: Response, readonly data: unknown) {
    super(
      `Ingest request failed with status ${response.status}: ${
        typeof data === 'string' ? data : JSON.stringify(data)
      }`,
    );
    this.name = 'ApiError';
  }

  static async fromResponse(response: Response) {
    let data: unknown = undefined;
    try {
      if (response.headers.get('content-type')?.includes('application/json')) {
        data = await response.json();
        return new ApiError(response, data);
      }
      data = await response.text();
    } catch {
      // Body unreadable; report status alone.
    }

    return new ApiError(response, data);
  }
}
