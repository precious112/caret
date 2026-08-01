/**
 * The foundational context every agent must have, in two forms.
 *
 * **JSON for the machine.** Tokens, the page inventory, the flow graph — things
 * the agent looks values up in. Benchmarks put structured context at roughly 80%
 * fewer tokens than the same content as Markdown, with materially fewer
 * hallucinations, and none of it benefits from prose.
 *
 * **Prose for judgment.** The authoring rules are the opposite case: they are
 * conventions with reasons, and an agent that has only seen the shape of a
 * caret-id will still put one inside a `.map()`. That half stays as written
 * English and ships through `get_guide` and the rules files.
 */
import * as path from "path"

import {
	CARET_ID_RULES,
	type FoundationTokens,
	INLINE_EDITING_RULES,
	listFlows,
	listPages,
	readFoundationTokens,
} from "../../../src/core/design"

export interface FoundationContext {
	project: string
	tokens: FoundationTokens | null
	/** Page ids with their states, so an agent can see what already exists. */
	pages: Array<{ id: string; title: string; tags: string[]; states: string[] }>
	flows: Array<{ id: string; name: string; pages: string[] }>
}

export async function buildFoundationContext(projectPath: string): Promise<FoundationContext> {
	const [tokens, pages, flows] = await Promise.all([
		readFoundationTokens(projectPath).catch(() => null),
		listPages(projectPath).catch(() => []),
		listFlows(projectPath).catch(() => []),
	])

	return {
		project: path.basename(projectPath),
		tokens: tokens ?? null,
		pages: pages.map((p) => ({ id: p.id, title: p.title ?? p.id, tags: p.tags ?? [], states: p.states ?? [] })),
		flows: flows
			.filter((f) => !f.invalid)
			.map((f) => ({
				id: f.id,
				name: f.name ?? f.id,
				pages: (f.steps ?? []).map((s) => s.page).filter(Boolean),
			})),
	}
}

/**
 * The prose half: how to author a page here, and why each rule exists.
 *
 * The reasons are load-bearing. "Never put a caret-id inside `.map()`" reads as
 * an arbitrary restriction until you know the id would be duplicated across
 * every row and the editor would mutate the wrong one — and an agent that knows
 * the reason generalises it to cases this text does not list.
 */
export async function buildGuide(projectPath: string): Promise<string> {
	const context = await buildFoundationContext(projectPath)

	return `# Authoring the Caret design layer

You are writing pages into \`.caret/\`, a design layer that lives in this repo under
version control. It is not the shipped app — it is the place designs are worked out
before being synced into the app. Pages here are plain React + Tailwind v4 with no
backend, so anything a page displays it carries as its own sample data.

## Directory structure

\`\`\`
.caret/
├── tokens/foundation.json   foundation tokens (colour, type, spacing, radius)
├── pages/<page-id>/
│   ├── index.tsx            the page component
│   └── meta.json            { id, title, type, states, tags }
├── components/              shared components, hoisted out of pages
├── layouts/                 layout templates
├── flows/*.flow.json        multi-page user flows
└── assets/                  static assets
\`\`\`

## Styling

Tailwind v4 is loaded globally. Do **not** \`@import "tailwindcss"\` in a page or
component — it is already there, and a second import breaks the build.

- Use utility classes for all styling. Never \`style={{}}\` or \`React.CSSProperties\`,
  not even for one-off values: \`style={{ padding: "13px" }}\` becomes \`className="p-[13px]"\`.
  The inline editor reads classes; an inline style is invisible to it.
- No \`@apply\`, no \`@layer\` in component files, no \`tailwind.config\` — v4 has no config file.
- Never build a class name by concatenation (\`\\\`bg-\${color}-500\\\`\`). Tailwind's compiler
  scans for whole class strings and cannot see a constructed one, so the style silently
  never ships. Use a lookup object with full class strings instead.

## Responsive

Prefer one tree that reflows (\`flex-col md:flex-row\`) over separate mobile and desktop
trees. Two trees means every future edit has to be made twice, and one of them will
eventually be missed.

${INLINE_EDITING_RULES}

${CARET_ID_RULES}

## Page metadata

Every page needs a \`meta.json\` beside it. Always give meaningful \`tags\` — the canvas
groups pages by them, and an untagged page lands in "other". Declare the \`states\` a page
has (\`default\`, \`loading\`, \`empty\`, \`error\`) rather than only building the happy path.

## Shared components

Before writing a page, look at \`.caret/components/\`. If a pattern will appear on more
than one page, put it there first and import it (\`../../components/Name\`). Hoisting after
the fact means finding every copy.

## Foundation tokens

${
	context.tokens
		? `This project's tokens are below. Style from these, not from values you pick yourself —
a colour that is close to the brand colour but not it is the single most visible way
generated UI reads as generated.

\`\`\`json
${JSON.stringify(context.tokens, null, 2)}
\`\`\``
		: `This project has no foundation tokens yet. Ask the user to run the foundation
interview in Caret before generating pages — without tokens, every page you write will
have to be re-styled later.`
}

## What already exists

${
	context.pages.length === 0
		? "No pages yet."
		: context.pages.map((p) => `- \`${p.id}\` — ${p.title}${p.tags.length ? ` [${p.tags.join(", ")}]` : ""}`).join("\n")
}

## Do not run the dev server

Caret already runs Vite for this design layer and reloads your changes as you write them.
Do not run \`npm run dev\`, \`vite\`, or any server command inside \`.caret/\` — it will fight
the running one. To see build or runtime errors, read \`.caret/vite.log\`.
`
}
