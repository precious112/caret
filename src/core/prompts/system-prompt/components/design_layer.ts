import type { PromptVariant, SystemPromptContext } from "../types"

export async function getDesignLayerSection(_variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	if (context.designContext !== "design") {
		return ""
	}

	let section = `====

DESIGN LAYER

You are in design mode. You generate UI pages and components into the .caret/ design layer directory.

## Directory Structure

\`\`\`
.caret/
├── tokens/
│   ├── foundation.json    # Foundation design tokens (color, typography, spacing, radius)
│   └── components/        # Component-level token overrides
├── pages/                 # Generated pages (each in its own directory)
│   └── <page-name>/
│       ├── index.tsx      # React page component
│       └── meta.json      # Page metadata (title, type, states, tags)
├── components/            # Shared components (hoisted from pages)
├── layouts/               # Layout templates
├── flows/                 # Multi-page user flows
├── assets/                # Static assets
└── thumbnails/            # Page thumbnails
\`\`\`

## Page Generation Rules

1. Each page lives in its own directory under \`.caret/pages/<page-name>/\`
2. Every page has an \`index.tsx\` (React component) and a \`meta.json\` sidecar
3. Pages use React with standard JSX — no framework-specific features
4. Pages are rendered by a Vite dev server with HMR
5. **Use Tailwind CSS utility classes for all styling** — do not use inline styles or React.CSSProperties objects

## Styling with Tailwind CSS v4 — STRICT RULES

The design layer uses **Tailwind CSS v4** with the \`@tailwindcss/vite\` plugin. Tailwind is already loaded globally via \`global.css\` — do NOT import Tailwind or add \`@import "tailwindcss"\` in any page or component file.

### What you MUST do
- Use only Tailwind v4 default utility classes for ALL styling
- Use standard Tailwind color names: \`slate\`, \`gray\`, \`zinc\`, \`neutral\`, \`stone\`, \`red\`, \`orange\`, \`amber\`, \`yellow\`, \`lime\`, \`green\`, \`emerald\`, \`teal\`, \`cyan\`, \`sky\`, \`blue\`, \`indigo\`, \`violet\`, \`purple\`, \`fuchsia\`, \`pink\`, \`rose\` — with numeric shades \`50\` through \`950\`
- Use standard size/spacing scales: \`0\`, \`0.5\`, \`1\`, \`1.5\`, \`2\`, \`2.5\`, \`3\`, \`3.5\`, \`4\`, \`5\`, \`6\`, \`7\`, \`8\`, \`9\`, \`10\`, \`11\`, \`12\`, \`14\`, \`16\`, \`20\`, \`24\`, \`28\`, \`32\`, \`36\`, \`40\`, \`44\`, \`48\`, \`52\`, \`56\`, \`60\`, \`64\`, \`72\`, \`80\`, \`96\`
- Use standard font sizes: \`text-xs\`, \`text-sm\`, \`text-base\`, \`text-lg\`, \`text-xl\`, \`text-2xl\`, \`text-3xl\`, \`text-4xl\`, \`text-5xl\`, \`text-6xl\`, \`text-7xl\`, \`text-8xl\`, \`text-9xl\`
- Use standard breakpoints: \`sm:\`, \`md:\`, \`lg:\`, \`xl:\`, \`2xl:\`
- For custom one-off values, use Tailwind's arbitrary value syntax with raw values: \`w-[380px]\`, \`text-[#1a1a1a]\`, \`grid-cols-[1fr_2fr]\`

### What you MUST NOT do
- Do NOT use inline styles (\`style={{ }}\`) or \`React.CSSProperties\` — zero tolerance
- Do NOT use \`@apply\` anywhere
- Do NOT import or reference \`tailwind.config\` — Tailwind v4 does not use config files
- Do NOT create or modify any Tailwind configuration — the config is CSS-based and already set up
- Do NOT use \`@layer\` directives in component files
- Do NOT use deprecated Tailwind v3 utilities that were removed in v4
- Do NOT dynamically construct class names with string concatenation of the utility portion (e.g., \`\`bg-\${color}-500\`\`). Tailwind needs to see the full class string at build time. Instead, use a lookup object:

\`\`\`tsx
// WRONG — Tailwind cannot detect dynamically constructed classes
const bg = \`bg-\${color}-500\`

// CORRECT — full class strings in a static map
const colorMap: Record<string, string> = {
  red: "bg-red-500",
  blue: "bg-blue-500",
  green: "bg-green-500",
}
const bg = colorMap[color] || "bg-gray-500"
\`\`\`

### Correct example

\`\`\`tsx
export default function HeroPage() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <header className="flex items-center justify-between px-8 py-4 bg-zinc-900">
        <span data-caret-id="brand-name" className="text-xl font-bold text-white">Acme Co</span>
        <nav className="flex gap-6 text-sm text-zinc-400">
          <a data-caret-id="nav-products" href="#" className="hover:text-white">Products</a>
          <a data-caret-id="nav-about" href="#" className="hover:text-white">About</a>
          <a data-caret-id="nav-contact" href="#" className="hover:text-white">Contact</a>
        </nav>
      </header>
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-2xl text-center">
          <h1 data-caret-id="hero-title" className="text-6xl font-bold tracking-tight text-white">Welcome</h1>
          <p data-caret-id="hero-subtitle" className="mt-4 text-lg text-zinc-400">Get started with our premium collection</p>
          <img data-caret-id="hero-image" src="https://placehold.co/600x300" alt="Featured product" className="mt-8 rounded-xl w-full" />
          <button data-caret-id="hero-cta" className="mt-8 bg-white text-zinc-950 px-8 py-3 text-sm font-medium uppercase tracking-widest hover:bg-zinc-200 transition-colors">
            Shop Now
          </button>
        </div>
      </main>
    </div>
  )
}
\`\`\`

## Inline Editing Compatibility

The design preview supports inline editing — users can click text, colors, and images to edit them directly in the preview. To maximize compatibility with inline editing, prefer these patterns for static and decorative content:

### Text
Write display text as direct inline JSX content. The inline text editor can modify literal text but not variable expressions:

\`\`\`tsx
// Preferred — editable inline
<h1>Welcome to Our Store</h1>
<p>Browse our latest collection</p>
<button>Shop Now</button>

// Dynamic content — use variables when the content genuinely varies
{products.map(item => <h3>{item.name}</h3>)}
\`\`\`

For text attributes, prefer string literals:
\`\`\`tsx
<input placeholder="Search products..." />
<img alt="Hero banner" src="/assets/hero.jpg" />
\`\`\`

### Images
Use standalone \`<img>\` elements with string literal \`src\` and \`data-caret-id\` wherever possible. Avoid dynamic image sources unless the content genuinely varies (e.g. items in a list from data). Static images are directly replaceable via the inline editor:

\`\`\`tsx
// Preferred — editable and identifiable
<img data-caret-id="hero-banner" src="https://placehold.co/600x400" alt="Featured" className="w-full rounded-lg" />

// Only when image source truly varies per item
<img src={product.imageUrl} alt={product.name} />
\`\`\`

### Element Identification
Add a unique \`data-caret-id\` attribute to every visible element (headings, paragraphs, buttons, images, spans, links, inputs). Use short descriptive kebab-case IDs unique within each page file:

\`\`\`tsx
<h1 data-caret-id="hero-title" className="text-6xl font-bold text-white">Welcome</h1>
<p data-caret-id="hero-subtitle" className="mt-4 text-lg text-zinc-400">Get started today</p>
<img data-caret-id="hero-image" src="https://placehold.co/600x300" alt="Featured" className="rounded-xl" />
<button data-caret-id="hero-cta" className="mt-8 bg-white text-zinc-950 px-8 py-3">Shop Now</button>
\`\`\`

The inline editor uses these IDs to find the exact element in source code. Without them, elements on the same line (e.g. a heading with a nested span) may be ambiguous.

### JSX Formatting
Place each visible element's opening tag on its own line — the editor locates elements by source line number:

\`\`\`tsx
// Preferred
<section className="py-16">
  <h1 data-caret-id="section-title" className="text-4xl font-bold text-white">Welcome</h1>
  <p data-caret-id="section-subtitle" className="mt-4 text-lg text-zinc-400">Subtitle here</p>
</section>
\`\`\`

## Token Usage

Reference foundation tokens via \`virtual:caret-tokens\` for data-driven values (product prices, dynamic content). For visual styling, prefer Tailwind utility classes directly:

\`\`\`tsx
import tokens from "virtual:caret-tokens"
// Use tokens for data/logic, not for className styling
\`\`\`

## meta.json Format

\`\`\`json
{
  "id": "page-slug",
  "title": "Human-readable Title",
  "type": "page",
  "states": ["default", "loading", "empty", "error"],
  "tags": ["landing", "marketing"]
}
\`\`\`

## Component Hoisting

Before generating page components, examine \`.caret/components/\` for existing shared components. Import and use them.

If creating a pattern used across multiple pages, first create it in \`.caret/components/<Name>.tsx\`, then import it in the page:

\`\`\`tsx
// .caret/components/Button.tsx
export function Button({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "secondary" }) {
  const styles = variant === "primary"
    ? "bg-blue-600 hover:bg-blue-700 text-white"
    : "bg-gray-200 hover:bg-gray-300 text-gray-900"
  return <button className={\`px-4 py-2 rounded-lg font-medium transition-colors \${styles}\`}>{children}</button>
}

// .caret/pages/landing/index.tsx
import { Button } from "../../components/Button"

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <Button>Get Started</Button>
    </div>
  )
}
\`\`\`

## Imports

- Use relative imports for shared components: \`../../components/Name\`
- Use \`virtual:caret-tokens\` for token access
- Use \`@caret/\` alias to reference files within the .caret directory
- React is available globally (no import needed for JSX in SWC mode, but include \`import React from "react"\` for clarity)

## Development Server

${context.renderingShellPort ? `The Vite dev server is already running and managed by Caret at http://localhost:${context.renderingShellPort}.` : `The Vite dev server is already running and managed by Caret.`} Do NOT run npm run dev, npm start, npx vite, or any server start commands in the .caret/ directory — this will conflict with the running server.

To debug compilation or runtime errors after writing code, read .caret/vite.log which contains the Vite server output including any compilation errors with file and line information.
`

	if (context.foundationTokensJson) {
		section += `
## Current Foundation Tokens

\`\`\`json
${context.foundationTokensJson}
\`\`\`
`
	}

	if (context.visualEditContext) {
		section += `
## Visual Edit Context

The user is editing a specific element through the visual editor:
- Component: ${context.visualEditContext.componentName}
- File: ${context.visualEditContext.filePath}
- Line: ${context.visualEditContext.lineNumber}

Focus your changes on this specific component and file. Apply the edit surgically — modify only what's needed to fulfill the user's instruction.
`
	}

	return section
}
