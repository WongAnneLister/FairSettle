#!/usr/bin/env python3
"""Scan the whole git history for credentials (F30). Prints pattern names, commits and paths, never values.

Exit 0: no hits. Exit 1: hits. Exit 2: git failed.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Hit:
    pattern: str
    commit: str
    path: str


ENV_NAMES: tuple[str, ...] = (
    "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET",
    "LOCAL_APP_SECRET", "LOCAL_OPS_SECRET", "LOCAL_AGENT_SECRET",
    "LEDGER_NOTIFICATION_SECRET", "AGENT_SERVICE_TOKEN", "DEEPSEEK_API_KEY",
    "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_NEXTAUTH_SECRET",
    "LANGFUSE_SALT", "LANGFUSE_ENCRYPTION_KEY", "LANGFUSE_ADMIN_PASSWORD",
    "NGROK_AUTHTOKEN",
)
PATTERNS: dict[str, re.Pattern[str]] = {
    "paypal_like_token": re.compile(r"(?<![A-Za-z0-9_-])[AE][A-Za-z0-9_-]{78,}"),
    "api_key": re.compile(r"(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{32,}"),
    "langfuse_key": re.compile(r"(?<![A-Za-z0-9_-])(pk|sk)-lf-[0-9a-f]{32}"),
    "stripe_key": re.compile(r"(?<![A-Za-z0-9_-])((sk|rk)_(live|test)_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,})"),
    "private_key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "aws_key": re.compile(r"(?<![A-Za-z0-9_-])AKIA[0-9A-Z]{16}"),
    "github_token": re.compile(r"(?<![A-Za-z0-9_-])gh[pousr]_[A-Za-z0-9]{36}"),
    "ngrok_token": re.compile(r"(?<![A-Za-z0-9_-])[0-9][A-Za-z0-9]{26}_[A-Za-z0-9]{21}(?![A-Za-z0-9_-])"),
    "env_assignment": re.compile(
        r"(?<![A-Za-z0-9_])(" + "|".join(ENV_NAMES) + r''')["']?\s*[=:]\s*["']?([A-Za-z0-9+/=_-]{12,})["']?\s*,?\s*$'''
    ),
}
PLACEHOLDER = re.compile(r"(?i)^(replace|your|change|example|dummy|test|fake)")
INTEGRITY = re.compile(r"sha(1|256|384|512)-[A-Za-z0-9+/=]+")
ENV_FILE = re.compile(r"^\.env(\..+)?$")


def scan_lines(lines: Iterable[str]) -> list[Hit]:
    hits = []
    commit = path = ""
    for line in lines:
        if line.startswith("commit "):
            commit = line.removeprefix("commit ").strip()
            continue
        if line.startswith("diff --git a/"):
            path = line.split(" b/", 1)[1].rstrip("\r\n")
            basename = Path(path).name
            if ENV_FILE.fullmatch(basename) and basename != ".env.example":
                hits.append(Hit("env_file", commit, path))
            continue
        if line.startswith(("+++", "---")) or not line.startswith(("+", "-")):
            continue
        value = INTEGRITY.sub("", line[1:].rstrip("\r\n"))
        for name, pattern in PATTERNS.items():
            match = pattern.search(value)
            if match is None:
                continue
            if name == "env_assignment" and PLACEHOLDER.match(match.group(2)):
                continue
            hits.append(Hit(name, commit, path))
    return hits


def main(argv: list[str] | None = None, run=subprocess.run) -> int:
    if argv is None:
        argv = sys.argv[1:]
    if argv:
        print("usage: python3 scripts/secret_scan.py", file=sys.stderr)
        return 2
    result = run(
        ["git", "log", "-p", "--all", "--no-color", "--no-ext-diff", "--format=commit %H"],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if result.returncode:
        errors = result.stderr.splitlines()
        print("git log failed: " + (errors[0] if errors else ""), file=sys.stderr)
        return 2
    lines = result.stdout.splitlines()
    hits = list(dict.fromkeys(scan_lines(lines)))
    for hit in hits:
        print(f"{hit.pattern} {hit.commit[:7]} {hit.path}")
    commits = sum(line.startswith("commit ") for line in lines)
    print(f"secret scan: {len(hits)} hits in {commits} commits")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
