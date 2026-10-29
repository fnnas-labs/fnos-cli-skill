// Closed public release identities. Never derive authority from release.json.
const PRODUCTS = Object.freeze({
  fnos: Object.freeze({ variant: 'fnos', packageName: '@fnnas-labs/fnos-cli', commandName: 'fnos-cli', repository: 'fnnas-labs/fnos-cli-skill', locale: 'zh-CN', bridgeName: 'fnos-cli-skill', label: 'fnOS', dsh: true }),
  fygo: Object.freeze({ variant: 'fygo', packageName: '@fygonas-labs/fygo-cli', commandName: 'fygo-cli', repository: 'fygonas-labs/fygo-cli-skill', locale: 'en', bridgeName: 'fygo-cli-skill', label: 'Fygo', dsh: false })
});
function product(variant) {
  if (!Object.hasOwn(PRODUCTS, variant)) throw new Error('Invalid release product');
  return PRODUCTS[variant];
}
function assetNames(id, version) {
  return [`${id.packageName.slice(1).replace('/', '-')}-${version}.tgz`, `${id.variant}-skill.zip`, ...["darwin-arm64","darwin-x64","linux-arm64","linux-x64","windows-arm64","windows-x64"].map(platform=>`${id.commandName}-${version}-${platform}.gz`)];
}
module.exports = { product, assetNames };
