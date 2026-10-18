// Adds a build number from CI so each new APK installs as an update over the last one.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    versionCode: Number(process.env.VERSION_CODE || 1),
  },
});
