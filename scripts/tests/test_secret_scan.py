from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "secret_scan.py"
SPEC = importlib.util.spec_from_file_location("secret_scan", SCRIPT)
scanner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = scanner
SPEC.loader.exec_module(scanner)


def log(*lines, path="app/config.txt"):
    return ["commit " + "1" * 40, f"diff --git a/{path} b/{path}", f"+++ b/{path}", *lines]


class SecretScanTest(unittest.TestCase):
    def test_paypal_like_token(self):
        self.assertEqual(scanner.scan_lines(log("+client: " + "A" + "b" * 79)), [
            scanner.Hit("paypal_like_token", "1" * 40, "app/config.txt"),
        ])

    def test_integrity_hash_is_ignored(self):
        self.assertEqual(scanner.scan_lines(log('+  "integrity": "sha512-' + "A" * 86 + '=="')), [])

    def test_long_identifier_is_ignored(self):
        self.assertEqual(scanner.scan_lines(log("+reason: missing_" + "E" * 90)), [])

    def test_api_and_langfuse_keys(self):
        self.assertEqual(scanner.scan_lines(log(
            "+" + "sk-" + "0" * 32,
            "+" + "pk-lf-" + "a" * 32,
            "+pk-lf-test",
        )), [
            scanner.Hit("api_key", "1" * 40, "app/config.txt"),
            scanner.Hit("langfuse_key", "1" * 40, "app/config.txt"),
        ])

    def test_env_assignment(self):
        self.assertEqual(scanner.scan_lines(log(
            "+PAYPAL_CLIENT_SECRET=" + "x" * 20,
            "+      DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY:?}",
            "+DEEPSEEK_API_KEY=",
            "+# AGENT_SERVICE_TOKEN=replace-with-at-least-32-random-characters",
            "+  AGENT_SERVICE_TOKEN: Joi.string().min(32),",
        )), [scanner.Hit("env_assignment", "1" * 40, "app/config.txt")])

    def test_env_file_path(self):
        lines = []
        for path in (".env.live", ".env.example", "env.live.example"):
            lines.extend(log("+x", path=path))
        self.assertEqual(scanner.scan_lines(lines), [scanner.Hit("env_file", "1" * 40, ".env.live")])

    def test_private_key_and_tokens(self):
        self.assertEqual(scanner.scan_lines(log(
            "+" + "-----BEGIN " + "RSA PRIVATE KEY-----",
            "+" + "AKIA" + "A" * 16,
            "+" + "ghp_" + "a" * 36,
            "+" + "2" + "a" * 26 + "_" + "b" * 21,
        )), [
            scanner.Hit(name, "1" * 40, "app/config.txt")
            for name in ("private_key", "aws_key", "github_token", "ngrok_token")
        ])

    def test_removed_lines_are_scanned_context_lines_are_not(self):
        self.assertEqual(scanner.scan_lines(log(
            "-" + "sk-" + "1" * 32,
            " " + "sk-" + "2" * 32,
        )), [scanner.Hit("api_key", "1" * 40, "app/config.txt")])

    def test_header_lines_are_skipped(self):
        self.assertEqual(scanner.scan_lines(log("+++ b/sk-" + "3" * 32)), [])

    def test_main_prints_no_value(self):
        token = "sk-" + "9" * 32

        def fake(command, **kwargs):
            self.assertEqual(command, [
                "git", "log", "-p", "--all", "--no-color", "--no-ext-diff", "--format=commit %H",
            ])
            self.assertEqual(kwargs, {
                "cwd": scanner.ROOT, "capture_output": True, "text": True,
                "encoding": "utf-8", "errors": "replace",
            })
            return subprocess.CompletedProcess(command, 0, "\n".join(log("+k: " + token)), "")

        output = io.StringIO()
        with redirect_stdout(output):
            result = scanner.main([], run=fake)
        self.assertEqual(result, 1)
        self.assertIn("api_key 1111111 app/config.txt", output.getvalue())
        self.assertIn("secret scan: 1 hits in 1 commits", output.getvalue())
        self.assertNotIn(token, output.getvalue())

    def test_main_clean(self):
        def fake(command, **kwargs):
            return subprocess.CompletedProcess(command, 0, "\n".join(log("+hello")), "")

        output = io.StringIO()
        with redirect_stdout(output):
            result = scanner.main([], run=fake)
        self.assertEqual(result, 0)
        self.assertTrue(output.getvalue().rstrip().endswith("secret scan: 0 hits in 1 commits"))

    def test_main_git_failure_and_usage(self):
        def fake(command, **kwargs):
            return subprocess.CompletedProcess(command, 128, "", "fatal: not a git repository\nsecond line")

        error = io.StringIO()
        with redirect_stderr(error):
            self.assertEqual(scanner.main([], run=fake), 2)
        self.assertEqual(error.getvalue(), "git log failed: fatal: not a git repository\n")
        error = io.StringIO()
        with redirect_stderr(error):
            self.assertEqual(scanner.main(["--all"]), 2)
        self.assertEqual(error.getvalue(), "usage: python3 scripts/secret_scan.py\n")

    def test_repository_history_is_clean(self):
        output = io.StringIO()
        with redirect_stdout(output):
            result = scanner.main([])
        self.assertEqual(result, 0, output.getvalue())


if __name__ == "__main__":
    unittest.main()
