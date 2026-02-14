const { execSync } = require('child_process');
const path = require('path');

exports.default = async function(context) {
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`Removing problematic attributes: ${appPath}`);

  // Remove specific problematic attributes from all files and directories
  execSync(`find "${appPath}" -exec xattr -d com.apple.FinderInfo {} \\; 2>/dev/null || true`);
  execSync(`find "${appPath}" -exec xattr -d com.apple.quarantine {} \\; 2>/dev/null || true`);
  execSync(`find "${appPath}" -name "._*" -delete 2>/dev/null || true`);
  execSync(`dot_clean "${appPath}" 2>/dev/null || true`);

  console.log('Cleanup complete');
};
