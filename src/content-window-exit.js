
function waitForElement(selector) {
  return new Promise(function (resolve, reject) {
    var element = document.querySelector(selector);

    if (element) {
      resolve(element);
      return;
    }

    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        var nodes = Array.from(mutation.addedNodes);
        for (var node of nodes) {
          if (node.querySelectorAll) {
            var elements = node.querySelectorAll(selector);
            if (elements && elements.length > 0) {
              observer.disconnect();
              resolve(elements[0]);
              return;
            }
          }
        };
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function waitForElementRemoval(selector) {
  return new Promise(function (resolve, reject) {
    var element = document.querySelector(selector);

    if (!element) {
      resolve();
      return;
    }

    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        var nodes = Array.from(mutation.removedNodes);
        for (var node of nodes) {
          if (node.matches && node.matches(selector)) {
            observer.disconnect();
            resolve();
            return;
          }
          if (node.querySelectorAll) {
            var elements = node.querySelectorAll(selector);
            if (elements.length) {
              observer.disconnect();
              resolve();
              return;
            }
          }
        }
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

async function waitForElementsBeforeQuit() {
  console.log("page is fully loaded");
  await waitForElement('[data-testid="mask"]')
  console.log("element found");
  await waitForElementRemoval('[data-testid="mask"]')
  console.log("element removed");
  window.close();
}


async function performAutoSend() {
  console.log("Auto-Send: Starting...");
  // Wait specifically for the button
  const btn = await waitForElement('[data-testid="tweetButton"]');
  console.log("Auto-Send: Button found in DOM");

  // Wait a tiny bit to ensure listeners are bound
  setTimeout(() => {
    console.log("Auto-Send: Clicking button robustly...");
    btn.click();

    const events = ['mousedown', 'mouseup', 'click'];
    events.forEach(eventType => {
      const event = new MouseEvent(eventType, {
        view: window,
        bubbles: true,
        cancelable: true,
        buttons: 1
      });
      btn.dispatchEvent(event);
    });
  }, 500);
}

chrome.storage.local.get(['automatic-window-close', 'auto-send']).then((result) => {
  if (result['automatic-window-close'] == undefined) {
    result['automatic-window-close'] = true;
  }

  // Function to increment stats
  const incrementStats = () => {
    chrome.storage.local.get(['daily-stats', 'stats-reset-hour']).then((res) => {
      const resetHour = res['stats-reset-hour'] || 0;

      const now = new Date();
      if (now.getHours() < resetHour) {
        now.setDate(now.getDate() - 1);
      }
      const logicDateKey = `${now.toDateString()}_${resetHour}`;

      let stats = res['daily-stats'] || { date: logicDateKey, count: 0 };

      if (stats.date !== logicDateKey) {
        stats = { date: logicDateKey, count: 1 };
      } else {
        stats.count = (stats.count || 0) + 1;
      }

      chrome.storage.local.set({ 'daily-stats': stats });
      console.log("Stats incremented on send.");
    });
  };

  // Attach listener for manual clicks (if auto-send is off or fails)
  waitForElement('[data-testid="tweetButton"]').then((btn) => {
    // Use 'mousedown' as 'click' might be intercepted or prevented by Twitter's own handlers
    // But verify it's a real user action or our simulated one.
    btn.addEventListener('click', incrementStats);
  });

  // Handle Auto-Send
  if (result['auto-send']) {
    performAutoSend().then(() => {
      // Increment stats for auto-send cases too?
      // Wait, if we attach the listener above, the auto-send click() should trigger it.
      // But to be safe and avoid race conditions or event suppression:
      // Let's rely on the listener if possible, but the `performAutoSend` function
      // waits to find the button.
    });
  }

  // Handle Close
  if (result['automatic-window-close']) {
    console.log('before event');
    waitForElementsBeforeQuit();
  }
});

