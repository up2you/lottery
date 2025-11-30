const fs = require('fs');
const path = require('path');

const moveFile = (file, targetDir) => {
  const sourcePath = path.join(__dirname, '..', file);
  const targetPath = path.join(__dirname, '..', targetDir, file);

  if (fs.existsSync(sourcePath)) {
    if (!fs.existsSync(path.dirname(targetPath))) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    }
    fs.renameSync(sourcePath, targetPath);
    console.log(`Moved ${file} to ${targetDir}/`);
  }
};

const moveDir = (dir, targetDir) => {
  const sourcePath = path.join(__dirname, '..', dir);
  const targetPath = path.join(__dirname, '..', targetDir, dir);

  if (fs.existsSync(sourcePath)) {
    if (!fs.existsSync(path.dirname(targetPath))) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    }
    // Rename implies move for directories
    fs.renameSync(sourcePath, targetPath);
    console.log(`Moved ${dir}/ to ${targetDir}/`);
  }
};

// Ensure directories exist
const srcDir = path.join(__dirname, '..', 'src');
const publicDir = path.join(__dirname, '..', 'public');

if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir);
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);

// Files to move to public/
['index.html', 'metadata.json', 'favicon.ico', 'logo192.png', 'logo512.png', 'manifest.json', 'robots.txt'].forEach(file => {
  moveFile(file, 'public');
});

// Files/Dirs to move to src/
['App.tsx', 'index.tsx', 'types.ts', 'constants.ts', 'components', 'services', 'utils', 'App.css', 'index.css'].forEach(item => {
    // Check if it's a directory or file logic is handled by fs.renameSync generically, 
    // but our helpers split logic. Let's try simple rename for all first.
    const source = path.join(__dirname, '..', item);
    const dest = path.join(__dirname, '..', 'src', item);
    if (fs.existsSync(source)) {
        fs.renameSync(source, dest);
        console.log(`Moved ${item} to src/`);
    }
});

console.log('Project structure organized successfully!');