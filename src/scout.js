document.addEventListener('DOMContentLoaded', function () {
    // Element references
    const scrollSpeedSelect = document.getElementById('scroll-speed');
    const pauseOnMatchCheckbox = document.getElementById('pause-on-match');
    const autoGenerateCheckbox = document.getElementById('auto-generate');
    const highlightMatchesCheckbox = document.getElementById('highlight-matches');
    const soundNotificationCheckbox = document.getElementById('sound-notification');
    const matchCountDisplay = document.getElementById('match-count');
    const scoutStatusDisplay = document.getElementById('scout-status');

    // Save settings to Chrome storage
    function saveSettings() {
        const settings = {
            'scout-scroll-speed': scrollSpeedSelect.value,
            'scout-pause-on-match': pauseOnMatchCheckbox.checked,
            'scout-auto-generate': autoGenerateCheckbox.checked,
            'scout-highlight-matches': highlightMatchesCheckbox.checked,
            'scout-sound-notification': soundNotificationCheckbox.checked
        };

        chrome.storage.local.set(settings, () => {
            console.log('[Scout] Settings saved:', settings);
        });
    }

    // Load settings from Chrome storage
    function loadSettings() {
        chrome.storage.local.get([
            'scout-scroll-speed',
            'scout-pause-on-match',
            'scout-auto-generate',
            'scout-highlight-matches',
            'scout-sound-notification',
            'scout-match-count',
            'scout-status'
        ]).then((result) => {
            scrollSpeedSelect.value = result['scout-scroll-speed'] || 'medium';

            pauseOnMatchCheckbox.checked = result['scout-pause-on-match'] ?? true;
            autoGenerateCheckbox.checked = result['scout-auto-generate'] ?? false;
            highlightMatchesCheckbox.checked = result['scout-highlight-matches'] ?? true;
            soundNotificationCheckbox.checked = result['scout-sound-notification'] ?? false;

            // Display status
            matchCountDisplay.textContent = result['scout-match-count'] || 0;
            scoutStatusDisplay.textContent = result['scout-status'] || 'Idle';

            // Update status color
            updateStatusColor(result['scout-status']);
        });
    }

    function updateStatusColor(status) {
        if (status === 'Scouting') {
            scoutStatusDisplay.style.color = 'var(--success-color)';
        } else if (status === 'Paused') {
            scoutStatusDisplay.style.color = 'var(--accent-color)';
        } else {
            scoutStatusDisplay.style.color = 'var(--text-muted)';
        }
    }

    // Listen for storage changes to update UI in real-time
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local') {
            if (changes['scout-match-count']) {
                matchCountDisplay.textContent = changes['scout-match-count'].newValue || 0;
            }
            if (changes['scout-status']) {
                scoutStatusDisplay.textContent = changes['scout-status'].newValue || 'Idle';
                updateStatusColor(changes['scout-status'].newValue);
            }
        }
    });

    // Add event listeners for saving
    scrollSpeedSelect.addEventListener('change', saveSettings);
    pauseOnMatchCheckbox.addEventListener('change', saveSettings);
    autoGenerateCheckbox.addEventListener('change', saveSettings);
    highlightMatchesCheckbox.addEventListener('change', saveSettings);
    soundNotificationCheckbox.addEventListener('change', saveSettings);

    // Initialize
    loadSettings();
});
