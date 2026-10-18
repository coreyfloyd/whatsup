"""Test-only projection for historical recorded snapshots; not shipped in the plugin."""
"""Pure session-context projection. Adapters supply facts, never permissions."""

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta
import re
from typing import Any, Callable, Protocol
from urllib.parse import quote, urlsplit

NOT_RECORDED = 'Not recorded'
ISSUE_ID = re.compile(r'^[^/#\s]+/[^/#\s]+#[1-9][0-9]*$')
MILESTONE_ID = re.compile(r'^[^/@\s]+/[^/@\s]+@milestone/[1-9][0-9]*$')
KINDS = {'ticket', 'epic', 'milestone', 'project', 'stated_objective', 'ticket_set'}


@dataclass(frozen=True)
class Session:
    provider: str
    session_id: str

    def __post_init__(self):
        if not self.provider or not self.session_id:
            raise ValueError('An explicit provider and immutable session identity are required')


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


def body_section(body: str, headings: set[str]) -> str:
    """Preserve an authoritative Markdown section; do not interpret prose."""
    lines = body.splitlines()
    start = None
    level = None
    for i, line in enumerate(lines):
        match = re.match(r'^(#{1,6})\s+(.+?)\s*#*$', line)
        if not match:
            continue
        heading = match[2].strip().casefold()
        if start is None and heading in headings:
            start, level = i + 1, len(match[1])
        elif start is not None and len(match[1]) <= level:
            return '\n'.join(lines[start:i]).strip() or NOT_RECORDED
    return '\n'.join(lines[start:]).strip() or NOT_RECORDED if start is not None else NOT_RECORDED


def instant(value: Any) -> datetime:
    """Require an explicit timezone for clock comparisons."""
    if not isinstance(value, str):
        raise Unavailable('corrupt')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise Unavailable('corrupt')
    if parsed.tzinfo is None:
        raise Unavailable('corrupt')
    return parsed


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

    def slate(self, session: Session, evidence: list):
        slate = self.get('slates', session.provider + ':' + session.session_id, evidence, absent=True)
        if slate is None:
            return None
        if not isinstance(slate, dict) or type(slate.get('approved')) is not bool:
            raise Unavailable('corrupt')
        if not slate['approved'] or slate.get('session') != {'provider':session.provider,'session_id':session.session_id}:
            return None
        identity, revision = slate['id'], slate['revision']
        if not isinstance(identity, str) or not identity or type(revision) is not int or revision < 1:
            raise Unavailable('corrupt')
        ids(slate['tickets'])
        next(e for e in evidence if e['source']=='slates')['revision'] = revision
        return slate

    def ticket_card(self, record: dict, evidence: list):
        ev = deepcopy(evidence)
        def build():
            body = text_field(record, 'body')
            outcome = body_section(body, {'goal','outcome','requested outcome'})
            criteria = body_section(body, {'acceptance criteria','acceptance-criteria'})
            checklist = []
            continuing = False
            for line in criteria.splitlines():
                if re.match(r'^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s+', line):
                    checklist.append(line)
                    continuing = True
                elif continuing and line[:1].isspace():
                    checklist[-1] += '\n' + line
                elif line.strip():
                    continuing = False
            labels = record.get('labels')
            if labels is not None and (not isinstance(labels, list) or any(not isinstance(x, str) for x in labels)):
                raise Unavailable('corrupt')
            status = sorted(set(x for x in (labels or []) if x.startswith('status/')))
            return {'body':body, 'requested_outcome':outcome,
                    'acceptance_criteria':checklist or NOT_RECORDED,
                    'status':{'state':record['state'], 'labels':status or NOT_RECORDED},
                    'blockers':self.blockers(record['id'], ev), 'page':source_page(record.get('url'))}
        return self.attempt(ev, build)

    def in_progress(self, session: Session, scope: dict, evidence: list):
        now = instant(self.observed_at)
        selected = set()
        slate = self.slate(session, evidence)
        if slate is not None:
            key = slate['id'] + '@revision/' + str(slate['revision'])
            ledger = self.get('runs', key, evidence)
            if not isinstance(ledger, dict) or ledger.get('slate_id') != slate['id'] or type(ledger.get('revision')) is not int or ledger['revision'] != slate['revision'] or not isinstance(ledger.get('runs'), list):
                raise Unavailable('corrupt')
            members = set(ids(slate['tickets']))
            for run in ledger['runs']:
                if not isinstance(run, dict): raise Unavailable('corrupt')
                ticket = ids([run['ticket']])[0]
                if run.get('role') not in {'generator','evaluator','review','investigator'}:
                    raise Unavailable('corrupt')
                start, end = run['dispatched_at'], run['finished_at']
                if start is not None: start = instant(start)
                if end is not None:
                    end = instant(end)
                    if start is None or end < start: raise Unavailable('corrupt')
                if ticket in members and run['role'] in {'generator','evaluator'} and start is not None and start <= now and end is None:
                    selected.add(ticket)
        claims = self.get('claims', session.provider + ':' + session.session_id, evidence)
        if not isinstance(claims, list): raise Unavailable('corrupt')
        for claim in claims:
            if not isinstance(claim, dict) or not isinstance(claim.get('session'), str):
                raise Unavailable('corrupt')
            ticket = ids([claim['ticket']])[0]
            age = now - instant(claim['heartbeat_at'])
            if claim['session'] == session.session_id[:12] and timedelta(0) <= age <= timedelta(hours=48):
                selected.add(ticket)
        rows = []
        for ticket in sorted(selected):
            record = self.issue(ticket, evidence)
            repository, number = ticket.split('#')
            owner, repo = repository.split('/')
            different = repository != scope['value']['repository'] if scope['state']=='present' else None
            rows.append({'identity':ticket, 'owner':owner, 'repository':repo, 'number':int(number),
                         'title':text_field(record, 'title'), 'different_repository':different,
                         'card':self.ticket_card(record, evidence)})
        return {'rows':rows, 'message':'Nothing in progress' if not rows else None}

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

    def entity_card(self, kind: str, record: dict, progress: dict, evidence: list):
        ev = deepcopy(evidence)
        def build():
            identity = progress['identity']
            if kind == 'slate':
                return {'identity':identity,'revision':progress['revision'],
                        'closed':progress['closed'],'total':progress['total'],'page':None}
            if kind == 'epic':
                body = record.get('body') or ''
                if not isinstance(body,str): raise Unavailable('corrupt')
                objective = body_section(body, {'objective','exit criterion','outcome','requested outcome','goal'})
                name = text_field(record,'title')
            else:
                objective = text_field(record,'objective')
                name = text_field(record,'name')
            return {'identity':identity,'name':name,'objective':objective,
                    'closed':progress['closed'],'total':progress['total'],
                    'blockers':self.blockers(identity,ev),'page':source_page(record.get('url'))}
        return self.attempt(ev,build)


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


