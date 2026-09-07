#!/usr/bin/env node
// ============================================================
// KURAMA REVIEW SCRAPER - Google Maps Review Scraper
// Zero-cost, no API keys, no proxies
// Architecture: kurama-susanoo-serp pattern
// ============================================================

const path = require('path');
const fs = require('fs');
const config = require('../config');

// ============================================================
// CONSTANTS
// ============================================================

const SKILL_ROOT = path.resolve(__dirname, '..');
const PROFILE_DIR = path.join(SKILL_ROOT, '.playwright-profile');

// Exit codes. Everything used to exit 1, so a caller could not tell "this business has no Maps
// listing" - which will fail identically forever - from "headed Chromium crashed" - which usually
// succeeds on a retry. One calling pipeline retried all of them three times with backoff, and on
// a 2026-08 run two unresolvable targets burned roughly 24 minutes of browser time
// and starved the remaining five targets of any attempt at all.
//
// 0 success, 1 unexpected error (retry is worth it), 20-22 deterministic (retrying cannot help).
const EXIT = {
  NOT_FOUND: 20,   // the Maps search returned no results for this query
  NO_REVIEWS: 21,  // the listing resolved but carries no readable reviews
  BLOCKED: 22,     // CAPTCHA - retrying makes it worse, the advice is to wait 24h
};
// Tag an error so the top-level catch can map it to its exit code.
function taggedError(message, exitCode) {
  const e = new Error(message);
  e.exitCode = exitCode;
  return e;
}

// ============================================================
// CLI ARGUMENT PARSING
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    clientName: null,
    business: null,
    location: null,
    reviews: config.defaults.reviews,
    sort: config.defaults.sort,
    expandAll: config.defaults.expandAll,
    debug: config.defaults.debug,
    root: null,
    dryRun: false,
    headless: false,
  };

  // First positional arg is client name
  if (args.length > 0 && !args[0].startsWith('--')) {
    parsed.clientName = args[0];
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--business':
        parsed.business = args[++i];
        break;
      case '--location':
        parsed.location = args[++i];
        break;
      case '--reviews':
        parsed.reviews = parseInt(args[++i], 10) || config.defaults.reviews;
        break;
      case '--sort':
        parsed.sort = args[++i] || config.defaults.sort;
        break;
      case '--no-expand':
        parsed.expandAll = false;
        break;
      case '--debug':
        parsed.debug = true;
        break;
      case '--root':
        parsed.root = args[++i];
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--headless':
        parsed.headless = true;
        break;
      case '--help':
        printUsage();
        process.exit(0);
    }
  }

  if (!parsed.clientName || !parsed.business) {
    printUsage();
    process.exit(1);
  }

  return parsed;
}

