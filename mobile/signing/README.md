# App signing key

`tingyi-release.p12` is created by the first GitHub build and is encrypted with the
`KEYSTORE_PASSWORD` repository secret. Every build signs the APK with it, so new versions
install over old ones. Don't delete it: a new key means uninstalling the app (and losing
its recordings) before the next version will install.
