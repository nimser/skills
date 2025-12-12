---
name: brave-search
description: Web search and content extraction via Brave Search API. Use for searching documentation, facts, or any web content. Lightweight, no browser required.
---

# Brave Search

Headless web search and content extraction using Brave Search. No browser required.

## Setup

Run once before first use:

```bash
cd {baseDir}/brave-search
npm install
```

## Search

```bash
{baseDir}/search.js "query"                    # Basic search (5 results)
{baseDir}/search.js "query" -n 10              # More results
{baseDir}/search.js "query" --content          # Include page content as markdown
{baseDir}/search.js "query" -n 3 --content     # Combined
```

## Extract Page Content

```bash
{baseDir}/content.js https://example.com/article
```

Fetches a URL and extracts readable content as markdown.

## Output Format

```
--- Result 1 ---
Title: Page Title
Link: https://example.com/page
Snippet: Description from search results
Content: (if --content flag used)
  Markdown content extracted from the page...

--- Result 2 ---
...
```

## Rate Limiting (HTTP 429)

If you get a 429 error, Brave requires a captcha. Open the search in a browser for the user to solve it:

```bash
open "https://search.brave.com/search?q=your+query"
```

After the user solves the captcha, retry the search.

## When to Use

- Searching for documentation or API references
- Looking up facts or current information
- Fetching content from specific URLs
- Any task requiring web search without interactive browsing
