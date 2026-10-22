#!/usr/bin/env python3
"""Feature list gate for FairSettle.

The only sanctioned way to change a feature's state. Standard library only.

  python3 scripts/features.py status          counts and the active feature
  python3 scripts/features.py next            features ready to start
  python3 scripts/features.py start F05       mark one feature active
  python3 scripts/features.py verify F05      run its verification; passing only on success
  python3 scripts/features.py block F05 "why" park it with a reason
  python3 scripts/features.py unblock F05     back to not_started
  python3 scripts/features.py check           integrity check (pre-commit hook)
  python3 scripts/features.py handoff         markdown summary for docs/progress.md
"""

import datetime as dt
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FEATURES = ROOT / "docs" / "features.json"
EVIDENCE_DIR = ROOT / "docs" / "evidence"
STATES = ("not_started", "active", "blocked", "passing")
# Files the gate itself writes; they may be dirty while verifying.
GATE_FILES = ("docs/features.json", "docs/progress.md", "docs/evidence/")
VERIFY_TIMEOUT_S = 1800


def die(msg: str, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def git(*args: str, check: bool = True) -> str:
    out = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    if check and out.returncode != 0:
        die(f"git {' '.join(args)} failed: {out.stderr.strip()}")
    return out.stdout.strip()


def load(text: str | None = None) -> dict:
    data = json.loads(text if text is not None else FEATURES.read_text(encoding="utf-8"))
    ids = [f["id"] for f in data["features"]]
    if len(ids) != len(set(ids)):
        die("duplicate feature ids")
    return data


def save(data: dict) -> None:
    FEATURES.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def by_id(data: dict, fid: str) -> dict:
    for f in data["features"]:
        if f["id"] == fid:
            return f
    die(f"unknown feature {fid}")


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def deps_passing(data: dict, f: dict) -> list[str]:
    """Return the ids of dependencies that are not passing yet."""
    return [d for d in f["depends_on"] if by_id(data, d)["state"] != "passing"]


def cmd_status(data: dict) -> None:
    counts = {s: 0 for s in STATES}
    for f in data["features"]:
        counts[f["state"]] += 1
    total = len(data["features"])
    print(f"{counts['passing']}/{total} passing · " + " · ".join(f"{s} {n}" for s, n in counts.items() if s != "passing"))
    for f in data["features"]:
        if f["state"] in ("active", "blocked"):
            reason = f" ({f.get('blocked_reason', '')})" if f["state"] == "blocked" else ""
            print(f"  {f['state']:<8} {f['id']} {f['title']}{reason}")
    for ms in sorted({f["milestone"] for f in data["features"]}):
        group = [f for f in data["features"] if f["milestone"] == ms]
        done = sum(f["state"] == "passing" for f in group)
        print(f"  {ms}: {done}/{len(group)}")


def ready(data: dict) -> list[dict]:
    order = {"P0": 0, "P1": 1}
    out = [f for f in data["features"] if f["state"] == "not_started" and not deps_passing(data, f)]
    return sorted(out, key=lambda f: (order.get(f["priority"], 9), f["milestone"], f["id"]))


def cmd_next(data: dict) -> None:
    active = [f for f in data["features"] if f["state"] == "active"]
    if active:
        f = active[0]
        print(f"{f['id']} is already active: {f['title']}\n  behavior: {f['behavior']}")
        return
    rs = ready(data)
    if not rs:
        print("nothing ready: everything left is blocked or waiting on dependencies")
        return
    for f in rs:
        print(f"{f['id']} [{f['priority']} {f['milestone']} {f['service']}] {f['title']}")


def cmd_start(data: dict, fid: str) -> None:
    f = by_id(data, fid)
    active = [x["id"] for x in data["features"] if x["state"] == "active"]
    if active:
        die(f"{active[0]} is active; finish, verify or block it first (one feature at a time)")
    if f["state"] != "not_started":
        die(f"{fid} is {f['state']}, only not_started features can start")
    missing = deps_passing(data, f)
    if missing:
        die(f"{fid} depends on {', '.join(missing)}, not passing yet")
    f["state"] = "active"
    f["started_at"] = now()
    save(data)
    print(f"{fid} active: {f['title']}\n  behavior: {f['behavior']}")
    v = f["verification"]
    print(f"  done when: {v['command'] if v['kind'] == 'command' else '; '.join(v['steps'])}")


def dirty_non_gate_files() -> list[str]:
    out = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout
    # Porcelain lines are "XY <path>"; X may be a space, so never strip before slicing.
    paths = [ln[3:] for ln in out.splitlines() if ln]
    return [p for p in paths if not any(p == g or p.startswith(g) for g in GATE_FILES)]


def write_evidence(fid: str, header: list[str], body: str) -> tuple[str, str]:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    path = EVIDENCE_DIR / f"{fid}.log"
    text = "\n".join(header) + "\n----\n" + body
    path.write_text(text, encoding="utf-8")
    return str(path.relative_to(ROOT)), hashlib.sha256(text.encode("utf-8")).hexdigest()


def cmd_verify(data: dict, fid: str) -> None:
    f = by_id(data, fid)
    if f["state"] != "active":
        die(f"{fid} is {f['state']}; start it before verifying")
    dirty = dirty_non_gate_files()
    if dirty:
        die("commit your work first; verification records the commit it ran against.\n  uncommitted: " + ", ".join(dirty[:8]))
    commit = git("rev-parse", "HEAD")
    v = f["verification"]
    started = now()

    if v["kind"] == "manual":
        if not sys.stdin.isatty():
            die(f"{fid} needs a human: run this command yourself in a terminal", code=2)
        print(f"{fid} {f['title']} — confirm each step is true:")
        for i, step in enumerate(v["steps"], 1):
            print(f"  {i}. {step}")
        if input(f"type {fid} to confirm all steps: ").strip() != fid:
            die("not confirmed; state unchanged")
        note = input("note (ids, links, anything a later reader needs): ").strip()
        body = "\n".join(f"[x] {s}" for s in v["steps"]) + f"\nnote: {note}\n"
        log, digest = write_evidence(fid, [f"feature: {fid}", "kind: manual", f"commit: {commit}", f"confirmed_at: {started}"], body)
        exit_code = 0
    else:
        print(f"running: {v['command']}")
        try:
            proc = subprocess.run(v["command"], shell=True, cwd=ROOT, capture_output=True, text=True, timeout=VERIFY_TIMEOUT_S)
            exit_code, output = proc.returncode, proc.stdout + proc.stderr
        except subprocess.TimeoutExpired as e:
            exit_code, output = 124, f"timed out after {VERIFY_TIMEOUT_S}s\n{e.stdout or ''}{e.stderr or ''}"
        log, digest = write_evidence(
            fid,
            [f"feature: {fid}", "kind: command", f"command: {v['command']}", f"commit: {commit}", f"started_at: {started}", f"exit_code: {exit_code}"],
            output,
        )
        if exit_code != 0:
            tail = "\n".join(output.splitlines()[-40:])
            print(tail)
            die(f"verification failed (exit {exit_code}); {fid} stays active. full log: {log}")

    f["state"] = "passing"
    f["evidence"] = {"commit": commit, "verified_at": now(), "log": log, "log_sha256": digest}
    save(data)
    print(f"{fid} passing at {commit[:10]}; evidence in {log}. commit docs/features.json and docs/evidence/ next.")


def cmd_block(data: dict, fid: str, reason: str) -> None:
    f = by_id(data, fid)
    if f["state"] == "passing":
        die("passing is irreversible")
    f["state"] = "blocked"
    f["blocked_reason"] = reason
    save(data)
    print(f"{fid} blocked: {reason}")


def cmd_unblock(data: dict, fid: str) -> None:
    f = by_id(data, fid)
    if f["state"] != "blocked":
        die(f"{fid} is {f['state']}, not blocked")
    f["state"] = "not_started"
    f.pop("blocked_reason", None)
    save(data)
    print(f"{fid} back to not_started")


def cmd_check(data: dict) -> None:
    problems = []
    for f in data["features"]:
        if f["state"] not in STATES:
            problems.append(f"{f['id']}: unknown state {f['state']}")
        for d in f["depends_on"]:
            by_id(data, d)
    active = [f["id"] for f in data["features"] if f["state"] == "active"]
    if len(active) > 1:
        problems.append(f"more than one active feature: {', '.join(active)}")

    for f in data["features"]:
        if f["state"] != "passing":
            continue
        ev = f.get("evidence") or {}
        log = ROOT / ev.get("log", "missing")
        if not log.is_file():
            problems.append(f"{f['id']}: passing without an evidence log")
            continue
        if hashlib.sha256(log.read_text(encoding="utf-8").encode("utf-8")).hexdigest() != ev.get("log_sha256"):
            problems.append(f"{f['id']}: evidence log does not match its recorded hash")
        if subprocess.run(["git", "cat-file", "-e", f"{ev.get('commit', '')}^{{commit}}"], cwd=ROOT).returncode != 0:
            problems.append(f"{f['id']}: evidence commit {ev.get('commit')} not in this repository")
        if "exit_code: 0" not in log.read_text(encoding="utf-8") and "kind: manual" not in log.read_text(encoding="utf-8"):
            problems.append(f"{f['id']}: evidence log does not record a successful run")

    head = subprocess.run(["git", "show", "HEAD:docs/features.json"], cwd=ROOT, capture_output=True, text=True)
    if head.returncode == 0:
        before = {f["id"]: f["state"] for f in load(head.stdout)["features"]}
        for f in data["features"]:
            if before.get(f["id"]) == "passing" and f["state"] != "passing":
                problems.append(f"{f['id']}: was passing in HEAD, passing is irreversible")
        for fid in before:
            if fid not in {f["id"] for f in data["features"]}:
                problems.append(f"{fid}: removed from the list; features are never deleted, block them instead")

    if problems:
        print("feature list check failed:", *problems, sep="\n  ", file=sys.stderr)
        sys.exit(1)
    print("feature list ok")


def cmd_handoff(data: dict) -> None:
    passing = [f for f in data["features"] if f["state"] == "passing"]
    recent = sorted(passing, key=lambda f: f["evidence"]["verified_at"])[-5:]
    print(f"### State on {dt.date.today().isoformat()}\n")
    total = len(data["features"])
    print(f"- passing {len(passing)}/{total}")
    for f in data["features"]:
        if f["state"] == "active":
            print(f"- active: {f['id']} {f['title']}")
        if f["state"] == "blocked":
            print(f"- blocked: {f['id']} {f['title']}: {f.get('blocked_reason', '')}")
    if recent:
        print("- recently passing: " + ", ".join(f"{f['id']} ({f['evidence']['commit'][:7]})" for f in recent))
    rs = ready(data)[:3]
    if rs:
        print("- ready next: " + ", ".join(f"{f['id']} {f['title']}" for f in rs))


def main() -> None:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    cmd, rest = args[0], args[1:]
    data = load()
    if cmd == "status":
        cmd_status(data)
    elif cmd == "next":
        cmd_next(data)
    elif cmd == "start" and len(rest) == 1:
        cmd_start(data, rest[0])
    elif cmd == "verify" and len(rest) == 1:
        cmd_verify(data, rest[0])
    elif cmd == "block" and len(rest) == 2:
        cmd_block(data, rest[0], rest[1])
    elif cmd == "unblock" and len(rest) == 1:
        cmd_unblock(data, rest[0])
    elif cmd == "check":
        cmd_check(data)
    elif cmd == "handoff":
        cmd_handoff(data)
    else:
        die(f"bad arguments: {' '.join(args)}\n{__doc__}")


if __name__ == "__main__":
    main()
