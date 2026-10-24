"""Signed release archives: build one, verify it, and pin the published signing key.

The build and verify tests sign with a throwaway key generated in a temporary
GnuPG home. The published key is never used to sign here; its test only checks
that the committed key and fingerprint agree. Set WHATSUP_RELEASE_CHECK=1 to
fail instead of skip when GnuPG is missing.
"""
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERIFY = ROOT / 'scripts/verify-release.sh'
PUBLISHED_KEY = ROOT / 'keys/whatsup-release.asc'
FINGERPRINT_FILE = ROOT / 'RELEASE_SIGNING_FINGERPRINT'
# The maintainer's release key, shared with the maintainer's other plugin releases.
RELEASE_FINGERPRINT = '09674AFF392661238F4ACBD9F32B3A412CD5EFC5'
SNAPSHOT_IGNORE = shutil.ignore_patterns('.git', '__pycache__', '.DS_Store', 'dist', 'node_modules')


def version():
    return json.loads((ROOT / 'mod/.claude-plugin/plugin.json').read_text())['version']


def gpg(home, *args, check=True):
    return subprocess.run(['gpg', '--homedir', home, '--batch', *args], text=True, capture_output=True, check=check)


def fingerprints(home, secret=False):
    """Primary key fingerprints in the keyring."""
    listing = gpg(home, '--with-colons', '--list-secret-keys' if secret else '--list-keys', check=False).stdout
    result, primary = [], False
    for line in listing.splitlines():
        fields = line.split(':')
        if fields[0] in ('pub', 'sec'):
            primary = True
        elif fields[0] == 'fpr' and primary:
            result.append(fields[9])
            primary = False
        elif fields[0] in ('sub', 'ssb'):
            primary = False
    return result


