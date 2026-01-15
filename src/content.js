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
  resultContainer.innerHTML = 'Generating...';

  try {
    const apiKey = await chrome.storage.local.get(['open-ai-key']);
    const geminiApiKey = await chrome.storage.local.get(['gemini-api-key']);
    const gptQuery = await chrome.storage.local.get(['gpt-query']);
    const aiProvider = await chrome.storage.local.get(['ai-provider']);

    // Get current user handle to avoid self-reply logic if needed, 
    // but for now we trust the button click context.
    const user = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    const userHandle = user ? '@' + user.href.split('/').pop() : 'unknown';

    const provider = aiProvider['ai-provider'] || 'gemini';
    const model = await chrome.storage.local.get(provider === 'openai' ? ['openai-model'] : ['gemini-model']);
    const selectedModel = model[provider === 'openai' ? 'openai-model' : 'gemini-model'] || (provider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-3.5-turbo');

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

    // Stats increment logic removed from here.
    // Moved to content-window-exit.js to count on actual send.

    // Link to auto-fill reply
    // Link to auto-fill reply
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(replyContent)}&in_reply_to=${tweetInfo.id}`;

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

    // Dynamic Send Button
    const sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send Reply';
    sendBtn.style.cssText = 'background-color: #1d9bf0; color: white; padding: 6px 12px; border: none; border-radius: 9999px; font-weight: bold; font-size: 14px; cursor: pointer; display: inline-block;';

    // Stop bubbling for the button too
    ['click', 'mousedown', 'mouseup'].forEach(evt => {
      sendBtn.addEventListener(evt, (e) => e.stopPropagation());
    });

    sendBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const finalContent = textarea.value;
      const finalIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(finalContent)}&in_reply_to=${tweetInfo.id}`;
      window.open(finalIntentUrl, '_blank');
    };

    resultContainer.appendChild(textarea);
    resultContainer.appendChild(sendBtn);

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