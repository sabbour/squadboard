# Content Creation Workflow — Squad Edition

A Squad sample that takes a **blog topic** and produces a polished, SEO-optimized article through a four-agent content pipeline: research → outline → write → edit.

## How It Works

1. You provide a topic — type it interactively or load from a file
2. Four AI agents collaborate in sequence:
   - **Researcher** — gathers facts, statistics, expert perspectives, and fresh angles
   - **Outliner** — designs the structural blueprint: sections, narrative arc, word counts
   - **Writer** — drafts the complete article with consistent voice and engagement
   - **Editor** — polishes grammar, tone, and flow, then optimizes for SEO
3. You get a publish-ready blog post with title, meta description, and optimized structure

What would normally take 4+ hours is delivered in under 30 minutes.

## Prerequisites

- Node.js ≥ 20
- GitHub Copilot CLI installed and authenticated

## Setup

```bash
npm install
```

## Usage

### Interactive mode — type your topic

```bash
npm start
```

You'll be prompted to enter a blog topic. Type anything:
> "The rise of AI-powered developer tools in 2026"

### File mode — load a topic brief

```bash
npm start -- content-topics/technical-blog-post.md
npm start -- content-topics/product-launch.md
```

Topic files can include detailed briefs with target audience, tone, angles to cover, and word count targets. Two sample files are included to get you started.

## Sample Topics Included

| File | Description |
|------|-------------|
| `content-topics/technical-blog-post.md` | Technical blog about building multi-agent AI systems with TypeScript |
| `content-topics/product-launch.md` | Product launch announcement for an AI code review tool |

## What You Get

The squad produces a complete article including:
- **Optimized title** — keyword-aware, click-worthy
- **Meta description** — 150-160 characters for search engines
- **Full article** — with proper H2/H3 hierarchy, code examples, and engagement hooks
- **SEO notes** — primary keywords, readability score, internal linking suggestions

## Extending This Sample

- 📱 **Social snippets** — add an agent that generates Twitter/LinkedIn posts from the article
- 📅 **Content calendar** — batch-produce posts on a schedule
- ✅ **Fact-checker** — add an agent that verifies claims before publishing
- 🌐 **CMS integration** — connect to WordPress, Ghost, or Medium APIs to publish directly
- 🎨 **Image suggestions** — add an agent that recommends hero images and diagrams

## Architecture

```
Topic Input → Researcher → Outliner → Writer → Editor → Published Article
                 ↓             ↓          ↓         ↓
              Facts &      Structure   Full      Polished +
              angles       blueprint   draft     SEO-ready
```

The squad uses `@bradygaster/squad-sdk` to coordinate agents through GitHub Copilot. Each agent has a detailed charter defining its expertise, output format, and boundaries — ensuring clean collaboration without overlap.
