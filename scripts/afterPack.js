const { execSync } = require('child_process');
const path = require('path');

exports.default = async function(context) {
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`Cleaning extended attributes: ${appPath}`);
  execSync(`xattr -cr "${appPath}"`);
  console.log(`Ad-hoc signing: ${appPath}`);
  execSync(`codesign --force --deep -s - "${appPath}"`);
  console.log('Ad-hoc signing complete');
};