class ReleaseSigningTest(unittest.TestCase):
    def setUp(self):
        for tool in ('gpg', 'gpgconf', 'shasum'):
            if shutil.which(tool) is None:
                if os.environ.get('WHATSUP_RELEASE_CHECK') == '1':
                    self.fail(f'{tool} is not installed')
                self.skipTest(f'{tool} is not installed')
        # A short path: gpg-agent's socket lives in the home, and macOS caps socket paths at 104 bytes.
        self.home = tempfile.mkdtemp(prefix='gpg')
        os.chmod(self.home, 0o700)
        self.tmp = Path(tempfile.mkdtemp(prefix='whatsup-release-'))

    def tearDown(self):
        subprocess.run(['gpgconf', '--homedir', self.home, '--kill', 'gpg-agent'], capture_output=True)
        shutil.rmtree(self.home, ignore_errors=True)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def generate_key(self, name):
        """A throwaway, unprotected signing key; returns its fingerprint."""
        before = set(fingerprints(self.home, secret=True))
        params = Path(self.home) / f'{name}.params'
        params.write_text('%no-protection\nKey-Type: eddsa\nKey-Curve: ed25519\nKey-Usage: sign\n'
                          f'Name-Real: {name}\nName-Email: {name}@example.invalid\nExpire-Date: 0\n%commit\n')
        gpg(self.home, '--generate-key', str(params))
        (new,) = set(fingerprints(self.home, secret=True)) - before
        return new

    def export(self, key, name):
        path = self.tmp / name
        path.write_text(gpg(self.home, '--armor', '--export', key).stdout)
        return path

    def sandbox_repo(self, name):
        """A git repository holding this checkout's current files, so a test controls its tag and dirty state."""
        dest = self.tmp / name
        shutil.copytree(ROOT, dest, ignore=SNAPSHOT_IGNORE)
        for args in (['init', '--quiet'], ['config', 'user.email', 'test@example.invalid'],
                     ['config', 'user.name', 'whatsup test'], ['config', 'commit.gpgsign', 'false'],
                     ['config', 'tag.gpgsign', 'false'], ['add', '-A'], ['commit', '--quiet', '-m', 'snapshot']):
            subprocess.run(['git', *args], cwd=dest, check=True, capture_output=True)
        return dest

    def build(self, cwd, out, key):
        env = dict(os.environ, GNUPGHOME=self.home, WHATSUP_GPG_KEY=key)
        return subprocess.run(['bash', str(ROOT / 'scripts/build-release.sh'), str(out)],
                              text=True, capture_output=True, env=env, cwd=cwd)

    def verify(self, archive, keyring, fingerprint):
        return subprocess.run(['bash', str(VERIFY), str(archive), str(keyring), fingerprint], text=True, capture_output=True)

    def test_committed_key_is_the_published_release_key(self):
        committed = FINGERPRINT_FILE.read_text().strip()
        self.assertEqual(committed, RELEASE_FINGERPRINT)
        gpg(self.home, '--import', str(PUBLISHED_KEY))
        self.assertEqual(fingerprints(self.home), [committed])
        self.assertEqual(fingerprints(self.home, secret=True), [])

    def test_built_archive_verifies_and_holds_only_the_caller_repository_tree(self):
        key = self.generate_key('release')
        keyring = self.export(key, 'release.asc')
        repo = self.sandbox_repo('checkout-with-another-name')
        (repo / 'untracked.txt').write_text('not shipped\n')

        result = self.build(repo, repo / 'dist', key)
        self.assertEqual(result.returncode, 0, result.stderr)
        archive = repo / 'dist' / f'whatsup-{version()}.tar.gz'

        result = self.verify(archive, keyring, key.lower())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('OK', result.stdout)

        tracked = subprocess.run(['git', 'ls-files'], cwd=repo, text=True, capture_output=True, check=True)
        with tarfile.open(archive) as tar:
            files = sorted(m.name for m in tar.getmembers() if not m.isdir())
        self.assertEqual(files, sorted('whatsup/' + name for name in tracked.stdout.splitlines()))

    def test_relative_output_directory_resolves_from_the_caller(self):
        key = self.generate_key('release')
        keyring = self.export(key, 'release.asc')
        repo = self.sandbox_repo('repo')

        result = self.build(repo / 'mod', 'dist', key)
        self.assertEqual(result.returncode, 0, result.stderr)
        archive = repo / 'mod' / 'dist' / f'whatsup-{version()}.tar.gz'
        self.assertTrue(archive.is_file())
        self.assertFalse((repo / 'dist').exists())
        self.assertEqual(self.verify(archive, keyring, key).returncode, 0)

    def test_verify_rejects_another_key_a_tampered_archive_and_a_swapped_checksum(self):
        key = self.generate_key('release')
        other = self.generate_key('other')
        keyring = self.export(key, 'release.asc')
        both = self.tmp / 'both.asc'
        both.write_text(keyring.read_text() + self.export(other, 'other.asc').read_text())
        repo = self.sandbox_repo('repo')

        self.assertEqual(self.build(repo, self.tmp / 'other-dist', other).returncode, 0)
        rejected = self.verify(self.tmp / 'other-dist' / f'whatsup-{version()}.tar.gz', both, key)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn('fingerprint mismatch', rejected.stderr)

        self.assertEqual(self.build(repo, self.tmp / 'dist', key).returncode, 0)
        archive = self.tmp / 'dist' / f'whatsup-{version()}.tar.gz'
        renamed = self.tmp / 'dist' / 'whatsup-renamed.tar.gz'
        for suffix in ('', '.sha256', '.asc'):
            shutil.copy(f'{archive}{suffix}', f'{renamed}{suffix}')
        self.assertNotEqual(self.verify(renamed, keyring, key).returncode, 0)

        with open(archive, 'ab') as handle:
            handle.write(b'x')
        self.assertNotEqual(self.verify(archive, keyring, key).returncode, 0)

    def test_build_refuses_a_dirty_tree_and_a_commit_past_the_release_tag(self):
        key = self.generate_key('release')
        repo = self.sandbox_repo('repo')
        with open(repo / 'README.md', 'a') as handle:
            handle.write('\nlocal edit\n')
        dirty = self.build(repo, self.tmp / 'dirty', key)
        self.assertNotEqual(dirty.returncode, 0)
        self.assertIn('dirty', dirty.stderr)
        subprocess.run(['git', 'checkout', '--', 'README.md'], cwd=repo, check=True)

        tag = f'v{version()}'
        subprocess.run(['git', 'tag', '-a', tag, '-m', tag], cwd=repo, check=True)
        self.assertEqual(self.build(repo, self.tmp / 'at-tag', key).returncode, 0)
        subprocess.run(['git', 'commit', '--quiet', '--allow-empty', '-m', 'past the tag'], cwd=repo, check=True)
        past = self.build(repo, self.tmp / 'past-tag', key)
        self.assertNotEqual(past.returncode, 0)
        self.assertIn(tag, past.stderr)


if __name__ == '__main__':
    unittest.main()
