# MIDI Choral Practice

A web application for practicing choral music with MIDI files. Load any MIDI file from a URL and control playback with features designed for music practice.

## Features

- **MIDI File Loading**: Load MIDI files from any public URL
- **Playback Controls**:
  - Play/Pause/Stop
  - Seek forward/backward by 10 seconds
  - Visual progress bar with click-to-seek
- **Tempo Control**: Speed up or slow down playback (25% - 200% of original tempo)
- **Channel Volume Control**: Adjust volume for individual MIDI channels to emphasize specific parts (e.g., soprano, alto, tenor, bass)
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile devices
- **Real-time Display**: Shows current time, duration, and track information

## Technology Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Audio Library**: [Tone.js](https://tonejs.github.io/) - Web Audio framework
- **MIDI Parsing**: [@tonejs/midi](https://github.com/Tonejs/Midi) - MIDI file parser
- **Backend**: Node.js with Express (for serving static files)
- **Deployment**: Render

## Getting Started

### Prerequisites

- Node.js 18.x or higher
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd choral-practice
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm start
```

4. Open your browser and navigate to:
```
http://localhost:3000
```

## Usage

1. **Load a MIDI file**:
   - Enter the URL of a publicly accessible MIDI file (must end in `.mid`)
   - Click "Load MIDI" or press Enter
   - Wait for the file to load and parse

2. **Playback**:
   - Click "Play" to start playback
   - Click "Pause" to pause (playback can be resumed)
   - Click "Stop" to stop and reset to the beginning

3. **Navigation**:
   - Use the "-10s" and "+10s" buttons to skip backward/forward
   - Click on the progress bar to jump to a specific position

4. **Tempo Adjustment**:
   - Use the tempo slider or Slower/Faster buttons
   - Range: 25% (very slow) to 200% (double speed)
   - Perfect for practicing difficult passages

5. **Channel Volume Control**:
   - Each MIDI channel/track appears with its own volume slider
   - Adjust individual channels from 0% (silent) to 200% (amplified)
   - Useful for isolating specific vocal parts

## Deployment on Render

### Option 1: Using render.yaml (Recommended)

1. Push your code to a Git repository (GitHub, GitLab, or Bitbucket)

2. Go to [Render Dashboard](https://dashboard.render.com/)

3. Click "New +" and select "Blueprint"

4. Connect your repository

5. Render will automatically detect the `render.yaml` file and configure your service

6. Click "Apply" to deploy

### Option 2: Manual Setup

1. Go to [Render Dashboard](https://dashboard.render.com/)

2. Click "New +" and select "Web Service"

3. Connect your repository

4. Configure the service:
   - **Name**: choral-practice (or your preferred name)
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free (or your preference)

5. Click "Create Web Service"

6. Wait for deployment to complete

7. Access your app at the provided URL (e.g., `https://choral-practice.onrender.com`)

## Finding MIDI Files

You can use MIDI files from various sources:

- **Free MIDI Archive**: [https://freemidi.org/](https://freemidi.org/)
- **Mutopia Project**: [https://www.mutopiaproject.org/](https://www.mutopiaproject.org/)
- **Classical MIDI Connection**: Various classical pieces

**Note**: The MIDI file must be hosted on a public URL that allows cross-origin requests (CORS).

## Browser Compatibility

- Chrome/Edge (recommended)
- Firefox
- Safari
- Opera

Modern browsers with Web Audio API support are required.

## Project Structure

```
choral-practice/
├── public/
│   ├── index.html       # Main HTML page
│   ├── styles.css       # Responsive styling
│   └── app.js           # MIDI player logic
├── server.js            # Express server
├── package.json         # Dependencies and scripts
├── render.yaml          # Render deployment config
├── .gitignore
└── README.md
```

## Development

### Running Locally

```bash
npm start
```

The server will start on port 3000 (or the PORT environment variable if set).

### Testing

Open the application and try loading a MIDI file. Example MIDI URLs for testing:
- Look for public MIDI files on sites like freemidi.org
- Ensure the URL is direct (ends with .mid) and allows CORS

## Known Limitations

- MIDI files must be accessible via CORS-enabled URLs
- Large MIDI files may take a moment to load
- Synthesizer quality depends on browser's Web Audio implementation
- Some complex MIDI features may not be fully supported

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT
