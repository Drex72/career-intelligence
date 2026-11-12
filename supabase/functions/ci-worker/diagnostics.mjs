/** Stable, sanitized failure reasons; no upstream body, URL or secrets in telemetry. */
export class SourceFetchFailure extends Error {
  constructor(code) {
    super(code);
    this.name='SourceFetchFailure';
    this.code=code;
  }
}
export function sourceFailureReason(error) {
  if(error instanceof SourceFetchFailure) return error.code;
  if(error && typeof error==='object') {
    if(error.name==='TimeoutError'||error.name==='AbortError')return 'timeout';
    if(error instanceof SyntaxError)return 'invalid_json';
  }
  return 'unexpected_error';
}
export function httpSourceFailure(status) {
  if(status===429)return new SourceFetchFailure('rate_limited');
  if(status===404||status===410)return new SourceFetchFailure('board_not_found');
  if(status>=500)return new SourceFetchFailure('upstream_server_error');
  return new SourceFetchFailure('upstream_http_error');
}
