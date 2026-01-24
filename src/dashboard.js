// Tweet Assist Dashboard JavaScript

document.addEventListener('DOMContentLoaded', function () {

    // ============================================
    // Navigation
    // ============================================

    const navItems = document.querySelectorAll('.nav-item[data-section]');
    const sections = document.querySelectorAll('.content-section');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const sectionId = item.dataset.section;

            // Update nav active state
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Show corresponding section
            sections.forEach(section => {
                section.classList.remove('active');
                if (section.id === `section-${sectionId}`) {
                    section.classList.add('active');
                }
            });
        });
    });

    // Explicitly handle Launch X button
    document.getElementById('nav-open-x')?.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: 'https://x.com/home' });
    });

    // ============================================
    // Stats Loading
    // ============================================

    function loadStats() {
        chrome.storage.local.get(['daily-stats', 'stats-reset-hour', 'scout-match-count']).then((result) => {
            const resetHour = result['stats-reset-hour'] || 0;
            const now = new Date();
            if (now.getHours() < resetHour) {
                now.setDate(now.getDate() - 1);
            }
            const logicDateKey = `${now.toDateString()}_${resetHour}`;

            const stats = result['daily-stats'];
            let count = 0;
            if (stats && stats.date === logicDateKey) {
                count = stats.count || 0;
            }

            document.getElementById('replies-today').textContent = count;
            document.getElementById('matches-found').textContent = result['scout-match-count'] || 0;
        });
    }

    loadStats();

    // Listen for stats changes
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local') {
            if (changes['daily-stats'] || changes['scout-match-count']) {
                loadStats();
            }
            if (changes['scout-matched-tweets'] || changes['scout-replied-tweets']) {
                loadMatchedTweets();
            }
        }
    });

    // ============================================
    // Auto Scrape Button
    // ============================================

    const autoScrapeBtn = document.getElementById('auto-scrape-btn');

    autoScrapeBtn.addEventListener('click', async () => {
        // Disable button and show loading state
        autoScrapeBtn.disabled = true;
        autoScrapeBtn.classList.add('scraping');
        autoScrapeBtn.textContent = 'Scouting...';

        try {
            // Send message to service worker to start auto-scrape
            await chrome.runtime.sendMessage({ action: 'start-auto-scrape', count: 12 });
        } catch (err) {
            console.error('Auto-scrape error:', err);
        }
    });

    // Listen for scrape complete message
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'auto-scrape-complete') {
            autoScrapeBtn.disabled = false;
            autoScrapeBtn.classList.remove('scraping');
            autoScrapeBtn.textContent = 'Auto Scout';
            loadMatchedTweets();
        }
    });

    // ============================================
    // System Prompt Management
    // ============================================

    const gptQueryInput = document.getElementById('gpt-query');
    const promptSelect = document.getElementById('prompt-select');
    const savePromptBtn = document.getElementById('save-prompt-btn');
    const deletePromptBtn = document.getElementById('delete-prompt-btn');

    function loadPrompts() {
        chrome.storage.local.get(['saved-prompts', 'selected-prompt-id', 'gpt-query']).then(res => {
            const prompts = res['saved-prompts'] || [];
            const selectedId = res['selected-prompt-id'] || 'custom';

            // Clear options except first
            while (promptSelect.options.length > 1) {
                promptSelect.remove(1);
            }

            prompts.forEach((p, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.text = p.name;
                promptSelect.appendChild(option);
            });

            promptSelect.value = selectedId;

            // Load the query text
            if (gptQueryInput) {
                gptQueryInput.value = res['gpt-query'] || "You are a ghostwriter and reply to the user's tweets by talking directly to the person, you must keep it short, exclude hashtags.";
            }
        });
    }

    loadPrompts();

    if (gptQueryInput) {
        gptQueryInput.addEventListener('input', function () {
            chrome.storage.local.set({ 'gpt-query': gptQueryInput.value });
            promptSelect.value = 'custom';
            chrome.storage.local.set({ 'selected-prompt-id': 'custom' });
        });
    }

    promptSelect.addEventListener('change', () => {
        const selected = promptSelect.value;
        chrome.storage.local.set({ 'selected-prompt-id': selected });

        if (selected === 'custom') return;

        chrome.storage.local.get(['saved-prompts']).then(res => {
            const prompts = res['saved-prompts'] || [];
            const index = parseInt(selected);
            if (prompts[index]) {
                gptQueryInput.value = prompts[index].content;
                chrome.storage.local.set({ 'gpt-query': prompts[index].content });
            }
        });
    });

    savePromptBtn.addEventListener('click', () => {
        const content = gptQueryInput.value;
        if (!content.trim()) return alert("Prompt cannot be empty");

        const name = prompt("Enter a name for this prompt:");
        if (!name) return;

        chrome.storage.local.get(['saved-prompts']).then(res => {
            const prompts = res['saved-prompts'] || [];
            prompts.push({ name: name, content: content });
            chrome.storage.local.set({
                'saved-prompts': prompts,
                'selected-prompt-id': prompts.length - 1
            }, () => {
                loadPrompts();
                setTimeout(() => promptSelect.value = prompts.length - 1, 50);
            });
        });
    });

    deletePromptBtn.addEventListener('click', () => {
        const selected = promptSelect.value;
        if (selected === 'custom') return alert("Cannot delete 'Custom' slot.");

        if (confirm("Delete this prompt preset?")) {
            chrome.storage.local.get(['saved-prompts']).then(res => {
                const prompts = res['saved-prompts'] || [];
                const index = parseInt(selected);
                if (index >= 0 && index < prompts.length) {
                    prompts.splice(index, 1);
                    chrome.storage.local.set({
                        'saved-prompts': prompts,
                        'selected-prompt-id': 'custom'
                    }, loadPrompts);
                }
            });
        }
    });

    // ============================================
    // Behavior Toggles
    // ============================================

    const windowCloseCheckbox = document.getElementById('window-close');
    const autoSendCheckbox = document.getElementById('auto-send');

    chrome.storage.local.get(['automatic-window-close', 'auto-send']).then((result) => {
        if (windowCloseCheckbox) {
            windowCloseCheckbox.checked = result['automatic-window-close'] !== false;
        }
        if (autoSendCheckbox) {
            autoSendCheckbox.checked = result['auto-send'] || false;
        }
    });

    windowCloseCheckbox?.addEventListener('change', () => {
        chrome.storage.local.set({ 'automatic-window-close': windowCloseCheckbox.checked });
    });

    autoSendCheckbox?.addEventListener('change', () => {
        chrome.storage.local.set({ 'auto-send': autoSendCheckbox.checked });
    });

    // ============================================
    // AI Provider Settings
    // ============================================

    const providerSelect = document.getElementById('provider-select');
    const quickProviderSelect = document.getElementById('quick-provider-select');
    const openaiConfig = document.getElementById('openai-config');
    const geminiConfig = document.getElementById('gemini-config');
    const xaiConfig = document.getElementById('xai-config');
    const modelsSelect = document.getElementById('models-select');

    function updateProviderUI() {
        const provider = providerSelect.value;

        openaiConfig.classList.add('hidden');
        geminiConfig.classList.add('hidden');
        xaiConfig.classList.add('hidden');

        if (provider === 'gemini') {
            geminiConfig.classList.remove('hidden');
        } else if (provider === 'openai') {
            openaiConfig.classList.remove('hidden');
        } else if (provider === 'xai') {
            xaiConfig.classList.remove('hidden');
        }

        loadModels();
    }

    function handleProviderChange(value) {
        chrome.storage.local.set({ 'selected-provider': value });
        providerSelect.value = value;
        if (quickProviderSelect) quickProviderSelect.value = value;
        updateProviderUI();
    }

    providerSelect.addEventListener('change', (e) => handleProviderChange(e.target.value));

    if (quickProviderSelect) {
        quickProviderSelect.addEventListener('change', (e) => handleProviderChange(e.target.value));
    }

    // Initialize provider selection
    chrome.storage.local.get(['selected-provider']).then((result) => {
        if (result['selected-provider']) {
            providerSelect.value = result['selected-provider'];
            if (quickProviderSelect) quickProviderSelect.value = result['selected-provider'];
            updateProviderUI();
        }
    });

    function loadModels() {
        const provider = providerSelect.value;
        modelsSelect.innerHTML = '';

        if (provider === 'xai') {
            const xaiModels = [
                { id: 'grok-4-1-fast-reasoning', name: 'Grok 4.1 Fast (Reasoning)' },
                { id: 'grok-4-1-fast-non-reasoning', name: 'Grok 4.1 Fast (Non-Reasoning)' },
                { id: 'grok-4-fast-reasoning', name: 'Grok 4 Fast (Reasoning)' },
                { id: 'grok-4-fast-non-reasoning', name: 'Grok 4 Fast (Non-Reasoning)' },
                { id: 'grok-4-0709', name: 'Grok 4 (0709)' },
                { id: 'grok-code-fast-1', name: 'Grok Code Fast' },
                { id: 'grok-3', name: 'Grok 3' },
                { id: 'grok-3-mini', name: 'Grok 3 Mini' },
                { id: 'grok-2-vision-1212', name: 'Grok 2 Vision' }
            ];

            chrome.storage.local.get(['xai-model']).then((res) => {
                const currentModel = res['xai-model'] || 'grok-4-1-fast-non-reasoning';
                xaiModels.forEach(m => {
                    const option = document.createElement('option');
                    option.value = m.id;
                    option.text = m.name;
                    if (m.id === currentModel) option.selected = true;
                    modelsSelect.appendChild(option);
                });
            });
        } else if (provider === 'gemini') {
            const geminiModels = [
                { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
                { id: 'gemini-1.5-flash-latest', name: 'Gemini 1.5 Flash Latest' },
                { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
                { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' }
            ];

            chrome.storage.local.get(['gemini-model']).then((res) => {
                const currentModel = res['gemini-model'] || 'gemini-1.5-flash';
                geminiModels.forEach(m => {
                    const option = document.createElement('option');
                    option.value = m.id;
                    option.text = m.name;
                    if (m.id === currentModel) option.selected = true;
                    modelsSelect.appendChild(option);
                });
            });
        } else if (provider === 'openai') {
            const openaiModels = [
                { id: 'gpt-4o', name: 'GPT-4o' },
                { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
                { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
                { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
            ];

            chrome.storage.local.get(['openai-model']).then((res) => {
                const currentModel = res['openai-model'] || 'gpt-3.5-turbo';
                openaiModels.forEach(m => {
                    const option = document.createElement('option');
                    option.value = m.id;
                    option.text = m.name;
                    if (m.id === currentModel) option.selected = true;
                    modelsSelect.appendChild(option);
                });
            });
        }
    }

    // Load saved provider
    chrome.storage.local.get(['ai-provider', 'open-ai-key', 'gemini-api-key', 'xai-api-key']).then((result) => {
        document.getElementById('api-key').value = result['open-ai-key'] || '';
        document.getElementById('gemini-api-key').value = result['gemini-api-key'] || '';
        document.getElementById('xai-api-key').value = result['xai-api-key'] || '';

        providerSelect.value = result['ai-provider'] || 'gemini';
        updateProviderUI();
    });

    providerSelect.addEventListener('change', () => {
        chrome.storage.local.set({ 'ai-provider': providerSelect.value });
        updateProviderUI();
    });

    modelsSelect.addEventListener('change', () => {
        const provider = providerSelect.value;
        const modelKey = provider === 'openai' ? 'openai-model' :
            provider === 'xai' ? 'xai-model' : 'gemini-model';
        chrome.storage.local.set({ [modelKey]: modelsSelect.value });
    });

    // API Key handlers
    document.getElementById('api-key').addEventListener('change', (e) => {
        chrome.storage.local.set({ 'open-ai-key': e.target.value });
    });

    document.getElementById('gemini-api-key').addEventListener('change', (e) => {
        chrome.storage.local.set({ 'gemini-api-key': e.target.value });
    });

    document.getElementById('xai-api-key').addEventListener('change', (e) => {
        chrome.storage.local.set({ 'xai-api-key': e.target.value });
    });

    // Validate buttons
    document.getElementById('validate-button').addEventListener('click', () => {
        const input = document.getElementById('api-key');
        // Simple validation feedback
        input.style.borderColor = input.value ? 'var(--accent-green)' : 'var(--accent-red)';
    });

    document.getElementById('validate-gemini-button').addEventListener('click', () => {
        const input = document.getElementById('gemini-api-key');
        input.style.borderColor = input.value ? 'var(--accent-green)' : 'var(--accent-red)';
    });

    document.getElementById('validate-xai-button').addEventListener('click', () => {
        const input = document.getElementById('xai-api-key');
        input.style.borderColor = input.value ? 'var(--accent-green)' : 'var(--accent-red)';
    });

    // Show/hide API key toggles
    document.getElementById('show-api-key').addEventListener('change', (e) => {
        document.getElementById('api-key').type = e.target.checked ? 'text' : 'password';
    });

    document.getElementById('show-gemini-api-key').addEventListener('change', (e) => {
        document.getElementById('gemini-api-key').type = e.target.checked ? 'text' : 'password';
    });

    document.getElementById('show-xai-api-key').addEventListener('change', (e) => {
        document.getElementById('xai-api-key').type = e.target.checked ? 'text' : 'password';
    });

    // ============================================
    // Stats Reset Hour
    // ============================================

    const resetHourInput = document.getElementById('reset-hour');

    chrome.storage.local.get(['stats-reset-hour']).then((result) => {
        resetHourInput.value = result['stats-reset-hour'] || 0;
    });

    resetHourInput.addEventListener('change', () => {
        let val = parseInt(resetHourInput.value);
        if (val < 0) val = 0;
        if (val > 23) val = 23;
        resetHourInput.value = val;
        chrome.storage.local.set({ 'stats-reset-hour': val });
    });

    // ============================================
    // Scout Settings
    // ============================================

    const scrollSpeedSelect = document.getElementById('scroll-speed');
    const pauseOnMatchCheckbox = document.getElementById('pause-on-match');
    const autoGenerateCheckbox = document.getElementById('auto-generate');
    const highlightMatchesCheckbox = document.getElementById('highlight-matches');
    const soundNotificationCheckbox = document.getElementById('sound-notification');

    chrome.storage.local.get([
        'scout-scroll-speed',
        'scout-pause-on-match',
        'scout-auto-generate',
        'scout-highlight-matches',
        'scout-sound-notification'
    ]).then((result) => {
        scrollSpeedSelect.value = result['scout-scroll-speed'] || 'medium';
        pauseOnMatchCheckbox.checked = result['scout-pause-on-match'] !== false;
        autoGenerateCheckbox.checked = result['scout-auto-generate'] || false;
        highlightMatchesCheckbox.checked = result['scout-highlight-matches'] !== false;
        soundNotificationCheckbox.checked = result['scout-sound-notification'] || false;
    });

    function saveScoutSettings() {
        chrome.storage.local.set({
            'scout-scroll-speed': scrollSpeedSelect.value,
            'scout-pause-on-match': pauseOnMatchCheckbox.checked,
            'scout-auto-generate': autoGenerateCheckbox.checked,
            'scout-highlight-matches': highlightMatchesCheckbox.checked,
            'scout-sound-notification': soundNotificationCheckbox.checked
        });
    }

    scrollSpeedSelect.addEventListener('change', saveScoutSettings);
    pauseOnMatchCheckbox.addEventListener('change', saveScoutSettings);
    autoGenerateCheckbox.addEventListener('change', saveScoutSettings);
    highlightMatchesCheckbox.addEventListener('change', saveScoutSettings);
    soundNotificationCheckbox.addEventListener('change', saveScoutSettings);

    // ============================================
    // Matched Tweets Grid
    // ============================================

    const tweetsGrid = document.getElementById('tweets-grid');
    const emptyState = document.getElementById('empty-state');
    const gridActions = document.getElementById('grid-actions');
    const clearMatchesBtn = document.getElementById('clear-matches-btn');
    const filterStatus = document.getElementById('filter-status');

    // Filter change event
    filterStatus.addEventListener('change', loadMatchedTweets);

    async function loadMatchedTweets() {
        const result = await chrome.storage.local.get(['scout-matched-tweets', 'scout-replied-tweets']);
        let tweets = result['scout-matched-tweets'] || [];
        const repliedTweets = new Set(result['scout-replied-tweets'] || []);

        // Apply filter
        const filter = filterStatus.value;
        if (filter === 'replied') {
            tweets = tweets.filter(t => repliedTweets.has(t.id));
        } else if (filter === 'not-replied') {
            tweets = tweets.filter(t => !repliedTweets.has(t.id));
        }

        if (tweets.length === 0) {
            emptyState.classList.remove('hidden');
            tweetsGrid.innerHTML = '';
            gridActions.classList.add('hidden');
            return;
        }

        emptyState.classList.add('hidden');
        gridActions.classList.remove('hidden');

        // Create Twitter-style embed cards
        tweetsGrid.innerHTML = tweets.map(tweet => {
            const isReplied = repliedTweets.has(tweet.id);

            // Build media HTML
            let mediaHtml = '';
            if (tweet.mediaUrls && tweet.mediaUrls.length > 0) {
                const mediaItems = tweet.mediaUrls.map(media => `
                    <div class="media-item ${media.type}">
                        <img src="${media.url}" alt="${media.type}" loading="lazy" />
                        ${media.type === 'video' ? '<div class="video-overlay">▶</div>' : ''}
                    </div>
                `).join('');
                mediaHtml = `<div class="tweet-media-grid media-count-${tweet.mediaUrls.length}">${mediaItems}</div>`;
            }

            // Get first letter of handle for avatar
            const initial = (tweet.handle || 'U').charAt(0).toUpperCase();

            // Replied badge HTML
            const repliedBadge = isReplied ? '<div class="tweet-replied-badge">✓ Replied</div>' : '';

            return `
                <div class="tweet-embed-card ${isReplied ? 'is-replied' : ''}" data-id="${tweet.id}">
                    <div class="tweet-card-inner">
                        <div class="tweet-embed-header">
                            <div class="tweet-avatar">${initial}</div>
                            <div class="tweet-user-info">
                                <div class="tweet-display-name">${tweet.handle || 'Unknown'}</div>
                                <div class="tweet-handle-row">
                                    <a href="https://x.com/${tweet.handle}" target="_blank">@${tweet.handle}</a>
                                    <span>·</span>
                                    <span>${tweet.age || ''}</span>
                                </div>
                            </div>
                            ${repliedBadge}
                            <div class="tweet-x-logo">𝕏</div>
                        </div>
                        <div class="tweet-content">
                            <p class="tweet-text-full">${escapeHtml(tweet.text || '')}</p>
                            ${tweet.quotedTweet ? `
                            <div class="quoted-tweet-card">
                                <div class="quoted-header">
                                    <div class="quoted-avatar">${(tweet.quotedTweet.handle || 'U').charAt(0).toUpperCase()}</div>
                                    <div class="quoted-info">
                                        <span class="quoted-handle">@${tweet.quotedTweet.handle}</span>
                                    </div>
                                </div>
                                <div class="quoted-text">${escapeHtml(tweet.quotedTweet.text || '')}</div>
                            </div>
                            ` : ''}
                            ${mediaHtml}
                        </div>
                        <div class="tweet-stats-row">
                            ${tweet.views ? `<span>${tweet.views.toLocaleString()} views</span>` : ''}
                        </div>
                        <div class="tweet-actions-row">
                            <a href="https://x.com/${tweet.handle}/status/${tweet.id}" target="_blank" class="tweet-action-btn view">
                                View on X
                            </a>
                            <button class="tweet-action-btn remove" data-remove-id="${tweet.id}">
                                Remove
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Add remove button handlers
        document.querySelectorAll('.tweet-action-btn.remove').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.dataset.removeId;
                const result = await chrome.storage.local.get(['scout-matched-tweets']);
                const tweets = (result['scout-matched-tweets'] || []).filter(t => t.id !== id);
                await chrome.storage.local.set({ 'scout-matched-tweets': tweets });
                loadMatchedTweets();
            });
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    loadMatchedTweets();

    clearMatchesBtn.addEventListener('click', () => {
        if (confirm('Clear all matched tweets?')) {
            chrome.storage.local.set({ 'scout-matched-tweets': [] });
            loadMatchedTweets();
        }
    });

    // ============================================
    // Calendar Post Composer
    // ============================================

    const composerTextarea = document.querySelector('.composer-textarea');
    const charCountSpan = document.getElementById('char-count');
    const mediaUploadZone = document.getElementById('media-upload-zone');
    const mediaInput = document.getElementById('media-input');
    const schedulePostBtn = document.getElementById('schedule-post-btn');
    const newPostBtn = document.getElementById('new-post-btn');

    // Character counter
    if (composerTextarea && charCountSpan) {
        composerTextarea.addEventListener('input', () => {
            charCountSpan.textContent = composerTextarea.value.length;
        });
    }

    // Media upload handling
    let pendingMediaBase64 = null;
    let pendingMediaName = null;

    if (mediaUploadZone && mediaInput) {
        // Click to upload
        mediaUploadZone.addEventListener('click', () => {
            mediaInput.click();
        });

        // Drag and drop
        mediaUploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            mediaUploadZone.classList.add('drag-over');
        });

        mediaUploadZone.addEventListener('dragleave', () => {
            mediaUploadZone.classList.remove('drag-over');
        });

        mediaUploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            mediaUploadZone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                handleMediaFile(file);
            }
        });

        // File input change
        mediaInput.addEventListener('change', () => {
            const file = mediaInput.files[0];
            if (file) {
                handleMediaFile(file);
            }
        });
    }

    function handleMediaFile(file) {
        const reader = new FileReader();
        reader.onload = () => {
            pendingMediaBase64 = reader.result;
            pendingMediaName = file.name;

            // Show preview
            mediaUploadZone.innerHTML = `
                <div class="media-preview">
                    <img src="${reader.result}" alt="Preview" style="max-width: 100%; max-height: 120px; border-radius: 8px;">
                    <div class="media-preview-name">${file.name}</div>
                    <button class="remove-media-btn" type="button">✕ Remove</button>
                </div>
            `;

            // Add remove handler
            mediaUploadZone.querySelector('.remove-media-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                clearMediaUpload();
            });
        };
        reader.readAsDataURL(file);
    }

    function clearMediaUpload() {
        pendingMediaBase64 = null;
        pendingMediaName = null;
        mediaUploadZone.innerHTML = `
            <div class="upload-placeholder">
                <span class="upload-icon">🖼️</span>
                <span>Drop image or click to upload</span>
                <span class="upload-hint">PNG, JPG, GIF up to 5MB</span>
            </div>
        `;
    }

    // Schedule Post button
    if (schedulePostBtn) {
        schedulePostBtn.addEventListener('click', async () => {
            const tweetText = composerTextarea?.value?.trim() || '';
            const scheduleDateInput = document.getElementById('schedule-date');
            const scheduleTimeInput = document.getElementById('schedule-time');

            if (!tweetText && !pendingMediaBase64) {
                alert('Please add some text or an image to post.');
                return;
            }

            // Get scheduled date/time
            const scheduleDate = scheduleDateInput?.value;
            const scheduleTime = scheduleTimeInput?.value;

            if (!scheduleDate || !scheduleTime) {
                alert('Please select a date and time for your scheduled post.');
                return;
            }

            // Parse the scheduled time
            const scheduledDateTime = new Date(`${scheduleDate}T${scheduleTime}`);
            const now = new Date();

            if (scheduledDateTime <= now) {
                alert('Please select a future date and time.');
                return;
            }

            // Create unique post ID
            const postId = `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Build post object
            const newPost = {
                id: postId,
                text: tweetText,
                mediaBase64: pendingMediaBase64,
                mediaName: pendingMediaName,
                scheduledTime: scheduledDateTime.getTime(),
                createdAt: Date.now()
            };

            // Get existing scheduled posts and add new one
            const result = await chrome.storage.local.get(['scheduled-posts']);
            const scheduledPosts = result['scheduled-posts'] || [];
            scheduledPosts.push(newPost);
            await chrome.storage.local.set({ 'scheduled-posts': scheduledPosts });

            // Send message to service worker to create alarm
            chrome.runtime.sendMessage({
                action: 'schedule-post-alarm',
                postId: postId,
                scheduledTime: scheduledDateTime.getTime()
            });

            // Clear the form
            if (composerTextarea) composerTextarea.value = '';
            if (charCountSpan) charCountSpan.textContent = '0';
            if (scheduleDateInput) scheduleDateInput.value = '';
            if (scheduleTimeInput) scheduleTimeInput.value = '';
            clearMediaUpload();

            // Refresh the scheduled posts display
            loadScheduledPosts();

            // Update calendar highlights
            highlightDaysWithPosts();

            schedulePostBtn.textContent = '✅ Scheduled!';
            setTimeout(() => {
                schedulePostBtn.innerHTML = '<span>📅</span> Schedule Post';
            }, 2000);
        });
    }

    // New Post button (scrolls to composer or focuses textarea)
    if (newPostBtn && composerTextarea) {
        newPostBtn.addEventListener('click', () => {
            composerTextarea.focus();
            composerTextarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }

    // ============================================
    // Load and Display Scheduled Posts
    // ============================================

    async function loadScheduledPosts() {
        const postsList = document.querySelector('.posts-list');
        if (!postsList) return;

        const result = await chrome.storage.local.get(['scheduled-posts']);
        const scheduledPosts = result['scheduled-posts'] || [];

        // Sort by scheduled time (soonest first)
        scheduledPosts.sort((a, b) => a.scheduledTime - b.scheduledTime);

        // Filter out past posts (cleanup)
        const now = Date.now();
        const futurePosts = scheduledPosts.filter(p => p.scheduledTime > now);

        if (futurePosts.length === 0) {
            postsList.innerHTML = `
                <div class="empty-posts">
                    <p>No scheduled posts yet. Create one above!</p>
                </div>
            `;
            return;
        }

        postsList.innerHTML = futurePosts.map(post => {
            const dateObj = new Date(post.scheduledTime);
            const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const timeStr = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const hasMedia = post.mediaBase64 ? '<div class="post-media-preview">🖼️ 1 image attached</div>' : '';

            return `
                <div class="scheduled-post-card" data-post-id="${post.id}">
                    <div class="post-time">
                        <span class="post-date">${dateStr}</span>
                        <span class="post-hour">${timeStr}</span>
                    </div>
                    <div class="post-content">
                        <p>${escapeHtml(post.text || '').substring(0, 100)}${post.text?.length > 100 ? '...' : ''}</p>
                        ${hasMedia}
                    </div>
                    <div class="post-actions">
                        <button class="icon-btn post-now-btn" title="Post Now">🚀</button>
                        <button class="icon-btn danger delete-post-btn" title="Delete">🗑️</button>
                    </div>
                </div>
            `;
        }).join('');

        // Add event listeners for post actions
        postsList.querySelectorAll('.delete-post-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const card = e.target.closest('.scheduled-post-card');
                const postId = card.dataset.postId;
                if (confirm('Delete this scheduled post?')) {
                    await deleteScheduledPost(postId);
                    loadScheduledPosts();
                }
            });
        });

        postsList.querySelectorAll('.post-now-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const card = e.target.closest('.scheduled-post-card');
                const postId = card.dataset.postId;
                await postNow(postId);
            });
        });
    }

    async function deleteScheduledPost(postId) {
        const result = await chrome.storage.local.get(['scheduled-posts']);
        let scheduledPosts = result['scheduled-posts'] || [];
        scheduledPosts = scheduledPosts.filter(p => p.id !== postId);
        await chrome.storage.local.set({ 'scheduled-posts': scheduledPosts });

        // Also clear the alarm
        chrome.runtime.sendMessage({ action: 'cancel-post-alarm', postId: postId });
    }

    async function postNow(postId) {
        const result = await chrome.storage.local.get(['scheduled-posts']);
        const scheduledPosts = result['scheduled-posts'] || [];
        const post = scheduledPosts.find(p => p.id === postId);

        if (!post) {
            alert('Post not found.');
            return;
        }

        // Store as pending post and open compose
        await chrome.storage.local.set({
            'pending-post': {
                text: post.text,
                mediaBase64: post.mediaBase64,
                mediaName: post.mediaName,
                timestamp: Date.now()
            }
        });

        // Add to posted history BEFORE removing
        const historyResult = await chrome.storage.local.get(['posted-history']);
        const postedHistory = historyResult['posted-history'] || [];
        postedHistory.push({
            ...post,
            postedAt: Date.now()
        });
        await chrome.storage.local.set({ 'posted-history': postedHistory });

        // Remove from scheduled posts
        await deleteScheduledPost(postId);
        loadScheduledPosts();
        loadPostedHistory();

        // Open compose window
        chrome.runtime.sendMessage({ action: 'open-compose-window' });
    }

    // ============================================
    // Load and Display Posted History (filtered by date)
    // ============================================

    let selectedDate = null;

    async function loadPostedHistory(filterDate = null) {
        const historySection = document.querySelector('.posted-history');
        const historyList = document.querySelector('.history-list');
        if (!historyList || !historySection) return;

        // Hide if no date selected
        if (!filterDate) {
            historySection.style.display = 'none';
            return;
        }

        historySection.style.display = 'block';

        const result = await chrome.storage.local.get(['posted-history']);
        const postedHistory = result['posted-history'] || [];

        // Filter by selected date
        const filteredPosts = postedHistory.filter(post => {
            const postDate = new Date(post.postedAt);
            return postDate.toDateString() === filterDate.toDateString();
        });

        // Update header with selected date
        const header = historySection.querySelector('.upcoming-header');
        if (header) {
            const dateStr = filterDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            header.textContent = `📜 Posts on ${dateStr}`;
        }

        // Sort by posted time (most recent first)
        filteredPosts.sort((a, b) => b.postedAt - a.postedAt);

        if (filteredPosts.length === 0) {
            historyList.innerHTML = `
                <div class="empty-posts">
                    <p>No posts on this day.</p>
                </div>
            `;
            return;
        }

        historyList.innerHTML = filteredPosts.map(post => {
            const dateObj = new Date(post.postedAt);
            const timeStr = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const hasMedia = post.mediaBase64 ? '<div class="post-media-preview">🖼️ 1 image attached</div>' : '';

            return `
                <div class="scheduled-post-card posted" data-post-id="${post.id}">
                    <div class="post-time">
                        <span class="post-hour">${timeStr}</span>
                    </div>
                    <div class="post-content">
                        <p>${escapeHtml(post.text || '').substring(0, 100)}${post.text?.length > 100 ? '...' : ''}</p>
                        ${hasMedia}
                    </div>
                    <div class="post-actions">
                        <span class="posted-badge">✅ Posted</span>
                        <button class="icon-btn danger delete-history-btn" title="Remove from history">🗑️</button>
                    </div>
                </div>
            `;
        }).join('');

        // Add delete handlers
        historyList.querySelectorAll('.delete-history-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const card = e.target.closest('.scheduled-post-card');
                const postId = card.dataset.postId;
                if (confirm('Remove this post from history?')) {
                    const result = await chrome.storage.local.get(['posted-history']);
                    let history = result['posted-history'] || [];
                    history = history.filter(p => p.id !== postId);
                    await chrome.storage.local.set({ 'posted-history': history });
                    loadPostedHistory(selectedDate);
                }
            });
        });
    }

    // ============================================
    // Calendar Day Click Handlers
    // ============================================

    function setupCalendarDayClicks() {
        const calendarDays = document.querySelectorAll('.calendar-day:not(.other-month)');

        calendarDays.forEach(day => {
            day.addEventListener('click', () => {
                // Remove selection from other days
                document.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));

                // Select this day
                day.classList.add('selected');

                // Get the day number
                const dayNumber = parseInt(day.querySelector('.day-number')?.textContent || '1');

                // Get current month/year from the title
                const monthTitle = document.getElementById('calendar-month-title')?.textContent || 'January 2026';
                const [monthName, yearStr] = monthTitle.split(' ');
                const year = parseInt(yearStr);
                const monthIndex = new Date(`${monthName} 1, ${year}`).getMonth();

                // Create date object for selected day
                selectedDate = new Date(year, monthIndex, dayNumber);

                // Load history for that date
                loadPostedHistory(selectedDate);
            });
        });
    }

    // ============================================
    // Highlight Days with Posts (dynamic)
    // ============================================

    async function highlightDaysWithPosts() {
        const result = await chrome.storage.local.get(['scheduled-posts', 'posted-history']);
        const scheduledPosts = result['scheduled-posts'] || [];
        const postedHistory = result['posted-history'] || [];

        // Get current month/year from calendar title
        const monthTitle = document.getElementById('calendar-month-title')?.textContent || 'January 2026';
        const [monthName, yearStr] = monthTitle.split(' ');
        const year = parseInt(yearStr);
        const monthIndex = new Date(`${monthName} 1, ${year}`).getMonth();

        // Count posts per day
        const postsPerDay = {};

        // Check scheduled posts
        scheduledPosts.forEach(post => {
            const date = new Date(post.scheduledTime);
            if (date.getMonth() === monthIndex && date.getFullYear() === year) {
                const day = date.getDate();
                postsPerDay[day] = (postsPerDay[day] || 0) + 1;
            }
        });

        // Check posted history
        postedHistory.forEach(post => {
            const date = new Date(post.postedAt);
            if (date.getMonth() === monthIndex && date.getFullYear() === year) {
                const day = date.getDate();
                postsPerDay[day] = (postsPerDay[day] || 0) + 1;
            }
        });

        // Update calendar days
        const calendarDays = document.querySelectorAll('.calendar-day:not(.other-month)');
        calendarDays.forEach(dayEl => {
            const dayNumber = parseInt(dayEl.querySelector('.day-number')?.textContent || '0');

            // Remove existing indicators
            dayEl.classList.remove('has-posts');
            const existingIndicator = dayEl.querySelector('.day-posts');
            if (existingIndicator) existingIndicator.remove();

            // Add if has posts
            if (postsPerDay[dayNumber]) {
                dayEl.classList.add('has-posts');
                const count = postsPerDay[dayNumber];
                const indicator = document.createElement('div');
                indicator.className = 'day-posts';
                indicator.innerHTML = `<div class="post-indicator">🐦 ${count} post${count > 1 ? 's' : ''}</div>`;
                dayEl.appendChild(indicator);
            }
        });
    }

    // Load scheduled posts on page load
    loadScheduledPosts();

    // Setup calendar day click handlers
    setupCalendarDayClicks();

    // Hide history by default (no date selected)
    loadPostedHistory(null);

    // Highlight days with posts
    highlightDaysWithPosts();

    // Mark today on the calendar
    markTodayOnCalendar();

    // ============================================
    // Mark Today on Calendar (dynamic)
    // ============================================

    function markTodayOnCalendar() {
        const today = new Date();
        const todayDay = today.getDate();
        const todayMonth = today.getMonth();
        const todayYear = today.getFullYear();

        // Get current calendar month/year
        const monthTitle = document.getElementById('calendar-month-title')?.textContent || 'January 2026';
        const [monthName, yearStr] = monthTitle.split(' ');
        const calendarYear = parseInt(yearStr);
        const calendarMonth = new Date(`${monthName} 1, ${calendarYear}`).getMonth();

        // Only mark if viewing current month
        if (calendarMonth !== todayMonth || calendarYear !== todayYear) {
            return;
        }

        // Find and mark today's day
        const calendarDays = document.querySelectorAll('.calendar-day:not(.other-month)');
        calendarDays.forEach(dayEl => {
            const dayNumber = parseInt(dayEl.querySelector('.day-number')?.textContent || '0');

            // Remove existing today markers
            dayEl.classList.remove('today');
            const existingLabel = dayEl.querySelector('.today-label');
            if (existingLabel) existingLabel.remove();

            // Add today marker
            if (dayNumber === todayDay) {
                dayEl.classList.add('today');
                const label = document.createElement('div');
                label.className = 'today-label';
                label.textContent = 'Today';
                dayEl.appendChild(label);
            }
        });
    }

    // ============================================
    // Missed Posts Management
    // ============================================

    async function loadMissedPosts() {
        const missedSection = document.getElementById('missed-posts-section');
        const missedList = document.querySelector('.missed-posts-list');
        if (!missedSection || !missedList) return;

        const result = await chrome.storage.local.get(['missed-posts']);
        const missedPosts = result['missed-posts'] || [];

        // Hide section if no missed posts
        if (missedPosts.length === 0) {
            missedSection.style.display = 'none';
            return;
        }

        missedSection.style.display = 'block';

        // Sort by missed time (most recent first)
        missedPosts.sort((a, b) => b.missedAt - a.missedAt);

        missedList.innerHTML = missedPosts.map(post => {
            const originalDate = new Date(post.originalScheduledTime || post.scheduledTime);
            const dateStr = originalDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const timeStr = originalDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const hasMedia = post.mediaBase64 ? '<div class="post-media-preview">🖼️ 1 image attached</div>' : '';

            return `
                <div class="scheduled-post-card missed" data-post-id="${post.id}">
                    <div class="post-time">
                        <span class="post-date">${dateStr}</span>
                        <span class="post-hour">${timeStr}</span>
                        <span class="missed-badge">⚠️ Missed</span>
                    </div>
                    <div class="post-content">
                        <p>${escapeHtml(post.text || '').substring(0, 100)}${post.text?.length > 100 ? '...' : ''}</p>
                        ${hasMedia}
                    </div>
                    <div class="post-actions">
                        <button class="reschedule-btn" data-post-id="${post.id}" title="Reschedule">
                            🔄 Reschedule
                        </button>
                        <button class="icon-btn danger delete-missed-btn" title="Delete">🗑️</button>
                    </div>
                </div>
            `;
        }).join('');

        // Add event listeners
        missedList.querySelectorAll('.reschedule-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const postId = e.target.closest('.reschedule-btn').dataset.postId;
                openRescheduleModal(postId);
            });
        });

        missedList.querySelectorAll('.delete-missed-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const card = e.target.closest('.scheduled-post-card');
                const postId = card.dataset.postId;
                if (confirm('Delete this missed post?')) {
                    await deleteMissedPost(postId);
                    loadMissedPosts();
                }
            });
        });
    }

    async function deleteMissedPost(postId) {
        const result = await chrome.storage.local.get(['missed-posts']);
        let missedPosts = result['missed-posts'] || [];
        missedPosts = missedPosts.filter(p => p.id !== postId);
        await chrome.storage.local.set({ 'missed-posts': missedPosts });
    }

    function openRescheduleModal(postId) {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'reschedule-modal-overlay';
        overlay.innerHTML = `
            <div class="reschedule-modal">
                <h3>📅 Reschedule Post</h3>
                <div class="form-group">
                    <label>New Date</label>
                    <input type="date" id="reschedule-date" class="schedule-date">
                </div>
                <div class="form-group">
                    <label>New Time</label>
                    <input type="time" id="reschedule-time" class="schedule-time">
                </div>
                <div class="reschedule-modal-actions">
                    <button class="btn-secondary" id="cancel-reschedule">Cancel</button>
                    <button class="btn-primary" id="confirm-reschedule">Reschedule</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Set default values to tomorrow at 9am
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);

        const dateInput = overlay.querySelector('#reschedule-date');
        const timeInput = overlay.querySelector('#reschedule-time');

        dateInput.value = tomorrow.toISOString().split('T')[0];
        timeInput.value = '09:00';

        // Event listeners
        overlay.querySelector('#cancel-reschedule').addEventListener('click', () => {
            overlay.remove();
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        });

        overlay.querySelector('#confirm-reschedule').addEventListener('click', async () => {
            const newDate = dateInput.value;
            const newTime = timeInput.value;

            if (!newDate || !newTime) {
                alert('Please select a date and time.');
                return;
            }

            const newDateTime = new Date(`${newDate}T${newTime}`);
            const now = new Date();

            if (newDateTime <= now) {
                alert('Please select a future date and time.');
                return;
            }

            await reschedulePost(postId, newDateTime.getTime());
            overlay.remove();
        });
    }

    async function reschedulePost(postId, newScheduledTime) {
        // Get the missed post
        const result = await chrome.storage.local.get(['missed-posts', 'scheduled-posts']);
        const missedPosts = result['missed-posts'] || [];
        const scheduledPosts = result['scheduled-posts'] || [];

        const post = missedPosts.find(p => p.id === postId);
        if (!post) {
            alert('Post not found.');
            return;
        }

        // Create new post ID to avoid conflicts
        const newPostId = `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create new scheduled post
        const newPost = {
            id: newPostId,
            text: post.text,
            mediaBase64: post.mediaBase64,
            mediaName: post.mediaName,
            scheduledTime: newScheduledTime,
            createdAt: Date.now()
        };

        // Add to scheduled posts
        scheduledPosts.push(newPost);
        await chrome.storage.local.set({ 'scheduled-posts': scheduledPosts });

        // Remove from missed posts
        const updatedMissedPosts = missedPosts.filter(p => p.id !== postId);
        await chrome.storage.local.set({ 'missed-posts': updatedMissedPosts });

        // Create alarm for new post
        chrome.runtime.sendMessage({
            action: 'schedule-post-alarm',
            postId: newPostId,
            scheduledTime: newScheduledTime
        });

        // Refresh displays
        loadScheduledPosts();
        loadMissedPosts();
        highlightDaysWithPosts();

        // Show confirmation
        const dateStr = new Date(newScheduledTime).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
        alert(`Post rescheduled for ${dateStr}`);
    }

    // Load missed posts on page load
    loadMissedPosts();

});
