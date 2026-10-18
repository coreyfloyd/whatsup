"""Build labelled variants of recorded issue data; no operational source writes."""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).parent / 'fixtures'
BASE = json.loads((ROOT / 'baseline.json').read_text())
KEY = next(iter(BASE['slates']))
SID = KEY.split(':', 1)[1]
REPO = 'example/project'
SLATE = BASE['slates'][KEY]['value']
LEDGER = SLATE['id'] + '@revision/' + str(SLATE['revision'])
TIME = '2026-10-14T12:00:00Z'


def envelope(source, identity, value):
    return dict(source=source, identity=identity, observed_at=TIME,
                source_time=TIME, availability='complete', value=value)


def diff(a, b, path=''):
    if isinstance(a, dict) and isinstance(b, dict):
        changes = []
        for key in sorted(a.keys() | b.keys()):
            p = path + '/' + key.replace('~', '~0').replace('/', '~1')
            if key not in b: changes.append(dict(op='remove', path=p))
            elif key not in a: changes.append(dict(op='add', path=p, value=b[key]))
            else: changes.extend(diff(a[key], b[key], p))
        return changes
    return [] if a == b else [dict(op='replace', path=path, value=b)]


def setup():
    data = copy.deepcopy(BASE)
    data['claims'] = {KEY: envelope('claims', KEY, [])}
    data['runs'] = {LEDGER: envelope('runs', LEDGER,
        dict(slate_id=SLATE['id'], revision=SLATE['revision'], runs=[]))}
    return data


def run(data, **changes):
    record = dict(ticket=REPO+'#4', role='generator', dispatched_at=TIME, finished_at=None)
    record.update(changes)
    data['runs'][LEDGER]['value']['runs'].append(record)


def claim(data, **changes):
    record = dict(ticket=REPO+'#4', session=SID[:12], heartbeat_at=TIME)
    record.update(changes)
    data['claims'][KEY]['value'].append(record)


cases = []
def case(name, change):
    data = setup()
    change(data)
    cases.append(dict(name=name, kind='derived', parent='baseline.json',
        purpose=name.replace('-', ' ') + '; hypothetical normalized adapter facts, not real operational work.',
        changes=diff(BASE, data)))

case('empty', lambda d: None)
case('executing', lambda d: run(d))
case('queued', lambda d: run(d, dispatched_at=None))
case('finished', lambda d: run(d, finished_at=TIME))
case('evaluator', lambda d: run(d, role='evaluator'))
case('review', lambda d: run(d, role='review'))
case('claimed', lambda d: claim(d))
case('stale', lambda d: claim(d, heartbeat_at='2026-10-12T11:59:59Z'))
case('boundary', lambda d: claim(d, heartbeat_at='2026-10-12T12:00:00Z'))
case('offset-boundary', lambda d: claim(d, heartbeat_at='2026-10-12T06:00:00-06:00'))
case('other-session', lambda d: claim(d, session=SID[1:13]))
case('full-session', lambda d: claim(d, session=SID))
case('future', lambda d: claim(d, heartbeat_at='2026-10-14T12:00:01Z'))
case('both', lambda d: (run(d), claim(d), run(d, role='evaluator')))
def several(data):
    run(data)
    claim(data, ticket=REPO+'#3')
    # Derived long-card boundary: only neutralized captured titles, no private prose.
    titles = [record['value']['title'] for record in data['issues'].values()]
    data['issues'][REPO+'#3']['value']['body'] = (
        '## Goal\n' + titles[2] + '\n\n## Acceptance criteria\n' +
        '\n'.join('- [ ] ' + title for title in titles))
