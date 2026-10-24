from pathlib import Path
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "contracts/ledger-openapi.yaml"
OPERATIONS = {
    ("get", "/v1/payments/{paymentId}"): ("getPayment", "payments:read"),
    ("get", "/v1/payments/{paymentId}/refundable"): ("getRefundableAmount", "payments:read"),
    ("post", "/v1/refund-proposals"): ("createRefundProposal", "refund-proposals:write"),
    ("get", "/v1/refund-proposals/{proposalId}"): ("getRefundProposal", "refund-proposals:read"),
    ("get", "/v1/refunds/{refundId}"): ("getRefund", "refunds:read"),
    ("get", "/v1/refunds/{refundId}/liability"): ("getRefundLiability", "refunds:read"),
    ("get", "/ops/refund-proposals"): ("listRefundProposals", "ops:refund-proposal:read"),
    ("post", "/ops/refund-proposals/{proposalId}/decision"): (
        "decideRefundProposal", "ops:refund-proposal:review"),
}


def walk(value):
    yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


class LedgerContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.setup_error = None
        try:
            cls.document = yaml.safe_load(CONTRACT.read_text())
        except FileNotFoundError as error:
            cls.setup_error = str(error)

    def setUp(self):
        if self.setup_error:
            self.fail(self.setup_error)
        self.schemas = self.document["components"]["schemas"]

    def resolve(self, value):
        while "$ref" in value:
            reference = value["$ref"]
            self.assertTrue(reference.startswith("#/"), reference)
            value = self.document
            for segment in reference[2:].split("/"):
                value = value[segment.replace("~1", "/").replace("~0", "~")]
        return value

    def schema(self, value):
        value = self.resolve(value)
        result = {}
        for part in value.get("allOf", []):
            result.update(self.schema(part))
        result.update({key: item for key, item in value.items() if key != "allOf"})
        return result

    def operations(self):
        for path, item in self.document["paths"].items():
            for method, operation in item.items():
                if method in {"get", "post", "put", "patch", "delete", "head", "options", "trace"}:
                    yield method, path, operation

    def test_header(self):
        self.assertEqual(self.document["openapi"], "3.0.3")
        info = self.document["info"]
        self.assertEqual(info["title"], "FairSettle Ledger API (cross-service contract)")
        self.assertEqual(info["version"], "0.1.0-F14")
        self.assertEqual(info["license"]["name"], "Proprietary")
        self.assertEqual(info["license"]["url"], "https://github.com/WongAnneLister/FairSettle")
        server = self.document["servers"][0]
        self.assertEqual(server["url"], "{scheme}://{host}:{port}")
        self.assertEqual(server["variables"]["scheme"]["default"], "http")
        self.assertEqual(server["variables"]["host"]["default"], "localhost")
        self.assertEqual(server["variables"]["port"]["default"], "8080")

    def test_operations_are_exactly_the_contract(self):
        actual = {(method, path, operation["operationId"])
                  for method, path, operation in self.operations()}
        expected = {(method, path, values[0]) for (method, path), values in OPERATIONS.items()}
        self.assertEqual(actual, expected)

    def test_every_operation_is_complete(self):
        tags = {"payments", "refund-proposals", "refunds", "ops-review"}
        self.assertEqual({tag["name"] for tag in self.document["tags"]}, tags)
        for tag in self.document["tags"]:
            self.assertTrue(tag["description"])
        for method, path, operation in self.operations():
            with self.subTest(method=method, path=path):
                for field in ("summary", "description", "operationId", "security"):
                    self.assertTrue(operation[field])
                self.assertEqual(len(operation["tags"]), 1)
                self.assertIn(operation["tags"][0], tags)
                responses = operation["responses"]
                self.assertTrue(any(str(code).startswith("2") for code in responses))
                self.assertIn("401", responses)
                self.assertTrue(any(str(code).startswith("4") and str(code) != "401"
                                    for code in responses))
                self.assertIn("500", responses)
                for code, response in responses.items():
                    response = self.resolve(response)
                    self.assertIn("X-Request-Id", response["headers"])
                    media = response["content"]["application/json"]
                    if str(code).startswith(("4", "5")):
                        self.assertIs(self.resolve(media["schema"]), self.schemas["Error"])
                    elif str(code).startswith("2"):
                        self.assertIn("example", media)
                if "requestBody" in operation:
                    body = self.resolve(operation["requestBody"])
                    self.assertIn("example", body["content"]["application/json"])

    def test_security_matches_paths(self):
        for method, path, operation in self.operations():
            scheme = "ApplicationBearer" if path.startswith("/v1/") else "OpsBearer"
            self.assertEqual(operation["security"], [{scheme: [OPERATIONS[method, path][1]]}])

    def test_posts_require_idempotency_key(self):
        for method, path, operation in self.operations():
            if method == "post":
                with self.subTest(path=path):
                    self.assertIn({"$ref": "#/components/parameters/IdempotencyKeyRequired"},
                                  operation["parameters"])
                    parameter = self.document["components"]["parameters"]["IdempotencyKeyRequired"]
                    self.assertTrue(parameter["required"])
                    self.assertIn("Idempotent-Replay", self.resolve(operation["responses"]["200"])["headers"])

    def test_no_floats_anywhere(self):
        for node in walk(self.document):
            if isinstance(node, dict):
                self.assertNotEqual(node.get("type"), "number")
                for name, value in node.get("properties", {}).items():
                    if name.endswith("Minor"):
                        resolved = self.schema(value)
                        self.assertEqual(resolved["type"], "integer", name)
                        self.assertEqual(resolved["format"], "int64", name)

    def test_liability_split_shape(self):
        self.assertEqual(self.schemas["LiabilityParty"]["enum"], ["RESTAURANT", "DRIVER", "PLATFORM"])
        points = self.schemas["BasisPoints"]
        self.assertEqual(points["type"], "integer")
        self.assertEqual((points["minimum"], points["maximum"]), (0, 10000))
        split = self.schemas["LiabilitySplit"]
        self.assertEqual((split["minItems"], split["maxItems"]), (3, 3))
        self.assertIs(self.resolve(split["items"]), self.schemas["LiabilityShare"])
        self.assertIn("10000", split["description"])
        self.assertIn("LIABILITY_SPLIT_INVALID", split["description"])
        share = self.schemas["LiabilityShare"]
        self.assertEqual(set(share["required"]), {"party", "basisPoints"})
        self.assertFalse(share["additionalProperties"])

    def test_allocation_example_follows_the_rule(self):
        example = self.schemas["LiabilityAllocation"]["example"]
        self.assertEqual(example["amountMinor"], 1250)
        self.assertEqual(len(example["lines"]), 3)
        lines = {line["party"]: line for line in example["lines"]}
        self.assertEqual(set(lines), {"RESTAURANT", "DRIVER", "PLATFORM"})
        self.assertEqual([lines[party]["basisPoints"] for party in ("RESTAURANT", "DRIVER", "PLATFORM")],
                         [3333, 3333, 3334])
        for party in ("RESTAURANT", "DRIVER"):
            self.assertEqual(lines[party]["amountMinor"],
                             example["amountMinor"] * lines[party]["basisPoints"] // 10000)
        self.assertEqual(lines["PLATFORM"]["amountMinor"],
                         example["amountMinor"] - lines["RESTAURANT"]["amountMinor"]
                         - lines["DRIVER"]["amountMinor"])
        self.assertEqual(sum(line["amountMinor"] for line in example["lines"]), example["amountMinor"])
        self.assertEqual([lines[party]["amountMinor"] for party in ("RESTAURANT", "DRIVER", "PLATFORM")],
                         [416, 416, 418])

    def test_create_request_is_closed_and_bounded(self):
        request = self.schemas["RefundProposalCreateRequest"]
        self.assertEqual(set(request["required"]), {
            "complaintId", "orderRef", "paymentId", "decision", "amountMinor", "currency",
            "reasonCode", "liability", "explanation", "evidenceRefs", "agentRun"})
        self.assertFalse(request["additionalProperties"])
        properties = request["properties"]
        self.assertEqual(properties["complaintId"]["pattern"], "^[A-Za-z0-9._:-]{1,128}$")
        explanation = properties["explanation"]
        self.assertEqual((explanation["minLength"], explanation["maxLength"]), (1, 2000))
        evidence = properties["evidenceRefs"]
        self.assertEqual((evidence["minItems"], evidence["maxItems"]), (1, 50))
        self.assertEqual((evidence["items"]["minLength"], evidence["items"]["maxLength"]), (1, 128))
        self.assertEqual(self.schema(properties["amountMinor"])["minimum"], 1)

    def test_review_cannot_edit(self):
        request = self.schemas["ReviewDecisionRequest"]
        self.assertEqual(set(request["properties"]), {"action", "reason"})
        self.assertFalse(request["additionalProperties"])
        self.assertEqual(request["properties"]["action"]["enum"], ["APPROVE", "REJECT"])
        shapes = request["oneOf"]
        self.assertEqual(len(shapes), 2)
        by_action = {shape["properties"]["action"]["enum"][0]: shape for shape in shapes}
        self.assertIn("reason", by_action["REJECT"]["required"])
        self.assertEqual(self.schemas["RefundProposalStatus"]["enum"],
                         ["PENDING_REVIEW", "APPROVED", "REJECTED"])

    def test_error_contract(self):
        self.assertTrue(set(self.schemas["Error"]["required"]) >= {"code", "message", "retryable", "requestId"})
        codes = self.schemas["ErrorCode"]
        self.assertTrue(set(codes["enum"]) >= {
            "LIABILITY_SPLIT_INVALID", "PROPOSAL_EXISTS", "PROPOSAL_NOT_PENDING",
            "REFUND_LIMIT_EXCEEDED", "REFUND_BLOCKED", "IDEMPOTENCY_CONFLICT"})
        for code in codes["enum"]:
            self.assertRegex(codes["description"], r"\|\s*`?" + code + r"`?\s*\|")

    def test_refs_are_internal_and_resolve(self):
        for node in walk(self.document):
            if isinstance(node, dict) and "$ref" in node:
                self.resolve(node)
        used = set()

        def visit(value):
            for node in walk(value):
                if isinstance(node, dict) and "$ref" in node:
                    reference = node["$ref"]
                    if reference not in used:
                        used.add(reference)
                        visit(self.resolve(node))

        visit({key: value for key, value in self.document.items() if key != "components"})
        for _, _, operation in self.operations():
            for requirement in operation["security"]:
                for scheme in requirement:
                    used.add("#/components/securitySchemes/" + scheme)
        for category, components in self.document["components"].items():
            for name in components:
                self.assertIn(f"#/components/{category}/{name}", used, f"Unused component: {category}/{name}")


if __name__ == "__main__":
    unittest.main()
