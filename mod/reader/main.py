"""One JSON request on stdin, one JSON snapshot on stdout; no third-party runtime."""
import json
import sys
from session_status import GitHubReader, enrich_report
from session_status.github import resolve_token

def main():
    if sys.version_info < (3, 10):
        raise RuntimeError('Python 3.10 or newer is required')
    request = json.load(sys.stdin)
    token = resolve_token()
    result = enrich_report(request['report'], GitHubReader(token) if token else None,
                           issue_kinds=request.get('issue_kinds', []))
    json.dump(result, sys.stdout)

if __name__ == '__main__':
    main()