def project_page(origin: str | None, slug: str) -> str | None:
    """Origin is explicit caller configuration, previously verified by that caller."""
    if origin is None:
        return None
    if source_page(origin) is None:
        raise ValueError('frontend_origin must be a verified frontend origin')
    url = urlsplit(origin)
    if url.scheme not in {'https','http'} or not url.netloc or url.username or url.password or url.query or url.fragment or url.path not in {'','/'}:
        raise ValueError('frontend_origin must be a verified frontend origin')
    return origin.rstrip('/') + '/#/projects/' + quote(slug, safe='')


def read_session(session: Session, readers: SourceReader | Callable, *, observed_at: str,
                 frontend_origin: str | None = None) -> dict[str, Any]:
    """Read one explicit session. No I/O apart from caller-injected reads.

    Supplies header, progress, in-progress rows and source-backed cards.
    """
    if not isinstance(observed_at,str) or not observed_at:
        raise ValueError('observed_at is required')
    if frontend_origin is not None:
        project_page(frontend_origin, '')
    obs = Observation(readers, observed_at)
    naming_ev = []
    naming = None
    def resolve_scope():
        nonlocal naming
        naming = obs.get('naming', session.provider + ':' + session.session_id, naming_ev, absent=True)
        if naming is None:
            return {'text':'No scope yet','authority':None,'reference':None,'label':None,'repository':None}
        if not isinstance(naming,dict) or naming.get('kind') not in KINDS:
            raise Unavailable('corrupt')
        kind = naming['kind']
        repo = naming.get('repository')
        reference = naming.get('reference')
        if repo is not None and (not isinstance(repo, str) or not re.fullmatch(r'[^/#\s]+/[^/#\s]+', repo)):
            raise Unavailable('corrupt')
        if kind == 'project' and (not isinstance(reference, str) or not reference.strip()):
            raise Unavailable('corrupt')
        if kind == 'ticket_set':
            tickets = ids(naming['tickets'])
            repositories = {key.split('#')[0] for key in tickets}
            repo = next(iter(repositories)) if len(repositories)==1 else None
            scope_text = ', '.join(tickets) or 'No scope yet'
        else:
            scope_text = text_field(naming,'text')
        if kind in {'ticket','epic'}:
            if not isinstance(reference,str) or not ISSUE_ID.fullmatch(reference): raise Unavailable('corrupt')
            repo = reference.split('#')[0]
        elif kind == 'milestone':
            if not isinstance(reference,str) or not MILESTONE_ID.fullmatch(reference): raise Unavailable('corrupt')
            repo = reference.split('@')[0]
        if kind == 'stated_objective':
            label = {'user':'from your stated objective','automatic':'from session title (automatic)',
                     'launch_name':'from launch name'}.get(naming.get('set_by'))
            if label is None: raise Unavailable('corrupt')
        elif kind == 'ticket_set':
            label = 'from claimed tickets'
        else:
            label = f'from {kind} {reference}'
        return {'text':scope_text,'authority':kind,'reference':reference,'label':label,'repository':repo}
    scope = obs.attempt(naming_ev,resolve_scope)
    result = {'session':{'provider':session.provider,'session_id':session.session_id,'observed_at':observed_at},
              'scope':scope,'project':None,'milestone':None,'progress':{}}

    # Slate resolution is independent of naming availability.
    slate_ev = []
    def resolve_slate():
        slate = obs.slate(session, slate_ev)
        if slate is None:
            return None
        identity,revision = slate['id'],slate['revision']
        p = obs.progress('slate',identity,slate_ev,slate['tickets'],revision)
        p['card'] = obs.entity_card('slate',slate,p,slate_ev)
        return p
    slate = obs.attempt(slate_ev,resolve_slate)
    if slate['state']=='present' and slate['value'] is None:
        slate['state']='hidden'
    result['progress']['slate']=slate

    work_ev = deepcopy(naming_ev)
    result['in_progress'] = obs.attempt(work_ev, lambda:obs.in_progress(session, scope, work_ev))

    if scope['state']=='unavailable':
        for key in ['project','milestone']:
            result[key]=section('unavailable',naming_ev,reason=scope['reason'])
        for key in ['milestone','epic']:
            result['progress'][key]=section('unavailable',naming_ev,reason=scope['reason'])
        return result
    if naming is None:
        for key in ['project','milestone']: result[key]=section('hidden',naming_ev)
        for key in ['milestone','epic']: result['progress'][key]=section('hidden',naming_ev)
        return result

    scope_value=scope['value']
    kind=scope_value['authority']
    reference=scope_value['reference']
    def assignment_for(progress_kind, assignment_ev):
        if kind in {'ticket','epic'}:
            issue=obs.issue(reference,assignment_ev)
            if progress_kind=='milestone': return issue.get('milestone')
            if kind=='epic': return reference
            parents=obs.get('parents',reference,assignment_ev)
            # Reader contract: complete native ancestors, nearest first.
            ids(parents)
            for parent in parents:
                obs.issue(parent,assignment_ev)
                if ids(obs.get('children',parent,assignment_ev)):
                    return parent
            return None
        if progress_kind=='epic' or kind=='ticket_set': return None
        if kind=='milestone': return reference
        milestone_refs=ids(naming.get('milestones',[]),MILESTONE_ID)
        return milestone_refs[0] if len(milestone_refs)==1 else None
    for progress_kind in ['milestone','epic']:
        assignment_ev=deepcopy(naming_ev)
        assignment=obs.attempt(assignment_ev,lambda:assignment_for(progress_kind,assignment_ev))
        ev=deepcopy(assignment_ev)
        if assignment['state']=='unavailable':
            p=section('unavailable',ev,reason=assignment['reason'])
            if progress_kind=='milestone': result['milestone']=deepcopy(p)
        else:
            identity=assignment['value']
            if identity is None:
                p=section('hidden',ev)
                if progress_kind=='milestone': result['milestone']=deepcopy(p)
            else:
                # Header/details do not depend on membership succeeding.
                record_ev=deepcopy(ev)
                def record_read():
                    if progress_kind=='epic': return obs.issue(identity,record_ev)
                    record=obs.get('milestones',identity,record_ev)
                    if not isinstance(record,dict) or record.get('id')!=identity: raise Unavailable('corrupt')
                    return {'identity':identity,'name':text_field(record,'name'),
                            'objective':text_field(record,'objective'),'page':source_page(record.get('url'))}
                header=obs.attempt(record_ev,record_read)
                if progress_kind=='milestone': result['milestone']=deepcopy(header)
                if header['state']=='unavailable':
                    p=header
                else:
                    def build_progress():
                        if progress_kind=='epic': members=obs.epic_members(identity,ev)
                        else: members=ids(obs.get('members',identity,ev))
                        p=obs.progress(progress_kind,identity,ev,members)
                        if progress_kind=='milestone':
                            # Original normalized record retains its source URL.
                            record=obs.get('milestones',identity,ev)
                        else: record=header['value']
                        p['card']=obs.entity_card(progress_kind,record,p,ev)
                        return p
                    p=obs.attempt(ev,build_progress)
        result['progress'][progress_kind]=p

    project_ev=deepcopy(naming_ev)
    project_key=scope_value['repository'] or naming.get('project_label') or (reference if kind=='project' else None)
    if kind=='ticket_set' and scope_value['repository'] is None:
        project_key=None
    if project_key is None:
        result['project']=section('hidden',project_ev)
    else:
        def build_project():
            record=obs.get('projects',project_key,project_ev,absent=True)
            if record is None:
                return {'identity':None,'name':NOT_RECORDED,'scope':scope_value['text'],
                        'progress_sets':[k for k in ['milestone','epic','slate'] if result['progress'][k]['state']!='hidden'], 'page':None}
            if not isinstance(record,dict) or not isinstance(record.get('id'),str) or not isinstance(record.get('slug'),str):
                raise Unavailable('corrupt')
            return {'identity':record['id'],'name':text_field(record,'name'),'scope':scope_value['text'],
                    'progress_sets':[k for k in ['milestone','epic','slate'] if result['progress'][k]['state']!='hidden'],
                    'page':project_page(frontend_origin,record['slug'])}
        result['project']=obs.attempt(project_ev,build_project)
    return result
