// Popup script for Discord Chat Exporter

let selectedMessageId = null;
let selectedMessagePreview = null;

// Check if we're on Discord
async function checkDiscordPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isDiscord = tab.url && tab.url.includes('discord.com');
    
    document.getElementById('not-discord').classList.toggle('hidden', isDiscord);
    document.getElementById('main-content').classList.toggle('hidden', !isDiscord);
    
    return isDiscord;
  } catch (error) {
    console.error('Error checking Discord page:', error);
    return false;
  }
}

// Send message to content script
async function sendToContentScript(action, data = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return chrome.tabs.sendMessage(tab.id, { action, ...data });
}

// Update status display
function updateStatus(message, type = 'normal') {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = 'status';
  if (type !== 'normal') {
    status.classList.add(type);
  }
}

// Update progress bar
function updateProgress(percent, text) {
  const progressContainer = document.getElementById('progress-container');
  const progress = document.getElementById('progress');
  const progressText = document.getElementById('progress-text');
  
  progressContainer.classList.remove('hidden');
  progress.style.width = `${percent}%`;
  progressText.textContent = text || `${percent}%`;
}

// Hide progress bar
function hideProgress() {
  document.getElementById('progress-container').classList.add('hidden');
}

// Show export status
function showExportStatus(text) {
  const exportStatus = document.getElementById('export-status');
  const exportStatusText = document.getElementById('export-status-text');
  exportStatus.classList.remove('hidden');
  exportStatusText.textContent = text;
}

// Hide export status
function hideExportStatus() {
  document.getElementById('export-status').classList.add('hidden');
}

// Update selected message display
function updateSelectedMessage(preview) {
  const container = document.getElementById('selected-message');
  const previewEl = document.getElementById('selected-preview');
  
  if (preview) {
    container.classList.remove('hidden');
    previewEl.textContent = preview;
  } else {
    container.classList.add('hidden');
  }
}

// Get export options
function getExportOptions() {
  return {
    includeImages: document.getElementById('include-images').checked,
    includeAvatars: document.getElementById('include-avatars').checked,
    includeTimestamps: document.getElementById('include-timestamps').checked,
    includeReactions: document.getElementById('include-reactions').checked,
  };
}

// Handle select starting message button
document.getElementById('select-start').addEventListener('click', async () => {
  try {
    updateStatus('Click on a message to set as starting point...');
    await sendToContentScript('startSelection');
    window.close(); // Close popup so user can select
  } catch (error) {
    updateStatus('Error: ' + error.message, 'error');
  }
});

// Handle PDF export
document.getElementById('export-pdf').addEventListener('click', async () => {
  try {
    const options = getExportOptions();
    showExportStatus('Scrolling and collecting messages...');
    updateStatus('Exporting to PDF...');
    
    const response = await sendToContentScript('exportPDF', { options });
    
    if (response.success) {
      updateStatus('PDF exported successfully!', 'success');
    } else {
      updateStatus('Error: ' + response.error, 'error');
    }
  } catch (error) {
    updateStatus('Error: ' + error.message, 'error');
  } finally {
    hideExportStatus();
  }
});

// Handle Markdown export
document.getElementById('export-md').addEventListener('click', async () => {
  try {
    const options = getExportOptions();
    showExportStatus('Scrolling and collecting messages...');
    updateStatus('Exporting to Markdown...');
    
    const response = await sendToContentScript('exportMarkdown', { options });
    
    if (response.success) {
      updateStatus('Markdown exported successfully!', 'success');
    } else {
      updateStatus('Error: ' + response.error, 'error');
    }
  } catch (error) {
    updateStatus('Error: ' + error.message, 'error');
  } finally {
    hideExportStatus();
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'messageSelected') {
    selectedMessageId = message.messageId;
    selectedMessagePreview = message.preview;
    updateSelectedMessage(message.preview);
    updateStatus('Starting message selected!', 'success');
  } else if (message.action === 'progressUpdate') {
    updateProgress(message.percent, message.text);
  } else if (message.action === 'exportComplete') {
    hideProgress();
    hideExportStatus();
    updateStatus(message.success ? 'Export complete!' : 'Export failed: ' + message.error, 
                 message.success ? 'success' : 'error');
  }
});

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await checkDiscordPage();
  
  // Check if there's a previously selected message
  try {
    const response = await sendToContentScript('getSelectedMessage');
    if (response && response.messageId) {
      selectedMessageId = response.messageId;
      selectedMessagePreview = response.preview;
      updateSelectedMessage(response.preview);
    }
  } catch (error) {
    console.log('No previously selected message');
  }
});
