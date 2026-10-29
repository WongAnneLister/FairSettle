import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "docker-compose.yml"
OVERLAY = ROOT / "docker-compose.live.yml"
TEMPLATE = ROOT / "env.live.example"
KEYS = ("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "LOCAL_APP_SECRET", "LOCAL_OPS_SECRET",
        "LOCAL_AGENT_SECRET", "PUBLIC_HOST", "LEDGER_NOTIFICATION_SECRET", "AGENT_SERVICE_TOKEN",
        "DEEPSEEK_API_KEY", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_NEXTAUTH_SECRET",
        "LANGFUSE_SALT", "LANGFUSE_ENCRYPTION_KEY", "LANGFUSE_ADMIN_EMAIL", "LANGFUSE_ADMIN_PASSWORD")


class ComposeLiveTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.setup_error = None
        try:
            cls.template = TEMPLATE.read_text()
            cls.keys = [line.split("=", 1)[0] for line in cls.template.splitlines()
                        if line.strip() and not line.lstrip().startswith("#")]
            cls.raw = OVERLAY.read_text()
            cls.compose_env = {key: value for key, value in os.environ.items() if key not in KEYS}
            values = {key: "test-" + key.lower() for key in cls.keys}
            values.update(PUBLIC_HOST="m2-test.ngrok-free.dev", LOCAL_APP_SECRET="a" * 43,
                          LOCAL_OPS_SECRET="b" * 43, LOCAL_AGENT_SECRET="c" * 43,
                          LANGFUSE_PUBLIC_KEY="pk-lf-test", LANGFUSE_SECRET_KEY="sk-lf-test")
            with tempfile.TemporaryDirectory() as directory:
                env_file = Path(directory) / "env.live"
                env_file.write_text("".join(key + "=" + values[key] + "\n" for key in cls.keys))
                result = subprocess.run(cls.command(env_file), capture_output=True, text=True,
                                        check=False, env=cls.compose_env)
            if result.returncode:
                cls.setup_error = "docker compose config failed: " + result.stderr.strip()
                return
            cls.config = json.loads(result.stdout)
        except FileNotFoundError as error:
            cls.setup_error = "Docker CLI or live compose input is missing: " + str(error)

    @staticmethod
    def command(env_file):
        return ["docker", "compose", "--env-file", str(env_file), "-f", str(COMPOSE),
                "-f", str(OVERLAY), "config", "--format", "json"]

    def setUp(self):
        if self.setup_error:
            self.fail(self.setup_error)
        self.services = self.config["services"]

    def test_services_are_root_plus_live(self):
        self.assertEqual(set(self.services), {
            "ledger-postgres", "ledger-redis", "kafka", "ledger-api", "ledger-worker",
            "dispatch-postgres", "dispatch-redis", "dispatch", "kafka-init",
            "ledger-notification-target", "agent-postgres", "agent", "langfuse-postgres",
            "langfuse-redis", "langfuse-clickhouse", "langfuse-s3", "langfuse-s3-init",
            "langfuse-worker", "langfuse-web"})
        for name, service in self.services.items():
            with self.subTest(service=name):
                self.assertNotIn("container_name", service)

    def test_published_ports(self):
        published = {"ledger-api": 8080, "ledger-worker": 8081, "dispatch": 4000,
                     "agent": 8000, "langfuse-web": 3000}
        for name, service in self.services.items():
            with self.subTest(service=name):
                if name in published:
                    ports = service["ports"]
                    self.assertEqual(len(ports), 1)
                    self.assertEqual(ports[0]["target"], published[name])
                    self.assertEqual(str(ports[0]["published"]), str(published[name]))
                    if name in {"agent", "langfuse-web"}:
                        self.assertEqual(ports[0]["host_ip"], "127.0.0.1")
                    else:
                        self.assertIn(ports[0].get("host_ip"), (None, "0.0.0.0", ""))
                else:
                    self.assertFalse(service.get("ports"))

    def test_every_secret_comes_from_env_live(self):
        self.assertEqual(self.keys, list(KEYS))
        for line in self.template.splitlines():
            if line.strip() and not line.lstrip().startswith("#"):
                self.assertEqual(line.split("=", 1)[1], "")
        for service in self.services.values():
            self.assertNotIn("env_file", service)
        occurrences = re.findall(r"\$\{([A-Za-z_][A-Za-z0-9_]*)([^}]*)\}", self.raw)
        self.assertEqual({name for name, _ in occurrences}, set(KEYS))
        for name, suffix in occurrences:
            with self.subTest(key=name):
                self.assertEqual(suffix, ":?" + name + " is required in .env.live")
        self.assertNotIn("${", COMPOSE.read_text())
        result = subprocess.run(["git", "check-ignore", "-q", ".env.live"], cwd=ROOT,
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_unfilled_env_file_fails_to_render(self):
        result = subprocess.run(self.command(TEMPLATE), capture_output=True, text=True,
                                check=False, env=self.compose_env)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(any(key in result.stderr for key in KEYS), result.stderr)

    def test_ledger_runs_paypal_sandbox_with_fixtures_on_the_api_only(self):
        self.assertIn("--spring.profiles.active=api,local", self.services["ledger-api"]["command"])
        for name in ("ledger-api", "ledger-worker"):
            env = self.services[name]["environment"]
            self.assertEqual(env["PAYPAL_ENABLED"], "true")
            self.assertEqual(env["PAYPAL_BASE_URL"], "https://api-m.sandbox.paypal.com")
            self.assertEqual(env["PAYPAL_ORGANIZATION_ID"], "10000000-0000-0000-0000-000000000001")
            self.assertEqual(env["PAYPAL_ENVIRONMENT_ID"], "10000000-0000-0000-0000-000000000011")
            self.assertEqual(env["PAYPAL_PROVIDER_ACCOUNT_ID"], "10000000-0000-0000-0000-000000000021")
        self.assertEqual(self.services["ledger-api"]["environment"]["LOCAL_FIXTURES_ENABLED"], "true")
        for name, service in self.services.items():
            with self.subTest(service=name):
                env = service.get("environment", {})
                if name != "ledger-api":
                    self.assertNotIn("LOCAL_FIXTURES_ENABLED", env)
                self.assertNotIn("PAYPAL_WEBHOOK_ENABLED", env)
                self.assertFalse(any(key.startswith("STRIPE_") for key in env))

    def test_notifications_and_checkout_agree(self):
        worker = self.services["ledger-worker"]["environment"]
        dispatch = self.services["dispatch"]["environment"]
        self.assertEqual(worker["PAYMENT_MESSAGING_ENABLED"], "true")
        self.assertEqual(worker["MERCHANT_NOTIFICATION_ALLOWED_HOSTS"], "m2-test.ngrok-free.dev")
        self.assertEqual(worker["MERCHANT_NOTIFICATION_KEY_DISPATCH"], dispatch["LEDGER_NOTIFICATION_SECRET"])
        self.assertEqual(dispatch["LEDGER_CHECKOUT"], "enabled")
        self.assertEqual(dispatch["LEDGER_BASE_URL"], "http://ledger-api:8080")
        self.assertEqual(dispatch["LEDGER_CHECKOUT_SUCCESS_URL"], "https://m2-test.ngrok-free.dev/checkout/success")
        self.assertEqual(dispatch["LEDGER_CHECKOUT_CANCEL_URL"], "https://m2-test.ngrok-free.dev/checkout/cancel")
        self.assertTrue(dispatch["LEDGER_APP_TOKEN"].startswith("app_10000000-0000-0000-0000-000000000041."))
        command = " ".join(self.services["ledger-notification-target"]["command"])
        self.assertIn("https://m2-test.ngrok-free.dev/webhooks/ledger", command)
        self.assertIn("'dispatch'", command)
        kafka_command = self.services["kafka-init"]["command"]
        self.assertIn("--create", kafka_command)
        self.assertIn("payment-notifications-v1", kafka_command)

    def test_agent_service_wiring(self):
        agent = self.services["agent"]
        env = agent["environment"]
        web = self.services["langfuse-web"]["environment"]
        self.assertTrue(env["LEDGER_APP_TOKEN"].startswith("app_10000000-0000-0000-0000-000000000042."))
        self.assertEqual(env["AGENT_SERVICE_TOKEN"], self.services["dispatch"]["environment"]["AGENT_SERVICE_TOKEN"])
        self.assertEqual(env["LANGFUSE_PUBLIC_KEY"], web["LANGFUSE_INIT_PROJECT_PUBLIC_KEY"])
        self.assertEqual(env["LANGFUSE_SECRET_KEY"], web["LANGFUSE_INIT_PROJECT_SECRET_KEY"])
        self.assertEqual(env["LANGFUSE_BASE_URL"], "http://langfuse-web:3000")
        self.assertEqual(env["FAIRSETTLE_MODEL"], "deepseek/deepseek-v4-pro")
        self.assertEqual(env["LITELLM_LOCAL_MODEL_COST_MAP"], "True")
        self.assertEqual(env["FAIRSETTLE_HTTP_HOST"], "0.0.0.0")
        self.assertNotIn("FAIRSETTLE_TRACING", env)
        self.assertTrue(agent["build"]["context"].endswith("/agent"))
        self.assertEqual(agent["image"], "fairsettle-agent:local")

    def test_images_pinned(self):
        for name, service in self.services.items():
            with self.subTest(service=name):
                self.assertIn(":", service["image"])
                self.assertNotEqual(service["image"].rsplit(":", 1)[1], "latest")
        for name, image in {"langfuse-web": "langfuse/langfuse:4.58.0",
                            "langfuse-worker": "langfuse/langfuse-worker:4.58.0",
                            "langfuse-s3": "chrislusf/seaweedfs:4.48",
                            "langfuse-s3-init": "chrislusf/seaweedfs:4.48",
                            "langfuse-clickhouse": "clickhouse/clickhouse-server:25.12"}.items():
            self.assertEqual(self.services[name]["image"], image)

    def test_live_data_is_separate_from_the_root_stack(self):
        for service, volume, target in (
                ("ledger-postgres", "fairsettle-live-ledger-postgres", "/var/lib/postgresql/data"),
                ("dispatch-postgres", "fairsettle-live-dispatch-postgres", "/var/lib/postgresql/data"),
                ("kafka", "fairsettle-live-kafka", "/var/lib/kafka/data")):
            mounts = [item for item in self.services[service]["volumes"] if item["type"] == "volume"]
            self.assertEqual([(item["source"], item["target"]) for item in mounts], [(volume, target)])
        mounts = [item for item in self.services["ledger-postgres"]["volumes"]
                  if item["target"] == "/docker-entrypoint-initdb.d/10-init-roles.sql"]
        self.assertEqual(len(mounts), 1)
        self.assertTrue(mounts[0]["source"].endswith("/ledger/scripts/db/init-roles.sql"))
        self.assertTrue(mounts[0]["read_only"])
        live_names = {"fairsettle-live-" + suffix for suffix in (
            "ledger-postgres", "dispatch-postgres", "kafka", "agent-postgres",
            "langfuse-postgres", "langfuse-clickhouse", "langfuse-s3")}
        self.assertEqual({name for name in self.config["volumes"] if name.startswith("fairsettle-live-")}, live_names)
        for name in live_names:
            self.assertEqual(self.config["volumes"][name]["name"], name)
        root_volumes = {"fairsettle-ledger-postgres", "fairsettle-dispatch-postgres", "fairsettle-kafka"}
        for service in self.services.values():
            for mount in service.get("volumes", []):
                self.assertNotIn(mount.get("source"), root_volumes)

    def test_health_and_ordering(self):
        one_shots = {"kafka-init", "ledger-notification-target", "langfuse-s3-init"}
        for name, service in self.services.items():
            with self.subTest(service=name):
                if name not in one_shots | {"langfuse-worker"}:
                    self.assertTrue(service.get("healthcheck", {}).get("test"))
                if name in one_shots:
                    self.assertEqual(service["restart"], "no")
                    self.assertNotIn("healthcheck", service)
        completed = "service_completed_successfully"
        healthy = "service_healthy"
        edges = {
            "ledger-worker": {"kafka-init": completed, "ledger-notification-target": completed},
            "ledger-notification-target": {"ledger-api": healthy},
            "dispatch": {"ledger-api": healthy},
            "agent": {name: healthy for name in ("agent-postgres", "ledger-api", "dispatch", "langfuse-web")},
            "langfuse-worker": {"langfuse-postgres": healthy, "langfuse-redis": healthy,
                                "langfuse-clickhouse": healthy, "langfuse-s3-init": completed},
            "langfuse-web": {"langfuse-postgres": healthy, "langfuse-redis": healthy,
                             "langfuse-clickhouse": healthy, "langfuse-s3-init": completed}}
        for name, dependencies in edges.items():
            for dependency, condition in dependencies.items():
                with self.subTest(service=name, dependency=dependency):
                    self.assertEqual(self.services[name]["depends_on"][dependency]["condition"], condition)


if __name__ == "__main__":
    unittest.main()
