const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '_locales');

function replaceInFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let updated = content
        .replace(/Video Downloader Plus/g, 'NexFetch')
        .replace(/Vidow/g, 'NexFetch');
    
    if (content !== updated) {
        fs.writeFileSync(filePath, updated, 'utf8');
        console.log(`Updated: ${filePath}`);
    }
}

function processDirectory(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            processDirectory(fullPath);
        } else if (file === 'messages.json') {
            replaceInFile(fullPath);
        }
    }
}

if (fs.existsSync(localesDir)) {
    processDirectory(localesDir);
    console.log('Finished updating locales.');
} else {
    console.log('Locales directory not found.');
}
