"""Read-only GitHub REST transport behind the attributed SourceReader protocol."""
from __future__ import annotations
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from .read import ISSUE_ID, MILESTONE_ID, Unavailable

# Restrict identities before inserting them in API paths.
IDENTITY = re.compile(r'^([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)(#|@milestone/)([1-9][0-9]*)$')

def resolve_token(environment=None):
    environment = os.environ if environment is None else environment
    cli_environment = {key: value for key, value in environment.items() if key not in {'GH_TOKEN', 'GITHUB_TOKEN'}}
    try:
        result = subprocess.run(['gh','auth','token','--hostname','github.com'],
                                capture_output=True, text=True, timeout=5, env=cli_environment)
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return environment.get('GITHUB_TOKEN', '').strip() or None

class GitHubRedirectHandler(HTTPRedirectHandler):
    """Keep bearer credentials on the GitHub API host during redirects too."""
    def redirect_request(self, request, response, code, message, headers, new_url):
        destination = urlsplit(new_url)
        if destination.scheme != 'https' or destination.netloc != 'api.github.com':
            raise Unavailable('failed')
        return super().redirect_request(request, response, code, message, headers, new_url)

class GitHubReader:
    def __init__(self, token, *, request=None):
        self.token = token
        self.request = request or self._request

    def _request(self, path):
        # Pagination may supply an absolute next URL, but credentials never leave this host.
        url = path if path.startswith('https://') else 'https://api.github.com' + path
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or parsed.netloc != 'api.github.com':
            raise Unavailable('corrupt')
        request = Request(url, headers={'Authorization': 'Bearer ' + self.token,
            'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'whatsup'})
        try:
            with build_opener(GitHubRedirectHandler).open(request, timeout=10) as response:
                value = json.load(response)
                link = response.headers.get('Link', '')
                match = re.search(r'<([^>]+)>;\s*rel="next"', link)
                return value, match[1] if match else None
        except Exception as error:
            # Parent endpoint returns 404 for a root issue (validate issue separately).
            if path.endswith('/parent') and getattr(error, 'code', None) == 404:
                return None, None
            raise Unavailable('failed') from None

    def _list(self, path):
        values, seen = [], set()
        while path:
            if path in seen or len(seen) >= 100:
                raise Unavailable('partial')
            seen.add(path)
            try:
                page, next_path = self.request(path)
            except Exception:
                raise Unavailable('partial' if values else 'failed') from None
            if not isinstance(page, list): raise Unavailable('corrupt')
            values.extend(page)
            path = next_path
        return values

    @staticmethod
    def _identity(record):
        url = record.get('html_url', '')
        match = re.fullmatch(r'https://github.com/([^/]+/[^/]+)/issues/([1-9][0-9]*)', url)
        if not match: raise Unavailable('corrupt')
        return match[1] + '#' + match[2]

    def read(self, source, identity):
        result = {'source': source, 'identity': identity,
                  'observed_at': datetime.now(timezone.utc).isoformat(), 'value': None}
        try:
            if source not in {'issues','children','parents','milestones','members','blockers'}:
                raise Unavailable('unsupported')
            match = IDENTITY.fullmatch(identity)
            if not match: raise Unavailable('corrupt')
            repo, kind, number = match.groups()
            base = '/repos/' + repo
            issue = base + '/issues/' + number
            if source == 'issues' and kind == '#':
                raw, _ = self.request(issue)
                if self._identity(raw) != identity: raise Unavailable('corrupt')
                value = {'id': identity, 'title': raw['title'], 'body': raw.get('body'),
                    'state': raw['state'], 'url': raw.get('html_url'),
                    'labels': [label['name'] for label in raw['labels']],
                    'milestone': repo + '@milestone/' + str(raw['milestone']['number']) if raw.get('milestone') else None}
            elif source in {'children','blockers'} and kind == '#':
                suffix = '/sub_issues' if source == 'children' else '/dependencies/blocked_by'
                value = [self._identity(row) for row in self._list(issue + suffix + '?per_page=100')]
            elif source == 'parents' and kind == '#':
                value, visited = [], {identity}
                while True:
                    raw, _ = self.request(issue + '/parent')
                    if raw is None: break
                    parent = self._identity(raw)
                    if parent in visited: raise Unavailable('corrupt')
                    visited.add(parent); value.append(parent)
                    parent_repo, parent_number = parent.split('#')
                    issue = '/repos/' + parent_repo + '/issues/' + parent_number
            elif source == 'milestones' and kind == '@milestone/':
                raw, _ = self.request(base + '/milestones/' + number)
                if raw['number'] != int(number): raise Unavailable('corrupt')
                value = {'id': identity, 'name': raw['title'], 'objective': raw.get('description'),
                         'state':raw['state'], 'url': raw.get('html_url')}
            elif source == 'members' and kind == '@milestone/':
                value = [self._identity(row) for row in self._list(base + '/issues?milestone=' + number + '&state=all&per_page=100') if 'pull_request' not in row]
            else:
                raise Unavailable('unsupported')
            result.update(availability='complete', value=value)
        except Unavailable as error:
            result.update(availability=error.reason)
        except Exception:
            result.update(availability='corrupt')
        return result
