"""Rebuild explicitly derived replay inputs, without network or operational writes."""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).parent / 'fixtures'
CAPTURE = json.loads((ROOT / 'github-capture.json').read_text())
MANIFEST = [x for x in json.loads((ROOT / 'manifest.json').read_text()) if x['kind']=='capture']
CONTEXT = json.loads((ROOT / 'context-capture.json').read_text())
TIME = MANIFEST[0]['captured_at']
REPO = 'example/project'
SESSION = {'provider': 'codex', 'session_id': '00000000-0000-4000-8000-000000000001'}

SESSION_KEY = SESSION['provider'] + ':' + SESSION['session_id']

def entry(source, key, value):
    return {'source': source, 'identity': key, 'observed_at': TIME,
            'source_time': TIME, 'availability': 'complete', 'value': value}

def put(data, source, key, value):
    data.setdefault(source, {})[key] = entry(source, key, value)

base = {}
for key, raw in CAPTURE.items():
    if '#' not in key:
        continue
    milestone = raw['milestone']
    issue = {'id': key, 'title': raw['title'], 'body': raw['body'],
             'state': raw['state'], 'close_reason': raw['state_reason'],
             'url': raw['html_url'], 'labels': [x['name'] for x in raw['labels']],
             'milestone': f"{REPO}@milestone/{milestone['number']}" if milestone else None}
    put(base, 'issues', key, issue)
    put(base, 'children', key, [])
    put(base, 'parents', key, [] if key.endswith('#2') else [REPO+'#2'])
    put(base, 'blockers', key, [])
put(base, 'children', REPO+'#2', [f"{REPO}#{x['number']}" for page in CAPTURE['sub_issues'] for x in page])
for page in CAPTURE['milestones']:
    for raw in page:
        key = f"{REPO}@milestone/{raw['number']}"
        put(base, 'milestones', key, {'id': key, 'name': raw['title'], 'objective': raw['description'], 'url': raw['html_url']})
        put(base, 'members', key, [f"{REPO}#{x['number']}" for page in CAPTURE['milestone_members'] for x in page])
        put(base, 'blockers', key, [])
put(base, 'naming', SESSION_KEY, {'text': 'Build Session Status initial slices', 'kind': 'epic', 'reference': REPO+'#2', 'set_by': 'ticket', 'repository': REPO})
put(base, 'projects', REPO, {'id': CONTEXT['project']['slug'], 'name': CONTEXT['project']['display_name'], 'slug': CONTEXT['project']['slug']})
base['projects'][REPO]['source_time'] = CONTEXT['project']['updated_at']
base['projects'][REPO]['observed_at'] = MANIFEST[1]['captured_at']
put(base, 'slates', SESSION_KEY, {'id': 'derived-read-module-slate', 'revision': 1, 'approved': True, 'session': SESSION, 'tickets': [REPO+'#3', REPO+'#4']})

def diff(a, b, path=''):
    """Exact replacements/additions/removals, including full changed values."""
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        for k in sorted(a.keys() | b.keys()):
            p = path+'/'+k.replace('~','~0').replace('/','~1')
            if k not in b: out.append({'op':'remove','path':p})
            elif k not in a: out.append({'op':'add','path':p,'value':b[k]})
            else: out.extend(diff(a[k],b[k],p))
        return out
    return [] if a == b else [{'op':'replace','path':path,'value':b}]

def save(name, data, parent, parent_data, purpose):
    (ROOT / (name+'.json')).write_text(json.dumps(data, indent=2)+'\n')
    MANIFEST.append({'file':name+'.json','kind':'derived','parent':parent+'.json',
                     'captured_at':TIME,'purpose':purpose,'changes':diff(parent_data,data)})

save('baseline',base,'github-capture',CAPTURE,'Normalized API captures; canonical project normalized from context-capture.json; illustrative naming/slate adapter records added for replay, not claims of real operational state. Empty child/parent/blocker facts outside the captured epic are derived.')

MANIFEST[-1]['sources'] = ['github-capture.json','context-capture.json']

