# Kurama Review Scraper

Zero-cost Google Maps review scraper using a real Chromium browser via [Playwright](https://playwright.dev). No API keys, no proxies, no per-scrape costs.

Built for PPC competitive intelligence - extracts reviews, detects sentiment themes, and generates branded HTML reports ready to share with clients.

## Why This Exists

Paid review APIs (SerpAPI, ValueSERP) cost $50-100+/month and return limited fields. This scraper launches a real browser, behaves like a human, and extracts everything visible on the page - including Local Guide badges, owner responses, review images, and like counts.

| | Paid APIs | Kurama Review Scraper |
|---|---|---|
| **Cost** | $50-100+/mo | Free |
| **API keys** | Required | None |
| **Rate limits** | Credit-based | ~200 reviews/day |
| **Data richness** | Standard fields | Full DOM (images, Local Guide, likes) |
| **Reports** | Raw data only | Branded HTML with themes + filtering |

## Quick Start

```bash
# Install dependencies
npm install

# Scrape reviews for a client
node scripts/scrape-reviews.cjs my-client --business "Business Name"

# With geo-context and review count
node scripts/scrape-reviews.cjs my-client \
  --business "CrossFit North London" \
  --location "London, UK" \
  --reviews 100 \
  --sort newest
```

## CLI Options

| Flag | Description | Default |
|------|-------------|---------|
| `<client-name>` | Client directory name (positional, required) | - |
| `--business "Name"` | Business to search on Google Maps (required) | - |
| `--location "City"` | Location context for search | none |
| `--reviews N` | Number of reviews to scrape | 50 |
| `--sort type` | `relevant`, `newest`, `highest`, or `lowest` | relevant |
| `--no-expand` | Skip expanding truncated review text | expand all |
| `--debug` | Save screenshots + HTML for troubleshooting | off |
| `--headless` | Run headless (less reliable) | off |
| `--root path` | Override output root directory | clients/ |
| `--dry-run` | Preview settings without scraping | off |

## Output

Files are saved to `clients/{client}/reviews/{date}/`:

| File | Contents |
|------|----------|
| `raw_reviews_*.json` | Every review as scraped |
| `review_data_*.json` | Structured data with stats, themes, highlights |
| `reviews_*.csv` | Flat CSV for spreadsheet analysis |
| `review_report_*.html` | Branded HTML report with filtering |

### Structured Data Includes

- **Business info** - name, address, rating, category, phone, total reviews
- **Rating distribution** - count per star (1-5)
- **Sentiment analysis** - positive/negative/neutral classification
- **Theme detection** - 8 themes: Customer Service, Value, Quality, Speed, Cleanliness, Location, Communication, Professionalism
- **Owner response rate** - percentage of reviews with business responses
- **Top reviews** - highest rated, most helpful, and top concerns
- **Local Guide stats** - count and percentage of Local Guide reviewers

## How It Works

1. Launches Chromium with a persistent profile and stealth plugins
2. Navigates to Google Maps (homepage-first to build trust)
3. Handles cookie consent if present
4. Types the business name character-by-character with human-like delays
5. Selects the correct business from search results
6. Extracts business metadata (name, rating, address, category)
7. Opens the Reviews tab and sets sort order
8. Infinite-scrolls to load the target number of reviews
9. Expands truncated review text by clicking "More" buttons
10. Extracts all review data from the DOM
11. Generates structured JSON, CSV, and an HTML report

## Anti-Detection

Same battle-tested stack as [kurama-susanoo-serp](https://github.com/kchinhara/kurama-susanoo-serp):

- **Persistent browser profile** - cookie/trust accumulation across sessions
- **Stealth plugin** - `navigator.webdriver` removal, WebGL spoofing
- **Human-like typing** - character-by-character with random 50-150ms delays
- **Random mouse movements** between actions
- **Variable scroll pauses** - no robotic timing patterns
- **Fresh profile warmup** - 3 casual searches to build trust on new profiles
- **User-Agent rotation** - pool of 6 real Chrome UAs
- **Automation flag disabled** - `--disable-blink-features=AutomationControlled`

No proxy needed - unlike ad scraping, Google Maps reviews are the same content regardless of IP.

## Configuration

All settings live in `config.js`:

- **Selectors** - Google Maps DOM selectors with multi-fallback chains
- **Delays** - typing speed, scroll pauses, click delays
- **User Agents** - Chrome UA rotation pool
- **Sentiment keywords** - positive/negative word lists
- **Theme patterns** - review themes with keywords and report colours

When Google Maps changes its layout, update the selectors in `config.js` - no need to touch the scraper code.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| CAPTCHA detected | Rate limited or flagged | Wait 24h. Delete `.playwright-profile/` if persistent |
| 0 reviews loaded | Reviews tab failed to open | Run with `--debug`, check HTML snapshots |
| Extraction fails | Selectors outdated | Update selectors in `config.js` |
| Browser crash | Profile corrupted | Delete `.playwright-profile/` |
| Wrong business | Ambiguous query | Add `--location` for specificity |

## Best Practices

- **1-2 sessions per day** - more risks profile flagging
- **50-100 reviews per session** is the sweet spot
- **Keep the browser profile** - do not delete `.playwright-profile/` unless you have to
- **Use `--debug` on first run** - verify selectors work before bulk scraping
- **Non-headless is more reliable** - only use `--headless` when you must (CI, remote server)

## Project Structure

```
kurama-review-scraper/
  config.js             # All configuration + selectors
  package.json          # Dependencies (playwright, stealth)
  scripts/
    scrape-reviews.cjs  # Main scraper (CLI entry point)
  images/               # Logo and branding assets
  .playwright-profile/  # Persistent browser profile (gitignored)
  clients/              # Output directory (gitignored)
```

## License

MIT
