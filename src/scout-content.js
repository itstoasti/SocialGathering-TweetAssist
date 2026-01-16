// Tweet Scout - Auto-scroll and tweet analysis content script
// Injected into Twitter/X pages

(function () {
  'use strict';

  // Prevent duplicate injection
  if (window.tweetScoutInjected) return;
  window.tweetScoutInjected = true;

  // State
  let isScoutingActive = false;
  let scrollInterval = null;
  let matchCount = 0;
  let scannedTweetIds = new Set();
  let repliedTweetIds = new Set(); // Track tweets we've replied to

  // Settings (loaded from storage)
  let settings = {
    minAge: 1, // in hours
    maxAge: 18, // in hours
    minViews: 250000,
    minFollowers: 0,
    scrollSpeed: 'medium',
    pauseOnMatch: true,
    autoGenerate: false,
    highlightMatches: true,
    soundNotification: false
  };

  // Scroll speed mappings (ms intervals)
  const SCROLL_SPEEDS = {
    slow: 3000,
    medium: 1500,
    fast: 800
  };

  // Load settings from storage
  async function loadSettings() {
    const result = await chrome.storage.local.get([
      'scout-min-age',
      'scout-max-age',
      'scout-min-views',
      'scout-min-followers',
      'scout-scroll-speed',
      'scout-pause-on-match',
      'scout-auto-generate',
      'scout-highlight-matches',
      'scout-sound-notification'
    ]);

    settings.minAge = result['scout-min-age'] ?? 1; // hours
    settings.maxAge = result['scout-max-age'] ?? 18; // hours
    settings.minViews = result['scout-min-views'] ?? 250000;
    settings.minFollowers = result['scout-min-followers'] ?? 0;
    settings.scrollSpeed = result['scout-scroll-speed'] || 'medium';
    settings.pauseOnMatch = result['scout-pause-on-match'] ?? true;
    settings.autoGenerate = result['scout-auto-generate'] ?? false;
    settings.highlightMatches = result['scout-highlight-matches'] ?? true;
    settings.soundNotification = result['scout-sound-notification'] ?? false;

    console.log('[Scout] Settings loaded:', settings);
  }

  // Update status in storage (for popup display)
  function updateStatus(status) {
    chrome.storage.local.set({ 'scout-status': status });
  }

  function updateMatchCount() {
    chrome.storage.local.set({ 'scout-match-count': matchCount });
  }

  // Track that scouting was active (for auto-resume after reply)
  function setScoutingWasActive(wasActive) {
    chrome.storage.local.set({ 'scout-was-active': wasActive });
  }

  // Add tweet to replied list (stored in memory and storage)
  async function markTweetAsReplied(tweetId) {
    if (!tweetId) return;
    repliedTweetIds.add(tweetId);

    // Also persist to storage for page refreshes
    const result = await chrome.storage.local.get(['scout-replied-tweets', 'stats-reset-hour']);
    const storedIds = result['scout-replied-tweets'] || [];
    const resetHour = result['stats-reset-hour'] || 0;

    if (!storedIds.includes(tweetId)) {
      storedIds.push(tweetId);
      // Keep only last 100 to avoid storage bloat
      if (storedIds.length > 100) storedIds.shift();
      chrome.storage.local.set({
        'scout-replied-tweets': storedIds,
        'scout-replied-date': getLogicDateKey(resetHour)
      });
    }
  }

  // Get the current "logic date" key based on reset hour (same as main extension)
  function getLogicDateKey(resetHour) {
    const now = new Date();
    // If current hour is before reset hour, we're still on "yesterday's" date
    if (now.getHours() < resetHour) {
      now.setDate(now.getDate() - 1);
    }
    return `${now.toDateString()}_${resetHour}`;
  }

  // Load replied tweets from storage (with daily reset check)
  async function loadRepliedTweets() {
    const result = await chrome.storage.local.get([
      'scout-replied-tweets',
      'scout-replied-date',
      'stats-reset-hour'
    ]);

    const resetHour = result['stats-reset-hour'] || 0;
    const currentDateKey = getLogicDateKey(resetHour);
    const storedDateKey = result['scout-replied-date'];

    // Check if we need to reset for a new day
    if (storedDateKey !== currentDateKey) {
      console.log(`[Scout] New day detected (${storedDateKey} -> ${currentDateKey}), resetting replied tweets`);
      // Clear the replied tweets for the new day
      repliedTweetIds.clear();
      chrome.storage.local.set({
        'scout-replied-tweets': [],
        'scout-replied-date': currentDateKey
      });
    } else {
      // Load existing replied tweets
      const storedIds = result['scout-replied-tweets'] || [];
      storedIds.forEach(id => repliedTweetIds.add(id));
      console.log(`[Scout] Loaded ${storedIds.length} replied tweets from storage`);
    }
  }

  // Auto-Scrape Mode
  let autoScrapeMode = false;
  let autoScrapeTarget = 10;
  let autoScrapeCount = 0;

  // Listen for auto-scrape message
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'start-auto-scrape') {
      console.log('[Scout] Auto-scrape started, target:', message.count);
      autoScrapeMode = true;
      autoScrapeTarget = message.count || 10;
      autoScrapeCount = 0;

      // Start scouting if not already running
      if (!isScoutingActive) {
        // Force settings for auto-scrape
        settings.pauseOnMatch = false; // Don't pause, just collect
        settings.highlightMatches = true;

        startScouting();

        // Ensure panel is open to show progress
        if (panel && panel.classList.contains('minimized')) {
          toggleMinimize();
        }
      }
    }
  });

  // Parse tweet time from the <time> element
  function extractTweetAge(tweetElement) {
    const timeElement = tweetElement.querySelector('time[datetime]');
    if (!timeElement) return null;

    const datetime = timeElement.getAttribute('datetime');
    if (!datetime) return null;

    const tweetTime = new Date(datetime);
    const now = new Date();
    const ageMinutes = (now - tweetTime) / (1000 * 60);

    return ageMinutes;
  }

  // Parse view count from tweet (e.g., "1.2K views", "500 views", "67K views")
  function extractViewCount(tweetElement) {
    // Twitter shows views in different places depending on the layout
    // Try multiple strategies to find the view count

    // Strategy 1: Look in the analytics link
    const analyticsGroup = tweetElement.querySelector('[role="group"]');
    if (analyticsGroup) {
      // Look for analytics links
      const links = analyticsGroup.querySelectorAll('a[href*="/analytics"]');
      for (const link of links) {
        const text = link.textContent || '';
        const ariaLabel = link.getAttribute('aria-label') || '';

        // Check textContent
        const viewMatch = text.match(/([\d,.]+)\s*([KMB])?\s*views?/i);
        if (viewMatch) {
          const count = parseCount(viewMatch[1] + (viewMatch[2] || ''));
          console.log(`[Scout] Found views in analytics link text: ${text} -> ${count}`);
          return count;
        }

        // Check aria-label
        const ariaMatch = ariaLabel.match(/([\d,.]+)\s*([KMB])?\s*views?/i);
        if (ariaMatch) {
          const count = parseCount(ariaMatch[1] + (ariaMatch[2] || ''));
          console.log(`[Scout] Found views in aria-label: ${ariaLabel} -> ${count}`);
          return count;
        }
      }

      // Strategy 2: Look for any element containing "views" text
      const allElements = analyticsGroup.querySelectorAll('*');
      for (const el of allElements) {
        if (el.children.length === 0) { // Leaf nodes only
          const text = el.textContent || '';
          const match = text.match(/([\d,.]+)\s*([KMB])?\s*views?/i);
          if (match) {
            const count = parseCount(match[1] + (match[2] || ''));
            console.log(`[Scout] Found views in element: ${text} -> ${count}`);
            return count;
          }
        }
      }
    }

    // Strategy 3: Search the entire tweet for view counts
    const tweetText = tweetElement.textContent || '';
    const viewPatterns = [
      /([\d,.]+)\s*([KMB])\s*views?/gi,  // "67K views"
      /([\d,]+)\s*views?/gi               // "67,000 views"
    ];

    for (const pattern of viewPatterns) {
      const matches = [...tweetText.matchAll(pattern)];
      if (matches.length > 0) {
        // Take the last match (usually the view count is in the footer)
        const lastMatch = matches[matches.length - 1];
        const count = parseCount(lastMatch[1] + (lastMatch[2] || ''));
        console.log(`[Scout] Found views in tweet text: ${lastMatch[0]} -> ${count}`);
        return count;
      }
    }

    console.log('[Scout] Could not find view count in tweet');
    return null;
  }

  // Parse count strings like "1.2K", "500", "2.5M"
  function parseCount(str) {
    if (!str) return 0;
    str = str.replace(/,/g, '').trim().toUpperCase();

    const multipliers = { 'K': 1000, 'M': 1000000, 'B': 1000000000 };
    const match = str.match(/([\d.]+)([KMB])?/);

    if (!match) return 0;

    let num = parseFloat(match[1]);
    if (match[2] && multipliers[match[2]]) {
      num *= multipliers[match[2]];
    }

    return Math.round(num);
  }

  // Get tweet ID for deduplication
  function getTweetId(tweetElement) {
    const links = tweetElement.querySelectorAll('a[href*="/status/"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      const match = href?.match(/\/status\/(\d+)/);
      if (match) return match[1];
    }
    return null;
  }

  // Extract tweet info for dashboard storage
  function extractTweetInfo(tweetElement) {
    const tweetId = getTweetId(tweetElement);
    if (!tweetId) return null;

    // Get handle
    const userElement = tweetElement.querySelector('[data-testid="User-Name"]');
    let handle = '';
    if (userElement) {
      const links = userElement.querySelectorAll('a');
      links.forEach(link => {
        const href = link.getAttribute('href');
        if (href && href.startsWith('/') && !href.includes('/status/')) {
          handle = href.substring(1);
        }
      });
    }

    // Get tweet text
    const textElement = tweetElement.querySelector('[data-testid="tweetText"]');
    const text = textElement ? textElement.innerText : '';

    // Get age
    const ageMinutes = extractTweetAge(tweetElement);
    let ageStr = '';
    if (ageMinutes !== null) {
      if (ageMinutes < 60) {
        ageStr = `${Math.round(ageMinutes)}m`;
      } else {
        ageStr = `${(ageMinutes / 60).toFixed(1)}h`;
      }
    }

    // Get views
    const views = extractViewCount(tweetElement);

    // Extract media URLs (images and video thumbnails)
    const mediaUrls = [];
    const seenUrls = new Set();

    // Check if this tweet has a video player
    const hasVideo = tweetElement.querySelector('[data-testid="videoPlayer"]') !== null;

    // Get video thumbnail first (if video exists)
    if (hasVideo) {
      const videoPlayers = tweetElement.querySelectorAll('[data-testid="videoPlayer"]');
      videoPlayers.forEach(player => {
        // Get the thumbnail image from videoPlayer
        const posterImg = player.querySelector('img');
        if (posterImg && posterImg.src && !seenUrls.has(posterImg.src)) {
          seenUrls.add(posterImg.src);
          mediaUrls.push({ type: 'video', url: posterImg.src });
        } else {
          // Fallback to video poster attribute
          const video = player.querySelector('video');
          if (video && video.poster && !seenUrls.has(video.poster)) {
            seenUrls.add(video.poster);
            mediaUrls.push({ type: 'video', url: video.poster });
          }
        }
      });
    } // End video capture

    // Always check for photo images (allow mixed media)
    const photos = tweetElement.querySelectorAll('[data-testid="tweetPhoto"] img');
    photos.forEach(img => {
      const src = img.src;
      if (src && src.includes('pbs.twimg.com') && !seenUrls.has(src)) {
        seenUrls.add(src);
        const largerSrc = src.replace(/&name=\w+$/, '&name=medium');
        mediaUrls.push({ type: 'image', url: largerSrc });
      }
    });

    // Get card images (link previews) - but not if already have media
    if (mediaUrls.length === 0) {
      const cardImages = tweetElement.querySelectorAll('[data-testid="card.wrapper"] img');
      cardImages.forEach(img => {
        if (img.src && img.src.includes('pbs.twimg.com') && !seenUrls.has(img.src)) {
          seenUrls.add(img.src);
          mediaUrls.push({ type: 'card', url: img.src });
        }
      });
    }

    return {
      id: tweetId,
      handle: handle,
      text: text.substring(0, 500),
      age: ageStr,
      views: views,
      mediaUrls: mediaUrls.slice(0, 4), // Max 4 media items
      timestamp: Date.now()
    };
  }

  // Store matched tweet for dashboard
  async function storeMatchedTweet(tweetInfo) {
    if (!tweetInfo) return;

    const result = await chrome.storage.local.get(['scout-matched-tweets']);
    const tweets = result['scout-matched-tweets'] || [];

    // Check if already stored
    if (tweets.some(t => t.id === tweetInfo.id)) return;

    // Add to beginning of array
    tweets.unshift(tweetInfo);

    // Keep only last 50 matches
    if (tweets.length > 50) tweets.pop();

    await chrome.storage.local.set({ 'scout-matched-tweets': tweets });
    console.log('[Scout] Stored matched tweet for dashboard:', tweetInfo.id);
  }


  // Check if tweet matches filter criteria
  function meetsFilterCriteria(tweetElement) {
    const age = extractTweetAge(tweetElement);
    const views = extractViewCount(tweetElement);

    // Convert age settings from hours to minutes
    const minAgeMinutes = settings.minAge * 60;
    const maxAgeMinutes = settings.maxAge * 60;

    // Add a small tolerance buffer (10 min) for the max age to account for
    // tweets showing "8h" but actually being 8h 5min old
    const maxAgeTolerance = 10;

    console.log(`[Scout] Tweet analysis - Age: ${age?.toFixed(1)}min (${(age / 60)?.toFixed(2)}hrs), Views: ${views?.toLocaleString()}, Settings: ${settings.minAge}-${settings.maxAge}hrs, MinViews: ${settings.minViews.toLocaleString()}`);

    // Age check - must be within the range [minAge, maxAge + tolerance]
    if (age !== null) {
      if (age < minAgeMinutes) {
        console.log(`[Scout] ❌ Rejected: Age ${(age / 60).toFixed(2)}hrs is less than min ${settings.minAge}hrs`);
        return false;
      }
      if (age > maxAgeMinutes + maxAgeTolerance) {
        console.log(`[Scout] ❌ Rejected: Age ${(age / 60).toFixed(2)}hrs exceeds max ${settings.maxAge}hrs (+ ${maxAgeTolerance}min tolerance)`);
        return false;
      }
    } else {
      // If we can't determine age, skip this tweet
      console.log('[Scout] ❌ Rejected: Could not determine tweet age');
      return false;
    }

    // Views check - MUST have at least minViews
    // If minViews is set (> 0) and we couldn't extract views, reject the tweet
    if (settings.minViews > 0) {
      if (views === null) {
        console.log('[Scout] ❌ Rejected: Could not determine view count');
        return false;
      }
      if (views < settings.minViews) {
        console.log(`[Scout] ❌ Rejected: Views ${views.toLocaleString()} < required ${settings.minViews.toLocaleString()}`);
        return false;
      }
    }

    console.log(`[Scout] ✅ MATCH: Age ${(age / 60).toFixed(2)}hrs, Views ${views?.toLocaleString() || 'N/A'}`);
    return true;
  }

  // Highlight a matching tweet
  function highlightTweet(tweetElement) {
    if (!settings.highlightMatches) return;

    tweetElement.style.boxShadow = '0 0 0 3px #00ba7c, 0 0 20px rgba(0, 186, 124, 0.3)';
    tweetElement.style.borderRadius = '16px';
    tweetElement.style.transition = 'box-shadow 0.3s ease';

    // Add scout badge
    if (!tweetElement.querySelector('.scout-match-badge')) {
      const badge = document.createElement('div');
      badge.className = 'scout-match-badge';
      badge.innerHTML = '🔍 Scout Match';
      badge.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        background: linear-gradient(135deg, #00ba7c, #1d9bf0);
        color: white;
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 600;
        z-index: 1000;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      `;
      tweetElement.style.position = 'relative';
      tweetElement.appendChild(badge);
    }
  }

  // Play notification sound
  function playNotificationSound() {
    if (!settings.soundNotification) return;

    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (e) {
      console.log('[Scout] Could not play sound:', e);
    }
  }

  // Scan visible tweets
  function scanTweets() {
    const tweets = document.querySelectorAll('[data-testid="tweet"]');

    for (const tweet of tweets) {
      const tweetId = getTweetId(tweet);
      if (!tweetId || scannedTweetIds.has(tweetId)) continue;

      scannedTweetIds.add(tweetId);

      // Skip tweets we've already replied to
      if (repliedTweetIds.has(tweetId)) {
        console.log(`[Scout] Skipping already-replied tweet: ${tweetId}`);
        continue;
      }

      if (meetsFilterCriteria(tweet)) {
        console.log(`[Scout] ✅ Match found! Tweet ID: ${tweetId}`);
        matchCount++;
        updateMatchCount();

        // Store tweet info for dashboard
        const tweetInfo = extractTweetInfo(tweet);
        storeMatchedTweet(tweetInfo);

        highlightTweet(tweet);
        playNotificationSound();

        if (settings.pauseOnMatch && !autoScrapeMode) {
          stopScouting();
          // Scroll the matched tweet into view
          tweet.scrollIntoView({ behavior: 'smooth', block: 'center' });
          updateStatus('Paused');
          return true; // Found a match
        }

        // Handle Auto-Scrape Mode
        if (autoScrapeMode) {
          autoScrapeCount++;
          console.log(`[Scout] Auto-scrape progress: ${autoScrapeCount}/${autoScrapeTarget}`);

          if (autoScrapeCount >= autoScrapeTarget) {
            console.log('[Scout] Auto-scrape target reached! Stopping...');
            stopScouting();
            updateStatus('Completed');

            // Notify background script to close tab
            chrome.runtime.sendMessage({ action: 'auto-scrape-done' });
            return true;
          }
        }

        if (settings.autoGenerate) {
          // Trigger the existing Tweet Assist button if present
          const assistButton = tweet.querySelector('.tweet-assist-button');
          if (assistButton) {
            assistButton.click();
          }
        }
      }
    }

    return false;
  }

  // Auto-scroll function
  function doScroll() {
    window.scrollBy({
      top: 400,
      behavior: autoScrapeMode ? 'auto' : 'smooth' // Use instant scroll for auto-scrape (better for background)
    });

    // Scan after scroll settles
    setTimeout(scanTweets, 500);
  }

  // Start scouting
  async function startScouting() {
    if (isScoutingActive) return;

    await loadSettings();
    isScoutingActive = true;
    updateStatus('Scouting');

    console.log('[Scout] 🚀 Scouting started with settings:', settings);

    const interval = SCROLL_SPEEDS[settings.scrollSpeed] || 1500;
    scrollInterval = setInterval(doScroll, interval);

    // Initial scan
    scanTweets();

    updateFloatingPanelState();
  }

  // Stop scouting
  function stopScouting() {
    if (!isScoutingActive) return;

    isScoutingActive = false;
    if (scrollInterval) {
      clearInterval(scrollInterval);
      scrollInterval = null;
    }

    updateStatus('Idle');
    console.log('[Scout] ⏹️ Scouting stopped');

    updateFloatingPanelState();
  }

  // Toggle scouting
  function toggleScouting() {
    if (isScoutingActive) {
      stopScouting();
    } else {
      startScouting();
    }
  }

  // Create floating control panel
  function createFloatingPanel() {
    if (document.getElementById('scout-floating-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'scout-floating-panel';
    panel.innerHTML = `
      <div class="scout-panel-header">
        <span>🔍 Scout</span>
        <button id="scout-panel-minimize" title="Minimize">−</button>
      </div>
      <div class="scout-panel-body">
        <div class="scout-panel-stats">
          <div class="scout-stat">
            <span class="scout-stat-value" id="scout-panel-matches">0</span>
            <span class="scout-stat-label">Matches</span>
          </div>
          <div class="scout-stat">
            <span class="scout-stat-value" id="scout-panel-replied">${repliedTweetIds.size}</span>
            <span class="scout-stat-label">Replied</span>
          </div>
          <div class="scout-stat">
            <span class="scout-stat-value" id="scout-panel-scanned">${scannedTweetIds.size}</span>
            <span class="scout-stat-label">Scanned</span>
          </div>
        </div>
        
        <div class="scout-settings-section">
          <div class="scout-setting-row">
            <label>Age Range (hrs)</label>
            <div class="scout-input-group">
              <input type="number" id="scout-input-min-age" value="${settings.minAge}" min="0" max="48" step="0.5">
              <span>-</span>
              <input type="number" id="scout-input-max-age" value="${settings.maxAge}" min="0.5" max="48" step="0.5">
            </div>
          </div>
          <div class="scout-setting-row">
            <label>Min Views</label>
            <input type="text" id="scout-input-min-views" value="${settings.minViews.toLocaleString()}" class="scout-input-full">
          </div>
          <div class="scout-setting-row">
            <label>System Prompt</label>
            <select id="scout-prompt-select" class="scout-input-full"></select>
          </div>
        </div>
        
        <button id="scout-toggle-btn" class="scout-btn-primary">
          ▶️ Start
        </button>
      </div>
    `;

    // Styles
    panel.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 20px;
      width: 200px;
      background: rgba(0, 0, 0, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      z-index: 99999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: white;
      overflow: hidden;
      backdrop-filter: blur(20px);
    `;

    // Inject additional styles
    const style = document.createElement('style');
    style.textContent = `
      #scout-floating-panel .scout-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        background: linear-gradient(135deg, rgba(0, 186, 124, 0.3), rgba(29, 155, 240, 0.3));
        font-weight: 600;
        font-size: 14px;
        cursor: move;
      }
      #scout-floating-panel .scout-panel-header button {
        background: none;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
        opacity: 0.7;
        transition: opacity 0.2s;
      }
      #scout-floating-panel .scout-panel-header button:hover {
        opacity: 1;
      }
      #scout-floating-panel .scout-panel-body {
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      #scout-floating-panel .scout-panel-stats {
        display: flex;
        justify-content: space-around;
        text-align: center;
      }
      #scout-floating-panel .scout-stat-value {
        display: block;
        font-size: 20px;
        font-weight: bold;
        color: #00ba7c;
      }
      #scout-floating-panel .scout-stat-label {
        font-size: 11px;
        opacity: 0.7;
      }
      #scout-floating-panel .scout-settings-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px;
        background: rgba(255,255,255,0.05);
        border-radius: 8px;
      }
      #scout-floating-panel .scout-setting-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      #scout-floating-panel .scout-setting-row label {
        font-size: 10px;
        opacity: 0.7;
        text-transform: uppercase;
      }
      #scout-floating-panel .scout-input-group {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      #scout-floating-panel .scout-input-group span {
        opacity: 0.5;
      }
      #scout-floating-panel .scout-input-group input {
        width: 50px;
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 6px;
        color: white;
        padding: 4px 6px;
        font-size: 12px;
        text-align: center;
      }
      #scout-floating-panel .scout-input-full {
        width: 100%;
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 6px;
        color: white;
        padding: 4px 8px;
        font-size: 12px;
        box-sizing: border-box;
      }
      #scout-floating-panel select {
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 6px;
        color: white;
        padding: 6px 8px;
        font-size: 12px;
        cursor: pointer;
      }
      #scout-floating-panel select option {
        background: #1a1a1a;
        color: white;
      }
      #scout-floating-panel input:focus,
      #scout-floating-panel select:focus {
        outline: none;
        border-color: #1d9bf0;
      }
      #scout-floating-panel .scout-btn-primary {
        background: linear-gradient(135deg, #00ba7c, #1d9bf0);
        border: none;
        color: white;
        padding: 8px 12px;
        border-radius: 20px;
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
      }
      #scout-floating-panel .scout-btn-primary:hover {
        transform: scale(1.02);
        box-shadow: 0 4px 12px rgba(0, 186, 124, 0.4);
      }
      #scout-floating-panel .scout-btn-primary.active {
        background: linear-gradient(135deg, #f4212e, #ff6b35);
      }
      #scout-floating-panel .scout-btn-secondary {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        padding: 6px 10px;
        border-radius: 16px;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.2s;
      }
      #scout-floating-panel .scout-btn-secondary:hover {
        background: rgba(255, 255, 255, 0.2);
      }
      #scout-floating-panel.minimized .scout-panel-body {
        display: none;
      }
      #scout-floating-panel.minimized {
        width: auto;
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(panel);

    // Event listeners
    document.getElementById('scout-toggle-btn').addEventListener('click', toggleScouting);
    document.getElementById('scout-panel-minimize').addEventListener('click', () => {
      panel.classList.toggle('minimized');
    });

    // Settings input listeners
    const minAgeInput = document.getElementById('scout-input-min-age');
    const maxAgeInput = document.getElementById('scout-input-max-age');
    const minViewsInput = document.getElementById('scout-input-min-views');

    function saveInlineSettings() {
      const minAge = parseFloat(minAgeInput.value) || 1;
      const maxAge = parseFloat(maxAgeInput.value) || 18;

      // Parse views - support K/M notation (e.g., "192k", "1.5M", "192000")
      let viewsStr = minViewsInput.value.replace(/,/g, '').trim().toUpperCase();
      let minViews = 250000;

      const match = viewsStr.match(/^([\d.]+)\s*([KMB])?$/);
      if (match) {
        let num = parseFloat(match[1]);
        if (match[2] === 'K') num *= 1000;
        else if (match[2] === 'M') num *= 1000000;
        else if (match[2] === 'B') num *= 1000000000;
        minViews = Math.round(num);
      }

      settings.minAge = minAge;
      settings.maxAge = maxAge;
      settings.minViews = minViews;

      // Save to storage so popup and future sessions have the same values
      chrome.storage.local.set({
        'scout-min-age': minAge,
        'scout-max-age': maxAge,
        'scout-min-views': minViews
      });

      // Update the views display with formatted number
      minViewsInput.value = minViews.toLocaleString();

      console.log('[Scout] Settings updated from widget:', settings);
    }

    minAgeInput.addEventListener('change', saveInlineSettings);
    maxAgeInput.addEventListener('change', saveInlineSettings);
    minViewsInput.addEventListener('change', saveInlineSettings);

    // System prompt dropdown handling
    const promptSelect = document.getElementById('scout-prompt-select');

    // Load saved prompts into dropdown
    chrome.storage.local.get(['saved-prompts', 'selected-prompt-id']).then((result) => {
      const prompts = result['saved-prompts'] || [];
      const selectedId = result['selected-prompt-id'];

      // Clear and rebuild dropdown
      promptSelect.innerHTML = '';

      if (prompts.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No prompts saved';
        promptSelect.appendChild(option);
      } else {
        prompts.forEach((prompt, index) => {
          const option = document.createElement('option');
          option.value = index;
          option.textContent = prompt.name || `Prompt ${index + 1}`;
          if (index.toString() === selectedId?.toString()) {
            option.selected = true;
          }
          promptSelect.appendChild(option);
        });
      }
    });

    // Save selection on change
    promptSelect.addEventListener('change', () => {
      const selectedIndex = promptSelect.value;
      chrome.storage.local.get(['saved-prompts']).then((result) => {
        const prompts = result['saved-prompts'] || [];
        if (prompts[selectedIndex]) {
          chrome.storage.local.set({
            'selected-prompt-id': selectedIndex,
            'gpt-query': prompts[selectedIndex].content
          });
          console.log('[Scout] Prompt switched to:', prompts[selectedIndex].name);
        }
      });
    });

    // Make draggable
    makeDraggable(panel, panel.querySelector('.scout-panel-header'));

    // Update stats periodically
    setInterval(updateFloatingPanelStats, 1000);
  }

  function updateFloatingPanelState() {
    const toggleBtn = document.getElementById('scout-toggle-btn');
    if (!toggleBtn) return;

    if (isScoutingActive) {
      toggleBtn.textContent = '⏹️ Stop';
      toggleBtn.classList.add('active');
    } else {
      toggleBtn.textContent = '▶️ Start';
      toggleBtn.classList.remove('active');
    }
  }

  function updateFloatingPanelStats() {
    const matchesEl = document.getElementById('scout-panel-matches');
    const repliedEl = document.getElementById('scout-panel-replied');
    const scannedEl = document.getElementById('scout-panel-scanned');

    if (matchesEl) matchesEl.textContent = matchCount;
    if (scannedEl) scannedEl.textContent = scannedTweetIds.size;

    // Get replied count from daily-stats (same as main extension)
    if (repliedEl) {
      chrome.storage.local.get(['daily-stats', 'stats-reset-hour']).then((result) => {
        const resetHour = result['stats-reset-hour'] || 0;
        const currentDateKey = getLogicDateKey(resetHour);
        const stats = result['daily-stats'] || { date: '', count: 0 };

        // Only show count if it's from today's date
        if (stats.date === currentDateKey) {
          repliedEl.textContent = stats.count || 0;
        } else {
          repliedEl.textContent = 0;
        }
      });
    }
  }

  function resetScout() {
    stopScouting();
    matchCount = 0;
    scannedTweetIds.clear();
    updateMatchCount();

    // Remove all highlights
    document.querySelectorAll('.scout-match-badge').forEach(el => el.remove());
    document.querySelectorAll('[data-testid="tweet"]').forEach(tweet => {
      tweet.style.boxShadow = '';
    });

    console.log('[Scout] 🔄 Reset complete');
  }

  // Make element draggable
  function makeDraggable(element, handle) {
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    handle.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = element.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      element.style.left = `${startLeft + deltaX}px`;
      element.style.top = `${startTop + deltaY}px`;
      element.style.right = 'auto';
      element.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  // Listen for keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+K - Toggle Scout
    if (e.ctrlKey && e.shiftKey && e.key === 'K') {
      e.preventDefault();
      toggleScouting();
    }

    // Ctrl+Shift+N - Skip to next (resume if paused)
    if (e.ctrlKey && e.shiftKey && e.key === 'N') {
      e.preventDefault();
      if (!isScoutingActive) {
        startScouting();
      }
    }
  });

  // Listen for settings changes (from popup) and resume signals
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      // Check for resume signal from reply window
      if (changes['scout-resume-scouting'] && changes['scout-resume-scouting'].newValue === true) {
        console.log('[Scout] 🔄 Resume signal received! Continuing to scout...');

        // Clear the flag immediately
        chrome.storage.local.remove('scout-resume-scouting');

        // Load any newly replied tweet IDs
        loadRepliedTweets().then(() => {
          // Resume scouting after a short delay
          setTimeout(() => {
            if (!isScoutingActive) {
              startScouting();
            }
          }, 1500);
        });
        return;
      }

      // Reload settings if any scout setting changed
      const scoutKeys = Object.keys(changes).filter(k => k.startsWith('scout-'));
      if (scoutKeys.length > 0) {
        loadSettings().then(() => {
          // Update input fields in floating panel
          const minAgeInput = document.getElementById('scout-input-min-age');
          const maxAgeInput = document.getElementById('scout-input-max-age');
          const minViewsInput = document.getElementById('scout-input-min-views');

          if (minAgeInput) minAgeInput.value = settings.minAge;
          if (maxAgeInput) maxAgeInput.value = settings.maxAge;
          if (minViewsInput) minViewsInput.value = settings.minViews.toLocaleString();
        });
      }
    }
  });

  // Initialize
  async function init() {
    // Only run on Twitter/X (but not on intent pages)
    if (!window.location.hostname.includes('twitter.com') && !window.location.hostname.includes('x.com')) {
      return;
    }

    // Don't run on intent popup pages
    if (window.location.pathname.includes('/intent/')) {
      return;
    }

    console.log('[Scout] 🔍 Tweet Scout initialized');

    // Load replied tweets from storage
    await loadRepliedTweets();

    await loadSettings();

    // Create floating panel after a short delay to ensure page is ready
    setTimeout(createFloatingPanel, 2000);

    // Note: Auto-resume is now handled by the storage change listener
    // which detects scout-resume-scouting flag in real-time without page reload
  }

  init();
})();
