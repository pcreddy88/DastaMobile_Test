#!/bin/sh
set -e

# Xcode Cloud images don't include Node by default
if ! command -v node &> /dev/null; then
  brew install node@20
  brew link node@20
fi

cd "$CI_WORKSPACE"
npm ci
npx expo prebuild --platform ios --no-install
cd ios
pod install --repo-update
