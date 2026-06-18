/**
 * Single source of truth for the caret-id / inline-editing authoring rules.
 *
 * The visual overlay editor locates elements in `.caret/` page source by a
 * **unique static** `data-caret-id` string literal (AST match), so these rules
 * are hard requirements, not style preferences. The same text is embedded in
 * BOTH the always-on design-mode system prompt (`design_layer.ts`) and the
 * on-demand `/debug-ui-page` healing command (`commands.ts`) so the rules the AI
 * is told up front can never drift from the rules it's told to enforce when
 * remediating. Keep it as plain markdown (no template interpolation) so it can be
 * embedded verbatim in either place.
 */
export const CARET_ID_RULES = `### Element Identification

Add a \`data-caret-id\` attribute to every visible element (headings, paragraphs, buttons, images, spans, links, inputs). The inline editor uses these IDs to locate the exact element in source code, so they have two HARD requirements:

1. **Static string literal — never an expression.** Write \`data-caret-id="hero-title"\`. NEVER use a variable, template literal, ternary, or any {...} expression. For example, these are all WRONG: data-caret-id={\`item-\${i}\`}, data-caret-id={someId}, data-caret-id={cond ? "a" : "b"}. The editor matches string literals only; a dynamic id is invisible to it and breaks inline editing.
2. **Unique within the page file.** Every element gets a DIFFERENT id. Never reuse or copy/paste the same id onto two elements — duplicate ids make the editor mutate the wrong element.

Use short descriptive kebab-case IDs:

\`\`\`tsx
<h1 data-caret-id="hero-title" className="text-6xl font-bold text-white">Welcome</h1>
<p data-caret-id="hero-subtitle" className="mt-4 text-lg text-zinc-400">Get started today</p>
<img data-caret-id="hero-image" src="https://placehold.co/600x300" alt="Featured" className="rounded-xl" />
<button data-caret-id="hero-cta" className="mt-8 bg-white text-zinc-950 px-8 py-3">Shop Now</button>
\`\`\`

**Do NOT put \`data-caret-id\` on elements inside \`.map()\`, \`.forEach()\`, or other array iteration callbacks.** They render multiple times, so a single id would be duplicated across every row. The visual editor handles array-rendered content through AI Edit, not inline editing. Never use a loop index/variable to "make the id unique" — just omit the id entirely inside iterators.

These rules apply equally to framer-motion visible elements (\`motion.h2\`, \`motion.p\`, \`motion.button\`, etc.), which forward \`data-caret-id\` to the DOM. When threading an id into a shared component, pass a static literal (\`<Card dataCaretId="pricing-card" />\`), never an interpolated expression.

When nesting inline elements (e.g. a span inside a heading), add a unique \`data-caret-id\` to both the parent and each child:

\`\`\`tsx
<h1 data-caret-id="hero-title">Defy <span data-caret-id="hero-accent">Limits</span></h1>
\`\`\`

### JSX Formatting
Place each visible element's opening tag on its own line — the editor also locates elements by source line number:

\`\`\`tsx
<section className="py-16">
  <h1 data-caret-id="section-title" className="text-4xl font-bold text-white">Welcome</h1>
  <p data-caret-id="section-subtitle" className="mt-4 text-lg text-zinc-400">Subtitle here</p>
</section>
\`\`\``
