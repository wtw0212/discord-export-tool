// Content script for Discord Chat Exporter
// Refactored modular version - All code bundled for Chrome Extension compatibility

(function () {
  'use strict';

  // --- CONSTANTS ---
  const SELECTORS = {
    // Message containers
    messagesContainer: '[class*="messagesWrapper"]',
    messagesList: '[class*="scrollerInner"]',
    message: '[id^="chat-messages-"]',
    messageGroup: '[class*="messageListItem"], [class*="groupStart"]',

    // Message parts
    messageContent: '[class*="messageContent"]',
    messageUsername: '[class*="username"]',
    messageTimestamp: 'time',
    messageAvatar: '[class*="avatar"] img, [class*="avatarWrapper"] img, img[class*="avatar"]',
    messageHeader: '[class*="header"]',
    repliedMessage: '[class*="repliedMessage"]',

    // Attachments
    messageImages: '[class*="imageWrapper"] img, [class*="embedImage"] img, [class*="mediaAttachment"] img',
    messageAttachments: '[class*="attachment"]',
    messageReactions: '[class*="reactions"]',

    // Navigation
    chatArea: '[class*="chatContent"]',
    scroller: '[class*="scroller"]',
    messagesScroller: '[class*="messagesWrapper"] [class*="scroller"]',

    // Bot embed selectors
    embedWrapper: '[class*="embedWrapper"], [class*="embed-"]',
    embedTitle: '[class*="embedTitle"]',
    embedDescription: '[class*="embedDescription"]',
    embedFields: '[class*="embedFields"]',
    embedField: '[class*="embedField"]',
    embedFieldName: '[class*="embedFieldName"]',
    embedFieldValue: '[class*="embedFieldValue"]',
    embedAuthor: '[class*="embedAuthor"]',
    embedFooter: '[class*="embedFooter"]',
    embedThumbnail: '[class*="embedThumbnail"] img',
    embedImage: '[class*="embedImage"] img, [class*="embedMedia"] img'
  };

  const CONFIG = {
    scrollDelay: 600,
    maxScrollAttempts: 500,
    maxNoChangeAttempts: 8,
    avatarSize: 128,
    contextMenuDelay: 100,
    highlightDuration: 2000
  };

  const DEFAULT_EXPORT_OPTIONS = {
    includeImages: true,
    includeAvatars: true,
    includeTimestamps: true,
    includeReactions: true
  };

  // --- CACHE ---

  const userCache = {
    avatars: {},
    colors: {},
    lastUsername: '',

    reset() {
      this.avatars = {};
      this.colors = {};
      this.lastUsername = '';
    },

    setAvatar(username, url) {
      if (username) this.avatars[username] = url;
    },

    getAvatar(username) {
      return this.avatars[username] || null;
    },

    setColor(username, color) {
      if (username && color) this.colors[username] = color;
    },

    getColor(username) {
      return this.colors[username] || null;
    }
  };

  // Image cache to avoid re-downloading same images
  const imageCache = new Map();
  const MAX_IMAGE_CACHE_SIZE = 200;

  function clearImageCache() {
    imageCache.clear();
  }

  async function getCachedImage(url) {
    if (!url) return null;

    if (imageCache.has(url)) {
      return imageCache.get(url);
    }

    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // Limit cache size to prevent memory issues
      if (imageCache.size >= MAX_IMAGE_CACHE_SIZE) {
        const firstKey = imageCache.keys().next().value;
        imageCache.delete(firstKey);
      }

      imageCache.set(url, base64);
      return base64;
    } catch (error) {
      console.error('Error caching image:', error);
      return null;
    }
  }

  // --- STATE ---

  let isSelectionMode = false;
  let selectedMessageElement = null;
  let selectedMessageId = null;
  let selectedEndMessageElement = null;
  let selectedEndMessageId = null;
  let highlightOverlay = null;

  // --- DOM UTILITIES ---

  function findMessageElement(element) {
    return element.closest(SELECTORS.message);
  }

  function getMessageId(messageEl) {
    if (!messageEl) return null;
    const id = messageEl.id;
    return (id && id.startsWith('chat-messages-')) ? id : null;
  }

  function getMessagePreview(messageEl) {
    if (!messageEl) return '';

    const contentEl = messageEl.querySelector(SELECTORS.messageContent);
    const usernameEl = messageEl.querySelector(SELECTORS.messageUsername);

    const username = usernameEl ? usernameEl.textContent.trim() : 'Unknown';
    const content = contentEl ? contentEl.textContent.trim().substring(0, 50) : '';

    return `${username}: ${content}${content.length >= 50 ? '...' : ''}`;
  }

  function getChannelName() {
    const selectors = [
      '[class*="title"][class*="channel"]',
      '[class*="channelName"]',
      'h1[class*="title"]',
      '[class*="header"] [class*="title"]',
      '[class*="chat"] [class*="title"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }

    const match = window.location.pathname.match(/\/channels\/\d+\/(\d+)/);
    return match ? `Channel ${match[1]}` : 'Discord Chat Export';
  }

  function getMessagesScroller() {
    const selectors = [
      '[class*="messagesWrapper"] [class*="scroller"]',
      '[class*="chatContent"] [class*="scroller"]',
      'main [class*="scroller"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // --- IMAGE UTILITIES ---

  function getFullResolutionImageUrl(img) {
    if (!img) return null;

    const originalUrl = img.getAttribute('data-original-src') ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-safe-src');
    if (originalUrl) return originalUrl;

    let src = img.src;
    if (!src) return null;

    if (src.includes('cdn.discordapp.com') || src.includes('media.discordapp.net')) {
      try {
        const url = new URL(src);
        url.searchParams.delete('width');
        url.searchParams.delete('height');
        url.searchParams.delete('size');
        url.searchParams.delete('quality');
        src = url.toString();
      } catch (e) {
        src = src.replace(/[&?](width|height|size)=\d+/gi, '');
      }
      src = src.replace('media.discordapp.net', 'cdn.discordapp.com');
    }

    const parentAnchor = img.closest('a');
    if (parentAnchor && parentAnchor.href) {
      const href = parentAnchor.href;
      if (href.includes('cdn.discordapp.com/attachments') ||
        href.includes('media.discordapp.net/attachments')) {
        return href.replace('media.discordapp.net', 'cdn.discordapp.com');
      }
    }

    return src;
  }

  async function imageToBase64(url) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Error converting image to base64:', error);
      return null;
    }
  }

  function isEmojiImage(img) {
    const src = img.src || '';
    const className = img.className || '';
    const ariaLabel = img.getAttribute('aria-label') || '';
    const dataType = img.getAttribute('data-type') || '';

    return (
      src.includes('cdn.discordapp.com/emojis') ||
      src.includes('discord.com/assets') ||
      src.includes('twemoji') ||
      className.includes('emoji') ||
      dataType === 'emoji' ||
      ariaLabel.startsWith(':') ||
      (img.width && img.width <= 48 && img.height && img.height <= 48)
    );
  }

  function isAvatarImage(img) {
    const src = img.src || '';
    return src.includes('/avatars/') || img.className.includes('avatar');
  }

  function isAvatarDecoration(img) {
    const src = img.src || '';
    const className = img.className || '';
    // Check for avatar decoration URLs and classes
    return (
      src.includes('avatar-decoration') ||
      src.includes('avatar_decoration') ||
      src.includes('/avatar-decorations/') ||
      src.includes('/avatar-decoration-presets/') ||
      className.includes('avatarDecoration') ||
      className.includes('avatar-decoration') ||
      className.includes('decoration') ||
      img.closest('[class*="avatarDecoration"]') !== null ||
      img.closest('[class*="decoration"]') !== null
    );
  }

  function isGifUrl(url) {
    if (!url) return false;
    const lowerUrl = url.toLowerCase();
    return lowerUrl.includes('.gif') || lowerUrl.includes('format=gif');
  }

  function getStaticImageUrl(url) {
    // Convert GIF URL to static image (first frame)
    if (!url) return url;

    try {
      const urlObj = new URL(url);

      // For Discord CDN, we can request a static format
      if (url.includes('cdn.discordapp.com') || url.includes('media.discordapp.net')) {
        // Change .gif to .png or add format parameter
        if (urlObj.pathname.endsWith('.gif')) {
          urlObj.pathname = urlObj.pathname.replace('.gif', '.png');
        }
        urlObj.searchParams.set('format', 'png');
        return urlObj.toString();
      }

      // For Tenor GIFs
      if (url.includes('tenor.com')) {
        // Tenor URLs often have a static thumbnail variant
        return url.replace('.gif', '.png');
      }

    } catch (e) {
      console.error('Error converting GIF URL:', e);
    }

    return url; // Return original if conversion fails
  }

  // --- CONTENT PROCESSING ---

  function processContentForEmoji(html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // Remove accessibility elements
    const elementsToRemove = tempDiv.querySelectorAll([
      '[class*="visuallyHidden"]',
      '[class*="hiddenVisually"]',
      '[class*="srOnly"]',
      '[class*="screenReaderOnly"]',
      '[class*="emojiText"]',
      '[class*="accessibilityText"]',
      '.sr-only',
      '[aria-hidden="true"]:not(img)'
    ].join(','));

    elementsToRemove.forEach(el => {
      if (el.tagName !== 'IMG') el.remove();
    });

    // Clean text nodes
    const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, null, false);
    const textNodesToCheck = [];
    while (walker.nextNode()) {
      textNodesToCheck.push(walker.currentNode);
    }

    textNodesToCheck.forEach(textNode => {
      const text = textNode.textContent;

      if (/^:[a-zA-Z0-9_]+:$/.test(text.trim())) {
        const parent = textNode.parentElement;
        if (parent && (
          parent.className.includes('emoji') ||
          parent.className.includes('accessib') ||
          parent.className.includes('hidden') ||
          parent.getAttribute('aria-label') ||
          parent.getAttribute('title')?.includes('按一下')
        )) {
          textNode.remove();
        }
      }

      if (text.includes('按一下以了解更多') ||
        text.includes('Click to learn more') ||
        text.includes('click to see more')) {
        textNode.textContent = text
          .replace(/按一下以了解更多/g, '')
          .replace(/Click to learn more/gi, '')
          .replace(/click to see more/gi, '');
      }
    });

    // Process emoji images
    const imgs = tempDiv.querySelectorAll('img');
    imgs.forEach(img => {
      const src = img.src || '';
      const className = img.className || '';
      const ariaLabel = img.getAttribute('aria-label') || '';
      const dataType = img.getAttribute('data-type') || '';

      const isDiscordEmoji =
        src.includes('cdn.discordapp.com/emojis') ||
        src.includes('discord.com/assets') ||
        src.includes('twemoji') ||
        className.includes('emoji') ||
        dataType === 'emoji' ||
        ariaLabel.startsWith(':') ||
        (img.width && img.width <= 48 && img.height && img.height <= 48);

      if (isDiscordEmoji) {
        img.classList.add('emoji');
        img.setAttribute('data-type', 'emoji');
        img.removeAttribute('width');
        img.removeAttribute('height');
        img.removeAttribute('aria-label');
        img.removeAttribute('title');
        img.style.display = 'inline';
        img.style.width = '1.375em';
        img.style.height = '1.375em';
        img.style.verticalAlign = '-0.4em';
        img.style.objectFit = 'contain';
      }
    });

    let result = tempDiv.innerHTML;
    result = result.replace(/(<img[^>]*class="[^"]*emoji[^"]*"[^>]*>)\s*\1/gi, '$1');
    result = result.replace(/(?<![:\w]):[a-zA-Z0-9_]+:(?![:\w])/g, '');

    return result;
  }

  // --- MESSAGE EXTRACTION ---

  function findUsernameElement(messageEl) {
    // Try header first (most common case)
    const headerEl = messageEl.querySelector('[class*="header"]:not([class*="repliedMessage"] *)');
    if (headerEl) {
      const el = headerEl.querySelector('[class*="username"]');
      if (el && el.textContent.trim()) return el;
    }

    // Try all username elements
    const allUsernameEls = messageEl.querySelectorAll(SELECTORS.messageUsername);
    for (const el of allUsernameEls) {
      if (!el.closest('[class*="repliedMessage"]') && !el.closest('[class*="replyBar"]') && el.textContent.trim()) {
        return el;
      }
    }

    // Try headerText username
    const headerTextEls = messageEl.querySelectorAll('[class*="headerText"] [class*="username"]');
    for (const el of headerTextEls) {
      if (!el.closest('[class*="repliedMessage"]') && el.textContent.trim()) {
        return el;
      }
    }

    // Try any element with class containing 'username' as last resort
    const anyUsernameEls = messageEl.querySelectorAll('[class*="username"]');
    for (const el of anyUsernameEls) {
      if (!el.closest('[class*="repliedMessage"]') && !el.closest('[class*="replyBar"]') && el.textContent.trim()) {
        return el;
      }
    }

    return null;
  }

  function extractAvatar(messageEl, data) {
    let avatarEl = null;

    const allAvatarEls = messageEl.querySelectorAll(SELECTORS.messageAvatar);
    for (const el of allAvatarEls) {
      // Skip avatar decorations and reply-related avatars
      if (!el.closest('[class*="repliedMessage"]') && !el.closest('[class*="replyBar"]') && !isAvatarDecoration(el)) {
        avatarEl = el;
        break;
      }
    }

    if (!avatarEl) {
      const avatarWrappers = messageEl.querySelectorAll('[class*="avatar"]');
      for (const wrapper of avatarWrappers) {
        // Skip decoration wrappers
        if (wrapper.className && (wrapper.className.includes('decoration') || wrapper.className.includes('Decoration'))) continue;
        if (!wrapper.closest('[class*="repliedMessage"]') && !wrapper.closest('[class*="replyBar"]')) {
          const img = wrapper.querySelector('img');
          if (img && !isAvatarDecoration(img)) {
            avatarEl = img;
            break;
          }
        }
      }
    }

    if (!avatarEl) {
      const allImgs = messageEl.querySelectorAll('img');
      for (const img of allImgs) {
        if (img.closest('[class*="repliedMessage"]') || img.closest('[class*="replyBar"]')) continue;
        // Skip avatar decorations
        if (isAvatarDecoration(img)) continue;
        const src = img.src || '';
        if (src.includes('cdn.discordapp.com/avatars') ||
          src.includes('discord.com/avatars') ||
          src.includes('/avatars/') ||
          img.className.includes('avatar')) {
          avatarEl = img;
          break;
        }
      }
    }

    if (avatarEl && avatarEl.src) {
      let foundAvatarUrl = avatarEl.src;
      if (foundAvatarUrl.includes('?size=')) {
        foundAvatarUrl = foundAvatarUrl.replace(/\?size=\d+/, `?size=${CONFIG.avatarSize}`);
      } else if (!foundAvatarUrl.includes('?')) {
        foundAvatarUrl += `?size=${CONFIG.avatarSize}`;
      }

      if (data.username) {
        userCache.setAvatar(data.username, foundAvatarUrl);
      }
      data.avatar = foundAvatarUrl;
    } else if (data.username) {
      // First try cache
      let cachedAvatar = userCache.getAvatar(data.username);

      // If cache is empty, look for avatar in previous sibling messages
      if (!cachedAvatar) {
        let prevEl = messageEl.previousElementSibling;
        let attempts = 0;
        while (prevEl && attempts < 20 && !cachedAvatar) {
          if (prevEl.matches && prevEl.matches(SELECTORS.message)) {
            // Try to find avatar in this previous message
            const prevAvatarEls = prevEl.querySelectorAll(SELECTORS.messageAvatar);
            for (const el of prevAvatarEls) {
              // Skip avatar decorations
              if (!el.closest('[class*="repliedMessage"]') && !el.closest('[class*="replyBar"]') && el.src && !isAvatarDecoration(el)) {
                let avatarUrl = el.src;
                if (avatarUrl.includes('?size=')) {
                  avatarUrl = avatarUrl.replace(/\?size=\d+/, `?size=${CONFIG.avatarSize}`);
                } else if (!avatarUrl.includes('?')) {
                  avatarUrl += `?size=${CONFIG.avatarSize}`;
                }
                cachedAvatar = avatarUrl;
                userCache.setAvatar(data.username, cachedAvatar);
                break;
              }
            }

            // Also try avatar wrappers in previous message
            if (!cachedAvatar) {
              const prevAvatarWrappers = prevEl.querySelectorAll('[class*="avatar"]');
              for (const wrapper of prevAvatarWrappers) {
                // Skip decoration wrappers
                if (wrapper.className && (wrapper.className.includes('decoration') || wrapper.className.includes('Decoration'))) continue;
                if (!wrapper.closest('[class*="repliedMessage"]') && !wrapper.closest('[class*="replyBar"]')) {
                  const img = wrapper.querySelector('img');
                  if (img && img.src && !isAvatarDecoration(img)) {
                    let avatarUrl = img.src;
                    if (avatarUrl.includes('?size=')) {
                      avatarUrl = avatarUrl.replace(/\?size=\d+/, `?size=${CONFIG.avatarSize}`);
                    } else if (!avatarUrl.includes('?')) {
                      avatarUrl += `?size=${CONFIG.avatarSize}`;
                    }
                    cachedAvatar = avatarUrl;
                    userCache.setAvatar(data.username, cachedAvatar);
                    break;
                  }
                }
              }
            }
          }
          prevEl = prevEl.previousElementSibling;
          attempts++;
        }
      }

      data.avatar = cachedAvatar || '';
    }
  }

  function extractContent(messageEl, data) {
    let contentEl = null;
    const allContentEls = messageEl.querySelectorAll(SELECTORS.messageContent);
    for (const el of allContentEls) {
      if (!el.closest('[class*="repliedMessage"]') &&
        !el.closest('[class*="repliedTextContent"]') &&
        !el.closest('[class*="replyBar"]')) {
        contentEl = el;
        break;
      }
    }

    if (contentEl) {
      data.content = processContentForEmoji(contentEl.innerHTML);
      data.contentText = contentEl.textContent.trim();
    }
  }

  function extractImages(messageEl, data) {
    const imageEls = messageEl.querySelectorAll(SELECTORS.messageImages);
    imageEls.forEach(img => {
      const src = getFullResolutionImageUrl(img);
      if (src && !isAvatarImage(img) && !isEmojiImage(img)) {
        const isGif = isGifUrl(src);
        data.images.push({
          url: src,
          isGif: isGif,
          staticUrl: isGif ? getStaticImageUrl(src) : src
        });
      }
    });
  }

  function extractEmbedData(embedEl, options) {
    if (!embedEl) return null;

    const embed = {
      title: '',
      description: '',
      author: '',
      fields: [],
      footer: '',
      thumbnail: '',
      image: '',
      color: ''
    };

    const style = window.getComputedStyle(embedEl);
    const borderColor = style.borderLeftColor || style.borderColor;
    if (borderColor && borderColor !== 'rgba(0, 0, 0, 0)') {
      embed.color = borderColor;
    }

    const authorEl = embedEl.querySelector(SELECTORS.embedAuthor);
    if (authorEl) embed.author = authorEl.textContent.trim();

    const titleEl = embedEl.querySelector(SELECTORS.embedTitle);
    if (titleEl) embed.title = titleEl.textContent.trim();

    const descEl = embedEl.querySelector(SELECTORS.embedDescription);
    if (descEl) embed.description = processContentForEmoji(descEl.innerHTML);

    const fieldEls = embedEl.querySelectorAll(SELECTORS.embedField);
    fieldEls.forEach(fieldEl => {
      const nameEl = fieldEl.querySelector(SELECTORS.embedFieldName);
      const valueEl = fieldEl.querySelector(SELECTORS.embedFieldValue);
      if (nameEl || valueEl) {
        embed.fields.push({
          name: nameEl ? nameEl.textContent.trim() : '',
          value: valueEl ? processContentForEmoji(valueEl.innerHTML) : ''
        });
      }
    });

    const footerEl = embedEl.querySelector(SELECTORS.embedFooter);
    if (footerEl) embed.footer = footerEl.textContent.trim();

    if (options.includeImages) {
      const thumbEl = embedEl.querySelector(SELECTORS.embedThumbnail);
      if (thumbEl) embed.thumbnail = getFullResolutionImageUrl(thumbEl);

      const imgEl = embedEl.querySelector(SELECTORS.embedImage);
      if (imgEl) embed.image = getFullResolutionImageUrl(imgEl);
    }

    if (!embed.title && !embed.description && !embed.fields.length && !embed.image) {
      return null;
    }

    return embed;
  }

  function extractEmbeds(messageEl, data, options) {
    const embedWrappers = messageEl.querySelectorAll(SELECTORS.embedWrapper);
    embedWrappers.forEach(embedEl => {
      const embed = extractEmbedData(embedEl, options);
      if (embed) data.embeds.push(embed);
    });
  }

  function extractReactions(messageEl, data) {
    const reactionsEl = messageEl.querySelector(SELECTORS.messageReactions);
    if (!reactionsEl) return;

    const reactionItems = reactionsEl.querySelectorAll(':scope > [class*="reaction"], :scope > * > [class*="reaction"]');
    const processedReactions = new Set();

    reactionItems.forEach(reaction => {
      if (reaction.closest('[class*="reaction"]') !== reaction &&
        reaction.parentElement?.closest('[class*="reaction"]')) {
        return;
      }

      const emojiImg = reaction.querySelector('img');
      let emoji;
      let emojiKey = '';

      if (emojiImg) {
        emojiKey = emojiImg.src || emojiImg.alt || '';
        const clonedImg = emojiImg.cloneNode(true);
        clonedImg.classList.add('emoji');
        clonedImg.setAttribute('data-type', 'emoji');
        clonedImg.style.width = '1em';
        clonedImg.style.height = '1em';
        clonedImg.style.verticalAlign = 'middle';
        clonedImg.style.objectFit = 'contain';
        emoji = clonedImg.outerHTML;
      } else {
        const textContent = reaction.textContent.trim();
        emoji = textContent.replace(/\d+$/, '').trim();
        emojiKey = emoji;
      }

      const countEl = reaction.querySelector('[class*="reactionCount"]');
      const count = countEl?.textContent?.trim() || '1';
      const reactionKey = `${emojiKey}-${count}`;

      if (emoji && !processedReactions.has(reactionKey)) {
        processedReactions.add(reactionKey);
        data.reactions.push({ emoji, count });
      }
    });
  }

  function extractMessageData(messageEl, options) {
    if (!messageEl) return null;

    const data = {
      id: getMessageId(messageEl),
      username: '',
      usernameColor: '',
      avatar: '',
      timestamp: '',
      content: '',
      contentText: '',
      images: [],
      attachments: [],
      reactions: [],
      embeds: [],
      replyTo: null
    };

    const repliedMessageEl = messageEl.querySelector(SELECTORS.repliedMessage);
    const usernameEl = findUsernameElement(messageEl);

    if (usernameEl) {
      data.username = usernameEl.textContent.trim();
      const computedStyle = window.getComputedStyle(usernameEl);
      const color = computedStyle.color;
      if (color && color !== 'rgb(255, 255, 255)' && color !== 'rgba(0, 0, 0, 0)') {
        data.usernameColor = color;
      }
    }

    // If no username found, try to find from previous message in DOM (consecutive messages)
    if (!data.username) {
      // First try cache
      if (userCache.lastUsername) {
        data.username = userCache.lastUsername;
        data.usernameColor = userCache.getColor(data.username) || '';
      } else {
        // Try to find username from previous message elements in the DOM
        let prevEl = messageEl.previousElementSibling;
        let attempts = 0;
        while (prevEl && attempts < 10 && !data.username) {
          if (prevEl.matches && prevEl.matches(SELECTORS.message)) {
            const prevUsernameEl = findUsernameElement(prevEl);
            if (prevUsernameEl && prevUsernameEl.textContent.trim()) {
              data.username = prevUsernameEl.textContent.trim();
              const computedStyle = window.getComputedStyle(prevUsernameEl);
              const color = computedStyle.color;
              if (color && color !== 'rgb(255, 255, 255)' && color !== 'rgba(0, 0, 0, 0)') {
                data.usernameColor = color;
              }
              break;
            }
          }
          prevEl = prevEl.previousElementSibling;
          attempts++;
        }
      }
    }

    // Update cache if we found a username
    if (data.username) {
      userCache.lastUsername = data.username;
      if (data.usernameColor) {
        userCache.setColor(data.username, data.usernameColor);
      } else {
        data.usernameColor = userCache.getColor(data.username) || '';
      }
    }

    if (repliedMessageEl) {
      const replyUsername = repliedMessageEl.querySelector('[class*="username"]');
      const replyContent = repliedMessageEl.querySelector('[class*="repliedTextContent"]');
      data.replyTo = {
        username: replyUsername ? replyUsername.textContent.trim() : '',
        content: replyContent ? replyContent.textContent.trim() : ''
      };
    }

    if (options.includeAvatars) extractAvatar(messageEl, data);

    if (options.includeTimestamps) {
      const timeEl = messageEl.querySelector(SELECTORS.messageTimestamp);
      if (timeEl) {
        data.timestamp = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
      }
    }

    extractContent(messageEl, data);
    if (options.includeImages) extractImages(messageEl, data);
    extractEmbeds(messageEl, data, options);
    if (options.includeReactions) extractReactions(messageEl, data);

    if (!data.content && !data.images.length && !data.embeds.length && !data.username) {
      return null;
    }

    return data;
  }

  async function scrollAndCollectMessages(startFromId, endAtId, options) {
    const scroller = getMessagesScroller();
    if (!scroller) {
      throw new Error('Could not find messages scroller');
    }

    userCache.reset();

    const collectedMessages = new Map();
    let noChangeCount = 0;
    let foundStartMessage = !startFromId; // If no start, collect from beginning
    let foundEndMessage = false;
    let reachedBottom = false;

    // If no start point, scroll to the very top first
    if (!startFromId) {
      updateExportProgress(5);
      chrome.runtime.sendMessage({ action: 'progressUpdate', percent: 5, text: 'Scrolling to top...' });

      // Scroll to top
      let scrollUpAttempts = 0;
      let lastScrollTop = scroller.scrollTop;

      while (scrollUpAttempts < CONFIG.maxScrollAttempts) {
        scroller.scrollTop = 0;
        await new Promise(resolve => setTimeout(resolve, CONFIG.scrollDelay));

        if (scroller.scrollTop === 0 || Math.abs(scroller.scrollTop - lastScrollTop) < 5) {
          // Double check we're really at top
          await new Promise(resolve => setTimeout(resolve, CONFIG.scrollDelay));
          if (scroller.scrollTop < 100) break;
        }

        lastScrollTop = scroller.scrollTop;
        scrollUpAttempts++;

        const scrollProgress = Math.min(15, 5 + scrollUpAttempts);
        updateExportProgress(scrollProgress);
        chrome.runtime.sendMessage({
          action: 'progressUpdate',
          percent: scrollProgress,
          text: 'Scrolling to top...'
        });
      }

      await new Promise(resolve => setTimeout(resolve, CONFIG.scrollDelay * 2));
      foundStartMessage = true;
    } else {
      // Scroll to start message
      const startEl = document.getElementById(startFromId);
      if (startEl) {
        startEl.scrollIntoView({ block: 'start' });
        await new Promise(resolve => setTimeout(resolve, CONFIG.scrollDelay));
        foundStartMessage = true;
      } else {
        console.warn('Start message element not found by ID');
      }
    }

    let maxScrollTopReached = scroller.scrollTop;
    let scrollAttempts = 0;

    while (scrollAttempts < CONFIG.maxScrollAttempts && !reachedBottom) {
      scrollAttempts++;

      const messageElements = document.querySelectorAll(SELECTORS.message);
      const messageArray = Array.from(messageElements);
      const startElement = startFromId ? document.getElementById(startFromId) : null;
      const endElement = endAtId ? document.getElementById(endAtId) : null;

      for (const msgEl of messageArray) {
        const msgId = getMessageId(msgEl);
        if (!msgId) continue;

        // Check if we reached end point
        if (endAtId && msgId === endAtId) {
          foundEndMessage = true;
          // Include the end message itself
          if (!collectedMessages.has(msgId)) {
            const messageData = extractMessageData(msgEl, options);
            if (messageData) {
              collectedMessages.set(msgId, messageData);
            }
          }
          reachedBottom = true;
          break;
        }

        // Check if past end point (by DOM position)
        if (endElement) {
          const position = endElement.compareDocumentPosition(msgEl);
          if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
            // Current message is AFTER end element, stop here
            foundEndMessage = true;
            reachedBottom = true;
            break;
          }
        }

        if (startFromId) {
          if (msgId === startFromId) {
            foundStartMessage = true;
            // Include the start message itself, don't skip it
            if (!collectedMessages.has(msgId)) {
              const messageData = extractMessageData(msgEl, options);
              if (messageData) {
                collectedMessages.set(msgId, messageData);
              }
            }
            continue;
          }

          if (startElement) {
            const position = startElement.compareDocumentPosition(msgEl);
            if (!(position & Node.DOCUMENT_POSITION_FOLLOWING)) {
              continue;
            }
          } else if (!foundStartMessage) {
            continue;
          }
        }

        if (!collectedMessages.has(msgId)) {
          const messageData = extractMessageData(msgEl, options);
          if (messageData) {
            collectedMessages.set(msgId, messageData);
          }
        }
      }

      // If we found the end message, stop scrolling
      if (foundEndMessage) {
        break;
      }

      const prevScrollTop = scroller.scrollTop;
      const prevScrollHeight = scroller.scrollHeight;
      const prevMessageCount = collectedMessages.size;

      // Scroll down
      scroller.scrollTop = scroller.scrollTop + scroller.clientHeight * 0.8;

      await new Promise(resolve => setTimeout(resolve, CONFIG.scrollDelay));

      // Check if we're at the bottom (with tolerance for dynamic loading)
      const isAtBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 50;
      const scrollDidNotMove = Math.abs(scroller.scrollTop - prevScrollTop) < 5;
      const noNewMessages = collectedMessages.size === prevMessageCount;
      const scrollHeightUnchanged = scroller.scrollHeight === prevScrollHeight;

      // Update max scroll position
      if (scroller.scrollTop > maxScrollTopReached) {
        maxScrollTopReached = scroller.scrollTop;
      }

      // Only increment no-change count if multiple conditions indicate we're stuck
      if (isAtBottom && scrollDidNotMove && noNewMessages && scrollHeightUnchanged) {
        noChangeCount++;
        console.log(`At bottom check: ${noChangeCount}/${CONFIG.maxNoChangeAttempts}`);
        if (noChangeCount >= CONFIG.maxNoChangeAttempts) {
          console.log('Confirmed at bottom, stopping collection');
          reachedBottom = true;
          break;
        }
      } else if (scrollDidNotMove && noNewMessages) {
        // Scroll stuck but not at bottom - might be loading
        noChangeCount++;
        if (noChangeCount >= CONFIG.maxNoChangeAttempts + 3) {
          console.log('Scroll stuck, stopping collection');
          reachedBottom = true;
          break;
        }
      } else {
        // Progress made, reset counter
        noChangeCount = 0;
      }

      const progress = Math.min(55, 20 + (scrollAttempts * 35 / CONFIG.maxScrollAttempts));
      updateExportProgress(progress);
      chrome.runtime.sendMessage({
        action: 'progressUpdate',
        percent: progress,
        text: `Loading messages... (${collectedMessages.size} found)`
      });
    }

    if (startFromId && !foundStartMessage) {
      console.warn('Start message not found, collecting all visible messages');
      const messageElements = document.querySelectorAll(SELECTORS.message);
      messageElements.forEach((msgEl) => {
        const msgId = getMessageId(msgEl);
        if (msgId && !collectedMessages.has(msgId)) {
          const messageData = extractMessageData(msgEl, options);
          if (messageData) {
            collectedMessages.set(msgId, messageData);
          }
        }
      });
    }

    return Array.from(collectedMessages.values());
  }

  // --- PDF GENERATION ---

  function getPDFStyles() {
    return `
      @media print {
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
        html, body { background-color: #313338 !important; }
        @page { background-color: #313338; margin: 3mm; }
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html { background-color: #313338; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #313338; color: #dcddde; padding: 8px; line-height: 1.4; min-height: 100vh; font-size: 14px; }
      .message { display: flex; padding: 2px 8px; margin-bottom: 1px; }
      .message:hover { background: #2e3035; }
      .avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 10px; flex-shrink: 0; }
      .avatar-placeholder { width: 40px; height: 40px; border-radius: 50%; background: #5865f2; margin-right: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px; }
      .avatar-spacer { width: 40px; margin-right: 10px; flex-shrink: 0; }
      .message-body { flex: 1; min-width: 0; }
      .reply-info { display: flex; align-items: center; font-size: 11px; color: #949ba4; margin-bottom: 2px; padding-left: 8px; border-left: 2px solid #3f4147; }
      .reply-info::before { content: '↩ '; margin-right: 4px; }
      .reply-username { color: #00aff4; font-weight: 500; margin-right: 6px; }
      .reply-content { color: #949ba4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 400px; }
      .message-header { display: flex; align-items: baseline; margin-bottom: 1px; }
      .username { font-weight: 500; color: #f2f3f5; margin-right: 6px; font-size: 14px; }
      .timestamp { font-size: 11px; color: #949ba4; }
      .content { color: #dbdee1; word-wrap: break-word; line-height: 1.35; }
      .content a { color: #00aff4; }
      .content img.emoji, .content img[data-type="emoji"] { width: 1.25em; height: 1.25em; vertical-align: -0.3em; object-fit: contain; display: inline; margin: 0 0.03em; }
      .images { margin-top: 4px; }
      .images img { max-width: 350px; max-height: 250px; border-radius: 4px; margin: 2px 2px 2px 0; display: block; }
      .image-container { position: relative; display: inline-block; margin: 2px 2px 2px 0; }
      .gif-container { border: 2px solid #5865f2; border-radius: 6px; padding: 2px; background: #2b2d31; }
      .gif-badge { position: absolute; top: 6px; left: 6px; background: #5865f2; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
      .gif-link { display: block; font-size: 10px; color: #00aff4; word-break: break-all; margin-top: 4px; padding: 4px; background: #1e1f22; border-radius: 4px; text-decoration: none; }
      .gif-link:hover { text-decoration: underline; }
      .reactions { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
      .reaction { display: flex; align-items: center; background: #2b2d31; border-radius: 4px; padding: 2px 6px; font-size: 12px; }
      .reaction img { width: 1em; height: 1em; vertical-align: middle; object-fit: contain; display: inline; margin-right: 3px; }
      .reaction-count { margin-left: 3px; color: #b9bbbe; }
      h1 { text-align: center; color: #fff; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #3f4147; font-size: 18px; }
      .embed { margin-top: 4px; padding: 6px 10px 10px 8px; border-left: 4px solid #5865f2; border-radius: 4px; background: #2b2d31; max-width: 450px; }
      .embed-author { display: flex; align-items: center; margin-bottom: 4px; font-size: 12px; font-weight: 500; color: #fff; }
      .embed-title { font-size: 14px; font-weight: 600; color: #00aff4; margin-bottom: 4px; }
      .embed-description { font-size: 13px; color: #dbdee1; margin-bottom: 4px; line-height: 1.35; }
      .embed-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 4px; margin-bottom: 4px; }
      .embed-field { min-width: 0; }
      .embed-field-name { font-size: 12px; font-weight: 600; color: #f2f3f5; margin-bottom: 1px; }
      .embed-field-value { font-size: 12px; color: #dbdee1; }
      .embed-thumbnail { float: right; max-width: 60px; max-height: 60px; border-radius: 4px; margin-left: 8px; }
      .embed-image { max-width: 100%; max-height: 200px; border-radius: 4px; margin-top: 4px; }
      .embed-footer { font-size: 11px; color: #949ba4; margin-top: 4px; }
    `;
  }

  async function generatePDFContent(messages, options) {
    clearImageCache();
    const htmlParts = [`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${getPDFStyles()}</style></head><body><h1>${escapeHtml(getChannelName())}</h1>`];

    // Phase 1: Collect all image URLs for parallel prefetch
    const imageUrls = new Set();
    if (options.includeAvatars) {
      messages.forEach(msg => msg.avatar && imageUrls.add(msg.avatar));
    }
    if (options.includeImages) {
      messages.forEach(msg => msg.images?.forEach(img => {
        const url = typeof img === 'object' ? img.staticUrl : img;
        if (url) imageUrls.add(url);
      }));
    }
    messages.forEach(msg => msg.embeds?.forEach(e => {
      if (e.thumbnail) imageUrls.add(e.thumbnail);
      if (e.image) imageUrls.add(e.image);
    }));

    // Phase 2: Parallel prefetch images (batched to avoid overwhelming network)
    const PREFETCH_BATCH = 10;
    const urlArray = Array.from(imageUrls);
    for (let i = 0; i < urlArray.length; i += PREFETCH_BATCH) {
      const batch = urlArray.slice(i, i + PREFETCH_BATCH);
      await Promise.all(batch.map(url => getCachedImage(url).catch(() => null)));
      chrome.runtime.sendMessage({
        action: 'progressUpdate',
        percent: 50 + Math.floor((i / urlArray.length) * 30),
        text: `Prefetching images... (${Math.min(i + PREFETCH_BATCH, urlArray.length)}/${urlArray.length})`
      });
    }

    // Phase 3: Generate HTML (images already cached, so getCachedImage is O(1))
    let lastUsername = '';
    const totalMessages = messages.length;
    const BATCH_SIZE = 50;

    for (let i = 0; i < totalMessages; i++) {
      const msg = messages[i];
      const isSameUser = msg.username && msg.username === lastUsername;
      const hasReply = msg.replyTo && (msg.replyTo.username || msg.replyTo.content);
      const showHeader = !isSameUser || hasReply;

      // Avatar (cached)
      let avatarHtml = '';
      if (showHeader) {
        if (options.includeAvatars && msg.avatar) {
          const base64 = imageCache.get(msg.avatar);
          avatarHtml = base64
            ? `<img class="avatar" src="${base64}" alt="avatar">`
            : `<div class="avatar-placeholder">${(msg.username || 'U').charAt(0).toUpperCase()}</div>`;
        } else if (options.includeAvatars) {
          avatarHtml = `<div class="avatar-placeholder">${(msg.username || 'U').charAt(0).toUpperCase()}</div>`;
        }
      } else {
        avatarHtml = '<div class="avatar-spacer"></div>';
      }

      // Images (cached)
      let imagesHtml = '';
      if (options.includeImages && msg.images?.length > 0) {
        const imgParts = ['<div class="images">'];
        for (const imgData of msg.images) {
          const imgUrl = typeof imgData === 'string' ? imgData : imgData.url;
          const isGif = typeof imgData === 'object' && imgData.isGif;
          const staticUrl = typeof imgData === 'object' ? imgData.staticUrl : imgUrl;
          const base64 = imageCache.get(staticUrl);
          if (base64) {
            if (isGif) {
              imgParts.push(`<div class="image-container gif-container"><img src="${base64}" alt="GIF"><span class="gif-badge">GIF</span><a href="${imgUrl}" class="gif-link" target="_blank">${imgUrl}</a></div>`);
            } else {
              imgParts.push(`<img src="${base64}" alt="image">`);
            }
          }
        }
        imgParts.push('</div>');
        imagesHtml = imgParts.join('');
      }

      // Embeds (cached)
      let embedsHtml = '';
      if (msg.embeds?.length > 0) {
        const embedParts = [];
        for (const embed of msg.embeds) {
          const style = embed.color ? `border-left-color: ${embed.color};` : '';
          embedParts.push(`<div class="embed" style="${style}">`);
          if (embed.thumbnail) {
            const b64 = imageCache.get(embed.thumbnail);
            if (b64) embedParts.push(`<img class="embed-thumbnail" src="${b64}" alt="thumbnail">`);
          }
          if (embed.author) embedParts.push(`<div class="embed-author">${escapeHtml(embed.author)}</div>`);
          if (embed.title) embedParts.push(`<div class="embed-title">${escapeHtml(embed.title)}</div>`);
          if (embed.description) embedParts.push(`<div class="embed-description">${embed.description}</div>`);
          if (embed.fields?.length > 0) {
            embedParts.push('<div class="embed-fields">');
            embed.fields.forEach(f => {
              embedParts.push('<div class="embed-field">');
              if (f.name) embedParts.push(`<div class="embed-field-name">${escapeHtml(f.name)}</div>`);
              if (f.value) embedParts.push(`<div class="embed-field-value">${f.value}</div>`);
              embedParts.push('</div>');
            });
            embedParts.push('</div>');
          }
          if (embed.image) {
            const b64 = imageCache.get(embed.image);
            if (b64) embedParts.push(`<img class="embed-image" src="${b64}" alt="embed image">`);
          }
          if (embed.footer) embedParts.push(`<div class="embed-footer">${escapeHtml(embed.footer)}</div>`);
          embedParts.push('</div>');
        }
        embedsHtml = embedParts.join('');
      }

      // Reactions
      let reactionsHtml = '';
      if (options.includeReactions && msg.reactions?.length > 0) {
        reactionsHtml = '<div class="reactions">' + msg.reactions.map(r =>
          `<span class="reaction">${r.emoji}<span class="reaction-count">${r.count}</span></span>`
        ).join('') + '</div>';
      }

      // Timestamp & Header
      const timestampHtml = (options.includeTimestamps && msg.timestamp)
        ? `<span class="timestamp">${new Date(msg.timestamp).toLocaleString()}</span>` : '';
      const replyHtml = hasReply
        ? `<div class="reply-info"><span class="reply-username">${escapeHtml(msg.replyTo.username || 'Unknown')}</span><span class="reply-content">${escapeHtml(msg.replyTo.content || '')}</span></div>` : '';
      const usernameStyle = msg.usernameColor ? `style="color: ${msg.usernameColor}"` : '';
      const headerHtml = showHeader
        ? `<div class="message-header"><span class="username" ${usernameStyle}>${escapeHtml(msg.username || 'Unknown')}</span>${timestampHtml}</div>` : '';

      htmlParts.push(`<div class="message">${avatarHtml}<div class="message-body">${replyHtml}${headerHtml}<div class="content">${msg.content || ''}</div>${imagesHtml}${embedsHtml}${reactionsHtml}</div></div>`);
      lastUsername = msg.username || '';

      if (i > 0 && i % BATCH_SIZE === 0) {
        await new Promise(r => setTimeout(r, 5));
        chrome.runtime.sendMessage({
          action: 'progressUpdate',
          percent: 80 + Math.floor((i / totalMessages) * 20),
          text: `Generating PDF... (${i}/${totalMessages})`
        });
      }
    }

    htmlParts.push('</body></html>');
    clearImageCache();
    return htmlParts.join('');
  }

  // --- MARKDOWN GENERATION ---

  function generateMarkdownContent(messages, options) {
    const channelName = getChannelName();
    let md = `# ${channelName}\n\n*Exported on ${new Date().toLocaleString()}*\n\n---\n\n`;

    let lastUsername = '';

    messages.forEach(msg => {
      const isSameUser = msg.username && msg.username === lastUsername;
      const hasReply = msg.replyTo && (msg.replyTo.username || msg.replyTo.content);

      if (hasReply) {
        md += `> ↩ Replying to **${msg.replyTo.username || 'Unknown'}**: ${msg.replyTo.content || ''}\n\n`;
      }

      if (!isSameUser || hasReply) {
        let header = `**${msg.username || 'Unknown'}**`;
        if (options.includeTimestamps && msg.timestamp) {
          const date = new Date(msg.timestamp);
          header += ` - ${date.toLocaleString()}`;
        }
        md += header + '\n\n';
      }

      if (msg.contentText) md += msg.contentText + '\n\n';

      // Images
      if (options.includeImages && msg.images.length > 0) {
        msg.images.forEach(imgData => {
          // Handle both old format (string) and new format (object)
          if (typeof imgData === 'string') {
            md += `![image](${imgData})\n\n`;
          } else if (imgData.isGif) {
            md += `🎬 **GIF**\n\n`;
            md += `[![GIF預覽](${imgData.staticUrl})](${imgData.url})\n\n`;
            md += `> 原始連結: ${imgData.url}\n\n`;
          } else {
            md += `![image](${imgData.url})\n\n`;
          }
        });
      }

      // Embeds
      if (msg.embeds && msg.embeds.length > 0) {
        msg.embeds.forEach(embed => {
          md += '> 📎 **[Embed]**\n';
          if (embed.author) md += `> 👤 ${embed.author}\n`;
          if (embed.title) md += `> **${embed.title}**\n`;
          if (embed.description) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = embed.description;
            md += `> ${tempDiv.textContent}\n`;
          }
          if (embed.fields && embed.fields.length > 0) {
            md += '>\n';
            embed.fields.forEach(field => {
              const tempDiv = document.createElement('div');
              tempDiv.innerHTML = field.value || '';
              md += `> • **${field.name}**: ${tempDiv.textContent}\n`;
            });
          }
          // Embed thumbnail
          if (embed.thumbnail) {
            md += `>\n> 🖼️ 縮圖: ![thumbnail](${embed.thumbnail})\n`;
          }
          // Embed image
          if (embed.image) {
            md += `>\n> ![embed image](${embed.image})\n`;
          }
          if (embed.footer) md += `> _${embed.footer}_\n`;
          md += '\n';
        });
      }

      if (!isSameUser && options.includeAvatars && msg.avatar) {
        md += `> Avatar: ${msg.avatar}\n\n`;
      }

      if (options.includeReactions && msg.reactions.length > 0) {
        const reactionText = msg.reactions.map(r => `${r.emoji} (${r.count})`).join(' ');
        md += `> Reactions: ${reactionText}\n\n`;
      }

      md += '---\n\n';
      lastUsername = msg.username || '';
    });

    return md;
  }

  // --- EXPORT FUNCTIONS ---

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function exportToPDF(options = {}) {
    const exportOptions = { ...DEFAULT_EXPORT_OPTIONS, ...options };

    try {
      updateExportProgress(10);
      chrome.runtime.sendMessage({ action: 'progressUpdate', percent: 10, text: 'Starting export...' });

      const messages = await scrollAndCollectMessages(selectedMessageId, selectedEndMessageId, exportOptions);

      if (messages.length === 0) {
        throw new Error('No messages found to export');
      }

      updateExportProgress(60);
      chrome.runtime.sendMessage({ action: 'progressUpdate', percent: 60, text: `Processing ${messages.length} messages...` });

      const htmlContent = await generatePDFContent(messages, exportOptions);

      updateExportProgress(90);
      chrome.runtime.sendMessage({ action: 'progressUpdate', percent: 90, text: 'Generating PDF...' });

      const printWindow = window.open('', '_blank', 'width=800,height=600');
      printWindow.document.write(htmlContent);
      printWindow.document.close();

      setTimeout(() => { printWindow.print(); }, 2000);

      return { success: true, messageCount: messages.length };
    } catch (error) {
      console.error('Error exporting to PDF:', error);
      return { success: false, error: error.message };
    }
  }

  async function exportToMarkdown(options = {}) {
    const exportOptions = { ...DEFAULT_EXPORT_OPTIONS, ...options };

    try {
      updateExportProgress(10);
      chrome.runtime.sendMessage({ action: 'progressUpdate', percent: 10, text: 'Starting export...' });

      const messages = await scrollAndCollectMessages(selectedMessageId, selectedEndMessageId, exportOptions);

      if (messages.length === 0) {
        throw new Error('No messages found to export');
      }

      updateExportProgress(70);
      chrome.runtime.sendMessage({ action: 'progressUpdate', percent: 70, text: `Processing ${messages.length} messages...` });

      const mdContent = generateMarkdownContent(messages, exportOptions);

      updateExportProgress(90);
      chrome.runtime.sendMessage({ action: 'progressUpdate', percent: 90, text: 'Saving file...' });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadFile(mdContent, `discord-export-${timestamp}.md`, 'text/markdown');

      return { success: true, messageCount: messages.length };
    } catch (error) {
      console.error('Error exporting to Markdown:', error);
      return { success: false, error: error.message };
    }
  }

  // --- UI COMPONENTS ---

  function createHighlightOverlay() {
    if (highlightOverlay) return;

    highlightOverlay = document.createElement('div');
    highlightOverlay.id = 'discord-exporter-highlight';
    highlightOverlay.style.cssText = `
      position: fixed;
      pointer-events: none;
      background: rgba(88, 101, 242, 0.3);
      border: 2px solid #5865f2;
      border-radius: 4px;
      z-index: 10000;
      display: none;
      transition: all 0.1s ease;
    `;
    document.body.appendChild(highlightOverlay);
  }

  function removeHighlightOverlay() {
    if (highlightOverlay) {
      highlightOverlay.remove();
      highlightOverlay = null;
    }
  }

  function handleSelectionMouseMove(e) {
    if (!isSelectionMode) return;

    const messageEl = findMessageElement(e.target);
    if (messageEl && highlightOverlay) {
      const rect = messageEl.getBoundingClientRect();
      highlightOverlay.style.display = 'block';
      highlightOverlay.style.left = rect.left + 'px';
      highlightOverlay.style.top = rect.top + 'px';
      highlightOverlay.style.width = rect.width + 'px';
      highlightOverlay.style.height = rect.height + 'px';
    } else if (highlightOverlay) {
      highlightOverlay.style.display = 'none';
    }
  }

  function handleSelectionClick(e) {
    if (!isSelectionMode) return;

    e.preventDefault();
    e.stopPropagation();

    const messageEl = findMessageElement(e.target);
    if (messageEl) {
      const msgId = getMessageId(messageEl);

      // Determine if setting start or end based on current selection mode
      if (window._selectionType === 'start') {
        setSelection(messageEl, msgId);
        updateExportPanel();
      } else if (window._selectionType === 'end') {
        setEndSelection(messageEl, msgId);
        updateExportPanel();
      }

      exitSelectionMode();
    }
  }

  function enterSelectionMode(type = 'start') {
    window._selectionType = type;
    isSelectionMode = true;
    createHighlightOverlay();
    document.body.classList.add('discord-exporter-selecting');
    document.body.setAttribute('data-selection-type', type);
    document.addEventListener('mousemove', handleSelectionMouseMove, true);
    document.addEventListener('click', handleSelectionClick, true);
  }

  function exitSelectionMode() {
    isSelectionMode = false;
    window._selectionType = null;
    removeHighlightOverlay();
    document.body.classList.remove('discord-exporter-selecting');
    document.body.removeAttribute('data-selection-type');
    document.removeEventListener('mousemove', handleSelectionMouseMove, true);
    document.removeEventListener('click', handleSelectionClick, true);
  }

  // --- EXPORT PANEL UI ---

  let exportPanel = null;
  let exportButton = null;
  let isExporting = false;

  function createExportButton() {
    if (exportButton) return exportButton;

    exportButton = document.createElement('div');
    exportButton.id = 'discord-exporter-btn';
    exportButton.setAttribute('tabindex', '0');
    exportButton.setAttribute('role', 'button');
    exportButton.setAttribute('aria-label', 'Export Chat');
    exportButton.setAttribute('title', 'Export Chat to PDF/Markdown');
    exportButton.innerHTML = `
      <svg aria-hidden="false" width="24" height="24" viewBox="0 0 24 24">
        <path fill="currentColor" d="M12 2a1 1 0 0 1 1 1v10.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V3a1 1 0 0 1 1-1Z"/>
        <path fill="currentColor" d="M5 16a1 1 0 0 1 1 1v2h12v-2a1 1 0 1 1 2 0v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1Z"/>
      </svg>
      <progress style="display: none;" value="0" max="100"></progress>
    `;

    exportButton.addEventListener('click', toggleExportPanel);

    return exportButton;
  }

  function updateExportProgress(percent) {
    if (!exportButton) return;
    const progress = exportButton.querySelector('progress');
    if (progress) {
      if (percent > 0 && percent < 100) {
        progress.style.display = 'block';
        progress.value = percent;
        exportButton.classList.add('exporting');
      } else {
        progress.style.display = 'none';
        progress.value = 0;
        exportButton.classList.remove('exporting');
      }
    }
  }

  async function startExport(type) {
    if (isExporting) return;
    isExporting = true;

    if (exportButton) {
      exportButton.classList.add('exporting');
    }
    updateExportProgress(5);

    try {
      let result;
      if (type === 'pdf') {
        result = await exportToPDF(DEFAULT_EXPORT_OPTIONS);
      } else {
        result = await exportToMarkdown(DEFAULT_EXPORT_OPTIONS);
      }

      chrome.runtime.sendMessage({ action: 'exportComplete', success: result.success, error: result.error });
    } finally {
      isExporting = false;
      updateExportProgress(0);
      if (exportButton) {
        exportButton.classList.remove('exporting');
      }
    }
  }

  function injectExportButton() {
    // Check if already injected
    if (document.getElementById('discord-exporter-btn')) return;

    // Find the toolbar trailing section (where inbox and help buttons are)
    const toolbarTrailing = document.querySelector('[class*="trailing_"]');
    if (!toolbarTrailing) {
      // Retry after a delay if not found
      setTimeout(injectExportButton, 2000);
      return;
    }

    // Find the inbox button (first clickable in trailing) to insert before
    const inboxButton = toolbarTrailing.querySelector('[aria-label="收件匣"], [aria-label="Inbox"]');
    const firstClickable = toolbarTrailing.querySelector('[class*="clickable"]');
    const targetElement = inboxButton?.closest('[class*="clickable"]') || firstClickable;

    if (!targetElement) {
      setTimeout(injectExportButton, 2000);
      return;
    }

    const button = createExportButton();
    // Insert as a sibling, not inside any anchor or button
    toolbarTrailing.insertBefore(button, targetElement);
  }

  function createExportPanel() {
    if (exportPanel) return exportPanel;

    exportPanel = document.createElement('div');
    exportPanel.id = 'discord-exporter-panel';
    exportPanel.innerHTML = `
      <div class="exporter-panel-header">
        <span class="exporter-panel-title">📤 Chat Exporter</span>
        <button class="exporter-panel-close" aria-label="Close">✕</button>
      </div>
      <div class="exporter-panel-body">
        <div class="exporter-section">
          <div class="exporter-section-title">📍 Selection Range</div>
          <div class="exporter-selection-row">
            <div class="exporter-selection-item">
              <span class="exporter-label">🟢 Start:</span>
              <span class="exporter-value" id="exporter-start-preview">Not set (from top)</span>
            </div>
            <button class="exporter-btn exporter-btn-select" id="exporter-set-start">Set</button>
          </div>
          <div class="exporter-selection-row">
            <div class="exporter-selection-item">
              <span class="exporter-label">🔴 End:</span>
              <span class="exporter-value" id="exporter-end-preview">Not set (to bottom)</span>
            </div>
            <button class="exporter-btn exporter-btn-select" id="exporter-set-end">Set</button>
          </div>
          <button class="exporter-btn exporter-btn-clear" id="exporter-clear">🗑️ Clear</button>
        </div>
        <hr class="exporter-divider">
        <div class="exporter-section">
          <div class="exporter-section-title">⬇️ Export</div>
          <div class="exporter-export-buttons">
            <button class="exporter-btn exporter-btn-export" id="exporter-pdf">📄 PDF</button>
            <button class="exporter-btn exporter-btn-export" id="exporter-md">📝 Markdown</button>
          </div>
          <div class="exporter-progress-container" id="exporter-progress-container" style="display: none;">
            <div class="exporter-progress-text" id="exporter-progress-text">Exporting...</div>
            <progress id="exporter-progress-bar" value="0" max="100"></progress>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(exportPanel);

    // Event listeners
    exportPanel.querySelector('.exporter-panel-close').addEventListener('click', hideExportPanel);
    exportPanel.querySelector('#exporter-set-start').addEventListener('click', () => {
      hideExportPanel();
      enterSelectionMode('start');
    });
    exportPanel.querySelector('#exporter-set-end').addEventListener('click', () => {
      hideExportPanel();
      enterSelectionMode('end');
    });
    exportPanel.querySelector('#exporter-clear').addEventListener('click', () => {
      clearAllSelections();
      updateExportPanel();
    });
    exportPanel.querySelector('#exporter-pdf').addEventListener('click', () => {
      hideExportPanel();
      startExport('pdf');
    });
    exportPanel.querySelector('#exporter-md').addEventListener('click', () => {
      hideExportPanel();
      startExport('markdown');
    });

    return exportPanel;
  }

  function updateExportPanel() {
    if (!exportPanel) return;

    const startPreview = exportPanel.querySelector('#exporter-start-preview');
    const endPreview = exportPanel.querySelector('#exporter-end-preview');

    if (selectedMessageId && selectedMessageElement) {
      startPreview.textContent = getMessagePreview(selectedMessageElement);
      startPreview.classList.add('has-selection');
    } else {
      startPreview.textContent = 'Not set (from top)';
      startPreview.classList.remove('has-selection');
    }

    if (selectedEndMessageId && selectedEndMessageElement) {
      endPreview.textContent = getMessagePreview(selectedEndMessageElement);
      endPreview.classList.add('has-selection');
    } else {
      endPreview.textContent = 'Not set (to bottom)';
      endPreview.classList.remove('has-selection');
    }
  }

  function toggleExportPanel() {
    if (!exportPanel) createExportPanel();

    if (exportPanel.classList.contains('visible')) {
      hideExportPanel();
    } else {
      showExportPanel();
    }
  }

  function showExportPanel() {
    if (!exportPanel) createExportPanel();
    updateExportPanel();
    exportPanel.classList.add('visible');
  }

  function hideExportPanel() {
    if (exportPanel) exportPanel.classList.remove('visible');
  }

  function setSelection(element, id) {
    selectedMessageElement = element;
    selectedMessageId = id;

    document.querySelectorAll('.discord-exporter-selected-start').forEach(el => {
      el.classList.remove('discord-exporter-selected-start');
    });
    if (element) element.classList.add('discord-exporter-selected-start');
  }

  function setEndSelection(element, id) {
    selectedEndMessageElement = element;
    selectedEndMessageId = id;

    document.querySelectorAll('.discord-exporter-selected-end').forEach(el => {
      el.classList.remove('discord-exporter-selected-end');
    });
    if (element) element.classList.add('discord-exporter-selected-end');
  }

  function clearAllSelections() {
    selectedMessageElement = null;
    selectedMessageId = null;
    selectedEndMessageElement = null;
    selectedEndMessageId = null;

    document.querySelectorAll('.discord-exporter-selected-start, .discord-exporter-selected-end, .discord-exporter-selected').forEach(el => {
      el.classList.remove('discord-exporter-selected-start', 'discord-exporter-selected-end', 'discord-exporter-selected');
    });
  }

  // --- MESSAGE LISTENER ---

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'startSelection':
        enterSelectionMode();
        sendResponse({ success: true });
        break;

      case 'getSelectedMessage':
        sendResponse({
          messageId: selectedMessageId,
          preview: selectedMessageElement ? getMessagePreview(selectedMessageElement) : null
        });
        break;

      case 'exportPDF':
        exportToPDF(message.options).then(result => {
          sendResponse(result);
          chrome.runtime.sendMessage({ action: 'exportComplete', success: result.success, error: result.error });
        });
        return true;

      case 'exportMarkdown':
        exportToMarkdown(message.options).then(result => {
          sendResponse(result);
          chrome.runtime.sendMessage({ action: 'exportComplete', success: result.success, error: result.error });
        });
        return true;

      case 'setStartFromContextMenu':
        if (window._lastRightClickedMessage) {
          setSelection(window._lastRightClickedMessage.element, window._lastRightClickedMessage.id);
          chrome.runtime.sendMessage({
            action: 'messageSelected',
            messageId: selectedMessageId,
            preview: window._lastRightClickedMessage.preview
          });
          updateExportPanel();
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No message selected' });
        }
        break;

      case 'setEndFromContextMenu':
        if (window._lastRightClickedMessage) {
          setEndSelection(window._lastRightClickedMessage.element, window._lastRightClickedMessage.id);
          updateExportPanel();
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No message selected' });
        }
        break;

      case 'exportFromContextMenu':
        if (window._lastRightClickedMessage) {
          setSelection(window._lastRightClickedMessage.element, window._lastRightClickedMessage.id);
          const exportFn = message.format === 'pdf' ? exportToPDF : exportToMarkdown;
          exportFn(message.options).then(result => {
            sendResponse(result);
            chrome.runtime.sendMessage({ action: 'exportComplete', success: result.success, error: result.error });
          });
          return true;
        } else {
          sendResponse({ success: false, error: 'No message selected' });
        }
        break;

      default:
        sendResponse({ error: 'Unknown action' });
    }
  });

  // --- EVENT LISTENERS ---

  // Click outside to close panel
  document.addEventListener('click', (e) => {
    if (exportPanel && exportPanel.classList.contains('visible')) {
      if (!exportPanel.contains(e.target) && !exportButton?.contains(e.target)) {
        hideExportPanel();
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isSelectionMode) exitSelectionMode();
      hideExportPanel();
    }
  });

  // Track element on right-click for context menu
  document.addEventListener('contextmenu', (e) => {
    const messageEl = findMessageElement(e.target);
    if (messageEl) {
      window._lastRightClickedMessage = {
        element: messageEl,
        id: getMessageId(messageEl),
        preview: getMessagePreview(messageEl)
      };
    } else {
      window._lastRightClickedMessage = null;
    }
  }, true);

  // Inject options into Discord context menu
  function injectContextMenuOptions(menuNode) {
    if (!window._lastRightClickedMessage) return;

    // Check if it looks like a message menu (contains reply or copy id/link options)
    // We look for common message actions
    const hasMessageActions = Array.from(menuNode.querySelectorAll('[role="menuitem"]')).some(item => {
      const text = item.textContent.toLowerCase();
      // "reply", "edit", "copy text", "copy id", "回覆", "編輯", "複製"
      return text.includes('reply') || text.includes('edit') ||
        text.includes('回覆') || text.includes('編輯') ||
        item.id === 'message-reply' || item.id === 'message-edit';
    });

    if (!hasMessageActions) return;

    // Avoid double injection
    if (menuNode.querySelector('.discord-exporter-menu-item')) return;

    // Find a separator or the last group to append after
    // Discord menus are usually groups of items
    const groups = menuNode.querySelectorAll('[role="group"]');
    if (!groups.length) return;

    // Find a group suitable for cloning styling (one that contains text items, not e.g. reactions)
    let referenceGroup = groups[0];
    let referenceItem = null;

    // Search for a standard text item to clone
    const candidateItems = menuNode.querySelectorAll('[role="menuitem"]');
    for (const item of candidateItems) {
      const text = item.textContent.toLowerCase();
      // "message-add-reaction" is usually the top bar, avoid it
      if (item.id === 'message-add-reaction') continue;

      // Look for standard actions
      if (text.includes('copy') || text.includes('edit') || text.includes('reply') ||
        text.includes('複製') || text.includes('編輯') || text.includes('回覆')) {
        referenceItem = item;
        referenceGroup = item.closest('[role="group"]') || groups[0];
        break;
      }
    }

    // Fallback if no specific item found but groups exist
    if (!referenceItem) referenceItem = menuNode.querySelector('[role="menuitem"]');

    // Create new group for our items
    const newGroup = document.createElement('div');
    newGroup.setAttribute('role', 'group');
    // Ensure we claim the class from a vertical group
    newGroup.className = referenceGroup ? referenceGroup.className : groups[0].className;

    // Helper to create menu item
    const createMenuItem = (label, onClick) => {
      if (!referenceItem) return null;

      const item = referenceItem.cloneNode(true);
      item.classList.add('discord-exporter-menu-item'); // Marker class
      item.id = ''; // Remove ID

      // Update text
      const labelDiv = item.querySelector('[class*="label"]');
      if (labelDiv) {
        labelDiv.textContent = label;
      } else {
        item.textContent = label;
      }

      // Remove icon if present
      const icon = item.querySelector('[class*="icon"]');
      if (icon) icon.remove();

      // Remove sub-menu arrow if present
      const hint = item.querySelector('[class*="hint"]');
      if (hint) hint.remove();

      item.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
        // Close menu
        const layer = menuNode.closest('[class*="layer"]');
        if (layer) layer.remove();
        // Fallback: trigger click on background
        document.body.click();
      };

      // Fix cursor
      item.style.cursor = 'pointer';

      // Add hover effect mimicking Discord's native menu
      // Native items usually toggle a 'focused' class, but since class names are randomized,
      // we use inline styles with Discord's CSS variables.
      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = 'var(--brand-experiment, #5865F2)';
        item.style.color = 'var(--interactive-active, #FFFFFF)';
        // Ensure icon color changes too if we had one
        const icon = item.querySelector('svg, [class*="icon"]');
        if (icon) icon.style.color = 'currentColor';
      });

      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = '';
        item.style.color = '';
        const icon = item.querySelector('svg, [class*="icon"]');
        if (icon) icon.style.color = '';
      });

      return item;
    };

    const separator = document.createElement('div');
    separator.className = menuNode.querySelector('[role="separator"]')?.className || 'separator-1So4YB';
    separator.setAttribute('role', 'separator');

    // Updated labels: No emoji, No Chinese
    const startItem = createMenuItem('Set Start Point', () => {
      const msg = window._lastRightClickedMessage;
      if (msg) {
        setSelection(msg.element, msg.id);
        updateExportPanel();
      }
    });

    const endItem = createMenuItem('Set End Point', () => {
      const msg = window._lastRightClickedMessage;
      if (msg) {
        setEndSelection(msg.element, msg.id);
        updateExportPanel();
      }
    });

    if (startItem && endItem) {
      newGroup.appendChild(startItem);
      newGroup.appendChild(endItem);

      // Insert logic using the container of the reference group
      const container = referenceGroup.parentNode;

      // Insert after the reference group (keeps standard items together)
      if (container) {
        if (referenceGroup.nextSibling) {
          container.insertBefore(newGroup, referenceGroup.nextSibling);
        } else {
          container.appendChild(newGroup);
        }

        // Add separator
        if (menuNode.querySelector('[role="separator"]')) {
          // Clone separator
          const sep = menuNode.querySelector('[role="separator"]').cloneNode(true);
          container.insertBefore(sep, newGroup);
        }
      } else {
        // Fallback
        menuNode.appendChild(newGroup);
      }
    }
  }

  // Inject button when DOM changes (Discord is a SPA)
  const observer = new MutationObserver((mutations) => {
    // Check for context menu injection
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) { // Element
          // Check if it IS the menu or CONTAINS the menu
          // Usually Discord adds a layer container
          if (node.getAttribute('role') === 'menu') {
            injectContextMenuOptions(node);
          } else {
            const menu = node.querySelector('[role="menu"], [class*="menu-"]');
            if (menu) {
              injectContextMenuOptions(menu);
            }
          }
        }
      }
    }

    injectExportButton();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Initial injection
  setTimeout(injectExportButton, 1000);

  console.log('Discord Chat Exporter content script loaded (refactored version)');
})();
