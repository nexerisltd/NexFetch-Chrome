const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ICONS_DIR = path.join(__dirname, 'icons');
const LOGO_PATH = path.join(ICONS_DIR, 'logo.png');

const sizes = [16, 19, 38, 48, 128, 256];

async function generateIcons() {
    if (!fs.existsSync(LOGO_PATH)) {
        console.error('Error: logo.png not found in icons directory.');
        console.log('Please save the attached logo as "logo.png" inside the "icons" folder.');
        return;
    }

    try {
        for (const size of sizes) {
            await sharp(LOGO_PATH)
                .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .toFile(path.join(ICONS_DIR, `${size}.png`));
            console.log(`Generated ${size}.png`);
        }

        // Also generate icon.png, icon_active.png, icon_inactive.png
        await sharp(LOGO_PATH)
            .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .toFile(path.join(ICONS_DIR, 'icon.png'));
        console.log('Generated icon.png');
        
        await sharp(LOGO_PATH)
            .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .toFile(path.join(ICONS_DIR, 'icon_active.png'));
        console.log('Generated icon_active.png');
        
        // Generate inactive (grayscale)
        await sharp(LOGO_PATH)
            .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .grayscale()
            .toFile(path.join(ICONS_DIR, 'icon_inactive.png'));
        console.log('Generated icon_inactive.png');
        
        console.log('All icons generated successfully!');
    } catch (err) {
        console.error('Error generating icons:', err);
    }
}

generateIcons();