case('several', several)
case('closed', lambda d: (claim(d), d['issues'][REPO+'#4']['value'].update(state='closed', labels=['status/deployed'])))
case('no-scope', lambda d: (run(d), d['naming'][KEY].update(value=None)))
case('failed-naming', lambda d: (run(d), d['naming'][KEY].update(availability='failed')))
case('withdrawn', lambda d: (run(d), d['slates'][KEY]['value'].update(tickets=[REPO+'#3'])))
case('unapproved', lambda d: (run(d), d['slates'][KEY]['value'].update(approved=False)))
case('foreign-slate', lambda d: (run(d), d['slates'][KEY]['value']['session'].update(provider='claude')))
case('no-slate-claim', lambda d: (claim(d), d['slates'][KEY].update(value=None)))
case('wrong-revision', lambda d: (run(d), d['runs'][LEDGER]['value'].update(revision=2)))
case('bad-heartbeat', lambda d: claim(d, heartbeat_at='unparseable'))
case('naive-heartbeat', lambda d: claim(d, heartbeat_at='2026-10-14T12:00:00'))
case('missing-issue', lambda d: (claim(d), d['issues'].pop(REPO+'#4')))
case('missing-card', lambda d: (claim(d), d['issues'][REPO+'#4']['value'].update(body=None, labels=None, url=None), d['blockers'][REPO+'#4'].update(value=None)))
case('card', lambda d: (claim(d), d['issues'][REPO+'#4']['value'].update(body='## Goal\n'+d['issues'][REPO+'#4']['value']['title']+'\n\n## Acceptance criteria\n- [ ] '+d['issues'][REPO+'#3']['value']['title']+'\n\n## Notes\n'+d['issues'][REPO+'#2']['value']['title']), d['blockers'][REPO+'#4'].update(value=[REPO+'#3', REPO+'#1'])))
case('failed-blockers', lambda d: (claim(d), d['blockers'][REPO+'#4'].update(availability='failed')))
case('bad-body', lambda d: (claim(d), d['issues'][REPO+'#4']['value'].update(body=[])))
case('wrapped-checklist', lambda d: (claim(d), d['issues'][REPO+'#4']['value'].update(body='## Outcome\n'+d['issues'][REPO+'#4']['value']['title']+'\n\n## Acceptance criteria\n- [x] '+d['issues'][REPO+'#3']['value']['title']+'\n  '+d['issues'][REPO+'#2']['value']['title']+'\n\n- [ ] '+d['issues'][REPO+'#4']['value']['title'])))
def cross(data):
    claim(data, ticket='example/other-project#3')
    record = copy.deepcopy(data['issues'][REPO+'#3'])
    record.update(identity='example/other-project#3')
    record['value'].update(id='example/other-project#3', url=None)
    data['issues']['example/other-project#3'] = record
    data['blockers']['example/other-project#3'] = envelope('blockers', 'example/other-project#3', [])
case('cross-repository', cross)
for source, key in [('claims', KEY), ('runs', LEDGER), ('slates', KEY)]:
    for availability in ['failed', 'partial', 'unsupported', 'corrupt']:
        case(source+'-'+availability, lambda d, s=source, k=key, a=availability: d[s][k].update(availability=a))

# Native-review regressions: corrupt scope authority/lookup keys, labelled derived.
for name, reference in [('list', [REPO]), ('object', {'project': REPO}), ('number', 4),
                        ('boolean', True), ('null', None), ('empty', ''), ('blank', ' ' )]:
    case('project-reference-'+name, lambda d, r=reference: d['naming'][KEY]['value'].update(kind='project', reference=r))
for name, repository in [('list', [REPO]), ('object', {'repository': REPO}), ('number', 4),
                         ('boolean', True), ('empty', ''), ('missing-owner', '/session-status'),
                         ('missing-repository', 'example/'), ('name-only', 'session-status'),
                         ('extra-path', REPO+'/extra'), ('whitespace', 'example/ session-status')]:
    case('project-repository-'+name, lambda d, r=repository: d['naming'][KEY]['value'].update(kind='project', reference='session-status', repository=r))

matrix = dict(cases=cases)
(ROOT/'in-progress-cases.json').write_text(json.dumps(matrix, indent=2)+'\n')
manifest = json.loads((ROOT/'manifest.json').read_text())
manifest = [e for e in manifest if e['file'] != 'in-progress-cases.json']
manifest.append(dict(file='in-progress-cases.json', kind='derived', parent='baseline.json',
    captured_at=TIME, purpose='Each case carries its exact patch from recorded baseline data. All run/claim scenarios are derived, not operational captures.', changes=diff(BASE, matrix)))
(ROOT/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
