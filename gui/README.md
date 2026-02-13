# AutoResume GUI Dashboard

A visually stunning cyberpunk-themed dashboard for monitoring and controlling the AutoResume daemon.

## Features

- **Real-time Session Monitoring**: Live status updates via WebSocket
- **Rate Limit Tracking**: Visual countdown timers and analytics
- **Interactive Configuration**: Edit settings through a modern UI
- **Analytics Visualization**: Chart.js powered graphs for rate limit history
- **Quick Actions**: Start/stop daemon, reset status, manual resume
- **Toast Notifications**: Real-time feedback for all operations

## Design Aesthetic

The dashboard features a **cyberpunk-inspired dark theme** with:
- Neon cyan and magenta accents on deep black backgrounds
- Glassmorphism effects with backdrop blur
- Smooth animations and transitions
- Grid-based noise overlay texture
- Real-time data visualization with Chart.js

## Usage

### Option 1: Open as Local File

Simply open `index.html` in your browser:

```bash
# Windows
start gui/index.html

# macOS
open gui/index.html

# Linux
xdg-open gui/index.html
```

### Option 2: Serve via HTTP Server

For WebSocket functionality, serve the dashboard via HTTP:

```bash
# Using Python
cd gui
python -m http.server 8080

# Using Node.js http-server (npm install -g http-server)
cd gui
http-server -p 8080
```

Then open: `http://localhost:8080`

### Option 3: Integrated with Daemon (Future)

The daemon will serve the GUI automatically on `http://localhost:8765`

## WebSocket Configuration

The dashboard connects to the daemon via WebSocket at:
- **Default Port**: 8765
- **Protocol**: WS (or WSS for HTTPS)
- **Auto-reconnect**: Enabled with exponential backoff

Edit `app.js` line 17 to change the WebSocket port:
```javascript
const port = 8765; // Change this
```

## Components

### 1. Session Status Cards
- Live session monitoring
- Rate limit detection badges
- Countdown timers
- Manual resume buttons

### 2. Analytics Dashboard
- Time-series charts for rate limits
- Configurable time ranges (1H, 6H, 24H, 7D)
- Peak hour detection
- Success rate tracking

### 3. Configuration Panel
- Check interval settings
- Auto-resume toggle
- Notification preferences
- Debug mode

### 4. System Stats
- Daemon uptime
- Total resumes count
- Success rate percentage
- Peak usage hours

### 5. Quick Actions
- Start/stop daemon
- Reset status
- View logs
- Manual session control

## Browser Support

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support (with webkit prefixes)
- Mobile: Responsive design included

## Dependencies

- **Chart.js v4.4.1**: Loaded via CDN for analytics visualization
- **WebSocket API**: Native browser support (no library needed)
- **LocalStorage**: For configuration persistence

## Color Palette

```css
--accent-cyan:    #00f5ff  /* Primary neon accent */
--accent-magenta: #ff00ff  /* Secondary accent */
--accent-purple:  #7b2cbf  /* Gradient stop */
--accent-green:   #00ff88  /* Success state */
--accent-yellow:  #ffed4e  /* Warning state */
--accent-red:     #ff006e  /* Error state */
```

## File Structure

```
gui/
├── index.html      # Main dashboard HTML
├── styles.css      # Cyberpunk theme styling
├── app.js          # WebSocket client & UI logic
└── README.md       # This file
```

## Customization

### Change Theme Colors

Edit `styles.css` root variables (lines 1-30):
```css
:root {
    --accent-cyan: #00f5ff;    /* Your color here */
    --accent-purple: #7b2cbf;  /* Your color here */
}
```

### Modify WebSocket Port

Edit `app.js` constructor (line 17):
```javascript
const port = 8765; // Your port here
```

### Adjust Update Frequency

Edit `app.js` update intervals:
```javascript
// Line 392: Countdown updates (default: 1 second)
setInterval(() => { /* ... */ }, 1000);

// Line 402: Status refresh (default: 10 seconds)
setInterval(() => { /* ... */ }, 10000);
```

## Known Issues

- WebSocket connection requires daemon to implement WS server
- Local file mode has CORS limitations for some features
- Chart.js requires internet connection (CDN)

## Future Enhancements

- [ ] Dark/light theme toggle
- [ ] Multiple session support
- [ ] Historical analytics export
- [ ] Desktop notifications
- [ ] Mobile app version
- [ ] Custom alert sounds
- [ ] Multi-language support

## License

MIT License - Same as parent project
