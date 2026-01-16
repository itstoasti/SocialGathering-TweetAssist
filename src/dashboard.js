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

});
