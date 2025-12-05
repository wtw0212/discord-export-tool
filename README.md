# Discord Chat Exporter

A Chrome extension to export Discord web conversations to PDF or Markdown format.

## Features

- **Custom Starting Point**: Select any message as the starting point for export
- **Auto-scroll**: Automatically scrolls down to capture all messages from your selected point to the latest
- **PDF Export**: Export chat with full styling, images, and avatars preserved
- **Markdown Export**: Export chat in clean Markdown format
- **Media Support**: Includes images and user avatars in exports
- **Timestamps**: Option to include message timestamps
- **Reactions**: Option to include message reactions
- **Chat Only**: Only exports the chat content, excluding channel lists and user sidebars

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension folder
5. The Discord Chat Exporter icon should appear in your toolbar

## Usage

### Basic Export

1. Navigate to Discord web (https://discord.com)
2. Open the channel you want to export
3. Click on the Discord Chat Exporter extension icon
4. Click "Select Starting Message" and click on the message where you want to start the export
5. Choose your export options (images, avatars, timestamps, reactions)
6. Click "Export as PDF" or "Export as Markdown"

### Quick Export (Right-Click)

1. Right-click on any message in Discord (uses Discord's native menu)
2. Look for the new options: "Set Start Point" and "Set End Point"
3. Click to mark the range directly from the menu

### Keyboard Shortcut

- Press `ESC` to cancel selection mode

## Export Options

| Option | Description |
|--------|-------------|
| Include images | Embed message images in the export |
| Include avatars | Show user profile pictures |
| Include timestamps | Add date/time to each message |
| Include reactions | Include emoji reactions on messages |

## File Formats

### PDF Export
- Opens a print preview window for saving as PDF
- Full Discord-like styling preserved
- Images and avatars embedded as base64
- Use your browser's "Save as PDF" option

### Markdown Export
- Clean `.md` file download
- Links to images preserved
- Compatible with any Markdown viewer
- Great for archiving or importing to other platforms

## Notes

- The extension only works on `discord.com`
- Large exports may take some time due to image processing
- Ensure you have permission to export the conversations you're archiving
- The extension respects Discord's DOM structure; updates to Discord's interface may require extension updates

## Privacy

- All processing is done locally in your browser
- No data is sent to external servers
- Images are converted to base64 locally for PDF export

## Troubleshooting

### Messages not loading
- Wait for Discord to fully load before starting export
- Try scrolling through the chat first to ensure messages are loaded

### PDF export issues
- If images don't appear, try with fewer messages
- Some image CDN URLs may expire; export promptly after viewing

### Selection not working
- Refresh the Discord page
- Ensure the extension is properly loaded

## Development

### Project Structure

```
discord-chat-exporter/
├── manifest.json          # Chrome extension manifest
├── popup.html             # Extension popup UI
├── popup.css              # Popup styles
├── popup.js               # Popup logic
├── content.js             # Content script for Discord interaction
├── content-styles.css     # Styles injected into Discord
├── background.js          # Service worker
└── icons/                 # Extension icons
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Building

No build process required - this is a pure JavaScript extension.

## License

MIT License - Feel free to modify and distribute.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
