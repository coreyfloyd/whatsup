import copy
import json
import unittest
from pathlib import Path
from unittest.mock import patch
import legacy_reader as session_status

FIXTURES = Path(__file__).parent / 'fixtures'
SID = '00000000-0000-4000-8000-000000000001'
REPO = 'example/project'

class ReadContract(unittest.TestCase):
    def read(self, fixture='baseline', origin=None):
        self.assertTrue(callable(getattr(session_status, 'read_session', None)), 'single read operation is missing')
        data=json.loads((FIXTURES/(fixture+'.json')).read_text())
        original=copy.deepcopy(data)
        replay=session_status.RecordedReaders(data)
        result=session_status.read_session(session_status.Session('codex', SID), replay,
            observed_at='2026-10-14T12:00:00+00:00', frontend_origin=origin)
        self.assertEqual(data, original, 'read mutated injected source records')
        json.dumps(result)  # shared presentation seam must serialize
        return result

    def test_header_and_independent_sets(self):
        s=self.read()
        self.assertEqual(s['scope']['value']['authority'],'epic')
        self.assertEqual(s['project']['value']['name'],'Session Status')
        self.assertEqual(s['milestone']['value']['name'],'Initial build')
        self.assertEqual(s['progress']['epic']['value']['total'],3)
        self.assertEqual(s['progress']['slate']['value']['total'],2)
        self.assertIn(REPO+'#3',s['progress']['milestone']['value']['members'])
        self.assertEqual(set(s['progress']),{'epic','milestone','slate'})
        for section in [s['scope'],s['project'],s['milestone'],*s['progress'].values()]:
            self.assertTrue(section['evidence'])
            self.assertTrue(all(e['source'] and e['observed_at'] and e['identity'] for e in section['evidence']))

    def test_recursive_cross_repo_dedup_grouping_and_every_close_reason(self):
        s=self.read('recursive'); epic=s['progress']['epic']['value']
        self.assertEqual(set(epic['members']),{REPO+'#1',REPO+'#5','example/other-project#3'})
        self.assertEqual((epic['closed'],epic['total']),(3,3))
        self.assertEqual(s['progress']['slate']['value']['total'],2)

    def test_absence_is_hidden_but_empty_is_present(self):
        s=self.read('no-sets')
        self.assertTrue(all(p['state']=='hidden' for p in s['progress'].values()))
        s=self.read('empty')
        for p in s['progress'].values():
            self.assertEqual(p['state'],'present'); self.assertEqual((p['value']['closed'],p['value']['total']),(0,0))

    def test_partial_failed_unsupported_and_corrupt_never_return_counts(self):
        for source,group in [('children','epic'),('members','milestone'),('slates','slate')]:
            for availability in ['partial','failed','unsupported','corrupt']:
                with self.subTest(source=source,availability=availability):
                    p=self.read(source+'-'+availability)['progress'][group]
                    self.assertEqual(p['state'],'unavailable'); self.assertIsNone(p['value'])
                    self.assertEqual(p['reason'],availability)

    def test_naming_failure_does_not_hide_uncertain_assignments_or_slate(self):
        for availability in ['partial','failed','unsupported','corrupt']:
            s=self.read('naming-'+availability)
            for group in ['scope','project','milestone']:
                self.assertEqual(s[group]['state'],'unavailable')
            self.assertEqual(s['progress']['epic']['state'],'unavailable')
            self.assertEqual(s['progress']['slate']['state'],'present')

    def test_no_scope_keeps_only_slate(self):
        s=self.read('no-scope')
        self.assertEqual(s['scope']['value']['text'],'No scope yet')
        for group in ['project','milestone']: self.assertEqual(s[group]['state'],'hidden')
        self.assertEqual(s['progress']['epic']['state'],'hidden')
        self.assertEqual(s['progress']['slate']['state'],'present')

    def test_each_authority_and_objective_origin(self):
        for kind in ['ticket','milestone','project','stated_objective','ticket_set']:
            with self.subTest(kind=kind):
                s=self.read('scope-'+kind)
                self.assertEqual(s['scope']['value']['authority'],kind)
        for name,label in [('stated_objective','from your stated objective'),('automatic','from session title (automatic)'),('launch_name','from launch name')]:
            self.assertEqual(self.read('scope-'+name)['scope']['value']['label'],label)
        self.assertEqual(self.read('scope-ticket')['progress']['epic']['value']['identity'],REPO+'#2')

    def test_ticket_sets_use_canonical_ticket_list_and_shared_repo(self):
        s=self.read('scope-ticket_set')
        self.assertEqual(s['scope']['value']['text'],REPO+'#3, '+REPO+'#4')
        self.assertEqual(s['project']['value']['name'],'Session Status')
        self.assertEqual(s['milestone']['state'],'hidden')
        self.assertEqual(s['progress']['epic']['state'],'hidden')
        s=self.read('cross-ticket-set')
        self.assertEqual(s['project']['state'],'hidden')

    def test_multiple_milestones_hidden(self):
        s=self.read('multiple-milestones')
        self.assertEqual(s['milestone']['state'],'hidden')
        self.assertEqual(s['progress']['milestone']['state'],'hidden')

    def test_project_missing_and_failure_are_distinct(self):
        self.assertEqual(self.read('no-project')['project']['value']['name'],'Not recorded')
        for availability in ['partial','failed','unsupported','corrupt']:
            self.assertEqual(self.read('projects-'+availability)['project']['state'],'unavailable')

    def test_cards_and_destinations(self):
        s=self.read(origin='https://panel.example.test')
        self.assertEqual(s['project']['value']['page'],'https://panel.example.test/#/projects/session-status')
        self.assertEqual(s['project']['value']['scope'],'Build Session Status initial slices')
        self.assertEqual(s['project']['value']['progress_sets'],['milestone','epic','slate'])
        self.assertIsNone(self.read()['project']['value']['page'])
        self.assertEqual(s['progress']['epic']['value']['card']['value']['page'],'https://github.com/example/project/issues/2')
        self.assertEqual(s['progress']['slate']['value']['card']['value']['revision'],1)
        self.assertIsNone(s['progress']['slate']['value']['card']['value']['page'])
        self.assertEqual(s['progress']['epic']['value']['card']['value']['objective'],'Not recorded')
        self.assertEqual(self.read('blocked')['progress']['epic']['value']['card']['value']['blockers'],[REPO+'#3'])

    def test_current_approved_owned_slate_only(self):
        p=self.read('slate-revised')['progress']['slate']['value']
        self.assertEqual((p['revision'],p['members']),(2,[REPO+'#4']))
        for fixture in ['unapproved-slate','foreign-slate']:
            self.assertEqual(self.read(fixture)['progress']['slate']['state'],'hidden')

    def test_corrupt_membership_and_unknown_state_unavailable(self):
        for fixture in ['cycle','malformed-issue']:
            self.assertEqual(self.read(fixture)['progress']['epic']['state'],'unavailable')

    def test_missing_replay_record_is_unavailable_not_verified_absence(self):
        s=self.read('missing-members')
        self.assertEqual(s['progress']['milestone']['state'],'unavailable')

    def test_canonical_issue_identity_enforced(self):
        s=self.read('mismatched-identity')
        self.assertEqual(s['progress']['epic']['state'],'unavailable')

    def test_reader_exceptions_are_section_local(self):
        self.assertTrue(callable(getattr(session_status,'read_session',None)), 'single read operation is missing')
        data=json.loads((FIXTURES/'baseline.json').read_text())
        replay=session_status.RecordedReaders(data)
        read=replay.read
        def adapter(source,key):
            if source=='members': raise OSError('private credential detail')
            return read(source,key)
        s=session_status.read_session(session_status.Session('codex',SID),adapter,observed_at='2026-10-14T12:00:00Z')
        self.assertEqual(s['progress']['milestone']['state'],'unavailable')
        self.assertEqual(s['progress']['epic']['state'],'present')
        self.assertNotIn('private credential',json.dumps(s))

    def test_read_starts_no_process_and_writes_no_files(self):
        with patch('subprocess.Popen',side_effect=AssertionError('process started')),patch('builtins.open',side_effect=AssertionError('file access')):
            self.read()

    def test_manifest_exact_derived_changes_and_capture_roots(self):
        manifest=json.loads((FIXTURES/'manifest.json').read_text())
        self.assertEqual(manifest[0]['kind'],'capture')
        for entry in manifest:
            if entry['kind']=='capture': continue
            self.assertEqual(entry['kind'],'derived'); self.assertTrue(entry['changes'])
            self.assertTrue((FIXTURES/entry['parent']).is_file())
            self.assertTrue((FIXTURES/entry['file']).is_file())


