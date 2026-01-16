
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

  return true;
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
