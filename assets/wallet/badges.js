// Official "Add to Apple Wallet" / "Add to Google Wallet" button artwork
// (brand guidelines require the exact assets -- don't edit or restyle).
// Shown as plain images under Reload Dasta Card on the Scan tab (App.js,
// ScanScreen).
//
// Apple: rendered from Apple's own SVG (Add-to-Apple-Wallet.zip ->
// US_UK/RGB/US-UK_Add_to_Apple_Wallet_RGB_101421.svg, kept in this folder)
// to PNG at 1x/2x/3x with resvg (2026-09-30). Drawing the SVG in-app with
// react-native-svg came out dark: it ignores the SVG's <style> colors and
// doesn't reliably draw its clip-path, so the Wallet icon and label were
// lost. React Native picks @2x/@3x by screen density.
export const APPLE_WALLET_BADGE_IMAGE = require('./add-to-apple-wallet.png');
export const APPLE_WALLET_BADGE_RATIO = 110.739 / 35.016;   // width / height, from the SVG viewBox

// Google: Google's official enUS "Add to Google Wallet" badge (two-line,
// 199x55 PNG from PC, 2026-09-30) -- same two-line shape as Apple's badge.
// A PNG, so it's drawn with Image, not SvgXml.
export const GOOGLE_WALLET_BUTTON_IMAGE = require('./add-to-google-wallet.png');
export const GOOGLE_WALLET_BUTTON_RATIO = 199 / 55;