class BoundaryContract(ReadContract):
    # Only new tests here; inherited contract tests intentionally omitted by loader below.
    def test_provider_is_part_of_session_reader_identity(self):
        self.assertTrue(callable(getattr(session_status,'read_session',None)))
        replay=session_status.RecordedReaders(json.loads((FIXTURES/'baseline.json').read_text()))
        s=session_status.read_session(session_status.Session('claude',SID), replay, observed_at='2026-10-14T12:00:00Z')
        self.assertEqual(s['scope']['state'],'unavailable')
        self.assertEqual(s['progress']['slate']['state'],'unavailable')

    def test_parent_read_failure_does_not_break_known_milestone_assignment(self):
        s=self.read('parent-failure')
        self.assertEqual(s['progress']['epic']['state'],'unavailable')
        self.assertEqual(s['progress']['milestone']['state'],'present')

    def test_project_scope_reference_resolves_without_repository(self):
        s=self.read('project-reference')
        self.assertEqual(s['project']['state'],'present')
        self.assertEqual(s['project']['value']['name'],'Session Status')

    def test_read_has_no_filesystem_effect(self):
        self.assertTrue(callable(getattr(session_status,'read_session',None)))
        records=json.loads((FIXTURES/'baseline.json').read_text())
        with patch('subprocess.Popen',side_effect=AssertionError('process')),patch('builtins.open',side_effect=AssertionError('file')),patch('io.open',side_effect=AssertionError('file')):
            s=session_status.read_session(session_status.Session('codex',SID),session_status.RecordedReaders(records),observed_at='2026-10-14T12:00:00Z')
            self.assertEqual(s['scope']['state'],'present')
            self.assertEqual(s['progress']['epic']['state'],'present')


