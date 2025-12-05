// Background service worker for Discord Chat Exporter

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Discord Chat Exporter installed');
  } else if (details.reason === 'update') {
    console.log('Discord Chat Exporter updated');
  }
});

// Create context menu item for quick message selection
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'setStartMessage',
    title: 'Set as export starting point',
    contexts: ['all'],
    documentUrlPatterns: ['https://discord.com/*']
  });

  chrome.contextMenus.create({
    id: 'setEndMessage',
    title: 'Set as export ending point',
    contexts: ['all'],
    documentUrlPatterns: ['https://discord.com/*']
  });

  chrome.contextMenus.create({
    id: 'exportFromHere',
    title: 'Export from this message (PDF)',
    contexts: ['all'],
    documentUrlPatterns: ['https://discord.com/*']
  });

  chrome.contextMenus.create({
    id: 'exportFromHereMD',
    title: 'Export from this message (Markdown)',
    contexts: ['all'],
    documentUrlPatterns: ['https://discord.com/*']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'setStartMessage') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'setStartFromContextMenu'
    });
  } else if (info.menuItemId === 'setEndMessage') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'setEndFromContextMenu'
    });
  } else if (info.menuItemId === 'exportFromHere') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'exportFromContextMenu',
      format: 'pdf',
      options: {
        includeImages: true,
        includeAvatars: true,
        includeTimestamps: true,
        includeReactions: true
      }
    });
  } else if (info.menuItemId === 'exportFromHereMD') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'exportFromContextMenu',
      format: 'markdown',
      options: {
        includeImages: true,
        includeAvatars: true,
        includeTimestamps: true,
        includeReactions: true
      }
    });
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Forward messages to popup if needed
  if (message.action === 'messageSelected' ||
    message.action === 'progressUpdate' ||
    message.action === 'exportComplete') {
    // These will be received by the popup directly
  }

  return false;
});

// Handle download requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'downloadFile') {
    chrome.downloads.download({
      url: message.url,
      filename: message.filename,
      saveAs: true
    }, (downloadId) => {
      sendResponse({ success: true, downloadId });
    });
    return true; // Keep channel open for async response
  }
});
