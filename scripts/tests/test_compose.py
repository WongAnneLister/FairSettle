import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "docker-compose.yml"


class ComposeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.setup_error = None
        try:
            result = subprocess.run(
                ["docker", "compose", "-f", str(COMPOSE), "config", "--format", "json"],
                capture_output=True, text=True, check=False)
            if result.returncode:
                cls.setup_error = "docker compose config failed: " + result.stderr.strip()
                return
            cls.config = json.loads(result.stdout)
            cls.raw = COMPOSE.read_text()
        except FileNotFoundError as error:
            cls.setup_error = "Docker CLI or root compose file is missing: " + str(error)

    def setUp(self):
        if self.setup_error:
            self.fail(self.setup_error)
        self.services = self.config["services"]

    def test_services_are_exactly_the_stack(self):
        self.assertEqual(self.config["name"], "fairsettle")
        self.assertEqual(set(self.services), {
            "ledger-postgres", "ledger-redis", "kafka", "ledger-api", "ledger-worker",
            "dispatch-postgres", "dispatch-redis", "dispatch"})
        for service in self.services.values():
            self.assertNotIn("container_name", service)

    def test_only_verified_ports_are_published(self):
        published = {"ledger-api": 8080, "ledger-worker": 8081, "dispatch": 4000}
        for name, service in self.services.items():
            with self.subTest(service=name):
                if name in published:
                    ports = service["ports"]
                    self.assertEqual(len(ports), 1)
                    self.assertEqual(ports[0]["target"], published[name])
                    self.assertEqual(str(ports[0]["published"]), str(published[name]))
                else:
                    self.assertFalse(service.get("ports"))

    def test_ledger_and_dispatch_have_separate_stores(self):
        for name in ("ledger-api", "ledger-worker"):
            self.assertEqual(self.services[name]["environment"]["DB_HOST"], "ledger-postgres")
            self.assertEqual(self.services[name]["environment"]["REDIS_HOST"], "ledger-redis")
        self.assertEqual(self.services["dispatch"]["environment"]["DB_HOST"], "dispatch-postgres")
        self.assertEqual(self.services["dispatch"]["environment"]["REDIS_HOST"], "dispatch-redis")
        ledger = [v["source"] for v in self.services["ledger-postgres"]["volumes"] if v["type"] == "volume"]
        dispatch = [v["source"] for v in self.services["dispatch-postgres"]["volumes"] if v["type"] == "volume"]
        self.assertEqual(len(ledger), 1)
        self.assertEqual(len(dispatch), 1)
        self.assertNotEqual(ledger, dispatch)

    def test_every_service_has_a_healthcheck(self):
        for name, service in self.services.items():
            with self.subTest(service=name):
                self.assertTrue(service.get("healthcheck", {}).get("test"))

    def test_depends_on_waits_for_health(self):
        edges = {
            "ledger-api": {"ledger-postgres", "ledger-redis"},
            "ledger-worker": {"ledger-api", "kafka"},
            "dispatch": {"dispatch-postgres", "dispatch-redis"}}
        for name, dependencies in edges.items():
            for dependency in dependencies:
                self.assertEqual(self.services[name]["depends_on"][dependency]["condition"], "service_healthy")

    def test_no_provider_secrets_or_fixtures(self):
        for name, service in self.services.items():
            with self.subTest(service=name):
                self.assertNotIn("env_file", service)
                for key in service.get("environment", {}):
                    self.assertFalse(key.startswith(("PAYPAL_", "STRIPE_")))
                    self.assertNotIn(key, {"LOCAL_FIXTURES_ENABLED", "LOCAL_APP_SECRET", "LOCAL_OPS_SECRET"})

    def test_images_are_pinned_and_ledger_image_shared(self):
        for name, service in self.services.items():
            with self.subTest(service=name):
                image = service["image"]
                self.assertIn(":", image)
                self.assertNotEqual(image.rsplit(":", 1)[1], "latest")
        for name in ("ledger-api", "ledger-worker"):
            self.assertEqual(self.services[name]["image"], "fairsettle-ledger:local")
            self.assertTrue(self.services[name]["build"]["context"].endswith("/ledger"))
        self.assertTrue(self.services["dispatch"]["build"]["context"].endswith("/dispatch"))

    def test_named_volumes(self):
        names = {"fairsettle-ledger-postgres", "fairsettle-dispatch-postgres", "fairsettle-kafka"}
        self.assertEqual(set(self.config["volumes"]), names)
        for name in names:
            self.assertEqual(self.config["volumes"][name]["name"], name)
        mounts = [v for v in self.services["ledger-postgres"]["volumes"]
                  if v.get("target") == "/docker-entrypoint-initdb.d/10-init-roles.sql"]
        self.assertEqual(len(mounts), 1)
        self.assertTrue(mounts[0]["source"].endswith("/ledger/scripts/db/init-roles.sql"))
        self.assertTrue(mounts[0]["read_only"])

    def test_compose_file_has_no_interpolation(self):
        self.assertNotIn("$" + "{", self.raw)


if __name__ == "__main__":
    unittest.main()
