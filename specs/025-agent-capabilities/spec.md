# Agent capabilities: cache, metrics, tool control, skills and plugins

**Status:** In progress (2026-10-26)
**Number:** 025
**Depends on:** [024](../024-agent-tool-parity/spec.md) tool parity, [022](../022-provider-compatibility/spec.md) providers.

## Why

Three separate things are missing from the writing agent, and a fourth is missing from the app
around it.

1. **The prompt is re-sent whole every turn.** The system prompt and the tool definitions are
   stable across a conversation, but nothing tells the provider to cache them, so every turn pays
   for the same prefix. The author cannot see whether the cache is helping.
2. **Nothing says which tools work.** A tool that always fails looks the same as one that succeeds.
3. **The author cannot turn a tool off.** Some books want no destructive tools at all, and a
   third-party agent should not be able to reach a tool the author has withdrawn.
4. **The agent is the app's agent, not the author's.** There is no way to teach it a house style, and
   no way to add a tool of your own.

The fourth is the one that matters most, and it is the one that must not become a hole. A plugin
that runs TypeScript is code the author chose to run, so the rules are: it runs in the app's own
process, it never sees a key, and it is visible.

## Deliverables

| Artefact | Requirement |
| --- | --- |
| Cache prefix | A stable, cacheable prefix on the agent's request, with the hit rate shown |
| Metrics | Per-tool calls, successes, failures and rate, per book |
| Tool control | The author can enable or disable each built-in tool, per book |
| Skills | An optional `SKILLS.md` in the book folder that shapes the agent's behaviour |
| Plugins | A folder of TypeScript tools the author points at, loaded into the agent |

## Requirements

- **FR-001** The agent's request MUST mark a stable prefix as cacheable where the provider supports
  it. The prefix is the system instructions and the tool definitions, which do not change between
  turns of one conversation.
- **FR-002** The app MUST show the cache hit rate for a book: the share of input tokens served from
  the provider's cache, and the number of turns that hit it at all. A provider that does not report
  a cache MUST be shown as "not reported", never as a rate of zero.
- **FR-003** The app MUST record, per book and per tool, how many times the agent called it, how
  many succeeded and how many failed.
- **FR-004** The author MUST be able to disable any built-in tool for a book. A disabled tool MUST
  not be offered to the model, and MUST NOT be reachable through the loopback backend or the MCP
  server.
- **FR-005** A book MAY contain a `SKILLS.md` file. When it does, its content MUST be given to the
  agent as the author's own instructions, clearly separated from the untrusted book content.
- **FR-006** `SKILLS.md` MUST be treated as author instructions, not as data. It is the author's own
  file in their own library.
- **FR-007** The author MUST be able to point the app at a folder of TypeScript tools. Each file
  MUST export one or more tools. They MUST be loaded into the agent's tool set.
- **FR-008** A plugin tool MUST NOT be able to read a provider key, a credential file or the user's
  home directory through the app. The app MUST NOT pass its internals to a plugin.
- **FR-009** A plugin MUST be able to read and write the open book, through the same library the
  built-in tools use, so the atomic write and version guard still apply.
- **FR-010** A plugin that fails to load MUST NOT break the turn. The failure MUST be reported, and
  the rest of the tools MUST still work.
- **FR-011** The plugin folder MUST be empty when the app starts. Nothing is loaded until the author
  points at one.
- **FR-012** The cache prefix, the metrics, the disabled tools and the skills file MUST be per
  book, so two books in one library can differ. The plugin folder is a library-level setting
  (D-150), so a copied book never carries a path to someone's home directory.
- **FR-013** The toolkit's MCP server MUST respect the disabled tools of the book it is working on.
- **FR-014** A plugin file MUST be loadable without the app's own packages being resolvable from
  the plugin's folder. The tool's arguments MUST therefore be expressible as a JSON Schema, which
  needs no import. A Zod schema is accepted as well.
- **FR-015** A plugin tool MUST NOT be able to shadow a built-in tool. When the names collide, the
  built-in tool wins and the plugin's tool is not offered.

## Non-goals

- A hosted plugin registry, a marketplace or a downloader.
- A plugin that runs in a separate process, or a sandboxed one. The first version runs in the app's
  process, and says so.
- Network access for a plugin beyond what the app already does.
- Making the app's agent a general-purpose coding agent.
- Changing the built-in tools' behaviour.

## Acceptance scenarios

1. **Cache.** A second turn in the same conversation reports a cache hit rate above zero when the
   provider supports caching, and the app shows it.
2. **Metrics.** After a turn that called `append_to_chapter` once and `read_story_bible` once, the
   app shows one call and one success for each, and the failure count for a tool that failed.
3. **Disable.** With `replace_in_chapter` disabled, the agent is never offered it, and the toolkit's
   `tools/call` for it is refused.
4. **Skills.** A book with a `SKILLS.md` gets its instructions applied, and the app shows that the
   book has skills.
5. **Plugin.** A folder with one TypeScript tool is loaded, the agent calls it, and it can append a
   passage to the chapter.
6. **A broken plugin.** A folder with a file that throws on import still leaves the built-in tools
   working, and the failure is shown.

## Open decisions

- **D-147** The cache prefix is marked with the provider's own cache option where one exists
  (Anthropic's `cacheControl`), and is otherwise a no-op. The app reports the hit rate the provider
  reports, and says "not reported" when the provider does not report it. Accepted.
- **D-148** The plugin API is a small, explicit surface: a tool declares a name, a description, a
  schema and a handler, and receives the library and the book id. It receives nothing else.
  Accepted.
- **D-149** Plugins run in the main process, in the app's own Node runtime. Accepted for this
  release: the alternative is a separate process with a protocol, which is a much larger change.
  The app must say so plainly wherever the author enables plugins.
- **D-150** The plugin folder is a library-level setting, not a per-book one, because it points at
  code on the author's disk. The tools it provides are still filtered per book by the disabled list.
  Accepted.
- **D-151** `SKILLS.md` lives in the book folder and is part of the book, so it travels with it.
  Accepted.
- **D-152** A plugin's arguments are a JSON Schema, or a Zod schema when the plugin's own folder can
  resolve it. Accepted: a plugin folder usually sits outside the app, where the app's own `zod`
  cannot be resolved, so a plugin that needed an import would simply fail to load. The JSON Schema
  form needs no import at all. Accepted.
- **D-153** The cache marker goes on the system message and on the last tool definition only.
  Accepted: a provider caches the tool block as one prefix, and it allows few breakpoints, so
  marking every tool would waste them.
