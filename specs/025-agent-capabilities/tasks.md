# Tasks: agent capabilities

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

## Phase 1 — The settings

- [x] T001 Add the per-book agent settings to the book schema: the disabled built-in tools and
  whether the skills file is used.
- [x] T002 Add the library-level plugin folder to the app settings, outside every book, so a copied
  book never carries a path to someone's home directory.
- [x] T003 Add the plugin contract to `packages/core`, so a plugin author can import it and the
  loader cannot drift from it. The arguments are a JSON Schema or a Zod schema (D-152).

## Phase 2 — The tools

- [x] T004 Apply the disabled list where the tool set is built, so a disabled tool is never offered.
- [x] T005 Apply the same filter in the loopback backend and in the MCP server, so a third-party
  agent cannot reach a withdrawn tool.
- [x] T006 Load a folder of TypeScript tools on demand, report a broken file and carry on, and
  expose the tools to the agent.
- [x] T007 Give a plugin handler only the library and the book id, so it cannot reach a key or the
  app's internals.

## Phase 3 — The prompt

- [x] T008 Read `SKILLS.md` from the book folder and give it a named, bounded section in the
  trusted part of the system prompt.
- [x] T009 Mark the system instructions and the tool definitions as the cacheable prefix where the
  provider supports it, and leave the request unchanged where it does not.

## Phase 4 — The numbers

- [x] T010 Record every tool call's outcome per book and summarize it: calls, successes, failures.
- [x] T011 Show the cache hit rate per book, including when the provider does not report it.
- [x] T012 Show the tool metrics and the cache rate in the app, and add the settings controls.

## Phase 5 — Proof and documentation

- [x] T013 Test the settings, the filter, the skills file, the plugin loader and the metrics.
- [x] T014 Document the plugin contract, the skills file and the cache behaviour.
- [x] T015 Update the changelog, the specs index and the hackathon plan; verify and push.

## Dependencies

- T001–T015 need no model key and no network.
- A live cache hit rate needs a provider that reports one (Anthropic) and a paid turn. The app
  shows "not reported" until then, which is the honest answer (D-147).
