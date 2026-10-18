"""Replay captured GitHub responses; no network or credentials needed."""
import copy
import json
import unittest
from pathlib import Path
from unittest.mock import patch
import session_status

CAPTURE = json.loads((Path(__file__).parent / 'fixtures/github-capture.json').read_text())
ROOT = 'example/project'

class GitHubContract(unittest.TestCase):
    def adapter(self, fail=None, closed=False):
        calls = []
        def request(path):
            calls.append(path)
            if fail and fail in path: raise OSError('secret token must not escape')
            base = '/repos/' + ROOT
            if path == base + '/issues/2/sub_issues?per_page=100': return CAPTURE['sub_issues'][0], None
            if '/sub_issues?' in path or '/dependencies/blocked_by?' in path: return [], None
            if path == base + '/milestones/1': return CAPTURE['milestones'][0][0], None
            if path == base + '/issues?milestone=1&state=all&per_page=100': return CAPTURE['milestone_members'][0], None
            if path.endswith('/parent'): return None, None
            number = path.rsplit('/', 1)[-1]
            raw = copy.deepcopy(CAPTURE[ROOT + '#' + number])
            # Derived variant: exact patch /state=closed on captured issues 3,4,5.
            if closed and number in {'3','4','5'}: raw['state'] = 'closed'
            return raw, None
        cls = getattr(session_status, 'GitHubReader', None)
        self.assertIsNotNone(cls, 'GitHub adapter is missing')
        return cls('unused', request=request), calls

    def report(self):
        return {'scope': 'work', 'sections': [{'label': 'Epic', 'verb': 'closed', 'item_kind': 'tickets', 'identity': ROOT+'#2', 'items': [
            {'identity': ROOT+'#3', 'title': 'old', 'state': 'active'},
            {'identity': ROOT+'#4', 'title': 'old', 'state': 'queued'},
        ]}]}

    def test_adapter_normalizes_all_six_protocol_sources(self):
        reader, calls = self.adapter()
        for source, identity in [('issues',ROOT+'#2'), ('children',ROOT+'#2'), ('parents',ROOT+'#2'), ('milestones',ROOT+'@milestone/1'), ('members',ROOT+'@milestone/1'), ('blockers',ROOT+'#2')]:
            envelope = reader.read(source, identity)
            self.assertEqual(envelope['availability'], 'complete')
            self.assertEqual(envelope['identity'], identity)
        self.assertEqual(reader.read('naming','x')['availability'], 'unsupported')
        self.assertTrue(calls)

    def test_enrich_titles_cards_active_override_and_recursive_leaf_counts(self):
        reader, _ = self.adapter(closed=True)
        report = self.report(); original = copy.deepcopy(report)
        result = session_status.enrich_report(report, reader, issue_kinds=['tickets'])
        self.assertEqual(report, original)
        section = result['report']['sections'][0]
        self.assertEqual(section['counts'], {'done': 2, 'active': 1, 'total': 3})
        active, closed = section['items']
        self.assertEqual(active['state'], 'active')
        self.assertEqual(closed['state'], 'done')
        self.assertEqual(active['title'], CAPTURE[ROOT+'#3']['title'])
        self.assertEqual(active['enrichment']['state'], 'present')
        value = active['enrichment']['value']
        self.assertEqual(value['status'], 'closed')
        self.assertEqual(value['page'], CAPTURE[ROOT+'#3']['html_url'])
        self.assertEqual(value['blockers'], [])
        self.assertTrue(value['labels'])

    def test_milestone_count_and_page(self):
        reader, _ = self.adapter()
        report = {'scope':'work', 'sections':[{'label':'Work','verb':'shipped','item_kind':'milestones', 'items':[{'identity':ROOT+'@milestone/1','title':'old','state':'queued'}]}]}
        item = session_status.enrich_report(report, reader)['report']['sections'][0]['items'][0]
        value = item['enrichment']['value']
        self.assertEqual(item['title'], 'Initial build')
        self.assertEqual(value['total'], 4)
        self.assertEqual(item['link'], CAPTURE['milestones'][0][0]['html_url'])

    def test_failure_is_local_and_has_no_counts_or_secrets(self):
        reader, _ = self.adapter(fail='/issues/3')
        result = session_status.enrich_report(self.report(), reader, issue_kinds=['tickets'])
        section = result['report']['sections'][0]
        self.assertEqual(section['enrichment']['state'], 'unavailable')
        self.assertNotIn('counts', section)
        self.assertEqual(section['items'][0]['enrichment']['state'], 'unavailable')
        self.assertEqual(section['items'][1]['enrichment']['state'], 'present')
        self.assertNotIn('secret', json.dumps(result))

    def test_pagination_partial_and_corrupt_never_claim_empty(self):
        reader, _ = self.adapter()
        pages = iter([(CAPTURE['sub_issues'][0][:1], '/next'), (CAPTURE['sub_issues'][0][1:], None)])
        reader.request = lambda path: next(pages)
        result = reader.read('children', ROOT+'#2')
        self.assertEqual(len(result['value']), 3)
        pages = iter([(CAPTURE['sub_issues'][0][:1], '/next')])
        reader.request = lambda path: next(pages)
        self.assertEqual(reader.read('children', ROOT+'#2')['availability'], 'partial')
        reader.request = lambda path: ({'message':'bad'}, None)
        self.assertEqual(reader.read('children', ROOT+'#2')['availability'], 'corrupt')

    def test_recursive_dedup_and_cycle_fail_closed(self):
        records = json.loads((Path(__file__).parent / 'fixtures/recursive.json').read_text())
        report = self.report()
        section = session_status.enrich_report(report, session_status.RecordedReaders(records), issue_kinds=['tickets'])['report']['sections'][0]
        self.assertEqual(section['counts']['total'], 3)
        records = json.loads((Path(__file__).parent / 'fixtures/cycle.json').read_text())
        section = session_status.enrich_report(report, session_status.RecordedReaders(records), issue_kinds=['tickets'])['report']['sections'][0]
        self.assertEqual(section['enrichment']['state'], 'unavailable')
        self.assertNotIn('counts', section)

    def test_open_native_blockers_and_nearest_first_parents(self):
        reader, _ = self.adapter()
        request = reader.request
        def relationships(path):
            if path.endswith('/issues/2/dependencies/blocked_by?per_page=100'):
                return [CAPTURE[ROOT+'#3'], CAPTURE[ROOT+'#1']], None
            if path.endswith('/issues/3/parent'):
                return CAPTURE[ROOT+'#2'], None
            return request(path)
        reader.request = relationships
        self.assertEqual(reader.read('parents',ROOT+'#3')['value'], [ROOT+'#2'])
        report = self.report()
        report['sections'][0]['items'][0]['identity'] = ROOT+'#2'
        item = session_status.enrich_report(report, reader)['report']['sections'][0]['items'][0]
        self.assertEqual(item['enrichment']['value']['blockers'], [ROOT+'#3'])

    def test_bundled_entrypoint_reads_json_without_access(self):
        import subprocess
        import sys
        entry = Path(__file__).resolve().parents[1] / 'mod/reader/main.py'
        result = subprocess.run([sys.executable, str(entry)], input=json.dumps({'report':self.report()}),
            text=True, capture_output=True, env={'PATH':''}, cwd='/')
        self.assertEqual(result.returncode, 0, result.stderr)
        snapshot = json.loads(result.stdout)
        self.assertEqual(snapshot['report'], self.report())
        self.assertIn('enrichment is off', snapshot['off_reason'])

    def test_missing_page_keeps_details_without_a_destination(self):
        records = json.loads((Path(__file__).parent / 'fixtures/baseline.json').read_text())
        records['issues'][ROOT+'#3']['value']['url'] = None
        item = session_status.enrich_report(self.report(), session_status.RecordedReaders(records))['report']['sections'][0]['items'][0]
        self.assertEqual(item['enrichment']['state'], 'present')
        self.assertNotIn('link', item)

    def test_transport_rejects_cross_host_pagination_without_opening_a_socket(self):
        from session_status.github import GitHubReader
        from session_status.read import Unavailable
        with patch('session_status.github.build_opener', side_effect=AssertionError('network opened')):
            with self.assertRaises(Unavailable):
                GitHubReader('unused')._request('https://example.invalid/next')

    def test_transport_redirect_cannot_forward_credentials_to_another_host(self):
        import session_status.github as github
        from session_status.read import Unavailable
        from urllib.request import Request
        redirect = getattr(github, 'GitHubRedirectHandler', None)
        self.assertIsNotNone(redirect, 'redirect credential guard missing')
        request = Request('https://api.github.com/repos/'+ROOT, headers={'Authorization':'Bearer unused'})
        with self.assertRaises(Unavailable):
            redirect().redirect_request(request, None, 302, 'Moved', {}, 'https://example.invalid/next')

    def test_no_access_preserves_report(self):
        report = self.report()
        result = session_status.enrich_report(report, None)
        self.assertEqual(result['report'], report)
        self.assertIn('enrichment is off', result['off_reason'])

    def test_credentials_cli_precedes_environment_and_errors_are_private(self):
        from session_status.github import resolve_token
        with patch('subprocess.run') as run:
            run.return_value.returncode = 0; run.return_value.stdout = 'cli-token\n'
            self.assertEqual(resolve_token({'GITHUB_TOKEN':'env-token'}), 'cli-token')
            self.assertEqual(run.call_args.args[0], ['gh','auth','token','--hostname','github.com'])
            self.assertNotIn('GITHUB_TOKEN', run.call_args.kwargs.get('env', {'GITHUB_TOKEN':'env-token'}))
            self.assertNotIn('GH_TOKEN', run.call_args.kwargs.get('env', {'GITHUB_TOKEN':'env-token'}))
            run.side_effect = FileNotFoundError()
            self.assertEqual(resolve_token({'GITHUB_TOKEN':'env-token'}), 'env-token')
            self.assertIsNone(resolve_token({}))

if __name__ == '__main__': unittest.main()
