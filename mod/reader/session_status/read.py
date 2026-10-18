"""Pure session-context projection. Adapters supply facts, never permissions."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import re
from typing import Any, Callable, Protocol
from urllib.parse import urlsplit

NOT_RECORDED = 'Not recorded'
ISSUE_ID = re.compile(r'^[^/#\s]+/[^/#\s]+#[1-9][0-9]*$')
MILESTONE_ID = re.compile(r'^[^/@\s]+/[^/@\s]+@milestone/[1-9][0-9]*$')
class SourceReader(Protocol):
    def read(self, source: str, identity: str) -> dict[str, Any]:
        """Return an attributed, complete/absent/unavailable result envelope."""
        ...


class RecordedReaders:
    """Replay caller-loaded normalized captures; missing keys are unsupported."""
    def __init__(self, records: dict[str, Any]):
        self._records = records

    def read(self, source: str, identity: str) -> dict[str, Any]:
        return deepcopy(self._records[source][identity])


class Unavailable(Exception):
    def __init__(self, reason: str):
        self.reason = reason


def section(state: str, evidence: list, value=None, reason=None) -> dict:
    return {'state': state, 'value': value, 'reason': reason, 'evidence': deepcopy(evidence)}


def text_field(record: dict, key: str):
    value = record.get(key)
    if value is None or value == '':
        return NOT_RECORDED
    if not isinstance(value, str):
        raise Unavailable('corrupt')
    return value


def ids(value, pattern=ISSUE_ID) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(x, str) or not pattern.fullmatch(x) for x in value):
        raise Unavailable('corrupt')
    return sorted(set(value))


class Observation:
    """One-read cache plus dependency evidence; no durable state."""
    def __init__(self, reader, observed_at: str):
        self.reader = reader.read if hasattr(reader, 'read') else reader
        self.observed_at = observed_at
        self.cache = {}

    def get(self, source: str, identity: str, evidence: list, *, absent=False):
        cache_key = (source, identity)
        if cache_key not in self.cache:
            try:
                self.cache[cache_key] = deepcopy(self.reader(source, identity))
            except KeyError:
                self.cache[cache_key] = {'availability': 'unsupported'}
            except Exception:
                # Never publish exception messages that may contain secrets.
                self.cache[cache_key] = {'availability': 'failed'}
        raw = self.cache[cache_key]
        if not isinstance(raw, dict):
            raw = {'availability': 'corrupt'}
        availability = raw.get('availability', 'corrupt')
        provenance = {k: raw.get(k) for k in ['source', 'identity', 'observed_at', 'source_time', 'revision']}
        provenance.update(source=raw.get('source', source), identity=raw.get('identity', identity),
                          observed_at=raw.get('observed_at', self.observed_at), availability=availability)
        if provenance not in evidence:
            evidence.append(provenance)
        if availability not in {'complete', 'absent'}:
            raise Unavailable(availability if availability in {'partial','failed','unsupported','corrupt'} else 'corrupt')
        if raw.get('source') != source or raw.get('identity') != identity or not raw.get('observed_at'):
            raise Unavailable('corrupt')
        if availability == 'absent' or raw.get('value') is None:
            if absent:
                return None
            raise Unavailable('corrupt')
        return deepcopy(raw['value'])

    def issue(self, identity: str, evidence: list):
        if not isinstance(identity, str) or not ISSUE_ID.fullmatch(identity):
            raise Unavailable('corrupt')
        value = self.get('issues', identity, evidence)
        if not isinstance(value, dict) or value.get('id') != identity or value.get('state') not in {'open','closed'}:
            raise Unavailable('corrupt')
        text_field(value, 'title')
        milestone = value.get('milestone')
        if milestone is not None and (not isinstance(milestone, str) or not MILESTONE_ID.fullmatch(milestone)):
            raise Unavailable('corrupt')
        return value

    def attempt(self, evidence: list, operation: Callable):
        try:
            return section('present', evidence, operation())
        except Unavailable as error:
            return section('unavailable', evidence, reason=error.reason)
        except (KeyError, TypeError, ValueError, RecursionError):
            return section('unavailable', evidence, reason='corrupt')

    def blockers(self, identity: str, evidence: list):
        result = self.get('blockers', identity, evidence, absent=True)
        if result is None:
            return NOT_RECORDED
        return [key for key in ids(result) if self.issue(key, evidence)['state'] == 'open']

    def progress(self, kind: str, identity: str, evidence: list, members: list[str], revision=None):
        unique = ids(members)
        closed = sum(self.issue(key, evidence)['state'] == 'closed' for key in unique)
        return {'kind':kind, 'identity':identity, 'revision':revision, 'members':unique,
                'closed':closed, 'total':len(unique)}

    def epic_members(self, root: str, evidence: list):
        # Iterative DFS avoids a recursion-depth limit for large native hierarchies.
        visiting, finished, leaves = set(), set(), set()
        stack = [(root, False)]
        while stack:
            key, exit_node = stack.pop()
            if exit_node:
                visiting.remove(key); finished.add(key)
                continue
            if key in visiting:
                raise Unavailable('corrupt')
            if key in finished:
                continue
            self.issue(key, evidence)
            children = ids(self.get('children', key, evidence))
            visiting.add(key)
            stack.append((key, True))
            if children:
                stack.extend((child, False) for child in reversed(children))
            elif key != root:
                leaves.add(key)
        return sorted(leaves)

def source_page(value: Any) -> str | None:
    """Keep a supplied absolute web URL, or expose no page for malformed data."""
    if not isinstance(value, str) or any(c.isspace() or ord(c) < 32 or ord(c) == 127 or c == '\\' for c in value):
        return None
    try:
        url = urlsplit(value)
        if url.scheme not in {'http', 'https'} or not url.hostname or url.username is not None or url.password is not None:
            return None
        # Accessing port validates numeric syntax and the legal range.
        url.port
    except ValueError:
        return None
    return value


def enrich_report(report: dict, readers: SourceReader | Callable | None, *, issue_kinds=()) -> dict:
    """Join report display state to GitHub; never mutate the report or any authority.

    A configured issue section with an identity counts native leaves (epic) or
    direct milestone members. Otherwise its explicit items define its set.
    """
    report = deepcopy(report)
    if readers is None:
        return {'report': report, 'off_reason': 'GitHub enrichment is off: no gh token or GITHUB_TOKEN.'}
    observation = Observation(readers, datetime.now().astimezone().isoformat())
    active = {item.get('identity') for group in report.get('sections', [])
              for item in group.get('items', []) if item['state'] == 'active'}

    def entity(identity):
        evidence = []
        def build():
            if ISSUE_ID.fullmatch(identity):
                raw = observation.issue(identity, evidence)
                labels = raw.get('labels')
                if not isinstance(labels, list) or any(not isinstance(label, str) for label in labels):
                    raise Unavailable('corrupt')
                return {'title': raw['title'], 'status': raw['state'], 'labels': labels,
                        'blockers': observation.blockers(identity, evidence), 'page': source_page(raw.get('url'))}
            raw = observation.get('milestones', identity, evidence)
            if raw.get('id') != identity or raw.get('state') not in {'open','closed'}:
                raise Unavailable('corrupt')
            members = ids(observation.get('members', identity, evidence))
            progress = observation.progress('milestone', identity, evidence, members)
            return {'title': text_field(raw, 'name'), 'status': raw['state'], 'page': source_page(raw.get('url')),
                    'members': progress['members'], 'closed': progress['closed'], 'total': progress['total']}
        return observation.attempt(evidence, build)

    def recognized(identity):
        return isinstance(identity, str) and (ISSUE_ID.fullmatch(identity) or MILESTONE_ID.fullmatch(identity))

    for group in report.get('sections', []):
        for item in group.get('items', []):
            identity = item.get('identity')
            if not recognized(identity): continue
            enriched = entity(identity)
            item['enrichment'] = enriched
            if enriched['state'] == 'present':
                facts = enriched['value']
                item['title'] = facts['title']
                if facts['page']: item['link'] = facts['page']
                else: item.pop('link', None)
                if item['state'] != 'active' and facts['status'] == 'closed': item['state'] = 'done'
                if ISSUE_ID.fullmatch(identity): item.setdefault('number', int(identity.split('#')[1]))
        identity = group.get('identity')
        if recognized(identity):
            group['enrichment'] = entity(identity)
            if group['enrichment']['state'] == 'present':
                facts = group['enrichment']['value']
                group['name'] = facts['title']
                if facts['page']: group['link'] = facts['page']
                else: group.pop('link', None)
        if group['item_kind'] not in issue_kinds: continue
        evidence = []
        def count():
            if recognized(identity):
                if group['enrichment']['state'] != 'present': raise Unavailable(group['enrichment']['reason'])
                if MILESTONE_ID.fullmatch(identity):
                    members = ids(observation.get('members', identity, evidence))
                else:
                    members = observation.epic_members(identity, evidence)
                closed = sum(observation.issue(key, evidence)['state'] == 'closed' and key not in active for key in members)
                return {'done': closed, 'active': len(set(members) & active), 'total': len(members)}
            items = group.get('items', [])
            if any(item.get('enrichment', {}).get('state') == 'unavailable' for item in items):
                raise Unavailable('failed')
            return {'done': sum(item['state'] == 'done' for item in items),
                    'active': sum(item['state'] == 'active' for item in items), 'total': len(items)}
        counted = observation.attempt(evidence, count)
        if counted['state'] == 'present': group['counts'] = counted['value']
        else: group['enrichment'] = counted
    return {'report': report, 'off_reason': None}
