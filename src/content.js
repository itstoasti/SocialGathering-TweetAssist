// Queue to manage button injection and avoid race conditions
const processedTweets = new WeakSet();

// Function to extract tweet information
function extractTweetInfo(tweetElement) {
  const userElement = tweetElement.querySelector('[data-testid="User-Name"]');
  const textElement = tweetElement.querySelector('[data-testid="tweetText"]');

  if (!userElement || !textElement) return null;

  // Get username (handle)
  const links = userElement.querySelectorAll('a');
  let handle = '';
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href && href.startsWith('/') && !href.includes('/status/')) {
      handle = href.substring(1); // Remove leading /
    }
  });

  if (!handle) {
    // Fallback looking for @ text
    const spans = userElement.querySelectorAll('span');
    for (let span of spans) {
      if (span.innerText.startsWith('@')) {
        handle = span.innerText.substring(1);
        break;
      }
    }
  }


  // Get Tweet ID
  let tweetId = '';
  const statusLink = Array.from(links).find(link => {
    const href = link.getAttribute('href');
    return href && href.includes('/status/');
  });

  if (statusLink) {
    const parts = statusLink.getAttribute('href').split('/');
    const statusIndex = parts.indexOf('status');
    if (statusIndex !== -1 && parts[statusIndex + 1]) {
      tweetId = parts[statusIndex + 1];
    }
  }


  // Extract Media Info (Images/GIFs)
  // Extract Media Info (Images/GIFs)
  // Try multiple selectors
  let mediaElements = tweetElement.querySelectorAll('[data-testid="tweetPhoto"] img');
  if (mediaElements.length === 0) {
    // Fallback: finding any image that looks like a tweet content image
    mediaElements = tweetElement.querySelectorAll('img[src*="pbs.twimg.com/media"]');
  }

  const mediaContext = [];
  const imageUrls = [];

  console.log(`[TweetAssist] Scanning tweet ${tweetId} for images. Found candidates: ${mediaElements.length}`);

  mediaElements.forEach(img => {
    // Filter out small icons/avatars (usually 48x48 or smaller) if using broad selector
    // Natural dimensions check is safer if loaded, but width/height attributes might be missing.
    // We'll trust the selector mostly but skip anything clearly tiny if we have dimensions.
    if (img.alt) mediaContext.push(`[Image: ${img.alt}]`);
    if (img.src) imageUrls.push(img.src);
  });

  if (imageUrls.length > 0) {
    console.log(`[TweetAssist] Successfully extracted ${imageUrls.length} valid images.`);
  } else {
    console.log(`[TweetAssist] No images extracted.`);
  }

  // Extract Video Info
  const videoElement = tweetElement.querySelector('[data-testid="videoPlayer"]');
  if (videoElement) {
    // Try to find a meaningful label for the video
    const label = videoElement.getAttribute('aria-label') ||
      (videoElement.querySelector('[aria-label]') ? videoElement.querySelector('[aria-label]').getAttribute('aria-label') : "Video content");
    mediaContext.push(`[Video: ${label}]`);
  }

  return {
    handle: handle,
    text: textElement.innerText,
    id: tweetId,
    element: tweetElement,
    mediaContext: mediaContext.join(' '),
    imageUrls: imageUrls
  };
}

// Helper function to increment daily reply stats
function incrementDailyStats() {
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
    console.log("[TweetAssist] Stats incremented. New count:", stats.count);
  });
}

async function urlToBase64(url) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        // Remove "data:image/jpeg;base64," prefix for API usage usually, 
        // but keep full string for flexibility or strip later
        const base64String = reader.result;
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error("Failed to convert image to base64", err);
    return null;
  }
}