class FixtureIntegrity(unittest.TestCase):
    def test_malformed_frontend_origin_is_rejected_before_source_reads(self):
        origins = ['https://example.test:abc', 'https://example.test:65536',
                   'https://example.test:-1', 'https://:80', 'https://[::1',
                   'https://example.test ', 'https://example.test\n',
                   'https://example.test\\', 'https://@example.test']
        for origin in origins:
            with self.subTest(origin=origin):
                calls = []
                def reader(source, identity):
                    calls.append((source, identity))
                    return {'availability':'unsupported'}
                with self.assertRaises(ValueError):
                    session_status.read_session(session_status.Session('codex', SID), reader,
                        observed_at='2026-10-14T12:00:00Z', frontend_origin=origin)
                self.assertEqual(calls, [])

    def test_valid_frontend_origins_keep_existing_routes(self):
        from legacy_reader import project_page
        for origin in ['https://panel.example.test', 'http://panel.example.test:8080', 'https://[::1]:443/']:
            with self.subTest(origin=origin):
                self.assertEqual(project_page(origin, 'session-status'), origin.rstrip('/')+'/#/projects/session-status')

    def test_each_derived_manifest_patch_reconstructs_its_fixture(self):
        for entry in json.loads((FIXTURES/'manifest.json').read_text()):
            if entry['kind']=='capture': continue
            with self.subTest(file=entry['file']):
                data=json.loads((FIXTURES/entry['parent']).read_text())
                for change in entry['changes']:
                    tokens=[s.replace('~1','/').replace('~0','~') for s in change['path'].split('/')[1:]]
                    target=data
                    for token in tokens[:-1]: target=target[token]
                    if change['op']=='remove': del target[tokens[-1]]
                    else: target[tokens[-1]]=change['value']
                self.assertEqual(data,json.loads((FIXTURES/entry['file']).read_text()))

    def test_supplied_project_origin_is_encoded_and_never_guessed(self):
        from legacy_reader import project_page
        self.assertEqual(project_page('https://panel.example.test','a/b #c'),'https://panel.example.test/#/projects/a%2Fb%20%23c')
        self.assertIsNone(project_page(None,'session-status'))
        for origin in ['file:///tmp','https://user:secret@example.test','https://example.test/api','https://example.test?key=secret']:
            with self.subTest(origin=origin),self.assertRaises(ValueError): project_page(origin,'session-status')