function printUsage() {
  console.log(`
KURAMA REVIEW SCRAPER - Zero-cost Google Maps review scraper

Usage:
  node scripts/scrape-reviews.cjs <client-name> --business "Business Name" [options]

Required:
  <client-name>          Client directory name (e.g., "my-client")
  --business "Name"      Business name to search on Google Maps

Options:
  --location "City,Country"   Location context for search (default: none)
  --reviews <N>               Number of reviews to scrape (default: ${config.defaults.reviews})
  --sort <type>               Sort order: relevant|newest|highest|lowest (default: ${config.defaults.sort})
  --no-expand                 Skip clicking "More" buttons on truncated reviews
  --debug                     Save debug screenshots and HTML snapshots
  --root <path>               Override output root directory
  --headless                  Run browser in headless mode (less reliable)
  --dry-run                   Show what would be scraped without launching browser
  --help                      Show this help message

Examples:
  node scripts/scrape-reviews.cjs crossfit-north --business "CrossFit North London"
  node scripts/scrape-reviews.cjs plumber-co --business "ABC Plumbing" --location "London, UK" --reviews 200 --sort newest
  node scripts/scrape-reviews.cjs test --business "Starbucks" --reviews 20 --debug
`);
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function timestamp() {
  return new Date().toISOString().split('T')[0];
}

function log(msg) {
  const ts = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${ts}] ${msg}`);
}

function logWarn(msg) {
  const ts = new Date().toISOString().split('T')[1].split('.')[0];
  console.warn(`[${ts}] WARN: ${msg}`);
}

function logError(msg) {
  const ts = new Date().toISOString().split('T')[1].split('.')[0];
  console.error(`[${ts}] ERROR: ${msg}`);
}

/**
 * Try multiple selectors in order, return the first match
 */
async function trySelectors(page, selectorList, options = {}) {
  const { timeout = 3000, state = 'visible' } = options;
  for (const sel of selectorList) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ state, timeout });
      return el;
    } catch {
      // Try next selector
    }
  }
  return null;
}

/**
 * Parse relative date string ("2 months ago") to approximate ISO date
 */
function parseRelativeDate(relativeDate) {
  if (!relativeDate) return null;
  const now = new Date();
  const text = relativeDate.toLowerCase().trim();

  const numMatch = text.match(/(\d+)/);
  const num = numMatch ? parseInt(numMatch[1], 10) : 1;

  if (text.includes('day') || text.includes('yesterday')) {
    now.setDate(now.getDate() - (text.includes('yesterday') ? 1 : num));
  } else if (text.includes('week')) {
    now.setDate(now.getDate() - (num * 7));
  } else if (text.includes('month')) {
    now.setMonth(now.getMonth() - num);
  } else if (text.includes('year')) {
    now.setFullYear(now.getFullYear() - num);
  } else if (text.includes('hour') || text.includes('minute') || text.includes('just now')) {
    // Today
  } else {
    return null;
  }

  return now.toISOString().split('T')[0];
}

// ============================================================
// ANTI-DETECTION & HUMAN-LIKE BEHAVIOR
// ============================================================

/**
 * Type text character by character with random delays
 */
async function typeHumanLike(page, locator, text) {
  await locator.click();
  await sleep(randomDelay(200, 500));

  for (const char of text) {
    await page.keyboard.type(char, {
      delay: randomDelay(config.delays.typingMin, config.delays.typingMax),
    });
  }
}

/**
 * Move mouse to random positions (simulates human)
 */
async function randomMouseMove(page) {
  const x = randomDelay(200, 800);
  const y = randomDelay(150, 500);
  const steps = randomDelay(5, 12);
  await page.mouse.move(x, y, { steps });
  await sleep(randomDelay(config.delays.mouseMovePauseMin, config.delays.mouseMovePauseMax));
}

/**
 * Human-like scroll within an element
 */
async function scrollElement(page, element, pixels) {
  await element.evaluate((el, px) => {
    el.scrollBy({ top: px, behavior: 'smooth' });
  }, pixels);
}

// ============================================================
// BROWSER MANAGEMENT
// ============================================================

async function launchBrowser(headless = false) {
  // Try playwright-extra + stealth first, fall back to plain playwright
  let chromium;
  let launchOptions;

  try {
    const { chromium: chromiumExtra } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth');
    chromiumExtra.use(stealth());
    chromium = chromiumExtra;
    log('Stealth plugin loaded');
  } catch {
    logWarn('playwright-extra/stealth not available, using plain playwright');
    const pw = require('playwright');
    chromium = pw.chromium;
  }

  const ua = config.userAgents[Math.floor(Math.random() * config.userAgents.length)];

  log(`Launching browser (headless: ${headless})`);
  log(`Profile: ${PROFILE_DIR}`);
  log(`User-Agent: ${ua.substring(0, 60)}...`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      // Stability flags: headed Chromium on Windows crashes its GPU/network-service
      // process under serial automation ("network service crashed mid-session"). These
      // are benign for stealth and fix the progressive-crash failure mode.
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-dev-shm-usage',
    ],
    userAgent: ua,
    viewport: { width: 1366, height: 768 },
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    permissions: ['geolocation'],
    geolocation: { latitude: 51.5074, longitude: -0.1278 },
    ignoreHTTPSErrors: true,
  });

  const page = context.pages()[0] || await context.newPage();

  // Remove webdriver flag
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return { context, page };
}

// ============================================================
// GOOGLE MAPS NAVIGATION
// ============================================================

/**
 * Handle Google consent/cookie dialog if present
 */
async function handleConsent(page) {
  log('Checking for consent dialog...');
  await sleep(2000);

  // Check if redirected to consent page
  if (page.url().includes('consent.google')) {
    log('Consent page detected, accepting...');
    const acceptBtn = await trySelectors(page, config.selectors.consentAccept, { timeout: 5000 });
    if (acceptBtn) {
      await acceptBtn.click();
      // Wait for redirect back to Maps
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      log('Consent accepted, waiting for Maps to load...');
      await sleep(3000);
      // If we didn't land back on Maps, navigate there explicitly
      if (!page.url().includes('google.com/maps')) {
        log('Re-navigating to Google Maps after consent...');
        await page.goto('https://www.google.com/maps', {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await sleep(3000);
      }
    }
    return;
  }

  // Check for overlay consent dialog
  const acceptBtn = await trySelectors(page, config.selectors.consentAccept, { timeout: 3000 });
  if (acceptBtn) {
    log('Consent overlay detected, accepting...');
    await acceptBtn.click();
    await sleep(3000);
    log('Consent accepted');
  } else {
    log('No consent dialog found');
  }
}

/**
 * Check for CAPTCHA or rate limiting
 */
async function checkForCaptcha(page) {
  const url = page.url();
  if (url.includes('sorry') || url.includes('captcha')) return true;

  const hasCaptcha = await page.evaluate(() => {
    const text = (document.body?.innerText || '').toLowerCase();
    return text.includes('unusual traffic') ||
           text.includes('not a robot') ||
           !!document.querySelector('iframe[src*="recaptcha"]');
  }).catch(() => false);

  return hasCaptcha;
}

/**
 * Navigate to Google Maps and search for business
 */
async function searchBusiness(page, business, location) {
  const query = location ? `${business}, ${location}` : business;
  log(`Navigating to Google Maps...`);

  await page.goto('https://www.google.com/maps', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  await handleConsent(page);

  if (await checkForCaptcha(page)) {
    throw new Error('CAPTCHA detected. Wait 24h before retrying. Delete .playwright-profile/ if persistent.');
  }

  // Wait for search box (longer timeout after consent redirect)
  log('Waiting for search box...');
  const searchBox = await trySelectors(page, config.selectors.searchBox, { timeout: 15000 });
  if (!searchBox) {
    throw new Error('Search box not found. Google Maps layout may have changed.');
  }

  // Clear any existing text
  await searchBox.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await sleep(randomDelay(300, 600));

  // Type business name human-like
  log(`Searching for: "${query}"`);
  await typeHumanLike(page, searchBox, query);

  await sleep(randomDelay(500, 1000));
  await page.keyboard.press('Enter');

  // Wait for results to load
  log('Waiting for results...');
  await sleep(randomDelay(config.delays.afterSearchMin, config.delays.afterSearchMax));

  if (await checkForCaptcha(page)) {
    throw taggedError('CAPTCHA detected after search. Wait 24h before retrying.', EXIT.BLOCKED);
  }
}

/**
 * Select the business from search results (handle single/multiple)
 */
async function selectBusiness(page, businessName, debug, outputDir) {
  log('Checking if place panel loaded...');

  // Check if we landed directly on a place page. NOTE: the businessTitle selector also
  // matches the multi-result list header, whose text is literally "Results" - a generic
  // business name (e.g. "Olive Tree Creative") returns a results list, not a single place.
  // Treat that header as "not landed" so we fall through to result selection below.
  const titleEl = await trySelectors(page, config.selectors.businessTitle, { timeout: 5000 });
  if (titleEl) {
    const title = (await titleEl.textContent().catch(() => '') || '').trim();
    if (title && !/^results$/i.test(title)) {
      log(`Place panel found: "${title}"`);
      return;
    }
    if (/^results$/i.test(title)) log('Results list detected (not a single place) - selecting best match...');
  }

  // Multiple results - try to click the first matching one
  log('Multiple results detected, looking for best match...');

  // Look for result items in the feed/list
  const resultItems = await page.locator('[role="feed"] a[aria-label], .Nv2PK a[aria-label]').all();

  if (resultItems.length === 0) {
    // Try broader selector
    const altItems = await page.locator('a.hfpxzc').all();
    if (altItems.length > 0) {
      log(`Found ${altItems.length} results, clicking first...`);
      await randomMouseMove(page);
      await altItems[0].click();
      await sleep(randomDelay(3000, 5000));
      return;
    }

    if (debug && outputDir) {
      const html = await page.content();
      fs.writeFileSync(path.join(outputDir, 'debug_no_results.html'), html);
      await page.screenshot({ path: path.join(outputDir, 'debug_no_results.png'), fullPage: true });
    }
    throw taggedError(`No results found for "${businessName}". Check the business name and location.`, EXIT.NOT_FOUND);
  }

  // Find best match by aria-label. Robust to spacing/punctuation/case: a run-together
  // query like "Olivetreecreative" must still match the listing "Olive Tree Creative".
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const target = norm(businessName);
  const tWords = new Set((businessName.toLowerCase().match(/[a-z0-9]+/g)) || []);

  // Sponsored results are never a scrape target. A Maps ad entry carries the advertiser's name in
  // its aria-label, so it scores as well as - or better than - the real listing, but it is not a
  // place panel and clicking it times out. On a 2026-08 run, a service-plus-city search matched
  // an `Ad-` prefixed entry (advertiser name plus offer text in the aria-label)
  // at score 2.00 and failed on a 30-second click timeout, three attempts running,
  // because the ad is deterministic - it was there every time.
  //
  // The retry guard added the same day does not catch this one: it surfaces as a click timeout
  // (exit 1, a genuinely transient-looking failure) rather than as NOT_FOUND, so the only way to
  // stop it is to not match the ad in the first place.
  const isSponsored = (label) => /^\s*(ad|sponsored|anuncio|annonce|anzeige)\s*[·•:-]/i.test(label || '');

  let bestMatch = null, bestScore = 0, bestLabel = '';
  let sponsoredSkipped = 0;
  for (const item of resultItems) {
    const label = (await item.getAttribute('aria-label').catch(() => '')) || '';
    if (isSponsored(label)) { sponsoredSkipped++; continue; }
    const cand = norm(label);
    if (!cand || !target) continue;
    let score = 0;
    if (cand === target) score = 3;                                       // exact (normalised)
    else if (cand.includes(target) || target.includes(cand)) score = 2;   // containment either way
    else {                                                                // token-overlap fallback
      const cWords = (label.toLowerCase().match(/[a-z0-9]+/g)) || [];
      const overlap = cWords.filter((w) => tWords.has(w)).length;
      if (overlap) score = 1 + (overlap / Math.max(tWords.size, 1)) * 0.5; // 1..1.5
    }
    if (score > bestScore) { bestScore = score; bestMatch = item; bestLabel = label; }
  }

  if (sponsoredSkipped) log(`Skipped ${sponsoredSkipped} sponsored result(s) - Maps ads are not place listings.`);

  if (bestMatch) {
    log(`Matched result (score ${bestScore.toFixed(2)}): "${bestLabel}"`);
  } else {
    // The first-result fallback must skip ads too, or a search whose only sponsored entry sits at
    // the top hands back the ad it was just excluded from matching.
    const organic = [];
    for (const item of resultItems) {
      const label = (await item.getAttribute('aria-label').catch(() => '')) || '';
      if (!isSponsored(label)) organic.push({ item, label });
    }
    if (!organic.length) {
      throw taggedError(`Only sponsored results for "${businessName}". No place listing to scrape.`, EXIT.NOT_FOUND);
    }
    log('No name match found, clicking first organic result...');
    bestMatch = organic[0].item;
    bestLabel = organic[0].label;
    log(`First organic result: "${bestLabel}"`);
  }

  await randomMouseMove(page);
  await bestMatch.click();
  await sleep(randomDelay(3000, 5000));
}

/**
 * Extract business metadata from the place page
 */
async function getBusinessInfo(page) {
  log('Extracting business info...');

  const info = await page.evaluate((selectors) => {
    function getText(selectorList) {
      for (const sel of selectorList) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) return el.textContent.trim();
      }
      return null;
    }

    // Try multiple strategies for total review count
    let totalReviews = 0;

    // Strategy 1: Look for "X reviews" text near the rating on the Reviews tab/panel
    const reviewsTabEl = document.querySelector('button[aria-label*="Reviews"], button[aria-label*="reviews"]');
    if (reviewsTabEl) {
      const tabLabel = reviewsTabEl.getAttribute('aria-label') || reviewsTabEl.textContent || '';
      const tabMatch = tabLabel.match(/([\d,]+)\s*review/i);
      if (tabMatch) totalReviews = parseInt(tabMatch[1].replace(/,/g, ''), 10);
    }

    // Strategy 2: Look for "X reviews" text in the rating summary area
    if (!totalReviews) {
      const allSpans = document.querySelectorAll('span, div');
      for (const span of allSpans) {
        const txt = span.textContent?.trim() || '';
        // Match "35 reviews" or "(35)" near a rating
        const match = txt.match(/^([\d,]+)\s*reviews?$/i);
        if (match) {
          const n = parseInt(match[1].replace(/,/g, ''), 10);
          if (n > 0 && n < 100000) { totalReviews = n; break; }
        }
      }
    }

    // Strategy 3: Configured selectors
    if (!totalReviews) {
      const totalReviewsText = getText(selectors.businessTotalReviews) || '';
      const totalMatch = totalReviewsText.match(/([\d,]+)/);
      if (totalMatch) totalReviews = parseInt(totalMatch[1].replace(/,/g, ''), 10);
    }

    return {
      name: getText(selectors.businessTitle) || 'Unknown',
      address: getText(selectors.businessAddress) || '',
      rating: parseFloat(getText(selectors.businessRating)) || 0,
      totalReviews,
      category: getText(selectors.businessCategory) || '',
      phone: getText(selectors.businessPhone) || '',
    };
  }, config.selectors);

  log(`Business: ${info.name}`);
  log(`Rating: ${info.rating} - ${info.totalReviews} reviews`);
  log(`Address: ${info.address}`);
  log(`Category: ${info.category}`);

  return info;
}

/**
 * Click the Reviews tab on the place page
 */
async function openReviewsTab(page) {
  log('Opening Reviews tab...');

  const reviewsTab = await trySelectors(page, config.selectors.reviewsTab, { timeout: 8000 });
  if (!reviewsTab) {
    // Try clicking text that says "reviews"
    const textTab = page.getByRole('tab', { name: /review/i }).first();
    try {
      await textTab.waitFor({ timeout: 3000 });
      await textTab.click();
    } catch {
      throw taggedError('Reviews tab not found. The business may have no reviews, or Google Maps layout changed.', EXIT.NO_REVIEWS);
    }
    await sleep(randomDelay(config.delays.afterTabClickMin, config.delays.afterTabClickMax));
    return;
  }

  await randomMouseMove(page);
  await sleep(randomDelay(config.delays.beforeClickMin, config.delays.beforeClickMax));
  await reviewsTab.click();
  await sleep(randomDelay(config.delays.afterTabClickMin, config.delays.afterTabClickMax));
  log('Reviews tab opened');
}

/**
 * Change the sort order of reviews
 */
async function setSortOrder(page, sortType) {
  if (sortType === 'relevant') {
    log('Sort: Most relevant (default, no change needed)');
    return;
  }

  log(`Setting sort order to: ${sortType}`);

  const sortBtn = await trySelectors(page, config.selectors.sortButton, { timeout: 5000 });
  if (!sortBtn) {
    logWarn('Sort button not found. Proceeding with default sort order.');
    return;
  }

  await randomMouseMove(page);
  await sleep(randomDelay(300, 700));
  await sortBtn.click();
  await sleep(randomDelay(1000, 2000));

  // Find the sort menu item
  const sortLabels = config.selectors.sortMenuItems[sortType] || [sortType];
  let clicked = false;

  for (const label of sortLabels) {
    try {
      const menuItem = page.locator(`[role="menuitemradio"]:has-text("${label}"), div.fxNQSd:has-text("${label}")`).first();
      await menuItem.waitFor({ timeout: 3000 });
      await menuItem.click();
      clicked = true;
      log(`Sort set to: ${label}`);
      break;
    } catch {
      // Try next label
    }
  }

  if (!clicked) {
    // Fallback: try clicking by text content broadly
    try {
      const menuItems = await page.locator('[role="menuitemradio"], div.fxNQSd').all();
      for (const item of menuItems) {
        const text = await item.textContent();
        const textLower = (text || '').toLowerCase();
        for (const label of sortLabels) {
          if (textLower.includes(label.toLowerCase())) {
            await item.click();
            clicked = true;
            log(`Sort set to: ${text.trim()}`);
            break;
          }
        }
        if (clicked) break;
      }
    } catch {
      logWarn('Could not set sort order, continuing with default.');
    }
  }

  if (!clicked) {
    // Dismiss the menu by pressing Escape
    await page.keyboard.press('Escape');
    logWarn('Sort option not found, continuing with default sort order.');
  }

  await sleep(randomDelay(config.delays.afterSortMin, config.delays.afterSortMax));
}

// ============================================================
// REVIEW SCROLLING & EXPANSION
// ============================================================

/**
 * Find the scrollable container that holds reviews
 */
async function findScrollableContainer(page, skipSelectors = []) {
  // Strategy 1: Known selectors, scored rather than first-past-the-post.
  //
  // Taking the first selector that merely overflows picks the wrong element on some place pages.
  // `scrollHeight > clientHeight` is true of plenty of containers that are not the review feed,
  // and it is also a point-in-time test - with only the first 10 reviews rendered, the real feed
  // may not have overflowed yet, so it fails the test and the loop falls through to a worse
  // candidate. Both listings that fell back to `[role="feed"]` on a 2026-08 run
  // under-delivered badly: one loaded 10 of 569 reviews across 15 scrolls and the other
  // 30 of 839 across 18, while every listing that resolved to `div.m6QErb.DxyBCb` hit its target
  // in 5 to 8 scrolls.
  //
  // So: prefer a candidate that actually CONTAINS review nodes, and among those the one holding
  // the most. Scrollability becomes a tiebreak rather than a gate.
  let best = null;
  for (const sel of config.selectors.scrollablePanel) {
    if (skipSelectors.includes(sel)) continue;
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ timeout: 3000 });
      const stats = await el.evaluate((e, reviewSelectors) => {
        let reviews = 0;
        for (const rs of reviewSelectors) {
          const n = e.querySelectorAll(rs).length;
          if (n > reviews) reviews = n;
        }
        return { reviews, scrollable: e.scrollHeight > e.clientHeight };
      }, config.selectors.reviewContainer);
      if (!stats.reviews && !stats.scrollable) continue;
      const score = stats.reviews * 10 + (stats.scrollable ? 1 : 0);
      if (!best || score > best.score) best = { sel, el, score, ...stats };
    } catch {
      // Try next
    }
  }
  if (best) {
    log(`Scrollable container found: ${best.sel} (${best.reviews} review nodes, scrollable: ${best.scrollable})`);
    return { locator: best.el, selector: best.sel };
  }

  // Strategy 2: Find review element, walk up to scrollable parent
  log('Trying structural scroll container detection...');
  const scrollSel = await page.evaluate((reviewSelectors) => {
    for (const sel of reviewSelectors) {
      const review = document.querySelector(sel);
      if (!review) continue;
      let el = review.parentElement;
      let depth = 0;
      while (el && depth < 10) {
        const style = getComputedStyle(el);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight) {
          // Return a unique identifier
          el.setAttribute('data-kurama-scroll', 'true');
          return '[data-kurama-scroll="true"]';
        }
        el = el.parentElement;
        depth++;
      }
    }
    return null;
  }, config.selectors.reviewContainer);

  if (scrollSel) {
    log(`Structural scroll container found`);
    return { locator: page.locator(scrollSel).first(), selector: scrollSel };
  }

  logWarn('No scrollable container found, will use page-level scrolling');
  return null;
}

/**
 * Click all visible "More" buttons to expand truncated review text
 */
async function expandAllReviews(page) {
  let expanded = 0;

  for (const sel of config.selectors.moreButton) {
    try {
      const buttons = await page.locator(sel).all();
      for (const btn of buttons) {
        try {
          if (await btn.isVisible()) {
            await btn.click();
            expanded++;
            await sleep(randomDelay(100, 300));
          }
        } catch {
          // Button may have disappeared
        }
      }
    } catch {
      // Selector not found
    }
  }

  if (expanded > 0) {
    log(`Expanded ${expanded} truncated reviews`);
  }

  return expanded;
}

/**
 * Count currently loaded UNIQUE reviews (by data-review-id or dedup key)
 * Raw element count is unreliable - Google Maps nests multiple matching elements per review
 */
async function countReviews(page) {
  return await page.evaluate((selectors) => {
    const ids = new Set();
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        // Use data-review-id if available
        const rid = el.getAttribute('data-review-id');
        if (rid) {
          ids.add(rid);
          continue;
        }
        // Fallback: use a composite key from content
        const ratingEl = el.querySelector('[aria-label*="star"], [aria-label*="Star"]');
        const nameEl = el.querySelector('.d4r55') || el.querySelector('button[data-review-id] span');
        if (ratingEl || nameEl) {
          const key = (nameEl?.textContent || '') + '|' + (ratingEl?.getAttribute('aria-label') || '');
          if (key.length > 2) ids.add(key);
        }
      }
    }
    return ids.size;
  }, config.selectors.reviewContainer);
}

/**
 * Scroll through reviews panel to load more reviews via infinite scroll
 */
async function scrollAndLoad(page, targetCount, expandAll, debug, outputDir) {
  log(`Target: ${targetCount} reviews`);

  let picked = await findScrollableContainer(page);
  let scrollContainer = picked ? picked.locator : null;
  const triedSelectors = picked ? [picked.selector] : [];
  let currentCount = await countReviews(page);
  const initialCount = currentCount;
  let previousCount = 0;
  let staleRounds = 0;
  const maxStaleRounds = 15; // Deep feeds pause >10s between lazy-load batches - be patient before giving up
  let scrollAttempt = 0;
  let containerSwitched = false;
  const maxScrollAttempts = config.defaults.maxScrollAttempts;

  log(`Initial reviews loaded: ${currentCount}`);

  while (currentCount < targetCount && scrollAttempt < maxScrollAttempts && staleRounds < maxStaleRounds) {
    scrollAttempt++;
    previousCount = currentCount;

    // Scroll
    const scrollPx = randomDelay(config.defaults.scrollPauseMin === 1500 ? 600 : 600, 1200);
    if (scrollContainer) {
      await scrollElement(page, scrollContainer, scrollPx);
    } else {
      await page.evaluate((px) => window.scrollBy(0, px), scrollPx);
    }

    // Wait for new content to load
    await sleep(randomDelay(config.defaults.scrollPauseMin, config.defaults.scrollPauseMax));

    // Random mouse movement occasionally
    if (scrollAttempt % 3 === 0) {
      await randomMouseMove(page);
    }

    // Expand truncated reviews periodically
    if (expandAll && scrollAttempt % 2 === 0) {
      await expandAllReviews(page);
    }

    currentCount = await countReviews(page);

    if (currentCount === previousCount) {
      staleRounds++;
      if (staleRounds >= 2) {
        // Jump to the container bottom - incremental scrolls stop reaching it once
        // expanded reviews grow the feed, and lazy load only fires near the bottom
        if (scrollContainer) {
          await scrollContainer.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        }
        await sleep(3000);
        currentCount = await countReviews(page);
        if (currentCount > previousCount) staleRounds = 0;
      }

      // Five stale rounds with NOTHING loaded since we started means we are almost certainly
      // scrolling the wrong element: the lazy-loader watches a container we are not touching.
      // Re-resolve once, excluding the selector already tried, rather than spending the full
      // stale budget scrolling something inert. One listing burned 15 scrolls this way and
      // came away with 10 of 569 reviews.
      if (staleRounds >= 5 && currentCount === initialCount && !containerSwitched) {
        containerSwitched = true;
        logWarn(`No reviews loaded after ${scrollAttempt} scrolls - re-resolving the scroll container.`);
        const next = await findScrollableContainer(page, triedSelectors);
        if (next) {
          scrollContainer = next.locator;
          triedSelectors.push(next.selector);
          staleRounds = 0;
        } else {
          logWarn('No alternative scroll container found; falling back to page-level scrolling.');
          scrollContainer = null;
          staleRounds = 0;
        }
      }
    } else {
      staleRounds = 0;
    }

    if (scrollAttempt % 10 === 0) {
      log(`Progress: ${currentCount} reviews loaded (scroll #${scrollAttempt})`);
    }

    // CAPTCHA check periodically
    if (scrollAttempt % 20 === 0) {
      if (await checkForCaptcha(page)) {
        logWarn('CAPTCHA detected during scrolling. Stopping.');
        break;
      }
    }
  }

  // Final expansion pass
  if (expandAll) {
    await expandAllReviews(page);
  }

  const finalCount = await countReviews(page);
  log(`Scrolling complete: ${finalCount} reviews loaded after ${scrollAttempt} scrolls`);

  if (finalCount === 0 && debug && outputDir) {
    const html = await page.content();
    fs.writeFileSync(path.join(outputDir, 'debug_no_reviews.html'), html);
    await page.screenshot({ path: path.join(outputDir, 'debug_no_reviews.png'), fullPage: true });
    logWarn('Debug files saved for investigation');
  }

  return finalCount;
}