async function handleGenerateClick(tweetInfo, resultContainer) {
  // Create a visually appealing loading state matching Scout widget style
  resultContainer.innerHTML = `
    <div class="tweet-assist-loading">
      <div class="tweet-assist-loading-spinner"></div>
      <div class="tweet-assist-loading-text">
        <span class="tweet-assist-loading-sparkle">✨</span>
        <span>Generating reply</span>
        <span class="tweet-assist-loading-dots"></span>
      </div>
    </div>
  `;

  // Inject loading styles if not already present
  if (!document.getElementById('tweet-assist-loading-styles')) {
    const style = document.createElement('style');
    style.id = 'tweet-assist-loading-styles';
    style.textContent = `
      .tweet-assist-loading {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px;
        background: linear-gradient(135deg, rgba(0, 186, 124, 0.1), rgba(29, 155, 240, 0.1));
        border: 1px solid rgba(29, 155, 240, 0.3);
        border-radius: 12px;
        backdrop-filter: blur(10px);
        animation: tweet-assist-pulse 2s ease-in-out infinite;
      }
      
      @keyframes tweet-assist-pulse {
        0%, 100% { 
          box-shadow: 0 0 0 0 rgba(29, 155, 240, 0.2);
          border-color: rgba(29, 155, 240, 0.3);
        }
        50% { 
          box-shadow: 0 0 20px 0 rgba(29, 155, 240, 0.15);
          border-color: rgba(0, 186, 124, 0.5);
        }
      }
      
      .tweet-assist-loading-spinner {
        width: 24px;
        height: 24px;
        border: 3px solid rgba(29, 155, 240, 0.2);
        border-top: 3px solid #1d9bf0;
        border-right: 3px solid #00ba7c;
        border-radius: 50%;
        animation: tweet-assist-spin 1s linear infinite;
      }
      
      @keyframes tweet-assist-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      
      .tweet-assist-loading-text {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 14px;
        font-weight: 500;
        color: inherit;
        opacity: 0.9;
      }
      
      .tweet-assist-loading-sparkle {
        animation: tweet-assist-sparkle 1.5s ease-in-out infinite;
      }
      
      @keyframes tweet-assist-sparkle {
        0%, 100% { 
          transform: scale(1) rotate(0deg);
          opacity: 1;
        }
        50% { 
          transform: scale(1.2) rotate(15deg);
          opacity: 0.7;
        }
      }
      
      .tweet-assist-loading-dots::after {
        content: '';
        animation: tweet-assist-dots 1.5s infinite;
      }
      
      @keyframes tweet-assist-dots {
        0% { content: ''; }
        25% { content: '.'; }
        50% { content: '..'; }
        75% { content: '...'; }
        100% { content: ''; }
      }
    `;
    document.head.appendChild(style);
  }

  try {
    const apiKey = await chrome.storage.local.get(['open-ai-key']);
    const geminiApiKey = await chrome.storage.local.get(['gemini-api-key']);
    const xaiApiKey = await chrome.storage.local.get(['xai-api-key']);
    const gptQuery = await chrome.storage.local.get(['gpt-query']);
    const aiProvider = await chrome.storage.local.get(['ai-provider']);

    // Get current user handle to avoid self-reply logic if needed, 
    // but for now we trust the button click context.
    const user = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    const userHandle = user ? '@' + user.href.split('/').pop() : 'unknown';

    const provider = aiProvider['ai-provider'] || 'gemini';

    // Get the correct model based on provider
    let selectedModel;
    if (provider === 'openai') {
      const model = await chrome.storage.local.get(['openai-model']);
      selectedModel = model['openai-model'] || 'gpt-3.5-turbo';
    } else if (provider === 'xai') {
      const model = await chrome.storage.local.get(['xai-model']);
      selectedModel = model['xai-model'] || 'grok-4-1-fast-non-reasoning';
    } else {
      const model = await chrome.storage.local.get(['gemini-model']);
      selectedModel = model['gemini-model'] || 'gemini-1.5-flash';
    }

    console.log(`Generating reply for ${tweetInfo.id} using ${provider}/${selectedModel}`);

    let replyContent = "";

    // Prepare image data if any
    let imageParts = [];
    if (tweetInfo.imageUrls && tweetInfo.imageUrls.length > 0) {
      // Only process images if the model likely supports vision (heuristic)
      // Gemini 1.5 Flash supports it. GPT-4 supports it.
      // We'll try to process them.
      for (const url of tweetInfo.imageUrls) {
        console.log(`[TweetAssist] Downloading and converting image: ${url}`);
        const b64 = await urlToBase64(url);
        if (b64) {
          console.log(`[TweetAssist] Image converted (Length: ${b64.length})`);
          imageParts.push(b64);
        }
      }
    }

    if (imageParts.length > 0) {
      console.log(`[TweetAssist] Attaching ${imageParts.length} images to ${provider} request.`);
    }

    if (provider === 'openai') {
      let userMessageContent;

      if (imageParts.length > 0) {
        // Multimodal format
        userMessageContent = [
          { type: "text", text: `${tweetInfo.handle} wrote: "${tweetInfo.text}"` }
        ];
        imageParts.forEach(b64 => {
          userMessageContent.push({
            type: "image_url",
            image_url: {
              "url": b64
            }
          });
        });
      } else {
        // Text only format
        userMessageContent = `${tweetInfo.handle} wrote: "${tweetInfo.text}"${tweetInfo.mediaContext ? `\n\nMedia/Image Context: ${tweetInfo.mediaContext}` : ''}`;
      }

      const body = {
        "messages": [
          { role: "system", 'content': gptQuery['gpt-query'] || "You are a ghostwriter and reply to the user's tweets by talking directly to the person, you must keep it short, exclude hashtags." },
          { role: "user", 'content': userMessageContent }
        ],
        model: selectedModel,
        temperature: 1
      };

      // Newer "o1", "o3" or "o4" models use max_completion_tokens
      // Standard models use max_tokens
      if (selectedModel.startsWith('o')) {
        body.max_completion_tokens = 4096;
      } else {
        body.max_tokens = 4096;
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey['open-ai-key']
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) throw new Error((await response.json()).error.message);
      const data = await response.json();
      replyContent = data.choices[0].message.content;

    } else if (provider === 'xai') {
      // xAI (Grok) - OpenAI-compatible API
      const xaiKey = xaiApiKey['xai-api-key'];
      if (!xaiKey) throw new Error("xAI API Key missing");

      let userMessageContent;

      // Check if using vision model for image support
      const isVisionModel = selectedModel.includes('vision');

      if (imageParts.length > 0 && isVisionModel) {
        // Multimodal format for Grok Vision
        userMessageContent = [
          { type: "text", text: `${tweetInfo.handle} wrote: "${tweetInfo.text}"` }
        ];
        imageParts.forEach(b64 => {
          userMessageContent.push({
            type: "image_url",
            image_url: {
              "url": b64
            }
          });
        });
      } else {
        // Text only format
        userMessageContent = `${tweetInfo.handle} wrote: "${tweetInfo.text}"${tweetInfo.mediaContext ? `\n\nMedia/Image Context: ${tweetInfo.mediaContext}` : ''}`;
      }

      const body = {
        "messages": [
          { role: "system", content: gptQuery['gpt-query'] || "You are a ghostwriter and reply to the user's tweets by talking directly to the person, you must keep it short, exclude hashtags." },
          { role: "user", content: userMessageContent }
        ],
        model: selectedModel,
        temperature: 1,
        max_tokens: 4096
      };

      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + xaiKey
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) throw new Error((await response.json()).error?.message || "xAI API Error");
      const data = await response.json();
      replyContent = data.choices[0].message.content;

    } else {
      // Gemini
      const geminiKey = geminiApiKey['gemini-api-key'];
      if (!geminiKey) throw new Error("Gemini API Key missing");

      const promptText = `${gptQuery['gpt-query'] || "You are a ghostwriter and reply to the user's tweets by talking directly to the person, you must keep it short, exclude hashtags."}
                     
                     User @${tweetInfo.handle} wrote: "${tweetInfo.text}"
                     ${tweetInfo.mediaContext ? `\nMedia/Image Context: ${tweetInfo.mediaContext}` : ''}
                     
                     Reply:`;

      const parts = [{ text: promptText }];

      // Add images for Gemini
      // Gemini expects base64 data without the prefix "data:image/jpeg;base64,"
      imageParts.forEach(b64 => {
        const pureBase64 = b64.split(',')[1];
        // Assuming JPEG/PNG, Gemini manages mime detection usually but we should specify if possible.
        // Twitter images are usually jpg or png.
        let mimeType = "image/jpeg";
        if (b64.startsWith("data:image/png")) mimeType = "image/png";

        parts.push({
          inline_data: {
            mime_type: mimeType,
            data: pureBase64
          }
        });
      });

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: parts }]
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || "Gemini API Error");
      }

      const data = await response.json();
      replyContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!replyContent) throw new Error("No response from Gemini");
    }

    // Display Result
    resultContainer.innerHTML = '';

    // Editable Textarea
    const textarea = document.createElement('textarea');
    textarea.value = replyContent;
    textarea.className = 'tweet-assist-edit-area';
    // Style to match Twitter/X input
    textarea.style.cssText = 'display: block; width: 100%; border: 1px solid #333; border-radius: 12px; padding: 10px; font-family: inherit; font-size: 15px; line-height: 20px; background: transparent; color: inherit; resize: vertical; margin-bottom: 8px; min-height: 80px; box-sizing: border-box;';

    // Stop bubbling for the text area
    ['click', 'mousedown', 'mouseup'].forEach(evt => {
      textarea.addEventListener(evt, (e) => e.stopPropagation());
    });

    // Copy to Clipboard Button
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 Copy';
    copyBtn.style.cssText = 'background-color: #333; color: white; padding: 6px 12px; border: none; border-radius: 9999px; font-weight: bold; font-size: 14px; cursor: pointer; display: inline-block; margin-right: 8px;';

    copyBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(textarea.value);
      copyBtn.textContent = '✅ Copied!';
      setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
    };

    // Open Native Reply Button
    const replyBtn = document.createElement('button');
    replyBtn.textContent = '💬 Reply';
    replyBtn.style.cssText = 'background-color: #1d9bf0; color: white; padding: 6px 12px; border: none; border-radius: 9999px; font-weight: bold; font-size: 14px; cursor: pointer; display: inline-block;';

    // Stop bubbling for the buttons
    ['click', 'mousedown', 'mouseup'].forEach(evt => {
      copyBtn.addEventListener(evt, (e) => e.stopPropagation());
      replyBtn.addEventListener(evt, (e) => e.stopPropagation());
    });

    replyBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const finalContent = textarea.value;

      // Copy text to clipboard first
      await navigator.clipboard.writeText(finalContent);

      // Find and click the tweet's native reply button
      const tweetElement = resultContainer.closest('[data-testid="tweet"]') ||
        resultContainer.closest('article');

      if (tweetElement) {
        const nativeReplyBtn = tweetElement.querySelector('[data-testid="reply"]');
        if (nativeReplyBtn) {
          nativeReplyBtn.click();

          replyBtn.textContent = '⏳ Opening...';

          // Wait for reply compose box to appear, then paste
          setTimeout(async () => {
            // Find the compose box - Twitter uses a draft editor
            const composeBox = document.querySelector('[data-testid="tweetTextarea_0"]') ||
              document.querySelector('[role="textbox"][data-testid]') ||
              document.querySelector('[contenteditable="true"][role="textbox"]') ||
              document.querySelector('div[data-contents="true"]')?.closest('[contenteditable="true"]');

            if (composeBox) {
              // Focus the compose box
              composeBox.focus();

              // Use DataTransfer to simulate paste (works with React)
              const dataTransfer = new DataTransfer();
              dataTransfer.setData('text/plain', finalContent);

              const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dataTransfer
              });

              composeBox.dispatchEvent(pasteEvent);

              // If paste didn't work, try direct text insertion
              setTimeout(() => {
                if (!composeBox.textContent || composeBox.textContent.trim().length === 0) {
                  // Fallback: set innerHTML directly for draft-js editors
                  const textSpan = composeBox.querySelector('span[data-text="true"]') || composeBox;
                  if (textSpan) {
                    // For Draft.js editors
                    const selection = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(composeBox);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    document.execCommand('insertText', false, finalContent);
                  }
                }
              }, 100);

              replyBtn.textContent = '✅ Ready to send!';

              // Mark as replied for Scout
              chrome.storage.local.get(['scout-replied-tweets']).then((result) => {
                const storedIds = result['scout-replied-tweets'] || [];
                if (!storedIds.includes(tweetInfo.id)) {
                  storedIds.push(tweetInfo.id);
                  if (storedIds.length > 100) storedIds.shift();
                  chrome.storage.local.set({ 'scout-replied-tweets': storedIds });
                }
              });

              // Check for auto-send setting and click the tweet button
              chrome.storage.local.get(['auto-send']).then((result) => {
                if (result['auto-send']) {
                  setTimeout(() => {
                    const tweetBtn = document.querySelector('[data-testid="tweetButton"]') ||
                      document.querySelector('[data-testid="tweetButtonInline"]');
                    if (tweetBtn && !tweetBtn.disabled) {
                      tweetBtn.click();
                      replyBtn.textContent = '✅ Sent!';

                      // Increment daily stats
                      incrementDailyStats();

                      // Signal Scout to resume
                      setTimeout(() => {
                        chrome.storage.local.set({ 'scout-resume-scouting': true });
                      }, 1000);
                    }
                  }, 300);
                } else {
                  // If not auto-send, just signal resume for Scout to continue
                  setTimeout(() => {
                    chrome.storage.local.set({ 'scout-resume-scouting': true });
                  }, 500);
                }
              });

            } else {
              replyBtn.textContent = '📋 Copied (paste with Ctrl+V)';
            }

            setTimeout(() => { replyBtn.textContent = '💬 Reply'; }, 4000);
          }, 800);

          return;
        }
      }

      // Fallback: just copy and notify
      replyBtn.textContent = '📋 Copied!';
      setTimeout(() => { replyBtn.textContent = '💬 Reply'; }, 2000);
    };

    resultContainer.appendChild(textarea);
    resultContainer.appendChild(copyBtn);
    resultContainer.appendChild(replyBtn);

    // Stop propagation on the container itself just in case
    resultContainer.addEventListener('click', (e) => e.stopPropagation());

  } catch (error) {
    console.error(error);
    resultContainer.innerHTML = `<span style="color: red;">Error: ${error.message}</span>`;
  }
}