class DestinationContract(unittest.TestCase):
    def cases(self):
        return json.loads((FIXTURES/'destination-cases.json').read_text())['cases']

    def replay_case(self, case):
        data=json.loads((FIXTURES/case['parent']).read_text())
        target=data[case['source']][case['identity']]['value']
        change=case['changes'][0]
        if change['op']=='remove': target.pop('url')
        else: target['url']=change['value']
        original=copy.deepcopy(data)
        s=session_status.read_session(session_status.Session('codex',SID),session_status.RecordedReaders(data),observed_at='2026-10-14T12:00:00Z')
        self.assertEqual(data,original)
        json.dumps(s)
        kind='epic' if case['source']=='issues' else 'milestone'
        progress=s['progress'][kind]
        self.assertEqual(progress['state'],'present')
        self.assertEqual(progress['value']['total'],3 if kind=='epic' else 4)
        self.assertEqual(progress['value']['card']['state'],'present')
        page=progress['value']['card']['value']['page']
        if kind=='milestone':
            self.assertEqual(s['milestone']['state'],'present')
            self.assertEqual(s['milestone']['value']['page'],case['expected_page'])
        self.assertEqual(s['project']['state'],'present')
        self.assertEqual(s['progress']['slate']['state'],'present')
        return page

    def test_malformed_epic_pages_are_null_without_losing_counts(self):
        for case in self.cases():
            if case['source']=='issues' and case['expected_page'] is None and not case['name'].endswith(('-missing','-null')):
                with self.subTest(case=case['name']): self.assertIsNone(self.replay_case(case))

    def test_malformed_milestone_header_and_card_pages_are_null(self):
        for case in self.cases():
            if case['source']=='milestones' and case['expected_page'] is None and not case['name'].endswith(('-missing','-null')):
                with self.subTest(case=case['name']): self.assertIsNone(self.replay_case(case))

    def test_missing_and_null_pages_remain_null(self):
        for case in self.cases():
            if case['name'].endswith(('-missing','-null')):
                with self.subTest(case=case['name']): self.assertIsNone(self.replay_case(case))

    def test_valid_source_pages_are_preserved_exactly(self):
        for case in self.cases():
            if case['expected_page'] is not None:
                with self.subTest(case=case['name']): self.assertEqual(self.replay_case(case),case['expected_page'])

# Keep the shared helper out of additional inherited test discovery.
def load_tests(loader, tests, pattern):
    suite=loader.loadTestsFromTestCase(ReadContract)
    for name in BoundaryContract.__dict__:
        if name.startswith('test_'): suite.addTest(BoundaryContract(name))
    suite.addTests(loader.loadTestsFromTestCase(FixtureIntegrity))
    suite.addTests(loader.loadTestsFromTestCase(DestinationContract))
    return suite

if __name__ == "__main__": unittest.main()
