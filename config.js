// ============================================================
// KURAMA REVIEW SCRAPER - Configuration
// Update selectors here when Google Maps changes layout
// ============================================================

module.exports = {
  // Branding
  businessName: 'Agentic PPC Ads',
  logoPath: 'images/appca_logo.jpeg',

  // Default scrape settings
  defaults: {
    reviews: 50,
    sort: 'relevant',   // 'relevant' | 'newest' | 'highest' | 'lowest'
    expandAll: true,     // Click "More" buttons to get full review text
    debug: false,        // Save debug screenshots and HTML
    maxScrollAttempts: 400,  // Safety limit for infinite scroll (847-review feeds need ~170+ scrolls at ~5/scroll)
    scrollPauseMin: 1500,
    scrollPauseMax: 3000,
  },

  // -----------------------------------------------------------
  // SELECTORS - Update these when Google Maps changes layout
  // Each key has an array of selectors tried in order (fallback)
  // -----------------------------------------------------------
  selectors: {
    // Search (Google Maps 2026: input#searchboxinput removed, now uses name="q" + role="combobox")
    searchBox: ['input[name="q"]', 'input[role="combobox"]', 'input#searchboxinput', 'input.UGojuc'],
    searchButton: ['button[aria-label="Search"]', 'button.mL3xi', 'button#searchbox-searchbutton'],

    // Consent dialog (cookie banner)
    consentAccept: [
      'button[aria-label*="Accept all"]',
      'button[aria-label*="Accept"]',
      'form[action*="consent"] button:first-of-type',
      '[aria-label="Accept all"]',
    ],

    // Reviews tab on place page
    reviewsTab: [
      'button[aria-label*="Reviews"]',
      'button[aria-label*="reviews"]',
      'button[data-tab-id="reviews"]',
      '[role="tab"][aria-label*="review"]',
    ],

    // Sort controls
    sortButton: [
      'button[aria-label="Sort reviews"]',
      'button[aria-label*="Sort"]',
      'button[data-value="Sort"]',
    ],
    sortMenuItems: {
      relevant: ['Most relevant', 'Relevance'],
      newest: ['Newest', 'Most recent'],
      highest: ['Highest rating', 'Highest'],
      lowest: ['Lowest rating', 'Lowest'],
    },

    // Review containers (tried in order)
    reviewContainer: [
      '[data-review-id]',
      '.jftiEf',
      'div[aria-label*="review"]',
    ],

    // Fields within a review container
    reviewerName: ['.d4r55', 'button[data-review-id] span', '.WNxzHc a'],
    reviewerLink: ['.WNxzHc a', 'a[href*="contrib"]'],
    reviewRating: ['[aria-label*="star"], [aria-label*="Star"]'],
    reviewDate: ['.rsqaWe', 'span.dehysf'],
    reviewText: ['.wiI7pd', '.MyEned', '.Jtu6Td span'],
    moreButton: [
      'button.w8nwRe.kyuRq',
      'button[aria-label="See more"]',
      'button.kyuRq',
    ],
    ownerResponse: ['.CDe7pd', '.d2DgGd'],
    ownerResponseDate: ['.DZSIDd'],
    reviewerMeta: ['.RfnDt', 'span.A503be'],  // "X reviews - Y photos"
    localGuideBadge: ['.QV3IV', '.d4r55 + span', '[aria-label*="Local Guide"]'],
    reviewImages: ['.KtCyie img', 'button.Tya61d img'],
    likesCount: ['.GBkF3d', 'span[aria-label*="likes"]'],

    // Scrollable reviews container (for infinite scroll)
    scrollablePanel: [
      'div.m6QErb.DxyBCb',
      'div.m6QErb',
      '[role="feed"]',
    ],

    // Business info on place page
    businessTitle: ['h1.DUwDvf', 'h1', '[data-attrid="title"]'],
    businessAddress: ['button[data-item-id="address"]', '.rogA2c .Io6YTe'],
    businessRating: ['div.F7nice span[aria-hidden="true"]', '.F7nice span'],
    businessTotalReviews: ['span.UY7F9', 'span.HHrUdb', 'button[aria-label*="reviews"] span'],
    businessCategory: ['button[jsaction*="category"]', '.DkEaL'],
    businessPhone: ['button[data-item-id*="phone"]', '.rogA2c a[href^="tel:"]'],
  },

  // Human-like typing delays (ms)
  delays: {
    typingMin: 50,
    typingMax: 150,
    afterSearchMin: 3000,
    afterSearchMax: 5000,
    beforeClickMin: 500,
    beforeClickMax: 1500,
    afterTabClickMin: 2000,
    afterTabClickMax: 4000,
    afterSortMin: 2000,
    afterSortMax: 4000,
    mouseMovePauseMin: 100,
    mouseMovePauseMax: 400,
  },

  // User agent rotation pool (real Chrome UAs)
  userAgents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  ],

  // Sentiment keywords for report analysis
  sentimentPatterns: {
    positive: [
      'excellent', 'amazing', 'great', 'fantastic', 'wonderful', 'best',
      'love', 'perfect', 'outstanding', 'professional', 'friendly', 'helpful',
      'recommend', 'quick', 'clean', 'reliable', 'efficient', 'superb',
      'incredible', 'brilliant', 'exceptional', 'delighted', 'impressed',
    ],
    negative: [
      'terrible', 'awful', 'worst', 'horrible', 'rude', 'slow', 'dirty',
      'expensive', 'disappointing', 'poor', 'avoid', 'waste', 'unprofessional',
      'broken', 'scam', 'overpriced', 'nightmare', 'useless', 'disgusting',
      'unacceptable', 'incompetent', 'dreadful',
    ],
  },

  // Theme detection patterns for review analysis
  themePatterns: [
    { name: 'Customer Service', keywords: ['staff', 'service', 'team', 'helpful', 'friendly', 'rude', 'polite', 'responsive', 'customer service'], color: '#1565C0' },
    { name: 'Value/Pricing', keywords: ['price', 'value', 'expensive', 'cheap', 'worth', 'cost', 'money', 'affordable', 'overpriced'], color: '#c65102' },
    { name: 'Quality', keywords: ['quality', 'excellent', 'poor', 'amazing', 'terrible', 'best', 'worst', 'standard', 'premium'], color: '#0a7a2e' },
    { name: 'Speed/Timing', keywords: ['fast', 'slow', 'quick', 'wait', 'time', 'late', 'prompt', 'delay', 'efficient'], color: '#8E24AA' },
    { name: 'Cleanliness', keywords: ['clean', 'dirty', 'tidy', 'mess', 'hygiene', 'spotless', 'filthy', 'neat'], color: '#00838F' },
    { name: 'Location/Access', keywords: ['location', 'parking', 'access', 'convenient', 'find', 'near', 'far', 'directions'], color: '#d4880f' },
    { name: 'Communication', keywords: ['communication', 'response', 'reply', 'contact', 'email', 'phone', 'callback', 'update'], color: '#4E342E' },
    { name: 'Professionalism', keywords: ['professional', 'expert', 'knowledgeable', 'experienced', 'skilled', 'competent', 'qualified'], color: '#752864' },
  ],
};
