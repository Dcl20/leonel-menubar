const { execSync } = require('child_process');
const path = require('path');

exports.default = async function(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`Removing problematic attributes: ${appPath}`);

  // Clear ALL extended attributes recursively - run multiple times to beat iCloud/FileProvider
  for (let i = 0; i < 3; i++) {
    execSync(`xattr -cr "${appPath}"`);
  }
  // Remove resource fork files
  execSync(`find "${appPath}" -name "._*" -delete 2>/dev/null || true`);
  execSync(`dot_clean "${appPath}" 2>/dev/null || true`);

  // Verify cleanup
  const result = execSync(`xattr -lr "${appPath}/Contents/Frameworks/" 2>&1 | head -5 || true`).toString();
  console.log('Remaining xattrs:', result || 'NONE');
  console.log('Cleanup complete');
};