// ============================================================
// REVIEW EXTRACTION
// ============================================================

/**
 * Extract all review data from the DOM
 * Uses multiple strategies with fallbacks
 */
async function extractReviews(page) {
  log('Extracting reviews from DOM...');

  const reviews = await page.evaluate((selectors) => {
    const results = [];

    // --- Helper: get text from first matching selector ---
    function getText(parent, selectorList) {
      for (const sel of selectorList) {
        const el = parent.querySelector(sel);
        if (el) {
          const text = el.textContent?.trim();
          if (text) return text;
        }
      }
      return '';
    }

    // --- Helper: get attribute from first matching selector ---
    function getAttr(parent, selectorList, attr) {
      for (const sel of selectorList) {
        const el = parent.querySelector(sel);
        if (el) {
          const val = el.getAttribute(attr);
          if (val) return val;
        }
      }
      return '';
    }

    // --- Helper: parse rating from aria-label ---
    function parseRating(parent, selectorList) {
      for (const sel of selectorList) {
        const el = parent.querySelector(sel);
        if (el) {
          const label = el.getAttribute('aria-label') || '';
          const match = label.match(/(\d)/);
          if (match) return parseInt(match[1], 10);
        }
      }
      return null;
    }

    // --- Helper: extract reviewer metadata (reviews count, photos) ---
    function parseReviewerMeta(parent, selectorList) {
      const meta = { reviewCount: 0, photoCount: 0 };
      for (const sel of selectorList) {
        const el = parent.querySelector(sel);
        if (el) {
          const text = el.textContent || '';
          const reviewMatch = text.match(/([\d,]+)\s*review/i);
          const photoMatch = text.match(/([\d,]+)\s*photo/i);
          if (reviewMatch) meta.reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''), 10);
          if (photoMatch) meta.photoCount = parseInt(photoMatch[1].replace(/,/g, ''), 10);
          break;
        }
      }
      return meta;
    }

    // --- Helper: check for local guide badge ---
    function isLocalGuide(parent, selectorList) {
      for (const sel of selectorList) {
        const el = parent.querySelector(sel);
        if (el) {
          const text = (el.textContent || '').toLowerCase();
          if (text.includes('local guide') || el.getAttribute('aria-label')?.includes('Local Guide')) {
            return true;
          }
        }
      }
      return false;
    }

    // --- Find review containers ---
    let reviewElements = [];
    for (const sel of selectors.reviewContainer) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        reviewElements = Array.from(els);
        break;
      }
    }

    if (reviewElements.length === 0) {
      // Broad fallback: look for elements with star ratings in the main panel
      const starEls = document.querySelectorAll('[aria-label*="star"]');
      for (const starEl of starEls) {
        let container = starEl.parentElement;
        let depth = 0;
        while (container && depth < 5) {
          if (container.querySelector('[aria-label*="star"]') &&
              container.textContent.length > 50) {
            reviewElements.push(container);
            break;
          }
          container = container.parentElement;
          depth++;
        }
      }
    }

    // --- Extract data from each review ---
    for (let i = 0; i < reviewElements.length; i++) {
      const el = reviewElements[i];

      try {
        const reviewId = el.getAttribute('data-review-id') || `review-${i}`;
        const name = getText(el, selectors.reviewerName) || 'Anonymous';
        const rating = parseRating(el, selectors.reviewRating);
        const dateText = getText(el, selectors.reviewDate);
        const reviewerLink = getAttr(el, selectors.reviewerLink, 'href');
        const meta = parseReviewerMeta(el, selectors.reviewerMeta);
        const localGuide = isLocalGuide(el, selectors.localGuideBadge);

        // Owner response (extract BEFORE review text so we can exclude it)
        let ownerResponse = null;
        let ownerResponseContainer = null;
        for (const sel of selectors.ownerResponse) {
          const responseEl = el.querySelector(sel);
          if (responseEl) {
            ownerResponseContainer = responseEl.closest('[class]') || responseEl.parentElement;
            const responseDate = getText(el, selectors.ownerResponseDate);
            ownerResponse = {
              text: responseEl.textContent?.trim() || '',
              date: responseDate,
            };
            break;
          }
        }

        // Review text (exclude text inside owner response container)
        let reviewText = '';
        for (const sel of selectors.reviewText) {
          const textEls = el.querySelectorAll(sel);
          for (const textEl of textEls) {
            // Skip if this element is inside the owner response
            if (ownerResponseContainer && ownerResponseContainer.contains(textEl)) continue;
            const t = textEl.textContent?.trim();
            if (t && t.length > reviewText.length) {
              reviewText = t;
            }
          }
          if (reviewText) break;
        }

        // Review images
        const images = [];
        for (const sel of selectors.reviewImages) {
          const imgEls = el.querySelectorAll(sel);
          for (const img of imgEls) {
            const src = img.getAttribute('src');
            if (src && !src.includes('data:image') && src.length > 10) {
              images.push(src);
            }
          }
          if (images.length > 0) break;
        }

        // Likes/helpful count
        let likes = 0;
        for (const sel of selectors.likesCount) {
          const likesEl = el.querySelector(sel);
          if (likesEl) {
            const likesText = likesEl.textContent || '';
            const likesMatch = likesText.match(/(\d+)/);
            if (likesMatch) likes = parseInt(likesMatch[1], 10);
            break;
          }
        }

        // Skip if we have no meaningful data
        if (!rating && !reviewText) continue;

        results.push({
          review_id: reviewId,
          reviewer_name: name,
          reviewer_url: reviewerLink,
          is_local_guide: localGuide,
          reviewer_reviews: meta.reviewCount,
          reviewer_photos: meta.photoCount,
          rating: rating || 0,
          date_text: dateText,
          text: reviewText,
          likes,
          images,
          owner_response: ownerResponse,
          position: i + 1,
        });
      } catch (e) {
        // Skip malformed review, continue extraction
      }
    }

    return results;
  }, config.selectors);

  // Deduplicate by review_id (Google Maps DOM often has duplicate container matches)
  const seen = new Set();
  const deduped = [];
  for (const review of reviews) {
    const key = review.review_id && !review.review_id.startsWith('review-')
      ? review.review_id
      : `${review.reviewer_name}|${review.date_text}|${review.rating}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(review);
    }
  }

  if (deduped.length < reviews.length) {
    log(`Deduplicated: ${reviews.length} -> ${deduped.length} reviews`);
  }

  // Renumber positions after dedup
  for (let i = 0; i < deduped.length; i++) {
    deduped[i].position = i + 1;
  }

  // Clean up owner response text (strip "Response from the owner X ago" prefix)
  for (const review of deduped) {
    if (review.owner_response && review.owner_response.text) {
      review.owner_response.text = review.owner_response.text
        .replace(/^Response from the owner\s*/i, '')
        .replace(/^\d+\s*(days?|weeks?|months?|years?)\s*ago\s*/i, '')
        .replace(/^(a|an)\s*(day|week|month|year)\s*ago\s*/i, '')
        .trim();
    }
  }

  // Enrich with parsed dates
  for (const review of deduped) {
    review.date_parsed = parseRelativeDate(review.date_text);
  }

  log(`Extracted ${deduped.length} reviews`);
  return deduped;
}

// ============================================================
// OUTPUT & FORMATTING
// ============================================================

function buildStructuredData(reviews, businessInfo, args) {
  // Rating distribution
  const ratingDist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let totalRating = 0;

  for (const r of reviews) {
    if (r.rating >= 1 && r.rating <= 5) {
      ratingDist[r.rating]++;
      totalRating += r.rating;
    }
  }

  const avgRating = reviews.length > 0 ? (totalRating / reviews.length).toFixed(2) : 0;

  // Response rate
  const withResponse = reviews.filter(r => r.owner_response).length;
  const responseRate = reviews.length > 0 ? ((withResponse / reviews.length) * 100).toFixed(1) : 0;

  // Sentiment analysis
  const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
  for (const r of reviews) {
    const text = (r.text || '').toLowerCase();
    const posHits = config.sentimentPatterns.positive.filter(w => text.includes(w)).length;
    const negHits = config.sentimentPatterns.negative.filter(w => text.includes(w)).length;

    if (posHits > negHits) sentimentCounts.positive++;
    else if (negHits > posHits) sentimentCounts.negative++;
    else sentimentCounts.neutral++;
  }

  // Theme detection
  const themes = {};
  for (const pattern of config.themePatterns) {
    let mentions = 0;
    const exampleReviews = [];

    for (const r of reviews) {
      const text = (r.text || '').toLowerCase();
      const hits = pattern.keywords.filter(w => text.includes(w));
      if (hits.length > 0) {
        mentions++;
        if (exampleReviews.length < 3) {
          exampleReviews.push({
            text: r.text.substring(0, 150) + (r.text.length > 150 ? '...' : ''),
            rating: r.rating,
            keywords_matched: hits,
          });
        }
      }
    }

    themes[pattern.name] = {
      mentions,
      percentage: reviews.length > 0 ? ((mentions / reviews.length) * 100).toFixed(1) : 0,
      color: pattern.color,
      examples: exampleReviews,
    };
  }

  // Top positive and negative reviews
  const topPositive = reviews
    .filter(r => r.rating >= 4 && r.text.length > 20)
    .sort((a, b) => b.likes - a.likes || b.text.length - a.text.length)
    .slice(0, 5);

  const topNegative = reviews
    .filter(r => r.rating <= 2 && r.text.length > 20)
    .sort((a, b) => b.likes - a.likes || b.text.length - a.text.length)
    .slice(0, 5);

  // Local guide stats
  const localGuides = reviews.filter(r => r.is_local_guide).length;

  return {
    metadata: {
      scraped_at: new Date().toISOString(),
      client: args.clientName,
      business_query: args.business,
      location_query: args.location || '',
      sort: args.sort,
      target_reviews: args.reviews,
      actual_reviews: reviews.length,
    },
    business: businessInfo,
    statistics: {
      total_reviews: reviews.length,
      average_rating: parseFloat(avgRating),
      rating_distribution: ratingDist,
      response_rate: parseFloat(responseRate),
      responses_count: withResponse,
      local_guides: localGuides,
      local_guide_percentage: reviews.length > 0 ? ((localGuides / reviews.length) * 100).toFixed(1) : 0,
      sentiment: sentimentCounts,
    },
    themes,
    highlights: {
      top_positive: topPositive,
      top_negative: topNegative,
    },
    reviews,
  };
}

function buildCSV(reviews) {
  const headers = [
    'position', 'reviewer_name', 'rating', 'date_text', 'date_parsed',
    'text', 'likes', 'is_local_guide', 'reviewer_reviews', 'reviewer_photos',
    'has_owner_response', 'owner_response_text', 'image_count',
  ];

  const escape = (val) => {
    const str = String(val || '').replace(/"/g, '""');
    return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
  };

  const rows = [headers.join(',')];

  for (const r of reviews) {
    rows.push([
      r.position,
      escape(r.reviewer_name),
      r.rating,
      escape(r.date_text),
      r.date_parsed || '',
      escape(r.text),
      r.likes,
      r.is_local_guide ? 'TRUE' : 'FALSE',
      r.reviewer_reviews,
      r.reviewer_photos,
      r.owner_response ? 'TRUE' : 'FALSE',
      escape(r.owner_response?.text || ''),
      r.images.length,
    ].join(','));
  }

  return rows.join('\n');
}

function backupIfExists(filePath) {
  // Same-day re-runs share filenames - never clobber a previous run's data
  if (fs.existsSync(filePath)) {
    fs.renameSync(filePath, `${filePath}.${Date.now()}.bak`);
  }
}

function saveOutputs(rawReviews, structuredData, csvData, outputDir) {
  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  const dateStr = timestamp();
  const bizSlug = slugify(structuredData.business.name || 'unknown');

  // 1. Raw reviews JSON
  const rawPath = path.join(outputDir, `raw_reviews_${bizSlug}_${dateStr}.json`);
  backupIfExists(rawPath);
  fs.writeFileSync(rawPath, JSON.stringify(rawReviews, null, 2));
  log(`Saved: ${rawPath}`);

  // 2. Structured data JSON (with statistics)
  const structPath = path.join(outputDir, `review_data_${bizSlug}_${dateStr}.json`);
  backupIfExists(structPath);
  fs.writeFileSync(structPath, JSON.stringify(structuredData, null, 2));
  log(`Saved: ${structPath}`);

  // 3. CSV
  const csvPath = path.join(outputDir, `reviews_${bizSlug}_${dateStr}.csv`);
  backupIfExists(csvPath);
  fs.writeFileSync(csvPath, csvData);
  log(`Saved: ${csvPath}`);

  return { rawPath, structPath, csvPath };
}

// ============================================================
// REPORT GENERATION (inline, no separate template needed)
// ============================================================

function generateHTMLReport(structuredData, outputDir) {
  const d = structuredData;
  const biz = d.business;
  const stats = d.statistics;
  const dist = stats.rating_distribution;
  const maxDist = Math.max(...Object.values(dist), 1);
  const dateStr = timestamp();

  // Star display helper
  const stars = (n) => {
    let s = '';
    for (let i = 1; i <= 5; i++) {
      s += i <= n ? '<span class="star filled">&#9733;</span>' : '<span class="star">&#9734;</span>';
    }
    return s;
  };

  // Sentiment badge
  const sentimentBadge = (rating) => {
    if (rating >= 4) return '<span class="badge positive">Positive</span>';
    if (rating <= 2) return '<span class="badge negative">Negative</span>';
    return '<span class="badge neutral">Neutral</span>';
  };

  // Theme rows
  const themeRows = Object.entries(d.themes)
    .sort((a, b) => b[1].mentions - a[1].mentions)
    .map(([name, t]) => `
      <tr>
        <td><span class="theme-dot" style="background:${t.color}"></span>${name}</td>
        <td>${t.mentions}</td>
        <td>${t.percentage}%</td>
        <td><div class="bar-bg"><div class="bar-fill" style="width:${t.percentage}%;background:${t.color}"></div></div></td>
      </tr>`).join('');

  // Rating distribution rows
  const distRows = [5, 4, 3, 2, 1].map(r => {
    const count = dist[r] || 0;
    const pct = stats.total_reviews > 0 ? ((count / stats.total_reviews) * 100).toFixed(1) : 0;
    return `
      <tr>
        <td>${stars(r)}</td>
        <td>${count}</td>
        <td>
          <div class="bar-bg">
            <div class="bar-fill" style="width:${pct}%;background:${r >= 4 ? '#0a7a2e' : r === 3 ? '#d4880f' : '#c0392b'}"></div>
          </div>
        </td>
        <td>${pct}%</td>
      </tr>`;
  }).join('');

  // Review cards
  const reviewCards = d.reviews.slice(0, 200).map(r => `
    <div class="review-card" data-rating="${r.rating}">
      <div class="review-header">
        <div class="reviewer-info">
          <strong>${escapeHtml(r.reviewer_name)}</strong>
          ${r.is_local_guide ? '<span class="local-guide-badge">Local Guide</span>' : ''}
          <span class="reviewer-meta">${r.reviewer_reviews} reviews - ${r.reviewer_photos} photos</span>
        </div>
        <div class="review-rating">${stars(r.rating)} ${sentimentBadge(r.rating)}</div>
      </div>
      <div class="review-date">${escapeHtml(r.date_text)}${r.date_parsed ? ` (approx. ${r.date_parsed})` : ''}</div>
      <div class="review-text">${escapeHtml(r.text) || '<em>No text</em>'}</div>
      ${r.likes > 0 ? `<div class="review-likes">${r.likes} found this helpful</div>` : ''}
      ${r.owner_response ? `
        <div class="owner-response">
          <strong>Owner response</strong>${r.owner_response.date ? ` - ${escapeHtml(r.owner_response.date)}` : ''}
          <p>${escapeHtml(r.owner_response.text)}</p>
        </div>` : ''}
    </div>`).join('');

  // Top positive
  const topPositiveCards = d.highlights.top_positive.map(r => `
    <div class="highlight-card positive">
      <div class="hl-rating">${stars(r.rating)}</div>
      <div class="hl-name">${escapeHtml(r.reviewer_name)}</div>
      <div class="hl-text">${escapeHtml(r.text.substring(0, 300))}${r.text.length > 300 ? '...' : ''}</div>
    </div>`).join('') || '<p class="muted">No positive reviews with text found.</p>';

  // Top negative
  const topNegativeCards = d.highlights.top_negative.map(r => `
    <div class="highlight-card negative">
      <div class="hl-rating">${stars(r.rating)}</div>
      <div class="hl-name">${escapeHtml(r.reviewer_name)}</div>
      <div class="hl-text">${escapeHtml(r.text.substring(0, 300))}${r.text.length > 300 ? '...' : ''}</div>
    </div>`).join('') || '<p class="muted">No negative reviews with text found.</p>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Review Intelligence - ${escapeHtml(biz.name)}</title>
  <style>
    :root {
      --primary: #00695c;
      --primary-light: #e0f2f1;
      --positive: #0a7a2e;
      --negative: #c0392b;
      --neutral: #7f8c8d;
      --bg: #f5f7fa;
      --card: #ffffff;
      --text: #2c3e50;
      --border: #e0e0e0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }

    .header {
      background: linear-gradient(135deg, var(--primary), #004d40);
      color: white; padding: 24px 40px; display: flex; align-items: center; justify-content: space-between;
    }
    .header h1 { font-size: 1.6rem; font-weight: 600; }
    .header .meta { font-size: 0.85rem; opacity: 0.85; text-align: right; }
    .header .big-rating { font-size: 2.4rem; font-weight: 700; margin-right: 12px; }

    .container { max-width: 1200px; margin: 0 auto; padding: 24px 20px; }

    .stat-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .stat-card {
      background: var(--card); border-radius: 10px; padding: 20px; text-align: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06); border-top: 3px solid var(--primary);
    }
    .stat-card .value { font-size: 2rem; font-weight: 700; color: var(--primary); }
    .stat-card .label { font-size: 0.8rem; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }

    .section { background: var(--card); border-radius: 10px; padding: 24px; margin-bottom: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .section h2 { font-size: 1.2rem; color: var(--primary); margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid var(--primary-light); }

    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); }
    th { background: var(--primary-light); color: var(--primary); font-weight: 600; font-size: 0.85rem; }

    .bar-bg { background: #eee; border-radius: 4px; height: 20px; overflow: hidden; min-width: 100px; }
    .bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }

    .star { color: #ddd; font-size: 1.1em; }
    .star.filled { color: #f59e0b; }

    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: 600; }
    .badge.positive { background: #d4edda; color: var(--positive); }
    .badge.negative { background: #f8d7da; color: var(--negative); }
    .badge.neutral { background: #e2e3e5; color: var(--neutral); }

    .theme-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; }

    .review-card {
      border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 12px;
      transition: box-shadow 0.2s;
    }
    .review-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
    .review-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; flex-wrap: wrap; gap: 8px; }
    .reviewer-info strong { font-size: 0.95rem; }
    .reviewer-meta { display: block; font-size: 0.75rem; color: #888; margin-top: 2px; }
    .local-guide-badge { display: inline-block; background: #e8f5e9; color: var(--positive); padding: 1px 6px; border-radius: 8px; font-size: 0.7rem; margin-left: 6px; }
    .review-date { font-size: 0.8rem; color: #888; margin-bottom: 8px; }
    .review-text { font-size: 0.9rem; line-height: 1.6; }
    .review-likes { font-size: 0.75rem; color: #888; margin-top: 8px; }
    .owner-response { background: var(--primary-light); border-radius: 6px; padding: 12px; margin-top: 12px; font-size: 0.85rem; }
    .owner-response strong { color: var(--primary); }
    .owner-response p { margin-top: 4px; }

    .highlight-card { border-radius: 8px; padding: 16px; margin-bottom: 10px; }
    .highlight-card.positive { background: #f0faf3; border-left: 4px solid var(--positive); }
    .highlight-card.negative { background: #fdf0f0; border-left: 4px solid var(--negative); }
    .hl-name { font-size: 0.8rem; color: #666; margin: 4px 0; }
    .hl-text { font-size: 0.88rem; }
    .hl-rating { margin-bottom: 4px; }

    .muted { color: #999; font-style: italic; }

    .filter-bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .filter-btn {
      padding: 6px 14px; border: 1px solid var(--border); border-radius: 20px;
      background: white; cursor: pointer; font-size: 0.8rem; transition: all 0.2s;
    }
    .filter-btn:hover, .filter-btn.active { background: var(--primary); color: white; border-color: var(--primary); }

    .footer { text-align: center; padding: 24px; color: #999; font-size: 0.75rem; }

    @media (max-width: 768px) {
      .header { flex-direction: column; gap: 12px; text-align: center; }
      .stat-cards { grid-template-columns: repeat(2, 1fr); }
      .review-header { flex-direction: column; }
    }

    @media print {
      .filter-bar { display: none; }
      .review-card { break-inside: avoid; }
    }
  </style>
</head>
<body>

<div class="header">
  <div style="display:flex;align-items:center;gap:16px">
    <span class="big-rating">${stats.average_rating}</span>
    <div>
      <h1>${escapeHtml(biz.name)}</h1>
      <div>${biz.category ? escapeHtml(biz.category) + ' - ' : ''}${escapeHtml(biz.address)}</div>
    </div>
  </div>
  <div class="meta">
    <div>Report generated: ${dateStr}</div>
    <div>Reviews scraped: ${stats.total_reviews}</div>
    <div>Sort: ${d.metadata.sort}</div>
    <div style="margin-top:8px;font-size:0.7rem;opacity:0.7">Kurama Review Intelligence</div>
  </div>
</div>

<div class="container">

  <!-- STAT CARDS -->
  <div class="stat-cards">
    <div class="stat-card">
      <div class="value">${stats.total_reviews}</div>
      <div class="label">Reviews Scraped</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.average_rating}</div>
      <div class="label">Average Rating</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.response_rate}%</div>
      <div class="label">Owner Response Rate</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.local_guides}</div>
      <div class="label">Local Guides</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.sentiment.positive}</div>
      <div class="label">Positive Reviews</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.sentiment.negative}</div>
      <div class="label">Negative Reviews</div>
    </div>
  </div>

  <!-- RATING DISTRIBUTION -->
  <div class="section">
    <h2>Rating Distribution</h2>
    <table>
      <thead><tr><th>Rating</th><th>Count</th><th>Distribution</th><th>%</th></tr></thead>
      <tbody>${distRows}</tbody>
    </table>
  </div>

  <!-- THEME ANALYSIS -->
  <div class="section">
    <h2>Theme Analysis</h2>
    <table>
      <thead><tr><th>Theme</th><th>Mentions</th><th>%</th><th>Distribution</th></tr></thead>
      <tbody>${themeRows}</tbody>
    </table>
  </div>

  <!-- TOP POSITIVE REVIEWS -->
  <div class="section">
    <h2>Top Positive Reviews</h2>
    ${topPositiveCards}
  </div>

  <!-- TOP CONCERNS -->
  <div class="section">
    <h2>Top Concerns (Low Ratings)</h2>
    ${topNegativeCards}
  </div>

  <!-- ALL REVIEWS -->
  <div class="section">
    <h2>All Reviews (${stats.total_reviews})</h2>
    <div class="filter-bar">
      <button class="filter-btn active" onclick="filterReviews('all')">All</button>
      <button class="filter-btn" onclick="filterReviews('5')">5 Star (${dist[5]})</button>
      <button class="filter-btn" onclick="filterReviews('4')">4 Star (${dist[4]})</button>
      <button class="filter-btn" onclick="filterReviews('3')">3 Star (${dist[3]})</button>
      <button class="filter-btn" onclick="filterReviews('2')">2 Star (${dist[2]})</button>
      <button class="filter-btn" onclick="filterReviews('1')">1 Star (${dist[1]})</button>
    </div>
    <div id="reviews-container">
      ${reviewCards}
    </div>
  </div>

</div>

<div class="footer">
  Generated by Kurama Review Intelligence - Agentic PPC Ads<br>
  ${dateStr} - ${stats.total_reviews} reviews analyzed
</div>

<script>
function filterReviews(rating) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('.review-card').forEach(card => {
    if (rating === 'all' || card.dataset.rating === rating) {
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }
  });
}
</script>

</body>
</html>`;

  const bizSlug = slugify(biz.name || 'unknown');
  const reportPath = path.join(outputDir, `review_report_${bizSlug}_${dateStr}.html`);
  backupIfExists(reportPath);
  fs.writeFileSync(reportPath, html);
  log(`Report saved: ${reportPath}`);

  return reportPath;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// WARMUP (for fresh profiles)
// ============================================================

async function warmupProfile(page) {
  const isFirstRun = !fs.existsSync(path.join(PROFILE_DIR, 'Default', 'Cookies'));

  if (!isFirstRun) {
    log('Existing profile detected, skipping warmup');
    return;
  }

  log('Fresh profile detected, running warmup searches...');
  const warmupQueries = [
    'weather today',
    'bbc news',
    'best restaurants near me',
  ];

  for (const q of warmupQueries) {
    try {
      await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await handleConsent(page);

      const searchBox = await trySelectors(page, config.selectors.searchBox, { timeout: 8000 });
      if (searchBox) {
        await typeHumanLike(page, searchBox, q);
        await page.keyboard.press('Enter');
        await sleep(randomDelay(3000, 5000));
        await randomMouseMove(page);
        await sleep(randomDelay(2000, 4000));
      }
    } catch {
      // Warmup failure is non-fatal
    }
  }

  log('Warmup complete');
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const args = parseArgs();

  console.log('\n============================================');
  console.log('  KURAMA REVIEW SCRAPER');
  console.log('  Zero-cost Google Maps review intelligence');
  console.log('============================================\n');

  log(`Client: ${args.clientName}`);
  log(`Business: ${args.business}`);
  log(`Location: ${args.location || '(none)'}`);
  log(`Target reviews: ${args.reviews}`);
  log(`Sort: ${args.sort}`);
  log(`Debug: ${args.debug}`);

  if (args.dryRun) {
    log('DRY RUN - would scrape with the above settings');
    process.exit(0);
  }

  // Determine output directory - defaults to repo-level clients/ (kurama-os convention)
  const REPO_ROOT = path.resolve(SKILL_ROOT, '..', '..', '..');
  const rootDir = args.root || path.join(REPO_ROOT, 'clients');
  const outputDir = path.join(rootDir, args.clientName, 'reviews', timestamp());
  fs.mkdirSync(outputDir, { recursive: true });
  log(`Output: ${outputDir}`);

  let context, page;

  try {
    // Launch browser
    ({ context, page } = await launchBrowser(args.headless));

    // Warmup if fresh profile
    await warmupProfile(page);

    // Search for business on Google Maps
    await searchBusiness(page, args.business, args.location);

    // Select the business from results
    await selectBusiness(page, args.business, args.debug, outputDir);

    // Get business info
    const businessInfo = await getBusinessInfo(page);

    // Debug screenshot after landing on business
    if (args.debug) {
      await page.screenshot({ path: path.join(outputDir, 'debug_business_page.png'), fullPage: false });
    }

    // Open reviews tab
    await openReviewsTab(page);

    // Set sort order
    await setSortOrder(page, args.sort);

    // Debug screenshot of reviews panel
    if (args.debug) {
      await page.screenshot({ path: path.join(outputDir, 'debug_reviews_panel.png'), fullPage: false });
    }

    // Scroll to load reviews
    const loaded = await scrollAndLoad(page, args.reviews, args.expandAll, args.debug, outputDir);

    if (loaded === 0) {
      logError('No reviews loaded. Possible causes:');
      logError('  - Business has no reviews');
      logError('  - Reviews tab did not open correctly');
      logError('  - Google Maps layout changed (check debug files)');

      if (args.debug) {
        const html = await page.content();
        fs.writeFileSync(path.join(outputDir, 'debug_full_page.html'), html);
      }

      await context.close();
      process.exit(EXIT.NO_REVIEWS);
    }

    // Extract reviews
    const rawReviews = await extractReviews(page);

    if (rawReviews.length === 0) {
      logError('Reviews loaded but extraction failed. Selectors may need updating.');
      logError('Run with --debug and check debug_full_page.html');

      if (args.debug) {
        const html = await page.content();
        fs.writeFileSync(path.join(outputDir, 'debug_full_page.html'), html);
      }

      await context.close();
      process.exit(EXIT.NO_REVIEWS);
    }

    // Build structured data
    const structuredData = buildStructuredData(rawReviews, businessInfo, args);

    // Build CSV
    const csvData = buildCSV(rawReviews);

    // Save all outputs
    const paths = saveOutputs(rawReviews, structuredData, csvData, outputDir);

    // Generate HTML report
    const reportPath = generateHTMLReport(structuredData, outputDir);

    // Summary
    console.log('\n============================================');
    console.log('  SCRAPE COMPLETE');
    console.log('============================================');
    console.log(`  Business: ${businessInfo.name}`);
    console.log(`  Rating: ${businessInfo.rating} (${businessInfo.totalReviews} total on Google)`);
    console.log(`  Scraped: ${rawReviews.length} reviews`);
    console.log(`  Average: ${structuredData.statistics.average_rating}`);
    console.log(`  Response rate: ${structuredData.statistics.response_rate}%`);
    console.log('');
    console.log('  Output files:');
    console.log(`    Raw JSON:    ${paths.rawPath}`);
    console.log(`    Data JSON:   ${paths.structPath}`);
    console.log(`    CSV:         ${paths.csvPath}`);
    console.log(`    HTML Report: ${reportPath}`);
    console.log('============================================\n');

  } catch (error) {
    logError(error.message);

    if (args.debug && page) {
      try {
        const html = await page.content();
        fs.writeFileSync(path.join(outputDir, 'debug_error.html'), html);
        await page.screenshot({ path: path.join(outputDir, 'debug_error.png'), fullPage: true });
        logError('Debug files saved');
      } catch {
        // Best effort
      }
    }

    process.exit(error.exitCode || 1);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

main();
