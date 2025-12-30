/**
 * Generates version.json at build time with date and git commit hash.
 * Run this during the build process before starting the server.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
    // Get short git commit hash
    // First try Render's environment variable, then fall back to git command
    let hash;
    if (process.env.RENDER_GIT_COMMIT) {
        hash = process.env.RENDER_GIT_COMMIT.substring(0, 7);
        console.log('Using RENDER_GIT_COMMIT environment variable');
    } else {
        hash = execSync('git rev-parse --short HEAD').toString().trim();
        console.log('Using git rev-parse command');
    }

    // Get current date in YYYY-MM-DD format
    const date = new Date().toISOString().split('T')[0];

    // Build version info
    const versionInfo = {
        version: `${date}.${hash}`,
        commit: hash,
        date: date,
        built: new Date().toISOString()
    };

    // Write to public folder so it's accessible from the client
    const outputPath = path.join(__dirname, 'public', 'version.json');
    fs.writeFileSync(outputPath, JSON.stringify(versionInfo, null, 2));

    console.log(`Version file generated: ${versionInfo.version}`);
} catch (error) {
    console.error('Failed to generate version file:', error.message);

    // Write a fallback version file so the app doesn't break
    const fallback = {
        version: 'unknown',
        commit: 'unknown',
        date: new Date().toISOString().split('T')[0],
        built: new Date().toISOString()
    };

    const outputPath = path.join(__dirname, 'public', 'version.json');
    fs.writeFileSync(outputPath, JSON.stringify(fallback, null, 2));

    console.log('Fallback version file generated');
}
