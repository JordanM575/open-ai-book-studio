#!/usr/bin/env python3
"""Focused structural regressions using only explicitly copied documentation fixtures."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("completion_validator", SOURCE / "scripts" / "validate-completion-specs.py")
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class CompletionGateFixtures(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="completion-gates-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.docs = self.root / "docs"
        self.docs.mkdir()
        for name in (
            "product-completion.json", "product-acceptance-gates.json", "completion-requirements.json",
            "completion-specs.json", "concurrent-delivery.json", "PRODUCT-COMPLETION.md",
            "PRODUCT-ACCEPTANCE-GATES.md", "CONCURRENT-DELIVERY.md", "RETAINED-DELIVERY.md",
        ):
            shutil.copyfile(SOURCE / "docs" / name, self.docs / name)
        (self.root / "specs").mkdir()
        shutil.copyfile(SOURCE / "specs" / "README.md", self.root / "specs" / "README.md")
        for source in (SOURCE / "specs").glob("[0-9][0-9][0-9]-*/spec.md"):
            target_dir = self.root / "specs" / source.parent.name
            target_dir.mkdir()
            for name in ("spec.md", "plan.md", "tasks.md"):
                if (source.parent / name).is_file():
                    shutil.copyfile(source.parent / name, target_dir / name)
        self.root_patch = patch.object(validator, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def get_json(self, name):
        return json.loads((self.docs / name).read_text())

    def put_json(self, name, value):
        (self.docs / name).write_text(json.dumps(value, indent=2) + "\n")

    def mutate_register(self, mutation):
        register = self.get_json("product-acceptance-gates.json")
        mutation(register["gates"])
        self.put_json("product-acceptance-gates.json", register)

    def mutate_graph(self, mutation):
        graph = self.get_json("product-completion.json")
        mutation(graph)
        self.put_json("product-completion.json", graph)

    def assert_invalid(self, message):
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(AssertionError, message):
            validator.validate()

    def test_unmodified_fixture_passes(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            validator.validate()
        self.assertIn("66 edge records; 24 direct L24 obligations", output.getvalue())

    def test_missing_edge_gate_is_rejected(self):
        self.mutate_register(lambda gates: gates.pop())
        self.assert_invalid("Missing edge gates")

    def test_duplicate_edge_gate_is_rejected(self):
        self.mutate_register(lambda gates: gates.append(dict(gates[0])))
        self.assert_invalid("Duplicate edge gate")

    def test_wrong_endpoint_is_rejected(self):
        self.mutate_register(lambda gates: gates[0].update(to="L99"))
        self.assert_invalid("wrong endpoints")

    def test_wrong_kind_is_rejected(self):
        self.mutate_register(lambda gates: gates[0].update(kind="conditional"))
        self.assert_invalid("Wrong gate kind")

    def test_missing_direct_obligation_is_rejected(self):
        self.mutate_graph(lambda graph: graph["terminalAcceptance"]["obligations"].remove("L01"))
        self.assert_invalid("Direct L24 obligations")

    def test_duplicate_direct_obligation_is_rejected(self):
        self.mutate_graph(lambda graph: graph["terminalAcceptance"]["obligations"].append("L01"))
        self.assert_invalid("Duplicate direct L24 obligation")

    def test_missing_non_owner_contract_link_is_rejected(self):
        self.mutate_register(lambda gates: gates[0].update(upstreamContract="../specs/999-missing/spec.md"))
        self.assert_invalid("Contract link is not an owner")

    def test_missing_owned_contract_file_is_rejected(self):
        (self.docs / "RETAINED-DELIVERY.md").unlink()
        self.assert_invalid("Broken contract link")

    def test_owner_link_resolving_to_root_is_rejected(self):
        path = self.docs / "RETAINED-DELIVERY.md"
        path.unlink()
        path.symlink_to(self.root, target_is_directory=True)
        self.assert_invalid("Contract link outside permitted repository scope")

    def test_existing_but_wrong_owner_is_rejected(self):
        self.mutate_register(lambda gates: gates[0].update(upstreamContract="../specs/011-model-access/spec.md"))
        self.assert_invalid("Contract link is not an owner")

    def test_external_contract_link_is_rejected(self):
        self.mutate_register(lambda gates: gates[0].update(upstreamContract="https://example.invalid/spec.md"))
        self.assert_invalid("Contract link must be a local file")

    def test_missing_semantics_is_rejected(self):
        self.mutate_register(lambda gates: gates[0].update(evidence="   "))
        self.assert_invalid("Missing or invalid evidence")

    def test_condition_drift_is_rejected(self):
        self.mutate_register(lambda gates: gates[-1].update(when="Always"))
        self.assert_invalid("Gate condition mismatch")

    def test_table_drift_is_rejected(self):
        self.mutate_register(lambda gates: gates[0].update(refusal="A changed refusal."))
        self.assert_invalid("Gate table differs")

    def test_optional_edge_cannot_be_promoted_even_with_matching_gate_and_diagram(self):
        graph = self.get_json("product-completion.json")
        graph["conditionalDependencies"] = [edge for edge in graph["conditionalDependencies"]
                                             if (edge["from"], edge["to"]) != ("L06", "L09")]
        next(lane for lane in graph["lanes"] if lane["id"] == "L09")["dependsOn"].append("L06")
        self.put_json("product-completion.json", graph)
        register = self.get_json("product-acceptance-gates.json")
        gate = next(gate for gate in register["gates"] if (gate["from"], gate["to"]) == ("L06", "L09"))
        gate["kind"] = "solid"
        del gate["when"]
        self.put_json("product-acceptance-gates.json", register)
        diagram = self.docs / "PRODUCT-COMPLETION.md"
        diagram.write_text(diagram.read_text().replace("L06 -. optional planning sources .-> L09", "L06 --> L09"))
        table = self.docs / "PRODUCT-ACCEPTANCE-GATES.md"
        table.write_text(validator.replace_gate_table(table.read_text(), register))
        self.assert_invalid("Optional relationships must remain conditional")

    def test_solid_cycle_is_rejected(self):
        self.mutate_graph(lambda graph: graph["lanes"][0]["dependsOn"].append("L24"))
        self.assert_invalid("Cycle at")

    def test_union_only_cycle_is_rejected(self):
        self.mutate_graph(lambda graph: next(lane for lane in graph["lanes"] if lane["id"] == "L06")["dependsOn"].append("L09"))
        diagram = self.docs / "PRODUCT-COMPLETION.md"
        diagram.write_text(diagram.read_text().replace("  L05 --> L06\n", "  L05 --> L06\n  L09 --> L06\n"))
        self.assert_invalid("Conditional cycle at")


if __name__ == "__main__":
    unittest.main(verbosity=2)
