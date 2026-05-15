# Social Media Content Manager

A Squad sample that takes a content theme or product description and generates platform-optimized social media posts for Twitter, LinkedIn, and Instagram — complete with timing recommendations and engagement monitoring strategies.

## How It Works

1. You provide a content theme (product launch, weekly content topic, company update, etc.) either by typing it or loading from a content brief file
2. Four AI agents collaborate to create a complete content package:
   - **Content Creator** — generates 3 distinct post concepts with hooks and CTAs
   - **Platform Optimizer** — adapts each concept for Twitter, LinkedIn, and Instagram with native formatting and hashtags
   - **Timing Strategist** — recommends optimal posting windows for maximum reach
   - **Engagement Monitor** — defines monitoring strategies and response templates
3. Get copy-paste ready content for your scheduling tools (Buffer, Hootsuite, etc.)

## Prerequisites

- Node.js ≥ 20
- GitHub Copilot CLI installed and authenticated

## Setup

```bash
npm install
```

## Usage

```bash
npm start
```

You'll be prompted to either:
- Type a content theme directly
- Provide a filename to load a content brief (e.g., `content-briefs/product-launch.md`)

Two sample briefs are included:
- `content-briefs/product-launch.md` — AI-powered code review tool launch
- `content-briefs/weekly-tech-content.md` — Cloud infrastructure best practices

## Example Input

```
Launching an AI-powered code review tool for developers — emphasize time savings and code quality improvements.
```

## Example Output

The squad will deliver:
- **3 post concepts** with different angles (problem-focused, solution-focused, social proof)
- **Platform-specific versions** for each concept:
  - Twitter: 280-char punchy versions with 1-2 hashtags
  - LinkedIn: 300-500 word professional posts with discussion prompts
  - Instagram: Caption + 10-15 hashtags optimized for visual storytelling
- **Timing recommendations**: Best days/times to post on each platform with rationale
- **Engagement playbook**: What to monitor, response templates, escalation triggers

## Extending This Sample

This is a content generation tool. You could extend it to:
- **Post automatically**: Integrate Twitter, LinkedIn, Instagram APIs to publish directly
- **Schedule in tools**: Connect to Buffer, Hootsuite, or Later APIs
- **Track performance**: Pull analytics and feed back to optimize future content
- **Generate visuals**: Add DALL-E or Midjourney prompts for each post
- **A/B test**: Generate variations and automatically post winner based on early engagement
- **Content calendar**: Generate a month's worth of posts from a brief

The Squad SDK makes it easy to add tools that take real action — see the suggestions at the end of each run.

## Notes

- Content is **generated, not posted** — you review and schedule via your preferred tools
- The agents understand platform algorithms and best practices as of 2024
- Timing recommendations assume US-focused audiences by default but can be customized
- This demo shows the power of multi-agent collaboration: each specialist focuses on their domain, delivering better results than a single generalist agent
