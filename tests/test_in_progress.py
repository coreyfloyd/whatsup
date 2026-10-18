import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from legacy_reader import RecordedReaders, Session, read_session

ROOT = Path(__file__).parent / 'fixtures'
SID = '00000000-0000-4000-8000-000000000001'
REPO = 'example/project'

class InProgressContract(unittest.TestCase):
    def records(self, name):
        case = next(c for c in json.loads((ROOT/'in-progress-cases.json').read_text())['cases'] if c['name']==name)
        self.assertEqual(case['kind'], 'derived')
        data = json.loads((ROOT/case['parent']).read_text())
        for change in case['changes']:
            tokens = [s.replace('~1','/').replace('~0','~') for s in change['path'].split('/')[1:]]
            target = data
            for token in tokens[:-1]: target = target[token]
            if change['op']=='remove': del target[tokens[-1]]
            else: target[tokens[-1]] = change['value']
        return data

    def snapshot(self, name):
        data = self.records(name)
        original = copy.deepcopy(data)
        with patch('subprocess.Popen', side_effect=AssertionError('process')), patch('builtins.open', side_effect=AssertionError('file')), patch('io.open', side_effect=AssertionError('file')):
            snapshot = read_session(Session('codex', SID), RecordedReaders(data), observed_at='2026-10-14T12:00:00Z')
        self.assertEqual(data, original)
        json.dumps(snapshot)
        self.assertIn('in_progress', snapshot, 'in-progress snapshot section is missing')
        return snapshot

    def group(self, name): return self.snapshot(name)['in_progress']
    def rows(self, name):
        group = self.group(name)
        self.assertEqual(group['state'], 'present')
        return group['value']['rows']

    def test_ticket_enters_and_leaves_executing_state(self):
        self.assertEqual(self.rows('queued'), [])
        self.assertEqual([r['identity'] for r in self.rows('executing')], [REPO+'#4'])
        self.assertEqual(self.rows('finished'), [])
        self.assertEqual(len(self.rows('evaluator')), 1)
        self.assertEqual(self.rows('review'), [])

    def test_claim_ownership_and_48_hour_boundary(self):
        for name in ['claimed','boundary','offset-boundary']:
            with self.subTest(name=name): self.assertEqual(len(self.rows(name)), 1)
        for name in ['stale','other-session','full-session','future']:
            with self.subTest(name=name): self.assertEqual(self.rows(name), [])

    def test_duplicate_membership_returns_one_row(self):
        self.assertEqual(len(self.rows('both')), 1)

    def test_several_rows_and_closed_issue_status(self):
        self.assertEqual([r['number'] for r in self.rows('several')], [3,4])
        self.assertEqual(self.rows('closed')[0]['card']['value']['status'],
                         {'state':'closed', 'labels':['status/deployed']})

    def test_acceptance_checklist_preserves_wrapped_details_and_checks(self):
        records = self.records('wrapped-checklist')['issues']
        self.assertEqual(self.rows('wrapped-checklist')[0]['card']['value']['acceptance_criteria'], [
            '- [x] '+records[REPO+'#3']['value']['title']+'\n  '+records[REPO+'#2']['value']['title'],
            '- [ ] '+records[REPO+'#4']['value']['title']])

    def test_explicit_empty_state(self):
        self.assertEqual(self.group('empty')['value'], {'rows':[], 'message':'Nothing in progress'})

    def test_failed_membership_reads_never_become_empty(self):
        for source in ['claims','runs','slates']:
            for availability in ['failed','partial','unsupported','corrupt']:
                with self.subTest(source=source, availability=availability):
                    group = self.group(source+'-'+availability)
                    self.assertEqual(group['state'], 'unavailable')
                    self.assertEqual(group['reason'], availability)
                    self.assertIsNone(group['value'])
                    self.assertTrue(group['evidence'])

    def test_rows_survive_absent_or_failed_scope(self):
        for name in ['no-scope','failed-naming','no-slate-claim']:
            with self.subTest(name=name): self.assertEqual(len(self.rows(name)), 1)

    def test_only_current_approved_owned_slate_members_execute(self):
        for name in ['withdrawn','unapproved','foreign-slate']:
            with self.subTest(name=name): self.assertEqual(self.rows(name), [])
        self.assertEqual(self.group('wrong-revision')['state'], 'unavailable')

    def test_identity_title_and_repository_indicator(self):
        row = self.rows('claimed')[0]
        self.assertEqual((row['owner'],row['repository'],row['number']), ('example','project',4))
        self.assertEqual(row['title'], self.records('claimed')['issues'][REPO+'#4']['value']['title'])
        self.assertFalse(row['different_repository'])
        self.assertTrue(self.rows('cross-repository')[0]['different_repository'])
        self.assertIsNone(self.rows('failed-naming')[0]['different_repository'])
        self.assertTrue(self.rows('no-scope')[0]['different_repository'])

    def test_card_uses_body_checklist_status_and_native_open_blockers(self):
        row = self.rows('card')[0]
        card = row['card']
        self.assertEqual(card['state'], 'present')
        value = card['value']
        records = self.records('card')
        self.assertEqual(value['requested_outcome'], records['issues'][REPO+'#4']['value']['title'])
        self.assertEqual(value['acceptance_criteria'], ['- [ ] '+records['issues'][REPO+'#3']['value']['title']])
        self.assertEqual(value['status'], {'state':'open','labels':['status/next']})
        self.assertEqual(value['blockers'], [REPO+'#3'])
        self.assertEqual(value['page'], records['issues'][REPO+'#4']['value']['url'])
        self.assertEqual(value['body'], records['issues'][REPO+'#4']['value']['body'])
        self.assertTrue(card['evidence'])

    def test_missing_card_fields_are_explicit(self):
        card = self.rows('missing-card')[0]['card']['value']
        for key in ['body','requested_outcome','acceptance_criteria','blockers']:
            self.assertEqual(card[key], 'Not recorded')
        self.assertEqual(card['status'], {'state':'open','labels':'Not recorded'})
        self.assertIsNone(card['page'])

    def test_card_read_failure_keeps_known_membership(self):
        for name in ['failed-blockers','bad-body']:
            with self.subTest(name=name):
                row = self.rows(name)[0]
                self.assertEqual(row['card']['state'], 'unavailable')
                self.assertIsNone(row['card']['value'])
        self.assertEqual(self.group('missing-issue')['state'], 'unavailable')

    def test_invalid_claim_times_are_unavailable(self):
        for name in ['bad-heartbeat','naive-heartbeat']:
            with self.subTest(name=name): self.assertEqual(self.group(name)['state'], 'unavailable')

    def test_source_exceptions_are_local_and_do_not_publish_messages(self):
        data = self.records('claimed')
        replay = RecordedReaders(data)
        def reader(source, identity):
            if source=='claims': raise OSError('private credential')
            return replay.read(source, identity)
        s = read_session(Session('codex',SID), reader, observed_at='2026-10-14T12:00:00Z')
        self.assertIn('in_progress', s, 'in-progress snapshot section is missing')
        self.assertEqual(s['in_progress']['state'], 'unavailable')
        self.assertEqual(s['progress']['slate']['state'], 'present')
        self.assertNotIn('private credential', json.dumps(s))

    def test_evidence_names_revision_ledger_claims_and_issue(self):
        group = self.group('both')
        self.assertEqual({e['source'] for e in group['evidence']}, {'naming','slates','runs','claims','issues'})
        self.assertEqual(next(e for e in group['evidence'] if e['source']=='slates')['revision'], 1)

    def test_corrupt_project_authority_and_repository_keys_are_unavailable(self):
        cases = json.loads((ROOT/'in-progress-cases.json').read_text())['cases']
        names = [c['name'] for c in cases if c['name'].startswith(('project-reference-', 'project-repository-'))]
        self.assertTrue(names)
        for name in names:
            with self.subTest(name=name):
                snapshot = self.snapshot(name)
                for group in ['scope', 'project', 'milestone']:
                    self.assertEqual(snapshot[group]['state'], 'unavailable')
                    self.assertEqual(snapshot[group]['reason'], 'corrupt')
                    self.assertIsNone(snapshot[group]['value'])
                for group in ['epic', 'milestone']:
                    self.assertEqual(snapshot['progress'][group]['state'], 'unavailable')
                self.assertEqual(snapshot['progress']['slate']['state'], 'present')
                self.assertEqual(snapshot['in_progress']['state'], 'present')

if __name__=='__main__': unittest.main()
