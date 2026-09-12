# Caret

**Caret puts a design canvas over your real code.**

You see your app as pages on a canvas. You click something and change it. The
change is written straight into your source files, because the canvas was never
a picture of your app. It was your app all along.

https://github.com/user-attachments/assets/93e273d4-aed3-45cd-bb5e-c5b587691017

Caret is a free desktop app for macOS, Windows and Linux. There is no account
and no key needed to open it and start designing.

- **[Download the latest release](https://github.com/precious112/caret/releases)**
- [caretai.cloud](https://caretai.cloud)

## Why another design tool

Most AI design tools only get one shot. The AI builds you a screen, you look at
it, you fix the same three things by hand, and next time it makes those same
three mistakes again. Tools like v0, Lovable, Bolt and Replit start from nothing
every time, so every correction you made disappears.

Caret keeps your design work in your repo, as files, in git. Fix something once
and it stays fixed, because the fix is a file that is still there tomorrow.

## How it works

Caret splits the front end of your project into two layers that live in the same
repo.

**The design layer** sits in a folder called `.caret/`. It holds real React
pages, shared components, and your design tokens (your colours, your type, your
spacing). This is your workshop. It is where you try things out.

**Your app layer** is the thing you actually ship. It can be built with anything:
Next.js, Svelte, Vue, plain HTML. Caret has no opinion about it.

You design in the first one, then sync into the second one. Keeping them apart is
what makes everything below possible. Caret knows exactly how the design layer is
shaped, so it can render it, let you click it, and translate it, no matter what
your shipped app is written in.

## A live canvas

Every page in your design layer is rendered on a canvas you can zoom and pan.
These are not screenshots. Click a page and it becomes live, so you can hover
things, open menus and type into forms. You can switch between desktop, tablet
and phone sizes to check that a page holds up.

![Pages appearing on the Caret canvas, then the view pulling back to show the whole set](assets/docs/canvas.gif)

## Change what you can see

Right-click any piece of text, any colour, or any image and change it there and
then. No panel to hunt through, no properties sidebar. You edit the thing you
were already looking at.

Caret writes the change into the real source file and the page reloads on its own.

![Editing a headline directly on the page, and Caret confirming the edit landed in the file](assets/docs/edit-text.gif)

Colours work the same way, with one extra step that saves a lot of mess. When you
pick a colour, Caret checks whether it is close to one of your design tokens. If
it is, it uses the token instead of pasting a raw hex code in. That way changing
your brand colour later changes every place that used it.

![Picking a colour on the page, and Caret matching it to the brand token](assets/docs/edit-colour.gif)

Some changes are too fiddly to click your way through. For those, paint over the
part of the page you mean and say what you want in plain words. Your agent gets
the exact elements you marked, so it does not have to guess which bit of the page
you were talking about.

![Painting over a section of a page and describing a change in words, then the rebuilt section](assets/docs/describe-a-change.gif)

## Make the pictures too

A design is not only layout. It needs a logo, a background, a photograph of the
thing you are selling. Caret can make those from a sentence, in the app, and put
them in your project.

You say what the thing is. Caret decides how it is lit, framed and coloured, based
on the design tokens you already set, so what comes out matches the rest of your
work. You get several versions to choose from, and you can ask for changes to the
one you picked.

![Asking for a logo in one sentence and getting several versions to choose from](assets/docs/generate-asset.gif)

It covers four kinds of thing: photographs and images, repeating textures and
patterns, logos and marks (drawn as real vector files), and animated backgrounds
written as code so the colours stay adjustable afterwards.

## Keeping your app in step

When your design changes, Caret works out exactly which design files moved since
the last time you synced. It hands your agent that list, then the agent reads
your current design and your current app code and makes the app match.

It also works the other way. If somebody edits the app directly, the design layer
is now telling a lie about that page. Caret spots this by comparing file contents,
and offers to bring the design back in line. You see the app's version and your
design's version side by side and pick one. Caret never quietly merges them for
you.

Before a sync starts, Caret takes a snapshot, so "undo sync" always works.

## Your agent already knows your rules

Caret writes your design tokens into `AGENTS.md`, `CLAUDE.md` and
`.cursor/rules`, and keeps them up to date.

This matters more than it sounds. An AI told to "build me a card" that has to
*decide* to go and look up your spacing scale will not bother. It will invent
something from whatever it saw during training. Putting your colours, type and
spacing in front of it every session is the difference between a card that fits
your app and a card that does not.

Caret also watches the `.caret/` folder. Your agent will edit those files with its
own tools rather than Caret's, which is fine. Caret checks and fixes up whatever
turns up in there, whoever wrote it.

## Bringing your own model

Caret drives a coding agent for the work you start inside it: an AI edit, the
paint-and-describe editor, a sync, the foundation interview.

It comes with OpenCode's engine built in, and connects to whichever provider you
want. That can be an API key you pay per use, or a subscription you already have.
ChatGPT Plus, Pro and Go, Kimi For Coding, the Z.AI and Zhipu coding plans and
GitHub Copilot all work as providers you sign into.

Anthropic's models are the one exception. They are available by API key, not by
subscription, because Anthropic does not allow Claude subscriptions to be used
outside its own apps.

## Using Caret from your own terminal

If you already work with an agent in your terminal, Caret can let it read and
write your design layer. Caret runs a small local server for each open project
and generates the exact config for your client.

Claude Code and Codex are both tested and working. See
[docs/connect-an-agent.md](docs/connect-an-agent.md).

This direction is optional. Nothing in the app needs it. Work you start inside
Caret runs on Caret's own backend instead.

## Longer demos

Two full walkthroughs, if you want to see more than a few seconds at a time.

**Visual editing**: changing text, colours and images, resizing by hand, and
describing a change in words.

https://github.com/user-attachments/assets/2fb6a9f4-f000-423c-8b9c-d70a81422bc6

**Making assets**: a logo, an animated background, and a photograph, each from a
sentence.

https://github.com/user-attachments/assets/99115f37-797a-454c-978a-421c6dace536

## Building from source

You need Node 20 or newer.

```bash
npm install
npm run dev       # run it in development
npm run build     # build it
npm run package   # make an installer for your platform
```

To run the tests:

```bash
npm run test:unit             # unit tests
npm run verify:design-shell   # checks the generated canvas
npm run verify:app            # drives the whole app end to end
```

## Licence

Apache-2.0.

The editor is free forever and works on your machine. No key, no account. The
only thing Caret ever sends anywhere is anonymous usage and crash data, and one
click turns that off. [docs/telemetry.md](docs/telemetry.md) lists exactly what
is collected and what never is.

Caret began as a fork of [Cline](https://github.com/cline/cline), which is also
Apache-2.0.