def variant(name, change, purpose):
    data = copy.deepcopy(base); change(data)
    save(name,data,'baseline',base,purpose)

def value(d, source, key): return d[source][key]['value']
def naming(d): return value(d,'naming',SESSION_KEY)
def scope(d, kind, **kw): naming(d).update(kind=kind, **kw)

def graph(d):
    # Copies retain real issue bodies; topology/identities/closure are derived.
    cross='example/other-project#3'
    issue=copy.deepcopy(value(d,'issues',REPO+'#3')); issue.update(id=cross, url=None, milestone=None)
    put(d,'issues',cross,issue); put(d,'children',cross,[]); put(d,'blockers',cross,[])
    value(d,'children',REPO+'#2')[:] = [REPO+'#3',REPO+'#4',REPO+'#5']
    value(d,'children',REPO+'#3')[:] = [cross,REPO+'#1']
    value(d,'children',REPO+'#4')[:] = [cross]
    for key,reason in [(cross,'completed'),(REPO+'#1','not_planned'),(REPO+'#5','duplicate')]:
        value(d,'issues',key).update(state='closed',close_reason=reason)
variant('recursive',graph,'Nested grouping issues, cross-repository leaf reached twice, all three close reasons.')
variant('no-scope',lambda d: d['naming'][SESSION_KEY].update(value=None),'Verified no naming scope; slate remains.')
variant('no-project',lambda d: d['projects'][REPO].update(value=None),'Verified no canonical project record.')
variant('no-sets',lambda d: (value(d,'issues',REPO+'#2').update(milestone=None),d['slates'][SESSION_KEY].update(value=None),scope(d,'stated_objective',reference=None,text='Read module',set_by='user')),'Objective with no assigned milestone/epic/slate.')
variant('empty',lambda d: (value(d,'members',REPO+'@milestone/1').clear(),value(d,'children',REPO+'#2').clear(),value(d,'slates',SESSION_KEY).update(tickets=[])),'Complete empty progress memberships.')
for source,key in [('children',REPO+'#2'),('members',REPO+'@milestone/1'),('slates',SESSION_KEY),('naming',SESSION_KEY),('projects',REPO)]:
    for availability in ['partial','failed','unsupported','corrupt']:
        variant(source+'-'+availability,lambda d,s=source,k=key,a=availability:d[s][k].update(availability=a),'Explicit '+availability+' '+source+' read.')
for kind in ['ticket','milestone','project','stated_objective','ticket_set']:
    def change(d,k=kind):
        ref={'ticket':REPO+'#3','milestone':REPO+'@milestone/1','project':'session-status','stated_objective':None,'ticket_set':None}[k]
        scope(d,k,reference=ref,set_by='user' if k=='stated_objective' else 'ticket',tickets=[REPO+'#3',REPO+'#4'])
    variant('scope-'+kind,change,'Scope authority '+kind+'.')
for by in ['automatic','launch_name']:
    variant('scope-'+by,lambda d,b=by:scope(d,'stated_objective',reference=None,set_by=b),'Objective set by '+by+'.')
variant('cross-ticket-set',lambda d:scope(d,'ticket_set',tickets=[REPO+'#3','example/other-project#3']),'Cross-repository scope ticket list; no shared project.')
variant('multiple-milestones',lambda d:scope(d,'project',reference='session-status',milestones=[REPO+'@milestone/1',REPO+'@milestone/2']),'Scope resolves to multiple milestone identities; hide milestone.')
variant('slate-revised',lambda d:value(d,'slates',SESSION_KEY).update(revision=2,tickets=[REPO+'#4']),'Current approved revision 2 removes withdrawn ticket 3.')
variant('unapproved-slate',lambda d:value(d,'slates',SESSION_KEY).update(approved=False),'Unapproved slate is not a progress set.')
variant('foreign-slate',lambda d:value(d,'slates',SESSION_KEY).update(session={'provider':'claude','session_id':SESSION_KEY}),'Slate belongs to another provider.')
variant('cycle',lambda d:value(d,'children',REPO+'#3').append(REPO+'#2'),'Corrupt cycle in sub-issue membership.')
variant('malformed-issue',lambda d:value(d,'issues',REPO+'#3').update(state='unknown'),'Corrupt issue state cannot become an open count.')
variant('blocked',lambda d:value(d,'blockers',REPO+'#2').extend([REPO+'#3',REPO+'#1']),'Open and closed native blockers; only open blocker is shown.')
variant('missing-members',lambda d:d['members'].pop(REPO+'@milestone/1'),'Missing replay record is unsupported, not an empty membership.')
variant('mismatched-identity',lambda d:value(d,'issues',REPO+'#3').update(id=REPO+'#4'),'Issue identity does not match the requested source key.')
def parent_failure(d):
    scope(d,'ticket',reference=REPO+'#3')
    d['parents'][REPO+'#3'].update(availability='failed')
