"""Release payload contracts; all checks are offline."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


class ReleaseContract(unittest.TestCase):
    def test_marketplace_points_to_self_contained_plugin(self):
        self.assertTrue((ROOT / '.claude-plugin/marketplace.json').is_file(), 'root marketplace missing')
        marketplace = json.loads((ROOT / '.claude-plugin/marketplace.json').read_text())
        self.assertEqual(marketplace['name'], 'whatsup')
        self.assertEqual(len(marketplace['plugins']), 1)
        entry = marketplace['plugins'][0]
        self.assertEqual((entry['name'], entry['source']), ('whatsup', './mod'))
        plugin = ROOT / entry['source']
        manifest = json.loads((plugin / '.claude-plugin/plugin.json').read_text())
        self.assertEqual(entry['version'], manifest['version'])
        # Copy only the plugin, as marketplace installation does. No source-tree imports.
        import shutil
        with tempfile.TemporaryDirectory() as directory:
            installed = Path(directory) / 'whatsup'
            shutil.copytree(plugin, installed, ignore=shutil.ignore_patterns('__pycache__'))
            environment = dict(os.environ, PATH='', GITHUB_TOKEN='')
            result = subprocess.run([os.sys.executable, '-E', '-s', str(installed / 'reader/main.py')],
                                    input='{"report":{"scope":"release check"},"issue_kinds":[]}',
                                    text=True, capture_output=True, cwd=directory, env=environment)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['report'], {'scope': 'release check'})

    def test_release_documents_and_cleanup(self):
        for name in ('LICENSE', 'README.md', 'INSTALLATION.md', 'INTERFACE.md',
                     'RELEASING.md', 'CONTRIBUTING.md', 'contracts/session-context.md',
                     'docs/read-module.md', 'docs/images/whatsup.png'):
            self.assertTrue((ROOT / name).is_file(), name)
        for name in ('docs/design', 'docs/specs', 'docs/launch', 'docs/verification',
                     '.claude/settings.local.json'):
            self.assertFalse((ROOT / name).exists(), name)
        self.assertIn('Apache License', (ROOT / 'LICENSE').read_text())
        readme = (ROOT / 'README.md').read_text()
        self.assertIn('claude plugin marketplace add coreyfloyd/whatsup', readme)
        self.assertIn('claude plugin install whatsup@whatsup', readme)
        self.assertIn('python3', readme)
        self.assertIn('mcp__whatsup__report', readme)

    def test_replay_data_has_neutral_identities(self):
        owner = 'corey' + 'floyd'
        paths = (list((ROOT / 'tests/fixtures').glob('*.json')) +
                 list((ROOT / 'mod/tests/fixtures').glob('*.ts')) +
                 [ROOT / 'mod/hooks/snapshots.ts'])
        for path in paths:
            content = path.read_text().lower()
            self.assertFalse(owner in content, str(path))
            self.assertFalse('/Users/' in path.read_text(), str(path))
        capture = json.loads((ROOT / 'tests/fixtures/github-capture.json').read_text())
        self.assertTrue(all(key.startswith('example/') for key in capture if '#' in key))


if __name__ == '__main__':
    unittest.main()
