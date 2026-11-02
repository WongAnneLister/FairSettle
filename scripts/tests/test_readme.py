from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ReadmeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.readme = (ROOT / "README.md").read_text()
        cls.readme_lines = cls.readme.splitlines()
        parts = re.split(r"^## (.+)\n", cls.readme, flags=re.MULTILINE)
        cls.headings = parts[1::2]
        cls.sections = dict(zip(parts[1::2], parts[2::2]))

    def test_title_and_pitch(self):
        self.assertEqual(self.readme_lines[0], "# FairSettle")
        pitch = self.readme.split("\n", 1)[1].strip().split("\n\n", 1)[0]
        for word in ("refund", "who pays", "PayPal"):
            self.assertIn(word, pitch)

    def test_sections_in_order(self):
        self.assertEqual(self.headings, [
            "Demo", "How it works", "Architecture", "Quick start", "Evaluation",
            "Pre-existing code and hackathon work", "Repository layout", "Limitations", "License",
        ])

    def test_architecture_diagram(self):
        section = self.sections["Architecture"]
        block = re.search(r"```mermaid\n(.*?)```", section, re.DOTALL)
        self.assertIsNotNone(block)
        for text in ("flowchart", "PayPal sandbox", "ledger", "dispatch", "agent"):
            self.assertIn(text, block.group(1))

    def test_relative_links_exist(self):
        for markdown, html in re.findall(r'\]\(([^)]+)\)|src="([^"]+)"', self.readme):
            target = markdown or html
            if target.startswith(("http:", "https:", "mailto:", "#")):
                continue
            target = target.split("#", 1)[0]
            if target == "docs/media/demo.gif":
                continue
            with self.subTest(target=target):
                self.assertTrue((ROOT / target).exists(), target)

    def test_demo_gif(self):
        self.assertIn("docs/media/demo.gif", self.sections["Demo"])
        path = ROOT / "docs/media/demo.gif"
        if not path.exists():
            self.skipTest("demo GIF not recorded yet")
        self.assertLessEqual(path.stat().st_size, 8 * 1024 * 1024)
        with path.open("rb") as gif:
            self.assertEqual(gif.read(4), b"GIF8")

    def test_evaluation_matches_results(self):
        results = (ROOT / "docs/eval-results.md").read_text().splitlines()
        accuracy = next(line for line in results if line.startswith("Accuracy:"))
        generated = next(line for line in results if line.startswith("Generated:"))
        commit = re.search(r"Commit: ([0-9a-f]+)", generated).group(1)
        self.assertIn(accuracy, self.sections["Evaluation"])
        self.assertIn(commit, self.sections["Evaluation"])

    def test_quick_start(self):
        for text in (
            "docker compose up -d --wait", "http://localhost:8080/actuator/health",
            "http://localhost:8081/actuator/health", "http://localhost:4000/graphql",
            "docker compose down", "env.live.example", "docs/m2-live-run.md", "docker-compose.live.yml",
        ):
            self.assertIn(text, self.sections["Quick start"])

    def test_pre_existing_boundary(self):
        section = self.sections["Pre-existing code and hackathon work"]
        for text in (
            "2026-10-01", "2ba58da", "d11a3ea", "8450d17",
            "git log --before='2026-10-01T00:00:00+08:00' --format='%h %ad %s' --date=short",
        ):
            self.assertIn(text, section)

    def test_no_secrets_in_readme(self):
        from test_secret_scan import log, scanner

        self.assertEqual(scanner.scan_lines(log(*("+" + line for line in self.readme_lines), path="README.md")), [])

    def test_license(self):
        path = ROOT / "LICENSE"
        self.assertTrue(path.is_file())
        license_text = path.read_text()
        first = next(line for line in license_text.splitlines() if line.strip())
        self.assertEqual(first.strip(), "GNU AFFERO GENERAL PUBLIC LICENSE")
        self.assertIn("Version 3, 19 November 2007", license_text)
        self.assertIn("AGPL-3.0", self.sections["License"])
        self.assertIn("[LICENSE](LICENSE)", self.sections["License"])


if __name__ == "__main__":
    unittest.main()
