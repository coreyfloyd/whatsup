import json
import unittest
from pathlib import Path

import build_pane_snapshots as pane

MOD = Path(__file__).resolve().parent.parent / 'mod'


class PaneSnapshots(unittest.TestCase):
    def test_committed_snapshots_are_the_read_module_output(self):
        self.assertEqual(pane.OUT.read_text(), pane.render(pane.build()),
                         'mod/hooks/snapshots.ts is stale; run python3 tests/build_pane_snapshots.py')

    def test_manifest_offers_exactly_the_built_snapshots(self):
        field = json.loads((MOD / '.claude-plugin' / 'plugin.json').read_text())['userConfig']['snapshot']
        self.assertEqual(field['options'], ['live', *pane.SNAPSHOTS])
        self.assertEqual(field['default'], 'live')

    def test_snapshots_name_existing_fixtures_and_cases(self):
        cases = {c['name'] for c in json.loads((pane.FIXTURES / 'in-progress-cases.json').read_text())['cases']}
        manifest = {e['file'] for e in json.loads((pane.FIXTURES / 'manifest.json').read_text())}
        for name, (fixture, case, _) in pane.SNAPSHOTS.items():
            with self.subTest(name=name):
                self.assertIn(fixture, manifest)
                if case is not None:
                    self.assertIn(case, cases)

    def test_configured_origin_reaches_only_the_project_page(self):
        plain = pane.build()['several-rows']['snapshot']
        configured = pane.build('https://panel.example.test')['several-rows']['snapshot']
        self.assertIsNone(plain['project']['value']['page'])
        self.assertEqual(configured['project']['value']['page'], 'https://panel.example.test/#/projects/session-status')
        configured['project']['value']['page'] = None
        self.assertEqual(configured, plain)


if __name__ == '__main__':
    unittest.main()
