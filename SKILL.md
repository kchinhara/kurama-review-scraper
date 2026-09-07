---
name: kurama-review-scraper
description: Zero-cost Google Maps review scraper using Playwright. Scrapes reviews with a real Chromium browser - no API keys, no proxies, no per-scrape costs. Outputs raw JSON, structured data with statistics, CSV, and a branded HTML report.
metadata:
  version: 1.0.0
---

# Kurama Review Scraper

Zero-cost Google Maps review intelligence using a real Chromium browser via Playwright. No API keys, no proxies, no per-scrape costs.

Replaces paid SerpAPI + ValueSERP review scraping with a free, browser-based approach. Same anti-detection stack as kurama-susanoo-serp (persistent profile, stealth plugin, human-like behavior).

## Quick Start

```bash
# Install dependencies (first time only)
cd .claude/skills/kurama-review-scraper && npm install

# Scrape reviews
node scripts/scrape-reviews.cjs my-client --business "Business Name"

# With options
node scripts/scrape-reviews.cjs my-client \
  --business "CrossFit North London" \
  --location "London, UK" \
  --reviews 100 \
  --sort newest
```

## Triggers

- "scrape Google reviews for [business]"
- "get reviews for [business] from Google Maps"
- "review intelligence for [client]"
- "Google Maps reviews [business name]"
- "scrape reviews [client] [business]"

## Quick Reference

| Flag | Description | Default |
|------|-------------|---------|
| `<client-name>` | Client directory name (required, positional) | - |
| `--business "Name"` | Business to search on Google Maps (required) | - |
| `--location "City, Country"` | Location context for search | none |
| `--reviews N` | Number of reviews to scrape | 50 |
| `--sort type` | Sort: relevant, newest, highest, lowest | relevant |
| `--no-expand` | Skip expanding truncated review text | expand all |
| `--debug` | Save screenshots + HTML for troubleshooting | off |
| `--headless` | Run headless (less reliable) | off |
| `--root path` | Override output root directory | clients/ |
| `--dry-run` | Preview settings without scraping | off |

## How It Works

```
1. Launch Chromium (persistent profile + stealth)
2. Navigate to Google Maps (homepage-first pattern)
3. Handle cookie consent if present
4. Type business name (char-by-char, human-like)
5. Select correct business from results
6. Extract business metadata (name, rating, address, category)
7. Click Reviews tab
8. Set sort order (if specified)
9. Infinite scroll to load target number of reviews
10. Click "More" buttons to expand truncated text
11. Extract all review data from DOM
12. Save: raw JSON + structured JSON + CSV + HTML report
```

## Output Files

Saved to the repo-level `clients/{client}/reviews/{date}/` (kurama-os convention). Use `--root <path>` to override.

| File | Contents |
|------|----------|
| `raw_reviews_{biz}_{date}.json` | Every review as scraped (array) |
| `review_data_{biz}_{date}.json` | Structured data with statistics, themes, highlights |
| `reviews_{biz}_{date}.csv` | Flat CSV for spreadsheet analysis |
| `review_report_{biz}_{date}.html` | Branded HTML report with filtering |

### Structured Data Includes
- **Business info**: name, address, rating, category, phone, total reviews
- **Rating distribution**: count per star (1-5)
- **Sentiment analysis**: positive/negative/neutral counts
- **Theme detection**: 8 themes (Customer Service, Value, Quality, Speed, Cleanliness, Location, Communication, Professionalism)
- **Owner response rate**: % of reviews with responses
- **Top positive reviews**: highest rated + most helpful
- **Top concerns**: lowest rated reviews to address
- **Local Guide stats**: count + percentage of Local Guide reviewers

## Anti-Detection

Same battle-tested stack as kurama-susanoo-serp:
- Persistent Chrome profile (`.playwright-profile/`) for cookie/trust accumulation
- Stealth plugin (navigator.webdriver removal, WebGL spoofing, etc.)
- Character-by-character typing with random delays (50-150ms)
- Random mouse movements between actions
- Human-like scroll patterns with variable pauses
- Fresh profile warmup (3 casual searches to build trust)
- User-Agent rotation (6 real Chrome UAs)
- `--disable-blink-features=AutomationControlled` flag

## No Proxy Required

Unlike ad scraping (where Google uses real IP for ad auction geo-targeting), **Google Maps reviews are the same content regardless of your IP**. No proxy, no VPN, no IPRoyal needed.

## Selector Strategy

Google Maps changes its DOM frequently. The scraper uses a multi-fallback approach:
1. **Semantic selectors first** (aria-labels, roles, data attributes)
2. **Class-based fallback** (current Google Maps classes)
3. **Structural fallback** (find star ratings, walk up to containers)

All selectors are defined in `config.js` and can be updated without touching the scraper code. Run with `--debug` to save HTML snapshots when extraction fails.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| CAPTCHA detected | Rate limited or flagged profile | Wait 24h. Delete `.playwright-profile/` if persistent |
| 0 reviews loaded | Reviews tab didn't open or layout changed | Run with `--debug`, check HTML snapshots |
| Reviews loaded but extraction fails | Selectors outdated | Update selectors in `config.js` |
| Browser crash | Profile corrupted | Delete `.playwright-profile/` |
| Wrong business selected | Ambiguous search query | Add `--location` for specificity |

## Configuration

Edit `config.js` to customize:
- **Selectors**: All Google Maps DOM selectors (update when layout changes)
- **Delays**: Typing speed, scroll pauses, click delays
- **User Agents**: Chrome UA rotation pool
- **Sentiment keywords**: Positive/negative word lists for analysis
- **Theme patterns**: Review themes with keywords and colors
- **Defaults**: Target reviews, sort order, expand behavior

## Architecture

```
kurama-review-scraper/
├── SKILL.md              # This file
├── config.js             # All configuration + selectors
├── package.json          # Dependencies
├── .gitignore
├── scripts/
│   └── scrape-reviews.cjs    # Main scraper (CLI entry point)
├── templates/            # (reserved for future report templates)
├── images/               # Logo and branding assets
├── clients/              # Output directory (gitignored)
│   └── {client}/
│       └── reviews/
│           └── {date}/
│               ├── raw_reviews_*.json
│               ├── review_data_*.json
│               ├── reviews_*.csv
│               └── review_report_*.html
└── .playwright-profile/  # Persistent browser profile (gitignored)
```

## Comparison with Paid Approach

| | googleScraper.js (old) | kurama-review-scraper |
|---|---|---|
| **Cost** | SerpAPI ($50+/mo) + ValueSERP ($50+/mo) | Free |
| **API keys** | 2 required | None |
| **Proxy** | Not needed | Not needed |
| **Rate limits** | API credit limits | Browser session limits (~200/day) |
| **Data richness** | Standard API fields | Full DOM extraction (images, local guide, likes) |
| **Report** | None (raw data only) | Branded HTML with themes + filtering |
| **Reliability** | API uptime | Depends on Google Maps layout stability |

## Best Practices

- **1-2 sessions per day max** - More risks profile flagging
- **50-100 reviews per session** is the sweet spot
- **Keep the profile** - Don't delete `.playwright-profile/` unless you have to
- **Use `--debug` first time** - Verify selectors work before bulk scraping
- **Non-headless is more reliable** - Only use `--headless` when you must (e.g., CI)
