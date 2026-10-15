# Iwifunni documentation

Start with the repository [`README.md`](../README.md) for what Iwifunni is and how to run
it. Everything below is the durable reference.

## Documents

| Document                                       | Answers                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`architecture.md`](architecture.md)           | What was decided and why — the decision record, and the stable citation target for code comments |
| [`domain-model.md`](domain-model.md)           | What the entities are: the tenancy tree, keys versus ids, lifecycle, tables, audit events        |
| [`authorization.md`](authorization.md)         | Who may do what: roles, the operation matrix, the access gate, tenant isolation                  |
| [`flags.md`](flags.md)                         | How a flag is put together: variations, rules, targets, rollout, versions, dependencies          |
| [`change-requests.md`](change-requests.md)     | Protected environments: proposing a change, who approves it, and how it commits                  |
| [`evaluation.md`](evaluation.md)               | How a variation is decided: resolution order, reasons, operators, bucketing, `/v1/evaluate`      |
| [`api-conventions.md`](api-conventions.md)     | The wire contract: schemas, routes, errors, pagination, naming, versioning                       |
| [`authentication.md`](authentication.md)       | Identity and credentials: sessions, workspaces, email codes, OAuth, API keys                     |
| [`testing.md`](testing.md)                     | How the API suite runs, its database, its isolation strategy and what it is expected to cover    |
| [`development.md`](development.md)             | Local setup: prerequisites, ports, env files, migrations, commands, health and operations        |

The dashboard keeps its own document at [`apps/web/README.md`](../apps/web/README.md),
covering its routes, components, design tokens and the screens that are not yet API-backed.

## Rules for these documents

1. **One fact, one place.** When a subject is documented somewhere, every other document
   links to it rather than restating it. The three subjects that most want to duplicate are
   flag scoping, the evaluation order and the "what is not built" list.
2. **Cite decisions by number.** `docs/architecture.md` section numbers are a stable
   contract: source comments reference them as `docs/architecture.md §N`. Sections are
   never renumbered and never reused — a new decision appends.
3. **Every claim is checkable.** A table name, route path, environment variable, audit
   action or script must be readable in the source. If it cannot be verified, it does not
   belong in the docs.
4. **Status is stated per subject.** Each document ends with `## Status`, so a reader
   learns what exists, what is partial and what is not built without leaving the subject
   they are reading.
5. **Comments do not restate documents.** Code comments point at a document; they do not
   copy it. See `.agents/skills/comments/skill.md`.

## Where new material goes

| Kind of fact                                    | Home                                     |
| ----------------------------------------------- | ---------------------------------------- |
| A durable decision and its rationale            | `architecture.md`, as a new section      |
| A reference table about a subsystem             | That subsystem's document                |
| How to run, configure or operate something      | `development.md`                         |
| How to verify something                         | `testing.md`                             |
| A dashboard screen, route or component          | `apps/web/README.md`                     |
| The shape of a wire value                       | `packages/contracts` — not a document    |
