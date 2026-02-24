const { execSync } = require('child_process');
const path = require('path');

exports.default = async function(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`Cleaning xattrs for codesign: ${appPath}`);

  // Remove resource fork files
  execSync(`find "${appPath}" -name "._*" -delete 2>/dev/null || true`);
  execSync(`dot_clean "${appPath}" 2>/dev/null || true`);

  // Nuclear cleanup: remove ALL extended attributes from everything
  // Run on every single file and directory individually
  execSync(`find "${appPath}" -exec xattr -c {} \\; 2>/dev/null || true`);

  // Second pass specifically on frameworks (where GPU helper fails)
  const frameworksPath = path.join(appPath, 'Contents', 'Frameworks');
  execSync(`find "${frameworksPath}" -exec xattr -c {} \\; 2>/dev/null || true`);
  execSync(`find "${frameworksPath}" -name "._*" -delete 2>/dev/null || true`);
  execSync(`dot_clean "${frameworksPath}" 2>/dev/null || true`);

  // Third pass: specifically target all Mach-O executables
  execSync(`find "${frameworksPath}" -type f -perm +111 -exec xattr -c {} \\; 2>/dev/null || true`);

  // Verify
  const result = execSync(`xattr -lr "${frameworksPath}" 2>&1 | grep -v "com.apple.cs" | head -5 || true`).toString().trim();
  console.log('Non-codesign xattrs remaining:', result || 'NONE (clean)');
};
