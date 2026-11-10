"""Conservative URL and employer normalization; never infer a company from ATS host."""
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

_HOSTED_ATS = ('jobs.lever.co', 'boards.greenhouse.io', 'job-boards.greenhouse.io', 'jobs.ashbyhq.com')
_TRACKING = {'gh_src', 'source', 'ref', 'referrer', 'fbclid', 'gclid'}


def canonicalize_url(url: str) -> str:
    p = urlsplit(url.strip())
    if p.scheme not in ('http', 'https') or not p.netloc:
        raise ValueError('HTTP(S) URL required')
    host = (p.hostname or '').lower().removeprefix('www.')
    port = f':{p.port}' if p.port and p.port not in (80, 443) else ''
    query = urlencode(sorted((k, v) for k, v in parse_qsl(p.query, keep_blank_values=True)
                             if not k.lower().startswith('utm_') and k.lower() not in _TRACKING))
    return urlunsplit(('https', host + port, p.path.rstrip('/') or '/', query, ''))


def canonical_domain(value: str) -> str | None:
    url = value if '://' in value else 'https://' + value
    p = urlsplit(url)
    host = (p.hostname or '').lower().removeprefix('www.')
    if not host or host in _HOSTED_ATS or any(host.endswith('.'+h) for h in _HOSTED_ATS):
        return None
    if '.' not in host:
        return None
    return host
