document.addEventListener('DOMContentLoaded', function () {

  // Query save - Using 'input' for immediate saving to avoid data loss on popup close
  // Query save - Using 'input' for immediate saving to avoid data loss on popup close
  const gptQueryInput = document.getElementById('gpt-query');
  const promptSelect = document.getElementById('prompt-select');

  // Load saved prompts
  function loadPrompts() {
    chrome.storage.local.get(['saved-prompts', 'selected-prompt-id']).then(res => {
      const prompts = res['saved-prompts'] || [];
      const selectedId = res['selected-prompt-id'] || 'custom';

      // Clear (except first 'Custom' option)
      while (promptSelect.options.length > 1) {
        promptSelect.remove(1);
      }

      prompts.forEach((p, index) => {
        const option = document.createElement('option');
        option.value = index; // Use index as ID for simplicity
        option.text = p.name;
        promptSelect.appendChild(option);
      });

      promptSelect.value = selectedId;
    });
  }

  loadPrompts();

  if (gptQueryInput) {
    gptQueryInput.addEventListener('input', function () {
      const value = gptQueryInput.value;
      chrome.storage.local.set({ 'gpt-query': value });
      // If user types, switch select to 'custom' automatically if not already
      // unless they are just editing a loaded one? 
      // Simplest UX: If you edit, it becomes "Custom" (or dirty state), 
      // but to avoid complexity we'll just let them edit the active text. 
      // Ideally we switch to 'custom' if content diverges, but let's keep it simple.
      promptSelect.value = 'custom';
      chrome.storage.local.set({ 'selected-prompt-id': 'custom' });
    });
  }

  // Prompt Management Buttons
  document.getElementById('save-prompt-btn').addEventListener('click', () => {
    const content = gptQueryInput.value;
    if (!content.trim()) return alert("Prompt cannot be empty");

    const name = prompt("Enter a name for this prompt:");
    if (!name) return;

    chrome.storage.local.get(['saved-prompts']).then(res => {
      const prompts = res['saved-prompts'] || [];
      prompts.push({ name: name, content: content });
      chrome.storage.local.set({ 'saved-prompts': prompts, 'selected-prompt-id': prompts.length - 1 }, () => {
        loadPrompts(); // Reload UI
        // Since we selected the new one by logic (length-1), loadPrompts will pick it up
        // BUT loadPrompts is async read. We should force select.
        setTimeout(() => promptSelect.value = prompts.length - 1, 50);
      });
    });
  });

  document.getElementById('delete-prompt-btn').addEventListener('click', () => {
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
            'selected-prompt-id': 'custom' // Reset to custom
          }, () => {
            loadPrompts();
            gptQueryInput.value = ""; // Optional: Clear or keep? valid question.
            // Usually better to keep text or clear? Let's keep text to be safe.
          });
        }
      });
    }
  });

  promptSelect.addEventListener('change', () => {
    const selected = promptSelect.value;
    chrome.storage.local.set({ 'selected-prompt-id': selected });

    if (selected === 'custom') {
      // If switching *to* custom, maybe we just leave whatever is there?
      // Or we load the last known 'custom' state? 
      // Current architecture saves everything to 'gpt-query'. 
      // So 'Custom' is just "Current contents".
      return;
    }

    chrome.storage.local.get(['saved-prompts']).then(res => {
      const prompts = res['saved-prompts'] || [];
      const index = parseInt(selected);
      if (prompts[index]) {
        gptQueryInput.value = prompts[index].content;
        // Also save to active query slot so it's used immediately
        chrome.storage.local.set({ 'gpt-query': prompts[index].content });
      }
    });
  });

  // Window Close Behavior
  const windowCloseCheckbox = document.getElementById('window-close');
  if (windowCloseCheckbox) {
    windowCloseCheckbox.addEventListener('change', function () {
      const isChecked = windowCloseCheckbox.checked;
      chrome.storage.local.set({ 'automatic-window-close': isChecked });
    });
  }

  // Auto-Send Behavior
  const autoSendCheckbox = document.getElementById('auto-send');
  if (autoSendCheckbox) {
    autoSendCheckbox.addEventListener('change', function () {
      const isChecked = autoSendCheckbox.checked;
      chrome.storage.local.set({ 'auto-send': isChecked });
    });
  }

  // Load Initial States
  chrome.storage.local.get(['gpt-query', 'automatic-window-close', 'auto-send']).then((result) => {
    if (gptQueryInput) {
      gptQueryInput.value = result['gpt-query'] || "You are a ghostwriter and reply to the user's tweets by talking directly to the person, you must keep it short, exclude hashtags.";
    }

    if (windowCloseCheckbox) {
      // Default to true if undefined
      if (result['automatic-window-close'] == undefined) {
        windowCloseCheckbox.checked = true;
        chrome.storage.local.set({ 'automatic-window-close': true });
      } else {
        windowCloseCheckbox.checked = result['automatic-window-close'];
      }
    }

    if (autoSendCheckbox && result['auto-send'] !== undefined) {
      autoSendCheckbox.checked = result['auto-send'];
    }
  });

  // Stats Logic (Respects Reset Hour)
  chrome.storage.local.get(['daily-stats', 'stats-reset-hour']).then((res) => {
    const resetHour = res['stats-reset-hour'] || 0;

    // Calculate "Logic Date"
    const now = new Date();
    if (now.getHours() < resetHour) {
      now.setDate(now.getDate() - 1);
    }
    const logicDateKey = `${now.toDateString()}_${resetHour}`;

    const stats = res['daily-stats'];

    let count = 0;
    // Compare against the new composite key
    if (stats && stats.date === logicDateKey) {
      count = stats.count || 0;
    }

    const countEl = document.getElementById('reply-count');
    if (countEl) countEl.textContent = count;
  });
});