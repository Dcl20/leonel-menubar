const { execSync } = require('child_process');
const path = require('path');

exports.default = async function(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`Removing problematic attributes: ${appPath}`);

  // Remove resource fork files first
  execSync(`find "${appPath}" -name "._*" -delete 2>/dev/null || true`);
  execSync(`dot_clean "${appPath}" 2>/dev/null || true`);

  // Clear ALL extended attributes recursively - run multiple times
  for (let i = 0; i < 5; i++) {
    execSync(`xattr -cr "${appPath}"`);
  }

  // Specifically target the Frameworks directory (where GPU helper lives)
  const frameworksPath = path.join(appPath, 'Contents', 'Frameworks');
  execSync(`find "${frameworksPath}" -type f -exec xattr -c {} \\; 2>/dev/null || true`);
  execSync(`find "${frameworksPath}" -name "._*" -delete 2>/dev/null || true`);
  execSync(`dot_clean "${frameworksPath}" 2>/dev/null || true`);

  // Strip resource forks from all Mach-O binaries in Frameworks
  execSync(`find "${frameworksPath}" -type f -perm +111 -exec xattr -d com.apple.FinderInfo {} \\; 2>/dev/null || true`);
  execSync(`find "${frameworksPath}" -type f -perm +111 -exec xattr -d com.apple.ResourceFork {} \\; 2>/dev/null || true`);

  // Verify cleanup
  const result = execSync(`xattr -lr "${frameworksPath}" 2>&1 | head -10 || true`).toString();
  console.log('Remaining xattrs:', result || 'NONE');
  console.log('Cleanup complete');
};
