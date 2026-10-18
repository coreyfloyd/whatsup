"""Exercise the shell script against a controlled Herdr CLI boundary."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "live-check.sh"


class LiveCheckStartTests(unittest.TestCase):
    def run_start(self, failures, error="agent_pane_busy"):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            herdr = root / "herdr"
            herdr.write_text("""#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['TEST_ROOT'])
args = sys.argv[1:]
with (root / 'calls').open('a') as log:
    log.write(json.dumps(args) + '\\n')
if args[:2] == ['tab', 'create']:
    print(json.dumps({'result': {'tab': {'tab_id': 'test-tab'},
                                'root_pane': {'pane_id': 'test-pane'}}}))
elif args[:2] == ['agent', 'start']:
    counter = root / 'attempts'
    attempt = int(counter.read_text()) + 1 if counter.exists() else 1
    counter.write_text(str(attempt))
    if attempt <= int(os.environ['TEST_FAILURES']):
        print(json.dumps({'error': {'code': os.environ['TEST_ERROR'],
                                   'message': 'start rejected'}}), file=sys.stderr)
        sys.exit(1)
elif args != ['tab', 'close', 'test-tab']:
    sys.exit(2)
""")
            herdr.chmod(0o755)
            sleep = root / "sleep"
            sleep.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_ROOT/sleeps"\n')
            sleep.chmod(0o755)
            state = root / "state"
            result = subprocess.run(
                ["bash", str(SCRIPT), "start", "test-start", str(root)],
                env={**os.environ, "PATH": f"{root}:{os.environ['PATH']}",
                     "TEST_ROOT": str(root), "TEST_FAILURES": str(failures),
                     "TEST_ERROR": error, "LIVE_CHECK_STATE": str(state),
                     "HERDR_WORKSPACE_ID": "test-workspace"},
                text=True, capture_output=True, timeout=10,
            )
            calls = [json.loads(line) for line in (root / "calls").read_text().splitlines()]
            sleeps = (root / "sleeps").read_text().splitlines() if (root / "sleeps").exists() else []
            return result, calls, sleeps, (state / "test-start").exists()

    def test_retries_busy_shell_until_start_succeeds(self):
        result, calls, sleeps, has_state = self.run_start(3)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sum(call[:2] == ["agent", "start"] for call in calls), 4)
        self.assertEqual(len(sleeps), 3)
        self.assertTrue(has_state)
        self.assertNotIn(["tab", "close", "test-tab"], calls)

    def test_busy_shell_exhaustion_closes_only_created_tab(self):
        result, calls, sleeps, has_state = self.run_start(100)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(sum(call[:2] == ["agent", "start"] for call in calls), 10)
        self.assertEqual(len(sleeps), 9)
        self.assertEqual(calls[-1], ["tab", "close", "test-tab"])
        self.assertFalse(has_state)
        self.assertIn("agent_pane_busy", result.stderr)

    def test_other_start_failure_cleans_up_without_retry(self):
        result, calls, sleeps, has_state = self.run_start(1, "agent_start_timeout")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(sum(call[:2] == ["agent", "start"] for call in calls), 1)
        self.assertEqual(sleeps, [])
        self.assertEqual(calls[-1], ["tab", "close", "test-tab"])
        self.assertFalse(has_state)
        self.assertIn("agent_start_timeout", result.stderr)

    def test_ready_shell_starts_once_without_sleep(self):
        result, calls, sleeps, has_state = self.run_start(0)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sum(call[:2] == ["agent", "start"] for call in calls), 1)
        self.assertEqual(sleeps, [])
        self.assertTrue(has_state)


class LiveCheckSayTests(unittest.TestCase):
    def run_say(self, text, error=None, status=1):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            herdr = root / "herdr"
            herdr.write_text("""#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['TEST_ROOT'])
(root / 'calls').write_text(json.dumps(sys.argv[1:]))
if os.environ['TEST_ERROR']:
    print(json.dumps({'error': {'code': os.environ['TEST_ERROR'],
                               'message': 'prompt did not settle'}}), file=sys.stderr)
    sys.exit(int(os.environ['TEST_STATUS']))
print(json.dumps({'result': {}}))
""")
            herdr.chmod(0o755)
            state = root / "state"
            state.mkdir()
            (state / "test-say").write_text("test-tab test-pane\n")
            result = subprocess.run(
                ["bash", str(SCRIPT), "say", "test-say", text],
                env={**os.environ, "PATH": f"{root}:{os.environ['PATH']}",
                     "TEST_ROOT": str(root), "TEST_ERROR": error or "",
                     "TEST_STATUS": str(status), "LIVE_CHECK_STATE": str(state),
                     "LIVE_CHECK_SETTLE": "0", "LIVE_CHECK_TIMEOUT": "1234"},
                text=True, capture_output=True, timeout=10,
            )
            return result, json.loads((root / "calls").read_text())

    def test_success_waits_for_pane_and_keeps_output_quiet(self):
        result, calls = self.run_say("Reply briefly.")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ["agent", "prompt", "test-pane", "Reply briefly.",
                                 "--wait", "--timeout", "1234"])
        self.assertEqual(result.stdout, "")

    def test_timeout_and_rejection_preserve_status_and_error(self):
        for error, status in [("timeout", 1), ("agent_not_found", 1),
                              ("agent_prompt_stalled", 1), ("invalid_argument", 2)]:
            with self.subTest(error=error):
                result, _ = self.run_say("Reply briefly.", error, status)
                self.assertEqual(result.returncode, status)
                self.assertIn(error, result.stderr)
                self.assertIn("prompt did not settle", result.stderr)

    def test_slash_command_without_state_transition_succeeds(self):
        result, _ = self.run_say("/whatsup", "agent_prompt_stalled")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_slash_commands_still_surface_timeout_and_rejection(self):
        for error in ["timeout", "agent_not_found"]:
            with self.subTest(error=error):
                result, _ = self.run_say("/whatsup", error)
                self.assertEqual(result.returncode, 1)
                self.assertIn(error, result.stderr)


if __name__ == "__main__":
    unittest.main()
