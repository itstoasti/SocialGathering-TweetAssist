const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const XAI_API_URL = 'https://api.x.ai/v1';

function getOpenAIModels(apiKey) {
    return fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
        }
    }).then(response => response.json());
}

async function validateGeminiApiKey() {
    const apiKey = document.getElementById('gemini-api-key').value.trim();
    const apiKeyInput = document.getElementById('gemini-api-key');
    const validateButton = document.getElementById('validate-gemini-button');
    const selectModels = document.getElementById('models-select');

    // Simple validation for Gemini key presence
    if (!apiKey) {
        apiKeyInput.style.borderColor = 'red';
        validateButton.classList.add('invalid');
        return;
    }

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`);
        if (response.ok) {
            apiKeyInput.style.borderColor = 'green';
            selectModels.disabled = false;
            loadAndPopulateModels();
            validateButton.classList.remove('invalid');
            chrome.storage.local.set({ 'gemini-api-key': apiKey });
            console.log("Gemini API key saved");
        } else {
            const errorData = await response.json();
            console.error("Validation failed:", errorData);
            throw new Error('Invalid key');
        }
    } catch (error) {
        console.error('Error occurred during Gemini API key validation:', error);
        apiKeyInput.style.borderColor = 'red';
        selectModels.disabled = true;
        validateButton.classList.add('invalid');
    }
}

async function validateXaiApiKey() {
    const apiKey = document.getElementById('xai-api-key').value.trim();
    const apiKeyInput = document.getElementById('xai-api-key');
    const validateButton = document.getElementById('validate-xai-button');
    const selectModels = document.getElementById('models-select');

    if (!apiKey) {
        apiKeyInput.style.borderColor = 'red';
        validateButton.classList.add('invalid');
        return;
    }

    try {
        // xAI uses OpenAI-compatible API, so we can test with /models endpoint
        const response = await fetch(`${XAI_API_URL}/models`, {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + apiKey
            }
        });

        if (response.ok) {
            apiKeyInput.style.borderColor = 'green';
            selectModels.disabled = false;
            loadAndPopulateModels();
            validateButton.classList.remove('invalid');
            chrome.storage.local.set({ 'xai-api-key': apiKey });
            console.log("xAI API key saved");
        } else {
            throw new Error('Invalid key');
        }
    } catch (error) {
        console.error('Error occurred during xAI API key validation:', error);
        apiKeyInput.style.borderColor = 'red';
        selectModels.disabled = true;
        validateButton.classList.add('invalid');
    }
}

function validateApiKey() {
    const apiKey = document.getElementById('api-key').value;
    const apiKeyInput = document.getElementById('api-key');
    const validateButton = document.getElementById('validate-button');
    const selectModels = document.getElementById('models-select');

    getOpenAIModels(apiKey)
        .then((response) => {
            if (response['error'] !== undefined) {
                apiKeyInput.style.borderColor = 'red';
                selectModels.disabled = true;
                validateButton.classList.add('invalid');
            } else {
                apiKeyInput.style.borderColor = 'green';
                selectModels.disabled = false;
                loadAndPopulateModels()
                validateButton.classList.remove('invalid');
            }
        })
        .catch((error) => {
            console.error('Error occurred during API key validation:', error);
            apiKeyInput.style.borderColor = 'red';
            selectModels.disabled = true;
            validateButton.classList.add('invalid');
        });
}

function loadAndPopulateModels() {
    const provider = document.getElementById('provider-select').value;
    const modelSelect = document.getElementById('models-select');
    modelSelect.innerHTML = ''; // Clear existing options

    if (provider === 'openai') {
        const apiKey = document.getElementById('api-key').value;
        if (!apiKey) return;

        getOpenAIModels(apiKey)
            .then((response) => {
                // Add default option
                chrome.storage.local.get(['openai-model']).then((model) => {
                    const defaultOption = document.createElement('option');
                    defaultOption.value = model['openai-model'] || 'gpt-3.5-turbo';
                    defaultOption.text = model['openai-model'] || 'gpt-3.5-turbo';
                    defaultOption.selected = true;
                    modelSelect.appendChild(defaultOption);
                });

                // Add models from response
                if (response.data) {
                    response.data.forEach(model => {
                        const option = document.createElement('option');
                        option.value = model.id;
                        option.text = model.id;
                        modelSelect.appendChild(option);
                    });
                }
            })
            .catch((error) => {
                console.error('Error loading models:', error);
            });
    } else if (provider === 'gemini') {
        const apiKey = document.getElementById('gemini-api-key').value.trim();
        if (!apiKey) return;

        fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
            .then(res => res.json())
            .then(data => {
                if (data.models) {
                    chrome.storage.local.get(['gemini-model']).then((res) => {
                        const currentModel = res['gemini-model'] || 'gemini-1.5-flash';

                        const validModels = data.models.filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'));
                        const userFriendlyModels = validModels.filter(m => {
                            const name = m.name.toLowerCase();
                            return name.includes('flash') || name.includes('pro');
                        });

                        const displayList = userFriendlyModels.length > 0 ? userFriendlyModels : validModels;

                        validModels.forEach(m => {
                            const modelId = m.name.replace('models/', '');
                            const option = document.createElement('option');
                            option.value = modelId;
                            option.text = (m.displayName || modelId).replace('models/', '');

                            if (modelId === currentModel) {
                                option.selected = true;
                            }
                            modelSelect.appendChild(option);
                        });

                        // Force add specific versions
                        const fallbacks = [
                            { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (Generic)' },
                            { id: 'gemini-1.5-flash-latest', name: 'Gemini 1.5 Flash-Latest' },
                            { id: 'gemini-1.5-flash-001', name: 'Gemini 1.5 Flash-001' },
                            { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
                        ];

                        fallbacks.forEach(fb => {
                            if (!Array.from(modelSelect.options).some(o => o.value === fb.id)) {
                                const option = document.createElement('option');
                                option.value = fb.id;
                                option.text = fb.name + " (Force Added)";
                                if (currentModel === fb.id) {
                                    option.selected = true;
                                }
                                modelSelect.insertBefore(option, modelSelect.firstChild);
                            }
                        });

                        const options = Array.from(modelSelect.options);
                        const values = options.map(o => o.value);
                        if (!values.includes(currentModel) && options.length > 0) {
                            modelSelect.value = options[0].value;
                            chrome.storage.local.set({ 'gemini-model': options[0].value });
                        }
                    });
                }
            })
            .catch(console.error);
    } else if (provider === 'xai') {
        const apiKey = document.getElementById('xai-api-key').value.trim();
        if (!apiKey) return;

        // xAI models - from xAI console (https://console.x.ai)
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
                if (m.id === currentModel) {
                    option.selected = true;
                }
                modelSelect.appendChild(option);
            });
        });
    }
}

function updateProviderUI() {
    const provider = document.getElementById('provider-select').value;
    const openaiConfig = document.getElementById('openai-config');
    const geminiConfig = document.getElementById('gemini-config');
    const xaiConfig = document.getElementById('xai-config');

    // Hide all configs first
    openaiConfig.classList.add('hidden');
    geminiConfig.classList.add('hidden');
    xaiConfig.classList.add('hidden');

    // Show the selected provider's config
    if (provider === 'gemini') {
        geminiConfig.classList.remove('hidden');
    } else if (provider === 'openai') {
        openaiConfig.classList.remove('hidden');
    } else if (provider === 'xai') {
        xaiConfig.classList.remove('hidden');
    }
    loadAndPopulateModels();
}

document.addEventListener('DOMContentLoaded', function () {
    // --- Stats Reset Hour Logic ---
    const resetHourInput = document.getElementById('reset-hour');

    // Load saved hour
    chrome.storage.local.get(['stats-reset-hour']).then((result) => {
        resetHourInput.value = result['stats-reset-hour'] || 0;
    });

    // Save on change
    resetHourInput.addEventListener('change', () => {
        let val = parseInt(resetHourInput.value);
        if (val < 0) val = 0;
        if (val > 23) val = 23;
        resetHourInput.value = val;
        chrome.storage.local.set({ 'stats-reset-hour': val });
    });


    // --- AI Config Logic (Moved from popup.js) ---
    const providerSelect = document.getElementById('provider-select');
    providerSelect.addEventListener('change', function () {
        const value = providerSelect.value;
        chrome.storage.local.set({ 'ai-provider': value }).then(() => {
            console.log("AI Provider saved: " + value);
            updateProviderUI();
        });
    });

    chrome.storage.local.get(['ai-provider', 'open-ai-key', 'gemini-api-key', 'xai-api-key']).then((result) => {
        if (result['open-ai-key'] !== undefined) {
            document.getElementById('api-key').value = result['open-ai-key'];
        }
        if (result['gemini-api-key'] !== undefined) {
            document.getElementById('gemini-api-key').value = result['gemini-api-key'];
        }
        if (result['xai-api-key'] !== undefined) {
            document.getElementById('xai-api-key').value = result['xai-api-key'];
        }

        const provider = result['ai-provider'] || 'gemini';
        providerSelect.value = provider;
        updateProviderUI();
    });

    document.getElementById('api-key').addEventListener('change', function () {
        const value = document.getElementById('api-key').value;
        chrome.storage.local.set({ 'open-ai-key': value }).then(() => {
            console.log("New API key saved");
        });
        validateApiKey();
    });

    document.getElementById('gemini-api-key').addEventListener('change', function () {
        // Just auto-save on change? original code didn't save locally on change event, only validate did.
        // But validate does save. We can leave it as is.
    });

    document.getElementById('validate-button').addEventListener('click', validateApiKey);
    document.getElementById('validate-gemini-button').addEventListener('click', validateGeminiApiKey);
    document.getElementById('validate-xai-button').addEventListener('click', validateXaiApiKey);

    document.getElementById('xai-api-key').addEventListener('change', function () {
        // Save on change for convenience
        const value = document.getElementById('xai-api-key').value.trim();
        if (value) {
            chrome.storage.local.set({ 'xai-api-key': value });
        }
    });

    document.getElementById('models-select').addEventListener('change', function () {
        const value = document.getElementById('models-select').value;
        const provider = document.getElementById('provider-select').value;
        if (provider === 'openai') {
            chrome.storage.local.set({ 'openai-model': value });
        } else if (provider === 'xai') {
            chrome.storage.local.set({ 'xai-model': value });
        } else {
            chrome.storage.local.set({ 'gemini-model': value });
        }
    });

    document.getElementById('show-api-key').addEventListener('click', function (event) {
        const isChecked = document.getElementById('show-api-key').checked;
        if (isChecked) {
            document.getElementById('api-key').setAttribute('type', 'text');
        } else {
            document.getElementById('api-key').setAttribute('type', 'password');
        }
    });

    document.getElementById('show-gemini-api-key').addEventListener('click', function (event) {
        const isChecked = document.getElementById('show-gemini-api-key').checked;
        if (isChecked) {
            document.getElementById('gemini-api-key').setAttribute('type', 'text');
        } else {
            document.getElementById('gemini-api-key').setAttribute('type', 'password');
        }
    });

    document.getElementById('show-xai-api-key').addEventListener('click', function (event) {
        const isChecked = document.getElementById('show-xai-api-key').checked;
        if (isChecked) {
            document.getElementById('xai-api-key').setAttribute('type', 'text');
        } else {
            document.getElementById('xai-api-key').setAttribute('type', 'password');
        }
    });

});