variant('parent-failure',parent_failure,'Nearest-parent read failed; directly recorded milestone remains available.')
def project_reference(d):
    scope(d,'project',reference='session-status')
    naming(d).pop('repository')
    d['projects']['session-status']=copy.deepcopy(d['projects'][REPO])
    d['projects']['session-status']['identity']='session-status'
variant('project-reference',project_reference,'Project-only scope resolves the explicit project reference without a repository.')
# Review regression cases retain the capture parent and each exact field edit.
from urllib.parse import urlsplit
cases = []
for source, identity in [('issues', REPO+'#2'), ('milestones', REPO+'@milestone/1')]:
    page = value(base, source, identity)['url']
    parts = urlsplit(page)
    variants = [
        ('missing', None, 'remove', None),
        ('null', None, 'replace', None),
        ('list', [page], 'replace', None),
        ('object', {'url': page}, 'replace', None),
        ('number', CAPTURE[REPO+'#2']['number'], 'replace', None),
        ('boolean', value(base,'slates',SESSION_KEY)['approved'], 'replace', None),
        ('empty', '', 'replace', None),
        ('relative', parts.path, 'replace', None),
        ('protocol-relative', '//'+parts.netloc+parts.path, 'replace', None),
        ('script-scheme', 'javascript:'+parts.path, 'replace', None),
        ('file-scheme', 'file://'+parts.path, 'replace', None),
        ('missing-host', 'https://'+parts.path, 'replace', None),
        ('userinfo', page.replace('://','://example@',1), 'replace', None),
        ('bad-port', page.replace(parts.netloc,parts.netloc+':bad',1), 'replace', None),
        ('port-range', page.replace(parts.netloc,parts.netloc+':65536',1), 'replace', None),
        ('bad-brackets', page.replace(parts.netloc,'['+parts.netloc+']',1), 'replace', None),
        ('whitespace', page+' ', 'replace', None),
        ('control', page+'\n', 'replace', None),
        ('delete-control', page+'\x7f', 'replace', None),
        ('backslash', page.replace(parts.netloc,parts.netloc+'\\',1), 'replace', None),
        ('https', page, 'replace', page),
        ('http', page.replace('https:','http:',1), 'replace', page.replace('https:','http:',1)),
        ('port', page.replace(parts.netloc,parts.netloc+':443',1), 'replace', page.replace(parts.netloc,parts.netloc+':443',1)),
        ('query-fragment', page+'?from=read#details', 'replace', page+'?from=read#details'),
    ]
    for name, url, op, expected in variants:
        path='/'+source+'/'+identity.replace('~','~0').replace('/','~1')+'/value/url'
        change={'op':op,'path':path}
        if op!='remove': change['value']=url
        cases.append({'name':source+'-'+name,'source':source,'identity':identity,
                      'kind':'derived','parent':'baseline.json','changes':[change],
                      'expected_page':expected})
save('destination-cases',{'parent':'baseline.json','cases':cases},'baseline',base,
     'Case matrix derived from captured epic/milestone URLs. Each case names its exact one-field patch; absent/malformed destinations must be null and valid absolute HTTP(S) destinations must be preserved.')
(ROOT/'manifest.json').write_text(json.dumps(MANIFEST,indent=2)+'\n')