function injectButton(tweetElement) {
  if (processedTweets.has(tweetElement)) return;
  processedTweets.add(tweetElement);

  const actionGroup = tweetElement.querySelector('[role="group"]');
  if (!actionGroup) return;

  // Create Container
  const container = document.createElement('div');
  container.className = 'tweet-assist-container';
  container.style.cssText = 'display: flex; align-items: center; margin-right: 12px;';

  // Create Button
  const button = document.createElement('div');
  button.className = 'tweet-assist-button';
  button.setAttribute('role', 'button');
  button.setAttribute('tabindex', '0');
  button.style.cssText = 'cursor: pointer; padding: 8px; border-radius: 50%; transition: background-color 0.2s; display: flex; align-items: center; justify-content: center;';
  button.title = 'Tweet Assist: Draft Reply';

  // Icon (Sparkles)
  button.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="color: #1d9bf0;">
            <path d="M8.5 19H8c-3.31 0-6-2.69-6-6s2.69-6 6-6h.5v2H8c-2.21 0-4 1.79-4 4s1.79 4 4 4h.5v2zm7-10h.5c2.21 0 4 1.79 4 4s-1.79 4-4 4h-.5v2h.5c3.31 0 6-2.69 6-6s-2.69-6-6-6h-.5v2zm-6 3h5v2h-5v-2z"></path>
            <!-- Fallback generic assist icon/magic wand shape if prefered -->
             <path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.58 1.41l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.58l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z" style="display:none"></path>
        </svg>
    `;

  // Hover effect
  button.addEventListener('mouseenter', () => { button.style.backgroundColor = 'rgba(29, 155, 240, 0.1)'; });
  button.addEventListener('mouseleave', () => { button.style.backgroundColor = 'transparent'; });

  // Click Handler
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    let resultContainer = tweetElement.querySelector('.tweet-assist-result');
    if (!resultContainer) {
      resultContainer = document.createElement('div');
      resultContainer.className = 'tweet-assist-result';
      // Use inherit color to ensure text is visible in dark mode
      resultContainer.style.cssText = 'padding: 12px; border-radius: 8px; margin-top: 8px; width: 100%; color: inherit;';
      // Insert after the action group (which is usually at bottom of tweet)
      actionGroup.parentElement.appendChild(resultContainer);
    }

    const info = extractTweetInfo(tweetElement);
    if (info) {
      handleGenerateClick(info, resultContainer);
    } else {
      console.log("Could not extract tweet info");
    }
  });

  container.appendChild(button);
  actionGroup.appendChild(container); // Append to the action bar
}


// Observer
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.addedNodes.length) {
      const tweets = document.querySelectorAll('[data-testid="tweet"]');
      tweets.forEach(injectButton);
    }
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});


// Initial check
setTimeout(() => {
  const tweets = document.querySelectorAll('[data-testid="tweet"]');
  tweets.forEach(injectButton);
}, 2000);

// Auto-send logic moved to content-window-exit.js