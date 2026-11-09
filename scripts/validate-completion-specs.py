#!/usr/bin/env python3
"""Validate the bounded completion documentation; never traverse author libraries."""

import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
GATE_START = "<!-- acceptance-gates:start -->"
GATE_END = "<!-- acceptance-gates:end -->"
OPTIONAL_RELATIONSHIPS = {
    ("L06", "L09"): "Review includes new 030 planning records; selected manuscript-only review does not require them.",
    ("L14", "L09"): "An accepted future review slice uses routing policy; manual provider/model selection does not require routing.",
    ("L06", "L13"): "Casting references new 030 character records; narrator-only generation does not require them.",
}


def load(name):
    return json.loads((ROOT / "docs" / name).read_text())


def assert_terminal_coverage(nodes, terminal):
    """Every retained node must be required by the final milestone, not only optional edges."""
    required = set()

    def collect(node_id):
        if node_id in required:
            return
        required.add(node_id)
        for parent in nodes[node_id]["dependsOn"]:
            collect(parent)

    assert terminal in nodes, f"Missing terminal {terminal}"
    collect(terminal)
    assert required == set(nodes), f"Not covered by {terminal}: {sorted(set(nodes) - required)}"


def render_gate_table(register):
    """Render the human-readable view from the canonical edge records."""
    rows = [
        "| Relationship | Claim applicability | Required upstream contract | Evidence required | No-claim / refusal | Contract owners |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for gate in register["gates"]:
        source, target = gate["from"], gate["to"]
        kind = gate["kind"]
        relationship = f"{source} → {target} ({kind})"
        if kind == "conditional":
            relationship += f"<br>When: {gate['when']}"
        owners = (f"[{source}]({gate['upstreamContract']}) → "
                  f"[{target}]({gate['downstreamContract']})")
        rows.append("| " + " | ".join((relationship, gate["claim"], gate["contract"],
                                      gate["evidence"], gate["refusal"], owners)) + " |")
    return "\n".join(rows)


def replace_gate_table(markdown, register):
    assert markdown.count(GATE_START) == markdown.count(GATE_END) == 1, "Invalid gate table markers"
    before, rest = markdown.split(GATE_START)
    _, after = rest.split(GATE_END)
    return before + GATE_START + "\n" + render_gate_table(register) + "\n" + GATE_END + after


def validate_optional_relationships(graph):
    conditional = graph.get("conditionalDependencies", [])
    pairs = [(edge["from"], edge["to"]) for edge in conditional]
    assert len(pairs) == len(set(pairs)), "Duplicate conditional edge"
    assert set(pairs) == set(OPTIONAL_RELATIONSHIPS), "Optional relationships must remain conditional and independent"
    for edge in conditional:
        pair = (edge["from"], edge["to"])
        assert edge.get("when") == OPTIONAL_RELATIONSHIPS[pair], f"Optional condition changed: {pair}"
    for lane in graph["lanes"]:
        for parent in lane["dependsOn"]:
            assert (parent, lane["id"]) not in OPTIONAL_RELATIONSHIPS, "Optional relationship became a solid gate"


def validate_gates(graph, lanes, edges, conditional, ownership, specs):
    expected_lanes = {f"L{number:02d}" for number in range(25)}
    assert set(lanes) == expected_lanes, "Retained lane set changed: reconcile direct terminal obligations"
    terminal = graph.get("terminalAcceptance", {})
    assert terminal.get("lane") == "L24", "Missing L24 direct terminal acceptance"
    assert terminal.get("kind") == "direct-retained-scope-conjunction", "Wrong terminal acceptance kind"
    obligations = terminal.get("obligations", [])
    assert isinstance(obligations, list), "Direct obligations must be a list"
    assert len(obligations) == len(set(obligations)), "Duplicate direct L24 obligation"
    assert set(obligations) == expected_lanes - {"L24"}, "Direct L24 obligations must contain exactly L00–L23"
    assert isinstance(terminal.get("meaning"), str) and terminal["meaning"].strip(), "Missing terminal meaning"
    assert len(edges) == 63, "Expected 63 solid relationships"
    assert graph.get("gateRegister") == "product-acceptance-gates.json", "Missing canonical gate register link"
    register = load(graph["gateRegister"])
    assert register.get("schemaVersion") == 1, "Unknown gate register schema"
    assert register.get("status") == "requirements-not-passed-evidence", "Gate register must not claim passed evidence"
    gates = register.get("gates", [])
    assert isinstance(gates, list), "Gates must be a list"
    conditional_by_pair = {(edge["from"], edge["to"]): edge for edge in conditional}
    actual = edges | set(conditional_by_pair)
    seen = set()

    def check_owner_link(link, lane_id):
        assert isinstance(link, str) and link.strip() == link and link, f"Missing contract link for {lane_id}"
        parsed = urlsplit(link)
        assert not (parsed.scheme or parsed.netloc or parsed.query or parsed.fragment), f"Contract link must be a local file: {link}"
        lexical = Path(os.path.abspath(ROOT / "docs" / parsed.path))
        assert lexical.is_relative_to(ROOT) and lexical != ROOT and lexical.relative_to(ROOT).parts[0] != "json", f"Contract link outside permitted repository scope: {link}"
        if lane_id == "L24":
            allowed = {ROOT / "docs" / "RETAINED-DELIVERY.md"}
        else:
            allowed = {specs[number] for number in ownership["lanes"][lane_id] if number in specs}
        assert lexical in allowed, f"Contract link is not an owner for {lane_id}: {link}"
        path = lexical.resolve()
        assert path.is_relative_to(ROOT) and path != ROOT and path.relative_to(ROOT).parts[0] != "json", f"Contract link outside permitted repository scope: {link}"
        assert path.is_file(), f"Broken contract link: {link}"

    for gate in gates:
        pair = (gate.get("from"), gate.get("to"))
        assert pair not in seen, f"Duplicate edge gate: {pair}"
        seen.add(pair)
        assert pair in actual, f"Gate has wrong endpoints or no graph edge: {pair}"
        kind = "conditional" if pair in conditional_by_pair else "solid"
        assert gate.get("kind") == kind, f"Wrong gate kind: {pair}"
        if kind == "conditional":
            assert gate.get("when") == conditional_by_pair[pair]["when"], f"Gate condition mismatch: {pair}"
        else:
            assert "when" not in gate, f"Solid gate has conditional semantics: {pair}"
        for field in ("claim", "contract", "evidence", "refusal"):
            value = gate.get(field)
            assert isinstance(value, str) and value.strip() and "\n" not in value and "|" not in value, f"Missing or invalid {field}: {pair}"
        check_owner_link(gate.get("upstreamContract"), pair[0])
        check_owner_link(gate.get("downstreamContract"), pair[1])
    assert seen == actual, f"Missing edge gates: {sorted(actual - seen)}"
    markdown = (ROOT / "docs" / "PRODUCT-ACCEPTANCE-GATES.md").read_text()
    assert replace_gate_table(markdown, register) == markdown, "Gate table differs from canonical register"
    print(f"Acceptance gates valid: {len(gates)} edge records; 24 direct L24 obligations; owner links and table match")


def validate_execution(lanes):
    execution = load("concurrent-delivery.json")
    streams = {stream["id"]: stream for stream in execution["streams"]}
    work = {item["id"]: item for item in execution["work"]}
    assert len(streams) == len(execution["streams"]), "Duplicate stream ID"
    assert len(work) == len(execution["work"]), "Duplicate work-package ID"
    work_lanes = execution["workLanes"]
    assert set(work_lanes) == set(work), "Work-package lane coverage mismatch"
    assigned = {stream_id: set() for stream_id in streams}
    for item_id, item in work.items():
        assert item["stream"] in streams, f"Unknown stream: {item_id}"
        scope = work_lanes[item_id]
        assert scope and len(scope) == len(set(scope)), f"Invalid work lane scope: {item_id}"
        assert set(scope) <= set(streams[item["stream"]]["lanes"]), f"Work outside stream scope: {item_id}"
        assigned[item["stream"]].update(scope)
    covered = set()
    for stream in streams.values():
        assert stream["lanes"], f"Empty stream: {stream['id']}"
        assert len(stream["lanes"]) == len(set(stream["lanes"])), "Duplicate lane in stream"
        assert set(stream["lanes"]) <= set(lanes), f"Unknown lane in {stream['id']}"
        assert assigned[stream["id"]] == set(stream["lanes"]), f"Stream lanes without assigned work: {stream['id']}"
        covered.update(stream["lanes"])
    assert covered == set(lanes), f"Unowned execution lanes: {set(lanes) - covered}"
    assert 1 <= execution["maxConcurrentIntegrationGates"] <= execution["maxConcurrentAgents"]
    wave = execution.get("currentWave", execution["firstWave"])
    assert len(wave) == len(set(wave)) <= execution["maxConcurrentAgents"], "Invalid current wave"
    assert set(wave) <= set(work), "Unknown current-wave work package"
    assert len({work[item]["stream"] for item in wave}) == len(wave), "Competing current-wave stream owners"
    active, done, edges = set(), set(), set()

    def visit(item_id):
        assert item_id not in active, f"Execution cycle at {item_id}"
        if item_id in done:
            return
        active.add(item_id)
        item = work[item_id]
        assert item["stream"] in streams, f"Unknown stream: {item_id}"
        assert item["gate"].strip(), f"Missing gate: {item_id}"
        assert len(item["dependsOn"]) == len(set(item["dependsOn"])), f"Duplicate dependency: {item_id}"
        for parent in item["dependsOn"]:
            assert parent in work, f"Unknown work prerequisite: {parent}"
            edges.add((parent, item_id))
            visit(parent)
        active.remove(item_id)
        done.add(item_id)

    for item_id in work:
        visit(item_id)
    for item_id in wave:
        assert not set(work[item_id]["dependsOn"]) & set(wave), "Current-wave dependency race"
    assert_terminal_coverage(work, "W99")
    markdown = (ROOT / "docs" / "CONCURRENT-DELIVERY.md").read_text()
    diagram = re.search(r"```mermaid\n(.*?)```", markdown, re.S)
    assert diagram, "Missing execution diagram"
    shown = set(re.findall(r"\b(W\d{2})(?:\[[^\]\n]*\])?\s*-->\s*(W\d{2})", diagram[1]))
    assert edges == shown, f"Execution Mermaid mismatch: {edges ^ shown}"
    print(f"Execution valid: {len(streams)} streams, {len(work)} packages, {len(edges)} edges, "
          f"{len(wave)} queued agents; assigned lane scopes and terminal coverage valid")


def validate():
    graph = load("product-completion.json")
    requirements = load("completion-requirements.json")["requirements"]
    ownership = load("completion-specs.json")
    lanes = {lane["id"]: lane for lane in graph["lanes"]}
    assert len(lanes) == len(graph["lanes"]), "Duplicate lane IDs"
    validate_optional_relationships(graph)
    req_ids = {req["id"] for req in requirements}
    assert len(req_ids) == len(requirements), "Duplicate requirement IDs"
    assert set(ownership["requirements"]) == req_ids, "Requirement ownership mismatch"
    assert set(ownership["lanes"]) == set(lanes), "Lane ownership mismatch"
    specs = {}
    for path in (ROOT / "specs").glob("[0-9][0-9][0-9]-*/spec.md"):
        number = path.parent.name[:3]
        assert number not in specs, f"Duplicate spec number {number}"
        specs[number] = path
    reserved = ownership["reservedSpecs"]
    assert not set(reserved) & set(specs), "Reserved spec now exists: reconcile its ownership"
    index = (ROOT / "specs" / "README.md").read_text()
    for number in reserved:
        assert re.search(rf"\| {number} \|.*Reserved", index), f"Missing reservation {number}"
    for lane_id, numbers in ownership["lanes"].items():
        assert numbers and len(numbers) == len(set(numbers)), f"Invalid spec owners: {lane_id}"
        for number in numbers:
            assert number in specs or number in reserved, f"Unknown spec {number} in {lane_id}"
    for req_id, record in ownership["requirements"].items():
        assert record["primary"] in specs, f"Missing primary spec: {req_id}"
        assert record["lane"] in lanes, f"Missing requirement lane: {req_id}"
        assert record["primary"] in ownership["lanes"][record["lane"]], req_id
    for requirement in requirements:
        for number in requirement["public_anchors"]:
            assert number in specs or number in reserved, f"Unknown public anchor {number}"
        assert ownership["requirements"][requirement["id"]]["primary"] in requirement["public_anchors"], requirement["id"]
    for number in ownership["newSpecs"]:
        assert number in specs, f"Missing new spec {number}"
        for name in ("spec.md", "plan.md", "tasks.md"):
            path = specs[number].parent / name
            assert path.is_file() and path.read_text().strip(), f"Missing/empty {path}"
        status = re.search(r"^\*\*Status:\*\* (.+)$", specs[number].read_text(), re.M)
        assert status, f"Missing feature status: {number}"
        feature_status = re.fullmatch(r"(Draft / Planned|In progress|Implemented)(?: — .+)?", status[1])
        assert feature_status, f"Unknown feature status: {number}"
        if feature_status[1] == "Draft / Planned":
            assert "[x]" not in (specs[number].parent / "tasks.md").read_text(), f"Planned feature has completed tasks: {number}"
        assert str(specs[number].relative_to(ROOT / "specs")) in index, number
    edges = set()
    visiting, visited, order = set(), set(), []

    def visit(lane_id):
        assert lane_id not in visiting, f"Cycle at {lane_id}"
        if lane_id in visited:
            return
        visiting.add(lane_id)
        dependencies = lanes[lane_id]["dependsOn"]
        assert len(dependencies) == len(set(dependencies)), f"Duplicate edge: {lane_id}"
        for parent in dependencies:
            assert parent in lanes, f"Unknown prerequisite {parent}"
            edges.add((parent, lane_id))
            visit(parent)
        visiting.remove(lane_id)
        visited.add(lane_id)
        order.append(lane_id)

    for lane_id in lanes:
        visit(lane_id)
    assert_terminal_coverage(lanes, "L24")
    markdown = (ROOT / "docs" / "PRODUCT-COMPLETION.md").read_text()
    diagram = re.search(r"```mermaid\n(.*?)```", markdown, re.S)
    assert diagram, "Missing lane diagram"
    diagram_edges = set(re.findall(r"\b(L\d{2})(?:\[[^\]\n]*\])?\s*-->\s*(L\d{2})", diagram[1]))
    assert edges == diagram_edges, f"Mermaid edge mismatch: {edges ^ diagram_edges}"
    conditional = graph.get("conditionalDependencies", [])
    conditional_edges = {(edge["from"], edge["to"]) for edge in conditional}
    assert len(conditional_edges) == len(conditional), "Duplicate conditional edge"
    assert not conditional_edges & edges, "Conditional edge also unconditional"
    for edge in conditional:
        assert edge["from"] in lanes and edge["to"] in lanes, "Unknown conditional endpoint"
        assert edge.get("when", "").strip(), "Missing dependency condition"
    dashed = set(re.findall(r"\b(L\d{2})\s+-\.\s+[^\n]*?\s+\.->\s*(L\d{2})", diagram[1]))
    assert dashed == conditional_edges, "Conditional Mermaid edge mismatch"
    # Optional slices may be enabled together: their union must also remain acyclic.
    union = edges | conditional_edges
    active, done = set(), set()

    def visit_union(lane_id):
        assert lane_id not in active, f"Conditional cycle at {lane_id}"
        if lane_id in done:
            return
        active.add(lane_id)
        for parent, child in union:
            if child == lane_id:
                visit_union(parent)
        active.remove(lane_id)
        done.add(lane_id)

    for lane_id in lanes:
        visit_union(lane_id)
    validate_gates(graph, lanes, edges, conditional, ownership, specs)
    print(f"Valid: {len(lanes)} lanes, {len(edges)} edges, {len(req_ids)} requirements, "
          f"{len(conditional_edges)} conditional edges, "
          f"{len(ownership['newSpecs'])} new spec triplets; reserved {', '.join(reserved) or 'none'}")
    print("Topological order: " + " -> ".join(order))
    validate_execution(lanes)


if __name__ == "__main__":
    if sys.argv[1:] == ["--write-gate-table"]:
        path = ROOT / "docs" / "PRODUCT-ACCEPTANCE-GATES.md"
        path.write_text(replace_gate_table(path.read_text(), load("product-acceptance-gates.json")))
    else:
        assert not sys.argv[1:], "Usage: validate-completion-specs.py [--write-gate-table]"
        validate()
