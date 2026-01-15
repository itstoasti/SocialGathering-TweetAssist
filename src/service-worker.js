
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


//chrome.scripting.registerContentScripts({
//  matches: ["https://twitter.com/*"],
//  files: ['src/single-reply-content.js'],
//});
