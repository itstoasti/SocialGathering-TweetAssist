
// Open dashboard when extension icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard.html') });
});

// Handle messages from dashboard
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start-auto-scrape') {
    // Open X.com in a new WINDOW (popup) to avoid background tab throttling
    chrome.windows.create({
      url: 'https://x.com/home',
      type: 'popup',
      state: 'normal',
      width: 800,
      height: 600,
      focused: false
    }, (window) => {
      const tab = window.tabs[0];
      const windowId = window.id;

      // Store ID in local storage to survive SW restarts
      chrome.storage.local.set({
        'auto-scrape-window-id': windowId,
        'auto-scrape-tab-id': tab.id
      });

      // Wait for page to load, then send message to start scraping
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);

          // Small delay to ensure content script is ready
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, {
              action: 'start-auto-scrape',
              count: message.count || 12
            });
          }, 1500);
        }
      });
    });
    sendResponse({ success: true });
  }

  if (message.action === 'auto-scrape-done') {
    // Retrieve window ID from storage and close it
    chrome.storage.local.get(['auto-scrape-window-id'], (result) => {
      const windowId = result['auto-scrape-window-id'];
      if (windowId) {
        chrome.windows.remove(windowId).catch(err => console.log('Window close error:', err));
        chrome.storage.local.remove(['auto-scrape-window-id', 'auto-scrape-tab-id']);
      }
    });

    // Notify dashboard
    chrome.runtime.sendMessage({ action: 'auto-scrape-complete' });
  }

  // Handle opening compose window for posting
  if (message.action === 'open-compose-window') {
    chrome.tabs.create({
      url: 'https://x.com/compose/post',
      active: true
    }, (tab) => {
      // Wait for page to fully load, then inject the post content
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);

          // Small delay to ensure the compose modal is ready
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { action: 'inject-post-content' });
          }, 1500);
        }
      });
    });
    sendResponse({ success: true });
  }

  // Handle scheduling a post with alarm
  if (message.action === 'schedule-post-alarm') {
    const alarmName = `scheduled-post-${message.postId}`;
    const scheduledTime = message.scheduledTime;

    // Create alarm - chrome.alarms uses minutes from now or a timestamp
    chrome.alarms.create(alarmName, {
      when: scheduledTime
    });

    console.log(`[TweetAssist] Alarm created: ${alarmName} for ${new Date(scheduledTime).toLocaleString()}`);
    sendResponse({ success: true });
  }

  // Handle canceling a scheduled post alarm
  if (message.action === 'cancel-post-alarm') {
    const alarmName = `scheduled-post-${message.postId}`;
    chrome.alarms.clear(alarmName);
    console.log(`[TweetAssist] Alarm canceled: ${alarmName}`);
    sendResponse({ success: true });
  }

  return true;
});

// ============================================
// Alarm Listener - Triggers when scheduled post is due
// ============================================

// Track processing posts using storage to prevent duplicates
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('scheduled-post-')) return;

  const postId = alarm.name.replace('scheduled-post-', '');
  console.log(`[TweetAssist] Alarm fired for post: ${postId}`);

  // Prevent duplicate processing using storage lock (survives SW restarts)
  const lockKey = `processing_post_${postId}`;
  const lockResult = await chrome.storage.local.get([lockKey]);
  const lockTimestamp = lockResult[lockKey];

  if (lockTimestamp && (Date.now() - lockTimestamp < 60000)) {
    console.log(`[TweetAssist] Post ${postId} is locked (processing). Ignoring duplicate alarm.`);
    return;
  }

  // Set lock
  await chrome.storage.local.set({ [lockKey]: Date.now() });

  try {
    // Get the scheduled post from storage
    const result = await chrome.storage.local.get(['scheduled-posts']);
    const scheduledPosts = result['scheduled-posts'] || [];
    const post = scheduledPosts.find(p => p.id === postId);

    if (!post) {
      console.log(`[TweetAssist] Post not found: ${postId}`);
      await chrome.storage.local.remove([lockKey]);
      return;
    }

    // Set as pending post
    await chrome.storage.local.set({
      'pending-post': {
        text: post.text,
        mediaBase64: post.mediaBase64,
        mediaName: post.mediaName,
        timestamp: Date.now()
      }
    });

    // Add to posted history BEFORE removing from scheduled
    const historyResult = await chrome.storage.local.get(['posted-history']);
    const postedHistory = historyResult['posted-history'] || [];
    postedHistory.push({
      ...post,
      postedAt: Date.now()
    });
    await chrome.storage.local.set({ 'posted-history': postedHistory });

    // Remove from scheduled posts
    const updatedPosts = scheduledPosts.filter(p => p.id !== postId);
    await chrome.storage.local.set({ 'scheduled-posts': updatedPosts });

    // Open compose window
    chrome.tabs.create({
      url: 'https://x.com/compose/post',
      active: true
    }, (tab) => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { action: 'inject-post-content' });

            // Clean up lock after a delay
            setTimeout(() => {
              chrome.storage.local.remove([lockKey]);
            }, 10000);
          }, 2000);
        }
      });
    });

    console.log(`[TweetAssist] Scheduled post ${postId} triggered successfully`);
  } catch (error) {
    console.error(`[TweetAssist] Error processing scheduled post:`, error);
    await chrome.storage.local.remove([lockKey]);
  }
});

chrome.commands.onCommand.addListener((command) => {
  console.log("Handling: " + command)

  if (command === 'generate_reply') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ['src/content.js'],
      });
    });
  } else if (command === "move_to_next_button") {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ['src/move-to-next-button.js']
      });
    });
  } else if (command === "move_to_previous_button") {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ['src/move-to-previous-button.js']
      });
    });
  }
});
