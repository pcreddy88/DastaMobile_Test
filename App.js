import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useState, useEffect, useRef, useContext, createContext, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
  ActivityIndicator, Alert, AppState, Animated, Image, ImageBackground, Keyboard, KeyboardAvoidingView, Modal, Pressable,
  ScrollView as RNScrollView, StyleSheet, Switch, Text, TextInput, View, Linking, useWindowDimensions, RefreshControl, Platform,
  PanResponder,
} from 'react-native';

// ── Pinch-to-zoom on every platform (2026-09-29, PC) ─────────────────
// Screens opt in with the same ScrollView props they always have
// (pinchGestureEnabled + maximumZoomScale={3} ...). iOS: React Native's own
// native ScrollView zoom, exactly as before. Android: RN's ScrollView has
// no zoom support at all, so this wraps it -- a two-finger pinch magnifies
// around the point between your fingers (up to maximumZoomScale), dragging
// with two fingers moves around while zoomed, and pinching back near 1x
// snaps to normal. The wrapper only claims a touch when TWO fingers are
// down, so one-finger scrolling and taps behave exactly as before. It's
// named ScrollView on purpose, so every existing screen picks it up with
// no edits. Only a ScrollView that fills its space (flex/height -- i.e. a
// screen) is wrapped on Android; small inner lists stay plain.
const PINCH_RESET_BELOW = 1.05;
function _pinchDist(t) {
  const dx = t[0].pageX - t[1].pageX, dy = t[0].pageY - t[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
}
function _pinchMid(t) {
  return { x: (t[0].pageX + t[1].pageX) / 2, y: (t[0].pageY + t[1].pageY) / 2 };
}

const AndroidPinchScrollView = forwardRef(function AndroidPinchScrollView(
  { style, maximumZoomScale = 3, minimumZoomScale = 1, ...rest }, ref) {
  const wrapperRef = useRef(null);
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const cur = useRef({ s: 1, x: 0, y: 0 });        // current zoom state
  const start = useRef(null);                        // snapshot at pinch start
  const frame = useRef({ x: 0, y: 0, w: 0, h: 0 });  // wrapper frame, window coords
  const [pinching, setPinching] = useState(false);
  const limits = useRef({ min: 1, max: 3 });
  limits.current = { min: Math.max(1, minimumZoomScale), max: Math.max(1, maximumZoomScale) };

  const apply = (s, x, y) => {
    cur.current = { s, x, y };
    scale.setValue(s); tx.setValue(x); ty.setValue(y);
  };
  const clampT = (t, s, size) => {
    const lim = ((s - 1) * size) / 2;
    return Math.max(-lim, Math.min(lim, t));
  };
  const begin = (touches) => {
    wrapperRef.current?.measureInWindow?.((x, y, w, h) => { frame.current = { x, y, w, h }; });
    start.current = { d: _pinchDist(touches), m: _pinchMid(touches), ...cur.current };
    setPinching(true);
  };
  const end = () => {
    start.current = null;
    setPinching(false);
    if (cur.current.s < PINCH_RESET_BELOW) {
      cur.current = { s: 1, x: 0, y: 0 };
      Animated.parallel([
        Animated.timing(scale, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.timing(tx, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(ty, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  };

  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponderCapture: (e) => e.nativeEvent.touches.length >= 2,
    onMoveShouldSetPanResponderCapture: (e) => e.nativeEvent.touches.length >= 2,
    onPanResponderGrant: (e) => { if (e.nativeEvent.touches.length >= 2) begin(e.nativeEvent.touches); },
    onPanResponderMove: (e) => {
      const t = e.nativeEvent.touches;
      if (t.length < 2) return;
      if (!start.current) begin(t);
      const st = start.current;
      const d = _pinchDist(t);
      if (!st.d || !d) return;
      const { min, max } = limits.current;
      const s = Math.max(min, Math.min(max, (st.s * d) / st.d));
      // Keep the point between the fingers fixed while scaling (transform
      // origin is the wrapper's center), and follow the fingers as they move.
      const m = _pinchMid(t), f = frame.current;
      const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
      const x = m.x - cx - (s / st.s) * (st.m.x - cx - st.x);
      const y = m.y - cy - (s / st.s) * (st.m.y - cy - st.y);
      apply(s, clampT(x, s, f.w), clampT(y, s, f.h));
    },
    onPanResponderRelease: end,
    onPanResponderTerminate: end,
    onPanResponderTerminationRequest: () => false,
  })).current;

  // Layout props stay on the outer wrapper so the screen sizes exactly as
  // it did; everything else (background, padding...) stays on the ScrollView.
  const flat = StyleSheet.flatten(style) || {};
  const LAYOUT = ['flex', 'flexGrow', 'flexShrink', 'flexBasis', 'height', 'minHeight', 'maxHeight', 'width',
                  'minWidth', 'maxWidth', 'alignSelf', 'margin', 'marginTop', 'marginBottom', 'marginLeft',
                  'marginRight', 'marginHorizontal', 'marginVertical', 'position', 'top', 'bottom', 'left', 'right', 'zIndex'];
  const outer = { overflow: 'hidden' }, inner = {};
  Object.keys(flat).forEach(k => { (LAYOUT.includes(k) ? outer : inner)[k] = flat[k]; });

  return (
    <View ref={wrapperRef} collapsable={false} style={outer} {...responder.panHandlers}>
      <Animated.View style={{ flex: 1, transform: [{ translateX: tx }, { translateY: ty }, { scale }] }}>
        <RNScrollView ref={ref} {...rest} style={[inner, { flex: 1 }]}
          scrollEnabled={!pinching && rest.scrollEnabled !== false} />
      </Animated.View>
    </View>
  );
});

const ScrollView = forwardRef(function ScrollView(props, ref) {
  if (Platform.OS === 'android' && props.pinchGestureEnabled && !props.horizontal) {
    const flat = StyleSheet.flatten(props.style) || {};
    if (flat.flex != null || flat.flexGrow != null || flat.height != null) {
      return <AndroidPinchScrollView ref={ref} {...props} />;
    }
  }
  return <RNScrollView ref={ref} {...props} />;
});
import QRCode from 'react-native-qrcode-svg';
// My Circles (2026-09-27) -- scanning a friend's Dasta Account ID QR to add
// them to a Circle. Native module: needs a new binary (app.json version
// bumped to 1.1.0 so no OTA update can ever ship this to a 1.0.0 build).
import { CameraView, useCameraPermissions } from 'expo-camera';
import { WebView } from 'react-native-webview';
import { useFonts } from 'expo-font';
// Direct per-weight subpath imports (2026-09-13) -- NOT the package's
// barrel import. That index re-exports all 12 weight/style files as
// unconditional top-level `require()`s, so Metro bundles every one of
// them (~2.2MB) regardless of which named exports are actually used.
// These two subpaths bundle only the two files this app loads.
import { PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display/700Bold';
import { PlayfairDisplay_600SemiBold } from '@expo-google-fonts/playfair-display/600SemiBold';
// Direct subpath import (2026-09-13) -- NOT `import { Ionicons } from
// '@expo/vector-icons'`. That barrel import pulls in every bundled icon
// set's font file (~3.7MB combined: FontAwesome/5/6, MaterialIcons,
// MaterialCommunityIcons, Entypo, Feather, etc.) even though only
// Ionicons is used anywhere in this app -- confirmed by checking the
// actual `expo export` asset list before/after this change. The direct
// subpath below only registers Ionicons' own font.
import Ionicons from '@expo/vector-icons/Ionicons';
// Voice input (2026-09-14, revised 2026-09-15) -- ported from dastacafe.
// com's find-my-drink mic button (find-my-drink_embed2.html), which is a
// genuine two-path design, not a single universal one: PATH A is the
// browser's native SpeechRecognition for English (instant, on-device, no
// server round trip); PATH B is server-side transcription (POST /voice/
// transcribe, faster-whisper + Ollama translation) for every non-English
// language, and English's own fallback if PATH A is unavailable/fails.
// The first mobile build sent every language through PATH B alone,
// including English -- which is why English felt slow on-device (PC's
// live report, 2026-09-15) despite being instant on web: it was never
// using the fast path web itself uses for English. expo-speech-recognition
// (iOS SFSpeechRecognizer / Android SpeechRecognizer) is the on-device
// equivalent of browser SpeechRecognition and now serves as PATH A here;
// expo-audio (PATH B) is unchanged and still the current SDK 54-documented
// recording API.
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
// Android nav-bar overlap fix (2026-09-19, tester report) -- Expo SDK 54 /
// RN 0.81 default to edge-to-edge on Android, so the system nav bar
// (3-button or gesture) is transparent and paints on top of app content
// unless something explicitly pads for it; iOS already handles its own
// home-indicator inset separately. Already a dependency, just never
// wired up anywhere in this file until now.
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

// ── Clover card payments (Dasta Test) ───────────────────────────
// test.dastacafe.com takes cards through Clover's sandbox, not Stripe.
// Card numbers never touch this app: CloverCardFields loads the API's
// own /payments/clover/card-frame page in a WebView, which hosts Clover's
// card fields and hands back a single-use token. Every money-moving
// screen (Checkout, Add Money, Gift Card Purchase, Gift a Sip/Food
// checkout) gets {payment_ref, clover: {...}} from its own endpoint and
// passes it to the one shared payWithCard() below.
// Dasta Card pay QR: how often the showing screen re-checks the current code
// (2026-09-30). The server returns the same code until it's used or 15
// minutes pass, so this only decides how fast a just-used code is replaced.
const DASTA_CARD_QR_POLL_MS = 5000;
const CLOVER_TOKENIZE_TIMEOUT_MS = 20000;
const CLOVER_FRAME_LOAD_TIMEOUT_MS = 20000;

// Card-frame protocol (all messages are JSON via ReactNativeWebView.postMessage):
//   page → app  {type:'ready'} once Clover's fields are loaded
//   app → page  window.dastaTokenize()
//   page → app  {type:'token', token, card:{brand,last4,exp_month,exp_year}}
//               or {type:'error', message}
// ref.tokenize() resolves {ok:true, token, card} or {ok:false, error}.
const CloverCardFields = forwardRef(function CloverCardFields({ onReady }, ref) {
  const webRef = useRef(null);
  const pending = useRef(null); // {resolve, timer} for the tokenize() in flight
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadKey, setLoadKey] = useState(0); // bumped by "Try again" to remount the WebView

  const settle = (result) => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    clearTimeout(p.timer);
    p.resolve(result);
  };
  useEffect(() => () => settle({ ok: false, error: 'The card form was closed.' }), []);

  // Don't spin forever if the page never says it's ready.
  useEffect(() => {
    if (ready || loadError) return;
    const t = setTimeout(() => setLoadError('The card form took too long to load.'), CLOVER_FRAME_LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready, loadError, loadKey]);

  useImperativeHandle(ref, () => ({
    tokenize: () => {
      if (!ready || !webRef.current) return Promise.resolve({ ok: false, error: 'The card form is still loading.' });
      settle({ ok: false, error: 'Replaced by a newer card check.' }); // only one in flight
      return new Promise((resolve) => {
        const timer = setTimeout(() => settle({ ok: false, error: 'Checking your card timed out. Please try again.' }), CLOVER_TOKENIZE_TIMEOUT_MS);
        pending.current = { resolve, timer };
        webRef.current.injectJavaScript('window.dastaTokenize(); true;');
      });
    },
  }), [ready]);

  const onMessage = (e) => {
    // Only trust messages from our own card-frame page.
    if (!(e.nativeEvent.url || '').startsWith(API_BASE_URL)) return;
    let msg;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg?.type === 'ready') { setReady(true); setLoadError(''); onReady?.(); return; }
    if (msg?.type === 'token' && msg.token) { settle({ ok: true, token: msg.token, card: msg.card || null }); return; }
    if (msg?.type === 'error') {
      const message = msg.message || 'Please check your card details.';
      if (pending.current) settle({ ok: false, error: message });
      else if (!ready) setLoadError(message);
    }
  };

  const failLoad = () => { setReady(false); setLoadError('Could not load the card form.'); };
  const retry = () => { setReady(false); setLoadError(''); setLoadKey(k => k + 1); };

  return (
    <View style={{ height: 160, marginTop: 12, marginBottom: 4, borderRadius: 10, overflow: 'hidden', backgroundColor: C.white, borderWidth: 1, borderColor: C.border }}>
      {!loadError && (
        <WebView
          key={loadKey}
          ref={webRef}
          source={{ uri: `${API_BASE_URL}/payments/clover/card-frame` }}
          originWhitelist={['https://*']}
          // Clover's own iframes load inside the page; the page itself must
          // never navigate the top frame somewhere else.
          onShouldStartLoadWithRequest={(req) => req.isTopFrame === false || req.url.startsWith(API_BASE_URL)}
          onMessage={onMessage}
          onError={failLoad}
          onHttpError={failLoad}
          scrollEnabled={false}
          style={{ backgroundColor: 'transparent' }}
        />
      )}
      {!ready && !loadError && (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: C.white }]}>
          <ActivityIndicator color={C.saffron} />
        </View>
      )}
      {!!loadError && (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 16 }]}>
          <Text style={{ color: '#C0392B', textAlign: 'center' }}>{loadError}</Text>
          <Pressable onPress={retry} style={{ marginTop: 8 }}>
            <Text style={S.linkText}>Try again</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
});

// payWithCard(data) -- data is the endpoint's own response
// ({payment_ref, clover: {saved_cards, preselect_card_id, can_save_card}}).
// Resolves {ok:true}, {ok:false, canceled:true} or {ok:false, error}.
// A payment that fails inside the sheet (e.g. a decline) shows the API's
// message there and lets the customer retry, so callers only ever see
// success or a cancel.
const CloverPayContext = createContext(null);
function usePayWithCard() {
  return useContext(CloverPayContext);
}

function CloverPayProvider({ children }) {
  const [request, setRequest] = useState(null); // {id, data}
  const resolver = useRef(null);
  const nextId = useRef(0);

  const finish = useCallback((result) => {
    const resolve = resolver.current;
    resolver.current = null;
    setRequest(null);
    resolve?.(result);
  }, []);

  const payWithCard = useCallback((data) => {
    if (!data?.payment_ref) return Promise.resolve({ ok: false, error: 'Payment could not be started. Please try again.' });
    resolver.current?.({ ok: false, canceled: true }); // a newer payment replaces any open one
    return new Promise((resolve) => {
      resolver.current = resolve;
      nextId.current += 1;
      setRequest({ id: nextId.current, data });
    });
  }, []);

  return (
    <CloverPayContext.Provider value={payWithCard}>
      {children}
      {request && <CloverPaySheet key={request.id} data={request.data} onDone={finish} />}
    </CloverPayContext.Provider>
  );
}

function CloverPaySheet({ data, onDone }) {
  const insets = useSafeAreaInsets();
  const clover = data.clover || {};
  const savedCards = clover.saved_cards || [];
  const [choice, setChoice] = useState(() =>
    savedCards.some(c => c.id === clover.preselect_card_id) ? clover.preselect_card_id : 'new');
  const [saveCard, setSaveCard] = useState(false);
  const [fieldsReady, setFieldsReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [inProgress, setInProgress] = useState(false); // 409: an earlier Pay is still being processed
  const fieldsRef = useRef(null);

  const cancel = () => { if (!paying) onDone({ ok: false, canceled: true }); };

  const pay = async () => {
    setPaying(true); setError('');
    let body;
    if (choice === 'new') {
      const t = (await fieldsRef.current?.tokenize()) || { ok: false };
      if (!t.ok) { setPaying(false); setError(t.error || 'Please check your card details.'); return; }
      body = { payment_ref: data.payment_ref, token: t.token, card: t.card, save_card: !!(clover.can_save_card && saveCard) };
    } else {
      body = { payment_ref: data.payment_ref, saved_card_id: choice };
    }
    // success also covers status 'authorized' (a group-order hold).
    const res = await apiFetch('/payments/clover/confirm', { method: 'POST', body, timeoutMs: 45000 });
    if (res.ok && res.data?.success) { onDone({ ok: true }); return; }
    setPaying(false);
    // 409: an earlier Pay for this payment_ref is still being charged.
    // Don't invite another tap -- the server blocks repeats for ~2 minutes.
    if (res.status === 409) {
      setInProgress(true);
      setError(`${res.data?.detail || 'This payment is already being processed.'} Check your order history in a minute.`);
      return;
    }
    setError(res.data?.detail || (res.networkError
      ? "We couldn't reach Dasta to confirm your payment. Please check your connection and try again."
      : 'Your payment could not be completed. Please try again.'));
  };

  const payDisabled = paying || inProgress || (choice === 'new' && !fieldsReady);
  const radio = (selected) => (
    <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? C.saffron : C.muted} />
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={cancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={cancel} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
          <View style={[S.modalSheet, { maxHeight: '90%' }]}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 28 + insets.bottom }}>
              <Text style={S.drinkFullName}>Pay with card</Text>

              {savedCards.map(c => (
                <Pressable key={c.id} disabled={paying || inProgress} onPress={() => { setChoice(c.id); setError(''); }}
                  accessibilityRole="radio" accessibilityState={{ checked: choice === c.id }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
                  {radio(choice === c.id)}
                  <Text style={{ color: C.black, fontSize: 15, flex: 1 }}>{c.display}</Text>
                </Pressable>
              ))}
              <Pressable disabled={paying || inProgress} onPress={() => { if (choice !== 'new') setFieldsReady(false); setChoice('new'); setError(''); }}
                accessibilityRole="radio" accessibilityState={{ checked: choice === 'new' }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 }}>
                {radio(choice === 'new')}
                <Text style={{ color: C.black, fontSize: 15, flex: 1 }}>Use a new card</Text>
              </Pressable>

              {choice === 'new' && (
                <>
                  <CloverCardFields ref={fieldsRef} onReady={() => setFieldsReady(true)} />
                  {!!clover.can_save_card && (
                    <Pressable disabled={paying || inProgress} onPress={() => setSaveCard(v => !v)}
                      accessibilityRole="checkbox" accessibilityState={{ checked: saveCard }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 }}>
                      <Ionicons name={saveCard ? 'checkbox' : 'square-outline'} size={20} color={saveCard ? C.saffron : C.muted} />
                      <Text style={{ color: C.black, fontSize: 14 }}>Save this card for next time</Text>
                    </Pressable>
                  )}
                </>
              )}

              {!!error && <Text style={{ color: '#C0392B', marginTop: 8 }}>{error}</Text>}
              <Pressable style={[S.btnSaffron, { marginTop: 16 }, payDisabled && { opacity: 0.6 }]} disabled={payDisabled} onPress={pay}>
                {paying ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Pay</Text>}
              </Pressable>
              <Pressable onPress={cancel} disabled={paying} style={{ marginTop: 4, alignItems: 'center', opacity: paying ? 0.4 : 1 }}>
                <Text style={[S.linkText, { color: C.black }]}>{inProgress ? 'Close' : 'Cancel'}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ── Face ID / Touch ID quick-unlock (2026-09-12) ───────────────
// LOCAL app-unlock only -- gates re-entry to an already-authenticated
// session (dasta_session cookie) behind the device's biometric, via
// expo-local-authentication. Deliberately NOT a Cognito/WebAuthn
// passkey: it doesn't touch auth_router.py, doesn't skip OTP for a
// brand-new device/session, and Face ID data itself never leaves the
// Secure Enclave. Real native passkey work is a separate, larger effort
// currently blocked on a dastacafe.com Apple-App-Site-Association/
// Cloudflare Worker issue outside this app's control -- see PC's
// 2026-09-12 direction. This ships now as an additive convenience,
// independent of that.
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore         from 'expo-secure-store';

// ── Dasta Rewards plant visual (2026-09-12) ────────────────────
// Ported from SipSense_webflow's rewards_embed1.html: same cup photo
// (loaded straight from Webflow's CDN -- no extra image bundled into
// this app) and the exact same 10 hand-traced leaf polygons overlaid
// via react-native-svg, so this looks like the real plant, not a
// simplified stand-in.
import Svg, { Polygon } from 'react-native-svg';
import { APPLE_WALLET_BADGE_IMAGE, APPLE_WALLET_BADGE_RATIO, GOOGLE_WALLET_BUTTON_IMAGE, GOOGLE_WALLET_BUTTON_RATIO } from './assets/wallet/badges';
const REWARDS_CUP_IMAGE_URL = 'https://cdn.prod.website-files.com/69dece9688dac5181962f293/6a2233e9d71a894e5bf20549_Dasta_Cup_With_Logo.jpg';
const REWARDS_LEAF_POLYGONS = [
  "377.0,696.5 368.0,696.5 359.0,696.5 351.0,695.5 344.0,693.5 337.0,691.5 330.0,689.5 324.0,686.5 318.0,683.5 313.0,679.5 307.5,676.0 302.0,672.5 297.5,668.0 293.0,663.5 288.5,659.0 284.0,654.5 279.5,650.0 275.5,645.0 271.5,640.0 267.5,635.0 263.5,630.0 259.5,625.0 256.5,619.0 252.5,614.0 249.5,608.0 254.0,603.5 260.0,604.5 269.0,604.5 277.0,603.5 285.0,602.5 293.0,601.5 301.0,600.5 308.0,600.5 317.0,600.5 325.0,599.5 334.0,599.5 342.0,600.5 349.0,602.5 356.0,604.5 363.0,606.5 370.0,608.5 375.5,610.0 380.5,614.0 386.5,617.0 391.5,621.0 396.5,625.0 401.5,629.0 406.0,633.5 410.0,638.5 414.0,643.5 417.5,649.0 421.5,654.0 424.5,660.0 427.5,666.0 431.0,671.5 427.5,676.0 422.0,673.5 416.5,670.0 410.5,667.0 405.0,663.5 398.5,661.0 392.5,658.0 386.0,655.5 379.0,653.5 373.0,650.5 366.0,648.5 359.0,646.5 351.5,645.0 344.0,643.5 348.0,645.5 354.0,648.5 361.0,650.5 367.5,653.0 374.0,655.5 380.0,658.5 386.5,661.0 392.5,664.0 399.0,666.5 404.5,669.0 409.0,672.5 415.0,675.5 420.0,679.5 422.5,684.0 418.0,688.5 410.0,689.5 402.5,691.0 395.0,692.5 388.0,694.5 380.0,695.5",
  "782.0,673.5 774.0,673.5 766.0,673.5 758.0,673.5 751.0,672.5 745.0,670.5 738.0,669.5 733.0,666.5 727.5,664.0 722.5,661.0 717.5,658.0 713.0,654.5 709.0,650.5 704.5,647.0 700.5,643.0 697.0,638.5 693.5,634.0 690.0,629.5 686.0,625.5 689.0,621.5 696.0,620.5 704.0,620.5 710.0,622.5 717.0,623.5 724.0,624.5 731.0,625.5 738.5,626.0 745.0,627.5 751.0,629.5 757.5,631.0 764.0,632.5 769.5,634.0 764.0,631.5 759.0,628.5 753.0,626.5 747.0,624.5 741.0,622.5 735.0,620.5 728.0,619.5 721.0,618.5 714.0,617.5 707.0,616.5 699.0,616.5 694.0,613.5 695.0,609.5 699.5,606.0 705.0,603.5 710.0,600.5 715.5,598.0 722.0,596.5 727.5,594.0 734.0,592.5 742.0,592.5 750.0,592.5 757.0,593.5 762.0,594.5 768.0,596.5 774.0,598.5 780.0,600.5 785.0,603.5 791.0,605.5 795.0,609.5 800.0,612.5 805.0,615.5 809.5,619.0 814.5,622.0 819.5,625.0 824.5,628.0 829.0,631.5 834.5,634.0 840.0,636.5 844.5,640.0 844.5,644.0 840.5,648.0 836.0,651.5 830.5,654.0 826.0,657.5 820.5,660.0 815.5,663.0 809.5,665.0 804.0,667.5 798.0,669.5 791.5,671.0 785.0,672.5",
  "565.0,646.5 560.5,643.0 561.0,637.5 563.0,631.5 565.5,626.0 567.5,620.0 570.0,614.5 572.5,609.0 575.0,603.5 577.5,598.0 580.5,593.0 583.0,587.5 585.5,582.0 588.5,577.0 591.0,571.5 592.5,568.0 589.0,572.5 585.5,577.0 582.5,582.0 579.5,587.0 576.5,592.0 573.5,597.0 570.5,602.0 568.0,607.5 565.5,613.0 563.0,618.5 560.5,624.0 558.0,629.5 554.5,634.0 550.5,635.0 547.5,630.0 547.5,622.0 547.0,615.5 547.5,608.0 548.0,600.5 548.5,593.0 550.5,587.0 552.5,581.0 554.5,575.0 557.0,569.5 559.5,564.0 562.5,559.0 565.5,554.0 569.0,549.5 572.5,545.0 576.0,540.5 580.0,536.5 584.0,532.5 588.5,529.0 592.5,525.0 597.0,521.5 602.0,518.5 606.5,515.0 611.5,512.0 615.5,508.0 620.0,504.5 625.0,503.5 629.5,505.0 631.5,511.0 631.5,519.0 631.5,527.0 630.5,534.0 630.5,542.0 629.5,549.0 628.0,555.5 626.5,562.0 625.5,569.0 622.5,574.0 620.5,580.0 618.5,586.0 616.0,591.5 613.0,596.5 610.0,601.5 607.0,606.5 603.5,611.0 600.0,615.5 596.0,619.5 592.0,623.5 588.0,627.5 584.0,631.5 579.5,635.0 575.0,638.5 570.0,641.5 566.0,645.5",
  "874.0,523.5 868.0,523.5 862.0,523.5 856.0,523.5 850.0,523.5 845.0,522.5 840.0,521.5 835.5,520.0 831.0,518.5 826.0,517.5 821.5,516.0 818.5,513.0 819.5,510.0 823.0,507.5 827.0,505.5 830.5,505.0 835.0,503.5 840.0,502.5 845.0,501.5 849.0,499.5 854.0,498.5 859.0,497.5 863.5,496.0 868.0,494.5 868.0,493.5 863.0,494.5 857.0,494.5 852.0,495.5 847.0,496.5 842.0,497.5 837.0,498.5 832.0,499.5 827.5,501.0 823.0,502.5 818.5,504.0 814.5,503.0 811.5,500.0 814.5,497.0 817.0,493.5 820.0,490.5 823.5,488.0 827.0,485.5 830.0,482.5 833.5,480.0 837.0,477.5 841.0,475.5 845.0,473.5 849.0,471.5 854.0,470.5 858.0,468.5 863.0,467.5 868.0,466.5 874.0,466.5 880.0,466.5 886.0,466.5 891.0,467.5 896.0,468.5 901.5,469.0 906.0,470.5 911.5,471.0 916.0,472.5 921.0,473.5 925.0,475.5 930.0,476.5 934.5,477.0 938.0,478.5 941.0,481.5 941.0,484.5 938.0,487.5 935.0,490.5 932.0,493.5 929.0,496.5 925.5,499.0 922.0,501.5 919.0,504.5 915.5,507.0 912.0,509.5 908.0,511.5 904.0,513.5 900.0,515.5 896.0,517.5 891.5,519.0 887.0,520.5 882.0,521.5 877.0,522.5",
  "415.0,536.5 404.5,534.0 393.5,532.0 383.0,529.5 372.0,527.5 361.0,525.5 351.0,522.5 342.0,518.5 333.0,514.5 324.5,510.0 316.0,505.5 309.0,499.5 302.0,493.5 295.0,487.5 288.5,481.0 282.5,474.0 277.0,466.5 272.0,458.5 266.5,451.0 262.5,442.0 258.5,433.0 254.5,424.0 250.5,415.0 247.5,405.0 244.5,395.0 242.5,384.0 242.0,374.5 250.0,373.5 259.0,377.5 268.0,381.5 277.0,385.5 287.0,388.5 297.0,391.5 307.0,394.5 317.0,397.5 327.0,400.5 336.5,404.0 345.5,408.0 354.0,412.5 361.5,416.0 369.0,421.5 376.0,425.5 382.0,432.5 388.5,439.0 395.0,445.5 400.5,453.0 405.5,461.0 410.5,469.0 414.5,478.0 418.5,487.0 421.5,497.0 424.5,507.0 427.0,517.5 422.5,524.0 416.0,517.5 410.0,510.5 403.5,504.0 397.0,497.5 390.5,491.0 383.5,485.0 376.5,479.0 369.0,473.5 361.5,468.0 353.5,463.0 345.5,458.0 337.0,453.5 328.5,450.0 336.0,455.5 344.0,460.5 351.0,466.5 359.0,471.5 366.0,477.5 373.0,483.5 379.0,488.5 385.5,495.0 392.0,501.5 398.5,508.0 405.0,514.5 411.0,519.5 415.0,526.5 418.0,533.5",
  "738.0,503.5 734.0,499.5 735.0,495.5 738.0,490.5 740.5,485.0 743.5,480.0 746.0,474.5 748.5,469.0 751.0,463.5 753.5,458.0 756.5,453.0 759.0,447.5 761.5,442.0 764.5,437.0 767.0,431.5 769.5,426.0 770.5,422.0 767.5,427.0 764.0,431.5 761.0,436.5 758.0,441.5 755.5,447.0 752.5,452.0 749.5,457.0 746.5,462.0 744.0,467.5 741.5,473.0 738.5,478.0 735.5,483.0 733.0,488.5 730.5,494.0 726.5,498.0 722.5,495.0 721.5,488.0 721.5,480.0 721.5,472.0 721.5,464.0 723.0,457.5 724.0,450.5 725.5,444.0 727.5,438.0 729.5,432.0 732.0,426.5 734.5,421.0 737.5,416.0 740.5,411.0 744.0,406.5 747.0,401.5 751.0,397.5 754.5,393.0 759.0,389.5 763.0,385.5 767.0,381.5 771.5,378.0 776.5,375.0 781.0,371.5 786.0,368.5 791.0,365.5 795.5,362.0 800.0,358.5 805.0,357.5 810.0,358.5 812.5,364.0 812.5,372.0 811.5,379.0 810.5,386.0 809.5,393.0 808.5,400.0 807.5,407.0 806.0,413.5 804.5,420.0 802.5,426.0 800.5,432.0 798.0,437.5 795.5,443.0 793.5,449.0 790.0,453.5 787.0,458.5 784.0,463.5 780.5,468.0 776.5,472.0 773.0,476.5 769.0,480.5 765.0,484.5 760.5,488.0 756.0,491.5 751.5,495.0 746.5,498.0 741.5,501.0",
  "582.0,453.5 577.5,447.0 582.0,438.5 586.5,430.0 591.5,422.0 596.5,414.0 601.0,405.5 605.5,397.0 611.0,389.5 616.0,381.5 621.5,374.0 626.5,366.0 632.0,358.5 637.5,351.0 643.5,344.0 649.5,337.0 655.5,330.0 659.5,324.0 652.5,330.0 645.5,336.0 639.0,342.5 633.0,349.5 627.5,357.0 621.5,364.0 616.0,371.5 610.5,379.0 605.5,387.0 600.5,395.0 595.5,403.0 590.5,411.0 585.5,419.0 581.0,427.5 575.5,435.0 569.5,431.0 570.5,419.0 572.5,408.0 574.5,397.0 577.5,387.0 580.5,377.0 584.0,367.5 588.0,358.5 592.5,350.0 597.5,342.0 602.5,334.0 608.0,326.5 614.0,319.5 620.5,313.0 627.0,306.5 634.0,300.5 641.0,294.5 648.5,289.0 656.0,283.5 664.0,278.5 672.0,273.5 681.0,269.5 689.0,264.5 697.5,260.0 706.5,257.0 710.5,266.0 709.5,278.0 707.5,289.0 705.5,300.0 703.5,311.0 700.5,321.0 697.5,331.0 694.5,341.0 691.0,350.5 687.0,359.5 682.5,368.0 678.0,376.5 673.0,384.5 667.5,392.0 662.0,399.5 655.5,406.0 649.5,413.0 642.5,419.0 635.5,425.0 628.0,430.5 620.0,435.5 611.5,440.0 602.5,444.0 593.5,448.0 584.5,452.0",
  "546.0,310.5 541.5,306.0 544.5,300.0 548.0,294.5 552.0,289.5 555.5,284.0 559.0,278.5 563.0,273.5 567.0,268.5 571.0,263.5 575.5,259.0 579.5,254.0 583.5,249.0 588.0,244.5 592.5,240.0 597.0,235.5 600.0,230.5 595.0,234.5 589.5,238.0 585.0,242.5 580.5,247.0 575.5,251.0 571.0,255.5 567.0,260.5 562.5,265.0 558.5,270.0 554.5,275.0 551.0,280.5 547.0,285.5 543.5,291.0 540.0,296.5 535.5,300.0 531.5,295.0 533.0,287.5 534.5,280.0 536.5,273.0 539.0,266.5 541.5,260.0 544.5,254.0 547.5,248.0 551.0,242.5 554.5,237.0 558.5,232.0 563.0,227.5 567.0,222.5 571.5,218.0 576.0,213.5 581.5,210.0 586.0,205.5 591.5,202.0 597.0,198.5 602.5,195.0 608.5,192.0 614.0,188.5 619.5,185.0 625.0,183.5 632.0,181.5 638.0,178.5 645.0,176.5 650.0,172.5 654.5,177.0 653.0,184.5 651.0,191.5 649.0,198.5 647.0,205.5 644.5,212.0 642.0,218.5 639.5,225.0 636.5,231.0 633.5,237.0 630.0,242.5 626.5,248.0 623.0,253.5 619.0,258.5 615.0,263.5 610.5,268.0 606.0,272.5 601.5,277.0 597.0,281.5 592.0,285.5 586.5,289.0 581.0,292.5 575.5,296.0 569.5,299.0 563.5,302.0 558.0,305.5 551.0,307.5",
  "452.0,337.5 445.0,332.5 438.5,327.0 431.5,322.0 425.0,316.5 419.0,310.5 412.5,305.0 406.5,299.0 401.0,292.5 395.5,286.0 390.5,279.0 385.5,272.0 381.5,264.0 377.5,256.0 374.0,247.5 370.5,239.0 367.5,230.0 365.5,220.0 363.5,210.0 362.5,199.0 361.5,188.0 360.5,177.0 360.5,165.0 361.5,154.0 362.5,143.0 363.5,132.0 364.5,121.0 370.0,116.5 376.0,122.5 382.0,128.5 388.0,134.5 393.5,141.0 399.0,147.5 405.0,153.5 411.0,159.5 416.5,166.0 422.0,172.5 427.0,179.5 432.5,186.0 437.5,193.0 442.0,200.5 446.5,208.0 450.5,216.0 454.5,224.0 457.5,233.0 460.5,242.0 462.5,252.0 465.5,261.0 466.5,272.0 467.5,283.0 467.5,295.0 467.5,307.0 466.5,318.0 460.5,321.0 456.5,313.0 453.5,304.0 450.0,295.5 446.5,287.0 442.5,279.0 439.0,270.5 435.5,262.0 431.0,254.5 427.5,246.0 423.0,238.5 418.5,231.0 414.0,223.5 409.0,216.5 407.0,215.5 411.5,223.0 415.0,231.5 419.5,239.0 423.5,247.0 427.0,255.5 430.5,264.0 434.5,272.0 438.0,280.5 441.5,289.0 444.5,298.0 448.5,306.0 451.5,315.0 454.5,324.0 456.0,333.5",
  "519.0,211.5 514.5,206.0 516.5,198.0 518.0,189.5 520.5,182.0 522.5,174.0 524.5,166.0 526.5,158.0 529.5,151.0 531.5,143.0 534.0,135.5 536.5,128.0 539.0,120.5 541.5,113.0 545.0,106.5 547.5,99.0 544.0,104.5 540.5,111.0 537.0,117.5 534.0,124.5 531.0,131.5 528.0,138.5 525.5,146.0 522.5,153.0 520.0,160.5 517.5,168.0 515.5,176.0 513.5,184.0 511.5,192.0 509.5,200.0 504.5,204.0 500.5,198.0 499.0,189.5 497.5,181.0 496.5,172.0 496.5,162.0 496.5,152.0 497.5,143.0 498.5,134.0 500.5,126.0 502.5,118.0 505.0,110.5 508.0,103.5 511.0,96.5 514.5,90.0 518.5,84.0 522.5,78.0 527.0,72.5 531.5,67.0 536.0,61.5 541.0,56.5 545.5,51.0 550.5,46.0 556.0,41.5 561.5,37.0 566.5,32.0 572.0,29.5 576.5,35.0 577.5,44.0 578.5,53.0 579.5,62.0 580.5,71.0 580.5,81.0 580.5,91.0 580.5,101.0 579.5,110.0 577.5,118.0 576.0,126.5 573.5,134.0 570.5,141.0 567.5,148.0 564.5,155.0 561.0,161.5 557.0,167.5 553.5,174.0 548.5,179.0 544.0,184.5 539.5,190.0 534.5,195.0 529.5,200.0 525.0,205.5 520.0,210.5",
];

// ── Voice input (2026-09-14) ───────────────────────────────────
// Real Dasta-designed mic artwork (find-my-drink_embed3.html's
// MIC_ICON_URL) -- loaded remotely, same pattern REWARDS_CUP_IMAGE_URL
// above already uses, not a generic vector-icon substitute (per PC's
// explicit instruction: this control is custom brand artwork, not a
// placeholder that needed a proper icon).
const MIC_ICON_URL = 'https://cdn.prod.website-files.com/69dece9688dac5181962f293/69fd50923135ee461462571f_Dasta%20Microphone%20Clear.png';
// Base tab bar dimensions -- named constants (2026-09-19) rather than
// reading them back off S.tabBar, since MainTabs needs to add the
// Android nav-bar inset on top of these same base values.
const TAB_BAR_HEIGHT         = 66;
const TAB_BAR_PADDING_BOTTOM = 18;
// Same 9 languages, codes, and order as find-my-drink_embed2.html's
// LANGUAGES array. Flags rendered as emoji here rather than fetching
// flagcdn.com PNGs per row (web's approach) -- avoids a new external
// image dependency for a static, always-available glyph; this is
// identifying content for a language picker, not a UI-control icon, so
// it's unrelated to the emoji-to-vector-icon instruction from the
// typography/icon-swap round.
// Native self-names (2026-09-15, PC's ask #2 -- "similar to Hindi" applied
// to the rest of the list) -- more recognizable to an actual speaker of
// each language scanning the picker than the English name would be. Every
// one of these now has full STRINGS display-copy localization behind it
// (see STRINGS below), matching Hindi's own earlier treatment exactly.
const VOICE_LANGUAGES = [
  { code: 'en', label: 'English',   flag: '🇺🇸' },
  { code: 'es', label: 'Español',   flag: '🇪🇸' },
  { code: 'fr', label: 'Français',  flag: '🇫🇷' },
  { code: 'it', label: 'Italiano',  flag: '🇮🇹' },
  { code: 'pt', label: 'Português', flag: '🇧🇷' },
  { code: 'de', label: 'Deutsch',   flag: '🇩🇪' },
  { code: 'hi', label: 'हिन्दी',      flag: '🇮🇳' },
  { code: 'ar', label: 'العربية',    flag: '🇸🇦' },
  { code: 'zh', label: '中文',       flag: '🇨🇳' },
];
const VOICE_LANG_KEY = 'sipsense_lang'; // same localStorage key name web uses, for conceptual parity

async function getVoiceLanguage() {
  try {
    const saved = await SecureStore.getItemAsync(VOICE_LANG_KEY);
    return VOICE_LANGUAGES.find(l => l.code === saved) ? saved : 'en';
  } catch { return 'en'; }
}
async function setVoiceLanguage(code) {
  try { await SecureStore.setItemAsync(VOICE_LANG_KEY, code); } catch {}
}

// ── Order screen display-copy localization (2026-09-15, PC's ask) ──
// Front-end display ONLY -- see LanguageProvider below and its own
// comment for the full "backend always stays English" contract. A
// plain object keyed by language code, not an i18n framework, per the
// single-file-App.js convention: adding a third language later means
// adding one more top-level entry here, nothing about the mechanism
// changes. Only 'en' and 'hi' are populated for now (PC's explicit
// scope: "English + Hindi now"); useLanguage()'s t() falls back to the
// English string for any other selected language/missing key, so the
// existing 9-language voice-hint picker (VOICE_LANGUAGES above, kept
// as-is -- PC hasn't tested the other 7 yet, cutting them wasn't asked
// for) never renders broken/missing copy for a language without a
// dictionary entry.
// Hindi strings were AI-drafted, then reviewed and approved by PC for
// first launch (2026-09-16) -- food/drink terms (chai/matcha/espresso)
// stay transliterated below, matching how those words are actually used
// in spoken Hindi.
const STRINGS = {
  en: {
    greetingGuest: 'Hey there!',
    greeting: (name) => `Hey ${name}!`,
    moodPrompt: 'What are you in the mood for?',
    placeholder: 'e.g. something warm, spiced and not too sweet...',
    refineDivider: '— or tap to refine —',
    sectionBase: 'Base', sectionFlavor: 'Flavor', sectionEnergy: 'Energy',
    sectionTempSweetness: 'Temp & Sweetness', sectionTexture: 'Texture',
    chip_Chai: 'Chai', chip_Espresso: 'Espresso', chip_Matcha: 'Matcha', chip_Tea: 'Tea', chip_Decaf: 'Decaf',
    chip_Floral: 'Floral', chip_Fruity: 'Fruity', chip_Spiced: 'Spiced',
    chip_Focused: 'Focused', chip_Energizing: 'Energizing', chip_Relaxing: 'Relaxing',
    chip_Hot: 'Hot', chip_Iced: 'Iced', chip_Sweetened: 'Sweetened', chip_Unsweetened: 'Unsweetened',
    chip_Refreshing: 'Refreshing', chip_Creamy: 'Creamy',
    findMyDrink: 'Craft My Drink',
    clearAll: 'Clear',
    craftingYourDrink: 'Crafting your drink...',
    listening: 'Listening...',
    processingVoice: 'SipSense is working on it... ✨',
    hotOrIcedTitle: 'Hot or Iced?', hotOrIcedMsg: 'One quick thing before we craft your sip —',
    hotLabel: '🔥 Hot', icedLabel: '🧊 Iced',
    sweetOrUnsweetTitle: 'Sweetened or Unsweetened?', sweetOrUnsweetMsg: 'One more quick thing before we craft your sip —',
    sweetenedLabel: '🍬 Sweetened', unsweetenedLabel: '🚫 Unsweetened',
    voiceLanguageTitle: 'Voice language', voiceLanguageMsg: "Choose the language you'll speak your order in.",
  },
  // AI-drafted, reviewed and approved by PC for first launch (2026-09-16).
  hi: {
    greetingGuest: 'नमस्ते!',
    greeting: (name) => `नमस्ते ${name}!`,
    moodPrompt: 'आपका मन किस चीज़ के लिए है?',
    placeholder: 'जैसे, कुछ गरम, मसालेदार और ज़्यादा मीठा नहीं...',
    refineDivider: '— या टैप करके बदलें —',
    sectionBase: 'बेस', sectionFlavor: 'फ्लेवर', sectionEnergy: 'एनर्जी',
    sectionTempSweetness: 'तापमान और मिठास', sectionTexture: 'टेक्सचर',
    chip_Chai: 'चाय', chip_Espresso: 'एस्प्रेसो', chip_Matcha: 'माचा', chip_Tea: 'टी', chip_Decaf: 'डिकैफ़',
    chip_Floral: 'फ्लोरल', chip_Fruity: 'फ्रूटी', chip_Spiced: 'मसालेदार',
    chip_Focused: 'फोकस्ड', chip_Energizing: 'एनर्जाइज़िंग', chip_Relaxing: 'रिलैक्सिंग',
    chip_Hot: 'गरम', chip_Iced: 'ठंडा', chip_Sweetened: 'मीठा', chip_Unsweetened: 'बिना चीनी',
    chip_Refreshing: 'रिफ्रेशिंग', chip_Creamy: 'क्रीमी',
    findMyDrink: 'मेरा ड्रिंक बनाएं',
    clearAll: 'साफ़ करें',
    craftingYourDrink: 'आपका ड्रिंक बन रहा है...',
    listening: 'सुन रहे हैं...',
    processingVoice: 'SipSense काम कर रहा है... ✨',
    hotOrIcedTitle: 'गरम या ठंडा?', hotOrIcedMsg: 'ड्रिंक बनाने से पहले एक छोटी बात —',
    hotLabel: '🔥 गरम', icedLabel: '🧊 ठंडा',
    sweetOrUnsweetTitle: 'मीठा या बिना चीनी?', sweetOrUnsweetMsg: 'एक और छोटी बात —',
    sweetenedLabel: '🍬 मीठा', unsweetenedLabel: '🚫 बिना चीनी',
    voiceLanguageTitle: 'आवाज़ की भाषा', voiceLanguageMsg: 'वह भाषा चुनें जिसमें आप अपना ऑर्डर बोलेंगे।',
  },
  // AI-drafted, unreviewed -- see file comment above. Extended to the
  // rest of VOICE_LANGUAGES 2026-09-15 (PC's ask #2, "similar to Hindi").
  es: {
    greetingGuest: '¡Hola!',
    greeting: (name) => `¡Hola ${name}!`,
    moodPrompt: '¿Qué se te antoja?',
    placeholder: 'p. ej. algo cálido, especiado y no muy dulce...',
    refineDivider: '— o toca para ajustar —',
    sectionBase: 'Base', sectionFlavor: 'Sabor', sectionEnergy: 'Energía',
    sectionTempSweetness: 'Temperatura y Dulzura', sectionTexture: 'Textura',
    chip_Chai: 'Chai', chip_Espresso: 'Espresso', chip_Matcha: 'Matcha', chip_Tea: 'Té', chip_Decaf: 'Descafeinado',
    chip_Floral: 'Floral', chip_Fruity: 'Afrutado', chip_Spiced: 'Especiado',
    chip_Focused: 'Concentración', chip_Energizing: 'Energizante', chip_Relaxing: 'Relajante',
    chip_Hot: 'Caliente', chip_Iced: 'Frío', chip_Sweetened: 'Dulce', chip_Unsweetened: 'Sin Azúcar',
    chip_Refreshing: 'Refrescante', chip_Creamy: 'Cremoso',
    findMyDrink: 'Crea Mi Bebida',
    clearAll: 'Borrar',
    craftingYourDrink: 'Preparando tu bebida...',
    listening: 'Escuchando...',
    processingVoice: 'SipSense está trabajando en ello... ✨',
    hotOrIcedTitle: '¿Caliente o Frío?', hotOrIcedMsg: 'Una cosa rápida antes de preparar tu bebida —',
    hotLabel: '🔥 Caliente', icedLabel: '🧊 Frío',
    sweetOrUnsweetTitle: '¿Dulce o Sin Azúcar?', sweetOrUnsweetMsg: 'Una cosa más antes de preparar tu bebida —',
    sweetenedLabel: '🍬 Dulce', unsweetenedLabel: '🚫 Sin Azúcar',
    voiceLanguageTitle: 'Idioma de voz', voiceLanguageMsg: 'Elige el idioma en el que hablarás tu pedido.',
  },
  fr: {
    greetingGuest: 'Salut !',
    greeting: (name) => `Salut ${name} !`,
    moodPrompt: "Qu'avez-vous envie de boire ?",
    placeholder: 'par ex. quelque chose de chaud, épicé et pas trop sucré...',
    refineDivider: '— ou touchez pour affiner —',
    sectionBase: 'Base', sectionFlavor: 'Saveur', sectionEnergy: 'Énergie',
    sectionTempSweetness: 'Température et Douceur', sectionTexture: 'Texture',
    chip_Chai: 'Chaï', chip_Espresso: 'Espresso', chip_Matcha: 'Matcha', chip_Tea: 'Thé', chip_Decaf: 'Décaféiné',
    chip_Floral: 'Floral', chip_Fruity: 'Fruité', chip_Spiced: 'Épicé',
    chip_Focused: 'Concentration', chip_Energizing: 'Énergisant', chip_Relaxing: 'Relaxant',
    chip_Hot: 'Chaud', chip_Iced: 'Glacé', chip_Sweetened: 'Sucré', chip_Unsweetened: 'Sans Sucre',
    chip_Refreshing: 'Rafraîchissant', chip_Creamy: 'Crémeux',
    findMyDrink: 'Créer Ma Boisson',
    clearAll: 'Effacer',
    craftingYourDrink: 'Préparation de votre boisson...',
    listening: 'Écoute en cours...',
    processingVoice: 'SipSense y travaille... ✨',
    hotOrIcedTitle: 'Chaud ou Glacé ?', hotOrIcedMsg: 'Une petite chose avant de préparer votre boisson —',
    hotLabel: '🔥 Chaud', icedLabel: '🧊 Glacé',
    sweetOrUnsweetTitle: 'Sucré ou Sans Sucre ?', sweetOrUnsweetMsg: 'Encore une petite chose —',
    sweetenedLabel: '🍬 Sucré', unsweetenedLabel: '🚫 Sans Sucre',
    voiceLanguageTitle: 'Langue vocale', voiceLanguageMsg: 'Choisissez la langue dans laquelle vous parlerez votre commande.',
  },
  it: {
    greetingGuest: 'Ciao!',
    greeting: (name) => `Ciao ${name}!`,
    moodPrompt: 'Cosa ti va di bere?',
    placeholder: 'es. qualcosa di caldo, speziato e non troppo dolce...',
    refineDivider: '— o tocca per perfezionare —',
    sectionBase: 'Base', sectionFlavor: 'Sapore', sectionEnergy: 'Energia',
    sectionTempSweetness: 'Temperatura e Dolcezza', sectionTexture: 'Consistenza',
    chip_Chai: 'Chai', chip_Espresso: 'Espresso', chip_Matcha: 'Matcha', chip_Tea: 'Tè', chip_Decaf: 'Decaffeinato',
    chip_Floral: 'Floreale', chip_Fruity: 'Fruttato', chip_Spiced: 'Speziato',
    chip_Focused: 'Concentrazione', chip_Energizing: 'Energizzante', chip_Relaxing: 'Rilassante',
    chip_Hot: 'Caldo', chip_Iced: 'Freddo', chip_Sweetened: 'Dolce', chip_Unsweetened: 'Senza Zucchero',
    chip_Refreshing: 'Rinfrescante', chip_Creamy: 'Cremoso',
    findMyDrink: 'Crea la Mia Bevanda',
    clearAll: 'Cancella',
    craftingYourDrink: 'Preparazione della tua bevanda...',
    listening: 'In ascolto...',
    processingVoice: 'SipSense ci sta lavorando... ✨',
    hotOrIcedTitle: 'Caldo o Freddo?', hotOrIcedMsg: 'Una cosa veloce prima di preparare la tua bevanda —',
    hotLabel: '🔥 Caldo', icedLabel: '🧊 Freddo',
    sweetOrUnsweetTitle: 'Dolce o Senza Zucchero?', sweetOrUnsweetMsg: "Un'altra cosa veloce —",
    sweetenedLabel: '🍬 Dolce', unsweetenedLabel: '🚫 Senza Zucchero',
    voiceLanguageTitle: 'Lingua vocale', voiceLanguageMsg: 'Scegli la lingua in cui parlerai il tuo ordine.',
  },
  pt: {
    greetingGuest: 'Olá!',
    greeting: (name) => `Olá ${name}!`,
    moodPrompt: 'Do que você está com vontade?',
    placeholder: 'ex. algo quente, apimentado e não muito doce...',
    refineDivider: '— ou toque para ajustar —',
    sectionBase: 'Base', sectionFlavor: 'Sabor', sectionEnergy: 'Energia',
    sectionTempSweetness: 'Temperatura e Doçura', sectionTexture: 'Textura',
    chip_Chai: 'Chai', chip_Espresso: 'Espresso', chip_Matcha: 'Matcha', chip_Tea: 'Chá', chip_Decaf: 'Descafeinado',
    chip_Floral: 'Floral', chip_Fruity: 'Frutado', chip_Spiced: 'Apimentado',
    chip_Focused: 'Foco', chip_Energizing: 'Energizante', chip_Relaxing: 'Relaxante',
    chip_Hot: 'Quente', chip_Iced: 'Gelado', chip_Sweetened: 'Adoçado', chip_Unsweetened: 'Sem Açúcar',
    chip_Refreshing: 'Refrescante', chip_Creamy: 'Cremoso',
    findMyDrink: 'Criar Minha Bebida',
    clearAll: 'Limpar',
    craftingYourDrink: 'Preparando sua bebida...',
    listening: 'Ouvindo...',
    processingVoice: 'SipSense está trabalhando nisso... ✨',
    hotOrIcedTitle: 'Quente ou Gelado?', hotOrIcedMsg: 'Uma coisa rápida antes de prepararmos sua bebida —',
    hotLabel: '🔥 Quente', icedLabel: '🧊 Gelado',
    sweetOrUnsweetTitle: 'Adoçado ou Sem Açúcar?', sweetOrUnsweetMsg: 'Mais uma coisa rápida —',
    sweetenedLabel: '🍬 Adoçado', unsweetenedLabel: '🚫 Sem Açúcar',
    voiceLanguageTitle: 'Idioma de voz', voiceLanguageMsg: 'Escolha o idioma em que você vai falar seu pedido.',
  },
  de: {
    greetingGuest: 'Hallo!',
    greeting: (name) => `Hallo ${name}!`,
    moodPrompt: 'Worauf hast du Lust?',
    placeholder: 'z.B. etwas Warmes, Würziges und nicht zu Süßes...',
    refineDivider: '— oder tippen zum Anpassen —',
    sectionBase: 'Basis', sectionFlavor: 'Geschmack', sectionEnergy: 'Energie',
    sectionTempSweetness: 'Temperatur & Süße', sectionTexture: 'Textur',
    chip_Chai: 'Chai', chip_Espresso: 'Espresso', chip_Matcha: 'Matcha', chip_Tea: 'Tee', chip_Decaf: 'Koffeinfrei',
    chip_Floral: 'Blumig', chip_Fruity: 'Fruchtig', chip_Spiced: 'Würzig',
    chip_Focused: 'Fokussiert', chip_Energizing: 'Belebend', chip_Relaxing: 'Entspannend',
    chip_Hot: 'Heiß', chip_Iced: 'Eisgekühlt', chip_Sweetened: 'Gesüßt', chip_Unsweetened: 'Ungesüßt',
    chip_Refreshing: 'Erfrischend', chip_Creamy: 'Cremig',
    findMyDrink: 'Mein Getränk Kreieren',
    clearAll: 'Löschen',
    craftingYourDrink: 'Dein Getränk wird zubereitet...',
    listening: 'Hört zu...',
    processingVoice: 'SipSense arbeitet daran... ✨',
    hotOrIcedTitle: 'Heiß oder Eisgekühlt?', hotOrIcedMsg: 'Noch eine kurze Sache, bevor wir deinen Sip zubereiten —',
    hotLabel: '🔥 Heiß', icedLabel: '🧊 Eisgekühlt',
    sweetOrUnsweetTitle: 'Gesüßt oder Ungesüßt?', sweetOrUnsweetMsg: 'Noch eine kurze Sache —',
    sweetenedLabel: '🍬 Gesüßt', unsweetenedLabel: '🚫 Ungesüßt',
    voiceLanguageTitle: 'Sprachauswahl', voiceLanguageMsg: 'Wähle die Sprache, in der du deine Bestellung sprichst.',
  },
  ar: {
    greetingGuest: 'مرحبًا!',
    greeting: (name) => `مرحبًا ${name}!`,
    moodPrompt: 'ما الذي تشتهيه؟',
    placeholder: 'مثال: شيء دافئ وحار قليلاً وليس حلوًا جدًا...',
    refineDivider: '— أو اضغط للتعديل —',
    sectionBase: 'الأساس', sectionFlavor: 'النكهة', sectionEnergy: 'الطاقة',
    sectionTempSweetness: 'الحرارة والحلاوة', sectionTexture: 'القوام',
    chip_Chai: 'تشاي', chip_Espresso: 'إسبريسو', chip_Matcha: 'ماتشا', chip_Tea: 'شاي', chip_Decaf: 'بدون كافيين',
    chip_Floral: 'زهري', chip_Fruity: 'فاكهي', chip_Spiced: 'متبل',
    chip_Focused: 'تركيز', chip_Energizing: 'منشط', chip_Relaxing: 'مهدئ',
    chip_Hot: 'ساخن', chip_Iced: 'مثلج', chip_Sweetened: 'محلى', chip_Unsweetened: 'بدون سكر',
    chip_Refreshing: 'منعش', chip_Creamy: 'كريمي',
    findMyDrink: 'اصنع مشروبي',
    clearAll: 'مسح',
    craftingYourDrink: 'جارٍ تحضير مشروبك...',
    listening: 'يستمع...',
    processingVoice: 'SipSense يعمل على ذلك... ✨',
    hotOrIcedTitle: 'ساخن أم مثلج؟', hotOrIcedMsg: 'شيء سريع قبل أن نحضّر مشروبك —',
    hotLabel: '🔥 ساخن', icedLabel: '🧊 مثلج',
    sweetOrUnsweetTitle: 'محلى أم بدون سكر؟', sweetOrUnsweetMsg: 'شيء آخر سريع —',
    sweetenedLabel: '🍬 محلى', unsweetenedLabel: '🚫 بدون سكر',
    voiceLanguageTitle: 'لغة الصوت', voiceLanguageMsg: 'اختر اللغة التي ستتحدث بها طلبك.',
  },
  zh: {
    greetingGuest: '你好！',
    greeting: (name) => `你好 ${name}！`,
    moodPrompt: '你想喝点什么？',
    placeholder: '例如：温暖、香辛、不要太甜...',
    refineDivider: '— 或点击调整 —',
    sectionBase: '基底', sectionFlavor: '风味', sectionEnergy: '能量',
    sectionTempSweetness: '温度与甜度', sectionTexture: '口感',
    chip_Chai: '印度奶茶', chip_Espresso: '浓缩咖啡', chip_Matcha: '抹茶', chip_Tea: '茶', chip_Decaf: '无咖啡因',
    chip_Floral: '花香', chip_Fruity: '果味', chip_Spiced: '香辛',
    chip_Focused: '专注', chip_Energizing: '提神', chip_Relaxing: '放松',
    chip_Hot: '热', chip_Iced: '冰', chip_Sweetened: '加糖', chip_Unsweetened: '无糖',
    chip_Refreshing: '清爽', chip_Creamy: '奶香',
    findMyDrink: '调制我的饮品',
    clearAll: '清除',
    craftingYourDrink: '正在制作您的饮品...',
    listening: '正在聆听...',
    processingVoice: 'SipSense 正在处理... ✨',
    hotOrIcedTitle: '热饮还是冰饮？', hotOrIcedMsg: '在我们制作您的饮品之前，还有一件小事 —',
    hotLabel: '🔥 热', icedLabel: '🧊 冰',
    sweetOrUnsweetTitle: '加糖还是无糖？', sweetOrUnsweetMsg: '还有一件小事 —',
    sweetenedLabel: '🍬 加糖', unsweetenedLabel: '🚫 无糖',
    voiceLanguageTitle: '语音语言', voiceLanguageMsg: '选择您将用来说出订单的语言。',
  },
};

// On-device speech recognition locales for the two languages that get
// PATH A (see OrderScreen's startOnDeviceSTT) -- the other 7 VOICE_
// LANGUAGES entries are untouched and keep going through the Whisper
// server path (PATH B) exactly as before.
const STT_LOCALES = { en: 'en-US', hi: 'hi-IN' };

// ── Display-language context (2026-09-15) ───────────────────────
// Front-end display ONLY, permanently -- PC's explicit, non-negotiable
// architecture call: "The backend API calls, the request payload
// values, and the generated drink name/description response all stay
// English, unchanged, exactly as they work today." No café staff can
// act on a non-English order, so /generate-custom-drink and everything
// downstream of it never sees a language parameter and never will.
// Lifted out of OrderScreen into its own Context (mirrors CartContext's
// shape/placement above) because the language pill itself moved out of
// the Order-screen-specific area into the persistent GlobalAccountHeader
// (PC's ask) -- both need the same selected-language value, and only
// one of them (OrderScreen) needs the translator function.
const LanguageContext = createContext(null);
function useLanguage() {
  return useContext(LanguageContext);
}
function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState('en');
  useEffect(() => { getVoiceLanguage().then(setLanguageState); }, []);
  const setLanguage = async (code) => {
    setLanguageState(code);
    await setVoiceLanguage(code);
  };
  const t = useCallback((key) => {
    const dict = STRINGS[language] || STRINGS.en;
    return dict[key] ?? STRINGS.en[key] ?? key;
  }, [language]);
  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

// Transcribe recorded audio via the exact same POST /voice/transcribe
// pipeline web's mic button uses (faster-whisper + Ollama translation) --
// no backend changes, no on-device speech-recognition package. Neither
// credentials nor the X-Requested-With CSRF header are sent, matching
// web's own fetch call exactly -- this endpoint has no require_csrf_header
// dependency and works for guests (customer_id is optional form data).
async function transcribeVoice(uri, langCode, customerId) {
  const formData = new FormData();
  formData.append('audio', { uri, name: 'voice_input.m4a', type: 'audio/mp4' });
  formData.append('hint_language', langCode);
  if (customerId) formData.append('customer_id', String(customerId));
  const res = await fetch(`${API_BASE_URL}/voice/transcribe`, { method: 'POST', body: formData });
  let data = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, data };
}

// Translate TYPED (not spoken) craving text to English before it reaches
// /generate-custom-drink (2026-09-15, PC's ask #2: "typed text should
// show as is on the screen but translate to english before it goes to
// backend"). Reuses the new POST /voice/translate-text endpoint, which
// itself reuses the exact same Ollama/mistral call the voice pipeline's
// own non-English path already makes -- see that endpoint's own comment.
// Not routed through apiFetch since this endpoint takes no cookies/CSRF
// (public, matching /voice/transcribe's own accessibility for guests).
// Falls back to the original text on any failure -- a customer should
// never be blocked from generating a drink just because translation
// hiccuped; worst case the backend sees the original-language text,
// same as it always has.
async function translateTextForBackend(text, langCode) {
  if (!text || langCode === 'en') return text;
  try {
    const res = await fetch(`${API_BASE_URL}/voice/translate-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, hint_language: langCode }),
    });
    const data = await res.json();
    return (res.ok && data?.success && data.translated_text) ? data.translated_text : text;
  } catch {
    return text;
  }
}

// ── NEW: Permission libraries ─────────────────────────────────
// Install: npx expo install expo-notifications expo-location
// iOS   app.json > expo > ios > infoPlist:
//          "NSLocationWhenInUseUsageDescription": "Used to find the nearest Dasta café.",
//          "UIBackgroundModes": ["remote-notification"]
// Android app.json > expo > android > permissions:
//          ["android.permission.ACCESS_FINE_LOCATION",
//           "android.permission.ACCESS_COARSE_LOCATION",
//           "android.permission.POST_NOTIFICATIONS"]
import * as Notifications from 'expo-notifications';
import * as Location      from 'expo-location';

// Push Notifications (2026-09-24) -- matches app.json/eas.json's expo.extra.eas.projectId.
const EXPO_PUSH_PROJECT_ID = '84b432c9-cb11-44a1-a96d-a906ef6f75c7';

// Push Notifications (2026-10-01) -- must be set at module scope, not
// inside requestPushPermissionAndRegister(). That function only runs
// from the onboarding Allow button and the Settings toggle -- never on
// a plain cold launch for a returning user who already granted
// permission (see reregisterPushTokenIfEnabled(), which runs on every
// launch but never installs this handler). Setting it here means it's
// always installed for the JS session, regardless of which screen (if
// any) the user visits. Safe to call unconditionally -- it only
// configures *how* a notification is handled if/when one arrives; it
// doesn't request permission or do anything if the user never grants it.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList:   true,
    shouldPlaySound:  true,
    shouldSetBadge:   false,
  }),
});

// ── SipSense banner image ─────────────────────────────────────
const SipSenseBanner = require('./assets/sipsense-banner.jpg');

// ── Featured food & drink images ─────────────────────────────
const FeaturedItems = [
  { src: require('./assets/masala_chai.jpg'),         label: 'Masala Chai',          tag: 'SIGNATURE SIP'  },
  { src: require('./assets/coffee_latte.jpg'),         label: 'Craft Latte',           tag: 'COFFEE BAR'     },
  { src: require('./assets/bagels_assorted.jpg'),      label: 'Fresh Bagels',          tag: 'FROM THE OVEN'  },
  { src: require('./assets/bagel_cream_cheese.jpg'),   label: 'Bagel & Cream Cheese',  tag: 'CLASSIC FAV'    },
  { src: require('./assets/panini.jpg'),               label: 'Signature Panini',      tag: 'HOUSE SPECIAL'  },
];

// ── Brand Colors ─────────────────────────────────────────────
const C = {
  ivory:    '#F6F1E7',
  charcoal: '#1F1F1F',
  saffron:  '#E26A2C',
  espresso: '#2A1E1A',
  gold:     '#C9A86A',
  white:    '#FFFFFF',
  muted:    '#888880',   // icons / input placeholders only -- NOT body text (2026-09-28)
  // Body text is black (2026-09-28, PC: customer complaints that grey text
  // was too light to read). Grey text on light backgrounds was replaced
  // app-wide; grey text on dark (espresso) screens went to ivory instead.
  black:    '#000000',
  border:   '#E8E2D6',
};

const API_BASE_URL = 'https://api.test.dastacafe.com';
const Stack = createNativeStackNavigator();

// ── Wide-screen breakpoint (2026-09-17) ───────────────────────────
// Shared by MyCircleAccountScreen's wallet panels and OrderScreen's
// SipSense results cards -- both replace a swipeable pager with a fixed
// side-by-side row at/above this width via useWindowDimensions(), which
// re-renders live as an Android foldable unfolds/folds or the device
// rotates (no native module, no "is this device foldable" special-
// casing). 700dp: comfortably covers an unfolded small Android foldable
// (Galaxy Fold/Pixel Fold land ~700-720dp unfolded) and any Android/iPad
// tablet in portrait, while a normal phone (~380-430dp) stays well below
// it and keeps today's pager unchanged. Chosen from known device widths
// (Galaxy Fold/Pixel Fold unfolded ~700-720dp; 10" tablets ~800dp+) --
// still needs verification against a real/emulated unfolded foldable and
// an iPad/Android tablet per this doc's own checklist before shipping.
const WIDE_BREAKPOINT = 700;

// ── Circular nav-element alignment (2026-09-17) ────────────────────
// General rule, PC's ask: a circular button on a screen edge should
// share its horizontal center with another circular element directly
// above/below it on the same edge (most commonly the persistent header's
// profile icon) -- two circles at different offsets on the same edge
// reads as unpolished. Derived from GlobalAccountHeader's own real
// geometry (S.globalAccountHeader's right:18 + S.profileBtn's width:44),
// not eyeballed: the profile icon's horizontal center sits this many px
// in from the screen's right edge. Any other circular edge button that
// needs to line up under/over it computes its own `right` inset as
// PROFILE_ICON_CENTER_INSET - (thatButton'sWidth / 2).
const PROFILE_ICON_CENTER_INSET = 18 + 44 / 2; // = 40

// ── API request helper (2026-09-11) ───────────────────────────
// Centralizes two things every state-changing call needs against the
// current backend: `credentials: 'include'` so the dasta_session cookie
// Cognito auth sets travels with the request (iOS's native cookie jar
// persists it across app launches automatically, same as a browser),
// and an `X-Requested-With: XMLHttpRequest` header, required backend-
// side as CSRF defense-in-depth since 2026-07-24 (require_csrf_header
// in auth_router.py) — added after this app's original fetch() calls
// were written, which is why they'd been silently 403ing. Mirrors
// SipSense_webflow's fetch contract (see head-code.html's _dpwFetch)
// exactly.
//
// Timeout + never-throws (2026-09-15, PC's ask: guest browsing must not
// break when the backend/DB/GPU are down for real maintenance). Verified
// live via curl before assuming anything: api.dastacafe.com currently
// fails with a silent TCP connection timeout (10s+ and climbing, not a
// fast refusal/DNS error) -- bare fetch() has no built-in timeout of its
// own, so every screen that calls this was hanging on whatever React
// Native's underlying networking stack's own default timeout is (likely
// 60s+), not failing visibly. Mirrors dastacafe.com's own explicit
// design philosophy for this exact scenario (head-code.html's
// checkSession(), verified live per PC's prompt): "a customer seeing
// [a degraded state] during a network hiccup is a much better failure
// mode than a page that hard-crashes" -- so a network failure/timeout
// here now resolves to a clean `{ok:false}` like any other error
// response, instead of throwing/hanging, matching what every existing
// call site's `if (ok)` check already handles. The default 8s timeout
// is skipped when the caller supplies its own `signal` -- only
// /generate-custom-drink's Stop-crafting button does that, and that
// flow already has its own manual abort + legitimately-long normal
// duration, so a short generic timeout would be wrong there.
async function apiFetch(path, { method = 'GET', body, signal, timeoutMs = 8000 } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-Requested-With'] = 'XMLHttpRequest';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let timeoutId;
  let effectiveSignal = signal;
  if (!signal) {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    effectiveSignal = controller.signal;
  }
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: effectiveSignal,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null, networkError: true };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ── Cart & Gift (2026-09-13) ─────────────────────────────────────
// Mirrors head-code.html's initNavCart exactly: two cheap counts (cart,
// gift-draft) drive two header icons next to the profile icon, ordered
// by whichever was most recently added to (PC's ask: "if I first add to
// gift, gift logo will appear left of my account logo then if I add an
// item to order then cart logo will appear left of gift logo"). One
// Context so every screen's header reads the same live counts instead of
// each screen re-fetching/re-deriving its own copy.
const CartContext = createContext(null);
function useCart() {
  return useContext(CartContext);
}

function CartProvider({ customer, children }) {
  const [cartCount, setCartCount] = useState(0);
  const [giftCount, setGiftCount] = useState(0);
  // Ordering rule: most-recently-populated icon sits leftmost (closest to
  // the group's edge, right next to the profile icon on its other side).
  // null = neither has ever been populated this session -> only render
  // icons that currently have a count > 0 anyway, so ordering is moot.
  const [lastAdded, setLastAdded] = useState(null); // 'cart' | 'gift' | null

  const refreshCartCount = useCallback(async () => {
    if (!customer?.id) { setCartCount(0); return; }
    const { ok, data } = await apiFetch('/checkout/cart/count');
    if (ok && data?.success) setCartCount(data.count || 0);
  }, [customer?.id]);

  const refreshGiftCount = useCallback(async () => {
    if (!customer?.id) { setGiftCount(0); return; }
    const { ok, data } = await apiFetch('/gift-orders/draft');
    if (ok && data?.success) {
      setGiftCount((data.items || []).reduce((sum, it) => sum + (it.quantity || 1), 0));
    } else {
      setGiftCount(0); // 404 = no draft in progress, same as web treating "no draft" as empty
    }
  }, [customer?.id]);

  const refreshCounts = useCallback(() => {
    refreshCartCount();
    refreshGiftCount();
  }, [refreshCartCount, refreshGiftCount]);

  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  // Add-to-order — POST /checkout/cart/items, the exact endpoint web's
  // own Order buttons and Favorites' Reorder button call (checkout_
  // router.py's add_cart_item docstring). Every caller (Menu item modal,
  // Build & Order, Circle/Menu Sip) shares this one function.
  const addToCart = useCallback(async (payload) => {
    const { ok, data } = await apiFetch('/checkout/cart/items', { method: 'POST', body: payload });
    if (ok && data?.success) {
      setLastAdded('cart');
      await refreshCartCount();
    }
    return { ok, data };
  }, [refreshCartCount]);

  // Add-to-gift — POST /gift-orders/items, gift_orders_router.py's own
  // draft-item endpoint (auto-creates the draft gift order on first add).
  const addToGift = useCallback(async (payload) => {
    const { ok, data } = await apiFetch('/gift-orders/items', { method: 'POST', body: payload });
    if (ok && data?.success) {
      setLastAdded('gift');
      await refreshGiftCount();
    }
    return { ok, data };
  }, [refreshGiftCount]);

  // Leftmost-most-recent ordering, e.g. [gift, account] then
  // [cart, gift, account] once cart is added too (PC's exact example).
  const iconOrder = (() => {
    const present = [];
    if (cartCount > 0) present.push('cart');
    if (giftCount > 0) present.push('gift');
    if (lastAdded && present.includes(lastAdded)) {
      present.sort((a, b) => (a === lastAdded ? -1 : b === lastAdded ? 1 : 0));
    }
    return present; // rendered left-to-right, immediately followed by the profile icon
  })();

  return (
    <CartContext.Provider value={{ cartCount, giftCount, iconOrder, refreshCounts, addToCart, addToGift }}>
      {children}
    </CartContext.Provider>
  );
}

// ── Group order in progress (My Circles, 2026-09-27) ─────────────
// Starting or joining a Circle group order means "pick and pay for your
// own item through the normal flow" -- Menu/Order add to the ordinary cart,
// and Checkout pays for it. This context is the only thing that's
// different: while set, Cart and Checkout show a banner, Checkout locks
// pickup to the group's time and sends group_order_id with /checkout/
// confirm (which re-checks the join cutoff server-side). Held in MainTabs;
// cleared on successful payment or when the customer backs out.
// Shape: { group_order_id, circle_display_name, pickup_time, join_cutoff_at, is_starter, is_new }
// is_new = this checkout CREATES the group order (the starter's very first
// item, while it's still 'pending'). It alone drives "Starting" vs
// "Updating" wording -- never is_starter, which is also true when the
// starter comes back to add a second item (instructions §3 banner rule).
const GroupOrderContext = createContext({ groupOrder: null, setGroupOrder: () => {} });
function useGroupOrder() {
  return useContext(GroupOrderContext);
}

function formatLocalTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Fifth pass (2026-09-29): a group-order payment is authorized and held
// at join, and only charged when joins close -- so it can be cancelled
// until then (Order Details -> Cancel Order).
const GROUP_HOLD_NOTE = (cutoffIso) =>
  `Your payment is on hold, not charged — you'll be charged at cutoff time (${formatLocalTime(cutoffIso)}). Changed your mind? You have a chance to cancel the order before cutoff.`;

function GroupOrderBanner({ onCancel }) {
  const { groupOrder } = useGroupOrder();
  if (!groupOrder) return null;
  return (
    <View style={S.groupOrderBanner}>
      <Ionicons name="people" size={18} color={C.saffron} />
      <View style={{ flex: 1 }}>
        <Text style={S.groupOrderBannerTitle}>
          {groupOrder.is_new ? 'Starting group order' : 'Updating the group order'} · {groupOrder.circle_display_name}
        </Text>
        <Text style={S.groupOrderBannerSub}>
          Pickup {formatLocalTime(groupOrder.pickup_time)} with everyone · pay before {formatLocalTime(groupOrder.join_cutoff_at)}.
          Everything in your cart is your part of the group order.
        </Text>
      </View>
      {onCancel && (
        <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button" accessibilityLabel="Leave group order checkout">
          <Ionicons name="close" size={18} color={C.muted} />
        </Pressable>
      )}
    </View>
  );
}

// Shared header icon row — cart/gift icons (dynamically ordered, see
// CartProvider above) immediately to the left of the profile icon. Used
// by every tab's header instead of each screen hand-rolling its own
// profile button, so the cart/gift badges show up consistently
// everywhere, not just on Home.
function AccountIconsRow({ customer, navigation, onProfilePress }) {
  const cart = useCart();
  if (!customer || !cart) {
    return (
      <Pressable
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={({ pressed }) => [S.profileBtn, pressed && { opacity: 0.7 }]}
        onPress={onProfilePress || (() => navigation.navigate('SignIn'))}>
        <Ionicons name="person-circle-outline" size={22} color={C.white} />
      </Pressable>
    );
  }
  // Icon swap (2026-09-13) -- vector icons, tinted with the brand
  // palette, instead of emoji standing in as the only marker for these
  // controls.
  const ICONS = { cart: { icon: 'cart-outline', count: cart.cartCount, screen: 'Cart' }, gift: { icon: 'gift-outline', count: cart.giftCount, screen: 'GiftDraft' } };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {cart.iconOrder.map(key => {
        const it = ICONS[key];
        return (
          <Pressable key={key}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            style={({ pressed }) => [S.cartHeaderBtn, pressed && { opacity: 0.7 }]}
            onPress={() => navigation.navigate(it.screen, { customer })}>
            <Ionicons name={it.icon} size={20} color={C.ivory} />
            {it.count > 0 && (
              <View style={S.cartBadge}><Text style={S.cartBadgeText}>{it.count > 99 ? '99+' : it.count}</Text></View>
            )}
          </Pressable>
        );
      })}
      <Pressable
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={({ pressed }) => [S.profileBtn, pressed && { opacity: 0.7 }]}
        onPress={onProfilePress}>
        <Ionicons name="person-circle-outline" size={22} color={C.white} />
      </Pressable>
    </View>
  );
}

// ── GLOBAL ACCOUNT HEADER (2026-09-13) ───────────────────────────
// Mounted exactly once, in MainTabs, absolutely positioned on top of
// every screen — PC's ask: "just like Home/Menu/Order/Rewards/More are
// persistent across any screen, keep My account/profile persistent
// across all screens too" (it used to vanish the moment you left Home
// or Menu, since each screen rendered its own copy of AccountIconsRow +
// dropdown, and no other screen bothered to). Owns the same
// profileMenuOpen/quickUnlock state + dropdown menu HomeScreen used to
// own locally — moved here, not duplicated, so there is exactly one
// copy of this UI in the whole app regardless of which of the 10+
// screens under MainTabs is currently showing.
// ── BRANDED CONFIRMATION MODAL (2026-09-14) ──────────────────────
// Replaces the plain OS Alert.alert confirmations for Sign Out, Remove
// Card, and Turn off Auto-reload — the only three destructive
// confirmations in the app (grepped every Alert.alert call to verify;
// everything else is a plain info/error alert, out of scope here). Reuses
// the exact S.modalOverlay/S.modalSheet styles Discovery/Menu item popups
// already use, rather than a fourth, different-looking modal shape. One
// shared component, three call sites — not three one-off modals.
function ConfirmModal({ visible, title, message, confirmLabel, cancelLabel = 'Cancel', onConfirm, onClose }) {
  // Real bug, live report (2026-09-16) -- this is a plain View, not RN's
  // own <Modal>, so unlike the native Alert.alert every one of these
  // replaced, it does NOT dismiss the keyboard on its own. Showing one
  // while a TextInput still had focus (e.g. a validation message fired
  // right after typing) left it rendered partially behind the open
  // keyboard, its buttons unreachable. Alert.alert always dismissed the
  // keyboard first; this restores that behavior explicitly.
  useEffect(() => { if (visible) Keyboard.dismiss(); }, [visible]);
  if (!visible) return null;
  return (
    <View style={S.modalOverlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={S.modalSheet}>
        <View style={{ padding: 24 }}>
          <Text style={S.confirmModalTitle}>{title}</Text>
          {!!message && <Text style={S.confirmModalMessage}>{message}</Text>}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
            <Pressable style={({ pressed }) => [S.confirmModalCancelBtn, pressed && { opacity: 0.7 }]} onPress={onClose}>
              <Text style={S.confirmModalCancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [S.confirmModalConfirmBtn, pressed && { backgroundColor: '#c95722' }]}
              onPress={() => { onClose(); onConfirm(); }}>
              <Text style={S.confirmModalConfirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

// Branded single-button alert (2026-09-16, PC's live report) -- Alert.alert
// is the OS's own native dialog on both iOS and Android; it cannot be
// restyled with Dasta's colors/fonts by any means, full stop, which is why
// "Dasta Card Reloaded!" showed up looking generic/system-styled instead of
// matching the rest of the app. Same visual language as ConfirmModal above
// (same modalOverlay/modalSheet/confirmModalTitle/Message/ConfirmBtn
// styles -- ivory sheet, charcoal Playfair title, saffron button), just one
// button instead of two. Not a wholesale Alert.alert replacement across the
// app yet -- see PC's ask for the full sweep, scoped separately.
function InfoModal({ visible, title, message, buttonLabel = 'OK', onClose }) {
  // Same keyboard-dismiss fix as ConfirmModal above -- see its comment.
  // This is the more commonly-hit case in practice: most of this
  // component's callers are form-validation messages ("Almost there",
  // "Required", etc.) fired the instant a customer taps a button while
  // still focused in a TextInput.
  useEffect(() => { if (visible) Keyboard.dismiss(); }, [visible]);
  if (!visible) return null;
  return (
    <View style={S.modalOverlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={S.modalSheet}>
        <View style={{ padding: 24 }}>
          <Text style={S.confirmModalTitle}>{title}</Text>
          {!!message && <Text style={S.confirmModalMessage}>{message}</Text>}
          {/* REAL BUG, live report (2026-09-16): confirmModalConfirmBtn's
              flex:1 was written for ConfirmModal's side-by-side two-button
              row (flex:1 there = "take half the row"). This single button
              has no row wrapper, so that same flex:1 made it try to fill
              the rest of the sheet's vertical space instead of sizing to
              its text -- the orange background still rendered and still
              caught the tap (matches PC's report: button worked, label
              invisible), just stretched somewhere the "OK" text wasn't
              visible. flex: 0 here cancels it back to a normal,
              content-sized button. */}
          <Pressable
            style={({ pressed }) => [S.confirmModalConfirmBtn, { flex: 0, marginTop: 20 }, pressed && { backgroundColor: '#c95722' }]}
            onPress={onClose}>
            <Text style={S.confirmModalConfirmText}>{buttonLabel}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// Scrollable bottom-sheet popup (2026-09-28, PC: Circle detail's Members and
// Order History open as touch popups). Same S.modalOverlay/S.modalSheet look
// as ConfirmModal/InfoModal; the body scrolls when the list is long, and
// tapping outside the sheet closes it.
function SheetModal({ visible, title, onClose, children }) {
  if (!visible) return null;
  return (
    <View style={S.modalOverlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[S.modalSheet, { maxHeight: '85%' }]}>
        <View style={S.sheetHeader}>
          <Text style={S.confirmModalTitle}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={C.black} />
          </Pressable>
        </View>
        <ScrollView pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

function formatPickupDateTime(iso) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// One past group order -- used by My Circles' combined history and the
// per-Circle Order History popup (showCircle=false there, it's implied).
function GroupOrderHistoryRow({ h, showCircle = true, onPress }) {
  return (
    <Pressable style={S.circleRow} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={S.menuItemName}>{showCircle ? h.circle_display_name : formatPickupDateTime(h.pickup_time)}</Text>
        <Text style={S.menuItemDesc}>
          {showCircle ? `${formatPickupDateTime(h.pickup_time)} · ` : ''}
          {`${h.participant_count} ${h.participant_count === 1 ? 'person' : 'people'}`}
          {h.i_took_part ? ' · you ordered' : ''}
        </Text>
        {!!h.note && <Text style={S.groupOrderNote} numberOfLines={2}>“{h.note}”</Text>}
      </View>
      <Ionicons name="chevron-forward" size={18} color={C.muted} />
    </Pressable>
  );
}

function GlobalAccountHeader({ customer, navigation, onSignOut, onAccountDeleted, activeTab }) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const quickUnlock = useQuickUnlockToggle();

  // Close the profile dropdown on any primary navigation (2026-09-24, PC's
  // report -- it stayed open, rendered on top of whatever screen a bottom-
  // tab tap navigated to). activeTab is MainTabs' single source of truth
  // for "what's on screen" -- every navigation trigger in this app (tab
  // bar taps, fakeNav.navigate from any screen, fakeNav.goBack, and the
  // cold/warm-start deep-link useEffect) already funnels into changing it,
  // so this one effect catches all of them without each call site needing
  // to remember to close the menu itself.
  useEffect(() => {
    setProfileMenuOpen(false);
  }, [activeTab]);

  return (
    <>
      <View style={S.globalAccountHeader} pointerEvents="box-none">
        <AccountIconsRow
          customer={customer}
          navigation={navigation}
          onProfilePress={() => setProfileMenuOpen(true)}
        />
      </View>

      {/* Guest dropdown (2026-09-15, PC's ask) -- previously the profile
          icon skipped straight to Sign In for a guest, with no dropdown
          at all. dastacafe.com's own guest menu (head-code.html's
          renderSignedOut(), verified live per PC's prompt) shows exactly
          two items -- "Login" and "About Dasta Circle" -- and needs zero
          backend data to render, which is exactly the point: a guest can
          see and use this even with the API fully unreachable. */}
      {profileMenuOpen && !customer && (
        <Pressable style={S.profileMenuBackdrop} onPress={() => setProfileMenuOpen(false)}>
          <Pressable style={S.profileMenuCard} onPress={() => {}}>
            <Pressable style={S.profileMenuRow}
              onPress={() => { setProfileMenuOpen(false); navigation.navigate('SignIn'); }}>
              <Text style={S.profileMenuRowText}>Login</Text>
            </Pressable>
            <Pressable style={S.profileMenuRow}
              onPress={() => { setProfileMenuOpen(false); navigation.navigate('DiscoverRewards'); }}>
              <Text style={S.profileMenuRowText}>About Dasta Rewards</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      )}

      {profileMenuOpen && customer && (
        <Pressable style={S.profileMenuBackdrop} onPress={() => setProfileMenuOpen(false)}>
          <Pressable style={S.profileMenuCard} onPress={() => {}}>
            <Text style={S.profileMenuHeader}>Signed in as {customer?.first_name || 'you'}</Text>

            {/* Icons removed (2026-09-14) per PC's ask -- plain text
                options only in this dropdown. */}
            {/* My Circles (2026-09-27) -- two new, distinct entries, in the
                DDD §2.10 order: Dasta Account ID, then My Circles placed
                immediately after My Circle Account. Deliberately NOT a sub-
                section of My Circle Account (the wallet) -- the "Circle"
                naming overlap is already confusing enough (DDD §1/§6). */}
            <Pressable style={S.profileMenuRow}
              onPress={() => { setProfileMenuOpen(false); navigation.navigate('DastaAccountId'); }}>
              <Text style={S.profileMenuRowText}>Dasta Account ID</Text>
            </Pressable>

            <Pressable style={S.profileMenuRow}
              // Explicit params (2026-09-30 fix): the tab switcher keeps a
              // screen's last params when none are passed, so after using
              // Transaction History (More / quick links) this reopened
              // straight into the transaction list instead of My Dasta Account.
              onPress={() => { setProfileMenuOpen(false); navigation.navigate('MyCircleAccount', { openTransactions: false, navKey: Date.now() }); }}>
              <Text style={S.profileMenuRowText}>My Dasta Account</Text>
            </Pressable>

            <Pressable style={S.profileMenuRow}
              onPress={() => { setProfileMenuOpen(false); navigation.navigate('MyCircles'); }}>
              <Text style={S.profileMenuRowText}>My Circles</Text>
            </Pressable>

            <Pressable style={S.profileMenuRow}
              onPress={() => { setProfileMenuOpen(false); navigation.navigate('PersonalInfo'); }}>
              <Text style={S.profileMenuRowText}>Personal Info</Text>
            </Pressable>
            <Pressable style={S.profileMenuRow}
              onPress={() => { setProfileMenuOpen(false); navigation.navigate('NotificationPreferences'); }}>
              <Text style={S.profileMenuRowText}>Notification Preferences</Text>
            </Pressable>

            <View style={[S.profileMenuRow, { justifyContent: 'space-between' }]}>
              <Text style={S.profileMenuRowText}>Quick Unlock (Face ID)</Text>
              {quickUnlock.loading
                ? <ActivityIndicator color={C.saffron} />
                : <Switch value={quickUnlock.enabled} onValueChange={quickUnlock.toggle}
                    trackColor={{ false: C.border, true: C.saffron }} thumbColor={C.white} ios_backgroundColor={C.border} />}
            </View>

            <Pressable style={S.profileMenuRow}
              onPress={() => { setProfileMenuOpen(false); navigation.navigate('SignInContact'); }}>
              <Text style={S.profileMenuRowText}>Sign-in & Contact</Text>
            </Pressable>

            <View style={S.profileMenuDivider} />

            {/* Delete My Account (2026-09-16) -- App Store Guideline
                5.1.1(v) / Google Play Account Deletion policy. Own row,
                not nested under a settings toggle list, per PC's ask.
                Placed before Sign Out (2026-09-16, PC's ask) -- Sign Out
                stays the last item in the dropdown. */}
            <Pressable style={S.profileMenuRow}
              onPress={() => {
                setProfileMenuOpen(false);
                setShowDeleteAccount(true);
              }}>
              <Text style={[S.profileMenuRowText, { color: '#C0392B' }]}>Delete My Account</Text>
            </Pressable>

            <Pressable style={S.profileMenuRow}
              onPress={() => {
                setProfileMenuOpen(false);
                setShowSignOutConfirm(true);
              }}>
              <Text style={[S.profileMenuRowText, { color: '#C0392B' }]}>Sign Out</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      )}

      <ConfirmModal
        visible={showSignOutConfirm}
        title="Sign Out?"
        message="Are you sure you want to sign out?"
        confirmLabel="Sign Out"
        onConfirm={onSignOut}
        onClose={() => setShowSignOutConfirm(false)}
      />

      <DeleteAccountModal
        visible={showDeleteAccount}
        onClose={() => setShowDeleteAccount(false)}
        onDeleted={() => {
          setShowDeleteAccount(false);
          onAccountDeleted();
        }}
      />

      <InfoModal
        visible={!!quickUnlock.infoModal}
        title={quickUnlock.infoModal?.title}
        message={quickUnlock.infoModal?.message}
        onClose={quickUnlock.dismissInfoModal}
      />
    </>
  );
}

// ── Face ID / Touch ID quick-unlock helpers ────────────────────
const QUICK_UNLOCK_KEY = 'dasta_quick_unlock_enabled';

async function getQuickUnlockEnabled() {
  try { return (await SecureStore.getItemAsync(QUICK_UNLOCK_KEY)) === 'true'; }
  catch { return false; }
}

async function setQuickUnlockEnabled(enabled) {
  try { await SecureStore.setItemAsync(QUICK_UNLOCK_KEY, enabled ? 'true' : 'false'); }
  catch { /* best-effort — worst case the toggle doesn't persist across launches */ }
}

// Runs the actual biometric prompt. Returns true only on a genuine
// success; false covers "no hardware," "not enrolled," "user cancelled,"
// and "failed" alike — every caller treats those identically (never
// strand the customer, just don't unlock yet).
async function runBiometricCheck(promptMessage) {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled   = hasHardware && await LocalAuthentication.isEnrolledAsync();
    if (!hasHardware || !isEnrolled) return { ok: false, reason: 'unavailable' };
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Use phone/email session instead',
      // disableDeviceFallback left false (default) — iOS's own passcode
      // fallback covers a bad Face ID read (lighting, mask, etc.)
      // without us needing a second custom fallback path.
    });
    return { ok: !!result.success, reason: result.success ? null : (result.error || 'failed') };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

// ── Idle-based session lock (2026-09-17) ───────────────────────────
// Matches dastacafe.com's own idle-lock exactly -- constants pulled
// directly from the live site's injected head script, not guessed: 12
// min of no touch/scroll/keypress shows a "Still there?" warning with a
// live countdown; 15 min total with no response locks for real. What
// triggers this is ELAPSED IDLE TIME, not whether the app was
// backgrounded -- a quick app switch and back within 12 minutes must
// resume with zero prompt, no Face ID, exactly like an untouched web tab
// that was simply sitting in the background the whole time.
const IDLE_WARNING_MS = 12 * 60 * 1000; // 12 min of no activity -> show warning
const IDLE_LOGOUT_MS  = 15 * 60 * 1000; // 15 min total -> fully locked
const LAST_ACTIVITY_KEY = 'dasta_last_activity_at';

// In-memory, stamped on every touch via the root-level onTouchStart
// wrapper in App() below -- a module-level mutable, not React state, so
// tracking activity never triggers a re-render on its own (same "shared
// mutable the whole app reads without React plumbing" pattern as
// _contentPageCache elsewhere in this file). Seeded to "now" at JS
// startup, which is the correct baseline for a fresh process -- true
// cross-restart elapsed time is a separate, persisted concern (below),
// read explicitly by BootstrapScreen's own cold-launch check.
let _lastActivityAt = Date.now();
function stampActivity() { _lastActivityAt = Date.now(); }

// Persisted only on backgrounding (IdleLockOverlay/BootstrapScreen), so
// a cold relaunch after the OS reclaims a backgrounded app can still
// compute real elapsed idle time instead of treating every cold start as
// "fully idle, lock immediately."
async function getPersistedLastActivity() {
  try {
    const v = await SecureStore.getItemAsync(LAST_ACTIVITY_KEY);
    return v ? parseInt(v, 10) : null;
  } catch { return null; }
}
async function persistLastActivity(ts) {
  try { await SecureStore.setItemAsync(LAST_ACTIVITY_KEY, String(ts)); } catch {}
}

// 'none' (resume silently) | 'warning' (12-15 min) | 'locked' (15+ min)
function idleBucket(elapsedMs) {
  if (elapsedMs >= IDLE_LOGOUT_MS)  return 'locked';
  if (elapsedMs >= IDLE_WARNING_MS) return 'warning';
  return 'none';
}

// Face ID success alone never resumes a session on its own (2026-09-17,
// PC's explicit ask) -- it only proves the device owner is present, not
// that the Cognito session is still valid server-side. Every unlock path
// re-checks this after any biometric prompt, matching web's own "Yes,
// continue" doing a real session check rather than just closing a modal.
//
// Regression fix (2026-09-18, PC's live report: unlocked with Face ID,
// got bounced straight back to the SignIn screen even though the same
// account was still signed in fine on web) -- apiFetch never actually
// throws (it catches its own errors and returns {ok:false,
// networkError:true}), so the try/catch below was dead code, and a
// transient network hiccup right as the app resumes from background
// (the OS network interface often isn't reconnected yet -- a known
// iOS/RN timing gotcha) was being treated identically to "session
// genuinely expired": both silently returned false and forced a full
// logout via fallbackToSignIn. Only an explicit negative response from
// the server (a real 401, or 200 with success:false) means the session
// is actually invalid now; a network error gets one short retry, and if
// it still can't reach the server, this no longer forces a logout --
// every real API call still separately enforces auth server-side, so a
// truly-expired session is caught there instead, without punishing a
// valid session for a momentary connectivity blip.
async function checkSessionStillValid() {
  const attempt = () => apiFetch('/auth/me');
  let result = await attempt();
  if (result.networkError) {
    await new Promise(r => setTimeout(r, 1200));
    result = await attempt();
  }
  if (result.networkError) return true; // couldn't confirm either way -- don't force a logout over connectivity alone
  return !!(result.ok && result.data?.success);
}

// Lands on a genuine OTP challenge, not a Face ID loop: SignInScreen's
// own trusted-device fast path (handleStart) re-triggers Face ID for a
// still-valid trusted-device cookie, so that cookie is forgotten first --
// same mechanism SignInScreen's existing "Use a code instead" link
// already uses (skipTrustedDevice). /auth/logout is idempotent, safe to
// call even if the session already lapsed server-side.
async function fallbackToSignIn(navigation) {
  try { await apiFetch('/auth/logout', { method: 'POST' }); } catch {}
  try { await apiFetch('/auth/trusted-device/forget', { method: 'POST' }); } catch {}
  navigation.reset({ index: 0, routes: [{ name: 'SignIn' }] });
}

// Shared Quick Unlock toggle state (2026-09-12) — extracted so the More
// tab's row and the new Home header dropdown both drive the exact same
// enable/disable logic instead of two copies drifting apart, per PC's
// "reuse the functions we build" direction.
function useQuickUnlockToggle() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  // Hooks can't render JSX themselves -- infoModal is handed back for
  // GlobalAccountHeader (this hook's one caller) to render as <InfoModal>,
  // same branded pattern used everywhere else in this sweep (2026-09-16).
  const [infoModal, setInfoModal] = useState(null); // {title, message}

  useEffect(() => { getQuickUnlockEnabled().then(setEnabled); }, []);

  const toggle = async (next) => {
    if (!next) {
      setEnabled(false);
      await setQuickUnlockEnabled(false);
      return;
    }
    setLoading(true);
    const { ok, reason } = await runBiometricCheck('Confirm to enable Face ID / Touch ID unlock');
    setLoading(false);
    if (ok) {
      setEnabled(true);
      await setQuickUnlockEnabled(true);
    } else if (reason === 'unavailable') {
      setInfoModal({ title: 'Not available', message: "Face ID / Touch ID isn't set up on this device yet — set it up in your device Settings first." });
    }
    // cancelled/failed otherwise: leave it off, no error noise
  };

  return { enabled, loading, toggle, infoModal, dismissInfoModal: () => setInfoModal(null) };
}

// Push Notifications (2026-09-24) -- shared by NotifyPermScreen's first-run
// ask and NotificationPreferencesScreen's ongoing "Push Notifications"
// toggle, so both follow the identical granted/undetermined/denied branch
// instead of two copies drifting apart, same "reuse the functions we
// build" precedent as useQuickUnlockToggle above.
//
// Never calls requestPermissionsAsync() when the OS already reports
// 'denied' -- once a customer has explicitly tapped "Don't Allow" once,
// neither iOS nor Android will ever show that native dialog again for
// this app, so calling it again would silently no-op instead of actually
// re-prompting.
//
// Returns:
//   'granted' -- permission is on (already was, or just became so), and
//                the Expo push token was captured + registered
//                (POST /auth/push-token) + push_enabled was set true
//                server-side (PATCH /auth/notification-preferences). Only
//                on 'granted' has anything actually been persisted.
//   'denied'  -- permission is off (already was, or was just refused) --
//                caller should offer the Open Settings fallback.
//   'error'   -- permission is granted but token capture/registration
//                failed (network, Expo, or backend error) -- caller
//                should show a plain retry message, not the Settings
//                fallback (Settings can't fix this).
async function requestPushPermissionAndRegister() {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let granted = existing === 'granted';
    if (!granted && existing !== 'denied') {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true, allowAnnouncements: false },
      });
      granted = status === 'granted';
    }
    if (!granted) return 'denied';

    const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId: EXPO_PUSH_PROJECT_ID });
    const pushToken = tokenResp?.data;
    if (!pushToken) return 'error';

    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    const { ok: tokenOk } = await apiFetch('/auth/push-token', {
      method: 'POST', body: { push_token: pushToken, platform },
    });
    if (!tokenOk) return 'error';

    const { ok: prefOk } = await apiFetch('/auth/notification-preferences', {
      method: 'PATCH', body: { push_enabled: true },
    });
    if (!prefOk) return 'error';

    return 'granted';
  } catch {
    return 'error';
  }
}

// Push Notifications (2026-09-24) -- re-registers the Expo push token on
// every app launch when permission is already granted AND push_enabled is
// on server-side. Tokens can change (reinstall, device restore), and
// POST /auth/push-token's ON CONFLICT upsert makes re-sending the SAME
// token on every launch a cheap no-op rather than a growing duplicate
// log, so this is safe to call unconditionally on every cold start.
// Fire-and-forget from BootstrapScreen -- never awaited on the launch
// critical path, never surfaces an error to the customer.
async function reregisterPushTokenIfEnabled() {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    const { ok, data } = await apiFetch('/auth/notification-preferences');
    if (!ok || !data?.success || !data.push_enabled) return;
    const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId: EXPO_PUSH_PROJECT_ID });
    const pushToken = tokenResp?.data;
    if (!pushToken) return;
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    await apiFetch('/auth/push-token', { method: 'POST', body: { push_token: pushToken, platform } });
  } catch {
    // Best-effort -- never block app launch over this.
  }
}

// Push Notifications (2026-09-24) -- shared by the tap-to-open listener
// (App(), below) to translate a notification's {screen, params} payload
// into the SAME {initialTab, initialTabParams} shape parseDeepLink already
// produces for Universal Links, so navigationRef.navigate('MainTabs', ...)
// routes identically regardless of which of the two triggered it.
function notificationDataToDeepLink(data) {
  if (!data?.screen) return null;
  return { initialTab: data.screen, initialTabParams: { [data.screen]: data.params || {} } };
}

// Cold-launch race, take 2 (2026-09-12 follow-up bug report: "Face ID
// works sometimes, doesn't work other times"). A fixed setTimeout delay
// before the bootstrap-path biometric check made the common case work
// but was still a guess — device speed varies, so a constant wait is
// sometimes too short. This waits for the real signal instead: iOS's
// own AppState transition to 'active', which is what actually indicates
// the native window is frontmost enough for Face ID's camera-based
// ceremony to succeed reliably. currentState can already read 'active'
// before that's fully true on cold launch, so a short buffer still
// follows either path — just no longer the ONLY thing standing in for
// "is the app really ready yet."
function waitForAppActive(timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(safety);
      setTimeout(resolve, 350);
    };
    if (AppState.currentState === 'active') { finish(); return; }
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') { sub.remove(); finish(); }
    });
    const safety = setTimeout(() => { sub.remove(); finish(); }, timeoutMs);
  });
}

// ── Temperature signal parser (2026-09-12) ─────────────────────
// Ported from SipSense_webflow's find-my-drink_embed4.html verbatim —
// same regex, same "one clear signal or none" logic — so mobile infers
// hot/iced from typed text exactly like web does. Also doubles as the
// parser voice input will reuse once transcription lands in this same
// textarea, per that file's own comment.
function parseTemperatureSignal(text) {
  const lowered = (text || '').toLowerCase();
  const hasIced = /\b(iced?|cold|on ice|frozen|chilled)\b/.test(lowered);
  const hasHot  = /\b(hot|warm|toasty|steaming)\b/.test(lowered);
  if (hasIced && !hasHot) return 'iced';
  if (hasHot && !hasIced) return 'hot';
  return null;
}

// ── Sweetness signal parser (2026-09-15, PC's ask) ──────────────
// Same "one clear signal or none" shape as parseTemperatureSignal above,
// but unlike hot_iced there's no dedicated /generate-custom-drink field
// for this — that endpoint has always inferred sweetness from free text
// alone, and dastacafe.com's live Find My Drink page has no Sweetened/
// Unsweetened chip at all (confirmed via WebFetch 2026-09-15 — its only
// sweetness-adjacent control is a freely-combinable "Sweet" flavor chip,
// not an exclusive pair). This is a deliberate mobile-only addition PC
// asked for regardless, so the resolved word is folded straight into the
// text sent to the API — see resolveSweetness/handleGenerate below.
function parseSweetnessSignal(text) {
  const lowered = (text || '').toLowerCase();
  const hasUnsweetened = /\bunsweetened\b/.test(lowered);
  const hasSweetened   = /\bsweetened\b/.test(lowered);
  if (hasUnsweetened && !hasSweetened) return 'unsweetened';
  if (hasSweetened && !hasUnsweetened) return 'sweetened';
  return null;
}

// MMDD -> "March 14", matching web's piFormatDob (dasta-circle_embed6.html)
function formatDobDisplay(mmdd) {
  if (!mmdd || mmdd.length !== 4) return mmdd || '';
  const months = ['January','February','March','April','May','June','July',
    'August','September','October','November','December'];
  const m = parseInt(mmdd.slice(0, 2), 10);
  const d = parseInt(mmdd.slice(2), 10);
  return `${months[m - 1] || ''} ${d}`.trim();
}

// ── Helper: open URL inside app ───────────────────────────────
const openLink = (url) => WebBrowser.openBrowserAsync(url, {
  toolbarColor: '#2A1E1A',
  controlsColor: '#E26A2C',
  showTitle: true,
});

// ── Greeting helpers ──────────────────────────────────────────
function getTimeGreeting() {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  if (h >= 17 && h < 21) return 'Good evening';
  return 'Good night';
}

function getDayMessage() {
  const msgs = [
    'Sunday well spent!',        // 0
    'New week, new sip!',         // 1
    'Keep the momentum going!',   // 2
    'Halfway through the week!',  // 3
    'Almost there!',              // 4
    'TGIF — you earned this sip!',// 5
    'Weekend mode: on!',          // 6
  ];
  return msgs[new Date().getDay()];
}

function getWeatherEmoji(code) {
  if (code === 0)                          return '☀️';
  if (code <= 3)                           return '⛅';
  if (code <= 48)                          return '🌫️';
  if (code <= 55)                          return '🌦️';
  if (code <= 67)                          return '🌧️';
  if (code <= 77)                          return '❄️';
  if (code <= 82)                          return '🌧️';
  if (code <= 99)                          return '⛈️';
  return '🌈';
}

// ── NEW: Location permission hook ────────────────────────────
// Called contextually when user taps "Find nearest Dasta" — never on app load.
// Handles iOS 14+ precise/approximate split and Android 12+ permission model.
function useRequestLocation() {
  // Same hooks-can't-render-JSX situation as useQuickUnlockToggle above --
  // the one caller (below) renders locationModal as ConfirmModal (the
  // "denied" case needs a real Open Settings/Cancel choice, not a single
  // OK) or InfoModal (plain error), branching on `kind`.
  const [locationModal, setLocationModal] = useState(null); // {kind: 'denied'|'error', title, message}
  const dismissLocationModal = () => setLocationModal(null);

  const requestLocation = async (onSuccess) => {
    try {
      // Check existing permission without triggering a prompt
      const { status: existing } = await Location.getForegroundPermissionsAsync();

      if (existing === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        onSuccess?.(loc.coords);
        return;
      }

      // Ask the OS — iOS shows "Allow Once / Allow While Using / Don't Allow"
      // Android 12+ lets user choose precise or approximate
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();

      let precision = 'none';
      if (status === 'granted') {
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          // accuracy in metres: <50 = precise, >=50 = approximate (iOS/Android approximate mode)
          precision = loc.coords.accuracy < 50 ? 'precise' : 'approximate';
          onSuccess?.(loc.coords);
        } catch {
          precision = 'approximate';
        }
      }

      // NOTE (2026-09-11): this used to PATCH location_permission/
      // location_precision to /customer/{id}/permissions — that endpoint
      // doesn't exist anywhere in the current backend (same dead route
      // NotifyPermScreen used to call), so it was always a no-op. Removed
      // rather than left silently failing; nothing currently reads this
      // back server-side.

      if (status !== 'granted' && !canAskAgain) {
        // Permanently denied — send user to device Settings
        setLocationModal({
          kind: 'denied', title: 'Location access needed',
          message: 'To find the nearest Dasta, please enable location in your device Settings.',
        });
      }

    } catch {
      setLocationModal({ kind: 'error', title: 'Location error', message: 'Could not access location. Please try again.' });
    }
  };

  return { requestLocation, locationModal, dismissLocationModal };
}

// ── HOME SCREEN ───────────────────────────────────────────────
// ── FAVORITE DETAIL MODAL (2026-09-13) ───────────────────────────
// Native rebuild of find-my-drink_embed5.html's renderFavoritesPage_ card
// — same fields (description, ingredients, Discovery, "Ordered Nx"/
// "Shared Nx"), same status-based buttons (never ordered -> Order;
// ordered -> Reorder + Share + Gift). "Build & Order" wording retired
// app-wide 2026-09-19 (PC's call, confusing to show customers a
// different word for the same action depending on internal recipe
// state they can't see) -- the underlying decision it used to label
// (recipe_status/drink_source gating, craft-the-sip's "Only custom sips
// can be built" 400) is unchanged, just never surfaced as a separate
// label anymore; see OrderScreen's handleOrder. Collapsed card stays
// the existing small horizontal-scroll size; tapping it opens this as a
// full-screen modal, tapping again (✕ or backdrop) returns to the
// collapsed list — PC's exact ask.
const FAV_THEMES = {
  custom: { border: '#E26A2C', bg: '#fff8ef', nameColor: '#C4581A', badgeText: '🫆 Custom Sip', badgeBg: '#E26A2C' },
  circle: { border: '#534AB7', bg: '#EEEDFE', nameColor: '#26215C', badgeText: '★ Dasta Members Sip', badgeBg: '#534AB7' },
  menu:   { border: '#0F6E56', bg: '#E1F5EE', nameColor: '#04342C', badgeText: '☕ Menu Sip', badgeBg: '#0F6E56' },
  dasta_menu: { border: '#8A5A2E', bg: '#F5EDE3', nameColor: '#4A2F17', badgeText: '☕ Dasta Menu', badgeBg: '#8A5A2E' },
  food:   { border: '#B0862F', bg: '#FBF3E1', nameColor: '#5C4413', badgeText: '🍽️ Food', badgeBg: '#B0862F' },
};
function FavoriteDetailModal({ drink, visible, onClose, customer, navigation, onChanged }) {
  const cart = useCart();
  const [busyAction, setBusyAction] = useState(null); // 'order' | 'gift' | 'heart' | null
  const [discoveryShown, setDiscoveryShown] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareRecipient, setShareRecipient] = useState('');
  const [sharing, setSharing] = useState(false);
  const [infoModal, setInfoModal] = useState(null); // {title, message, onOk}
  const showInfo = (title, message, onOk) => setInfoModal({ title, message, onOk });

  useEffect(() => { if (visible) { setDiscoveryShown(false); setShareOpen(false); setShareRecipient(''); } }, [visible, drink?.custom_drink_id]);

  if (!visible || !drink) return null;
  const theme = FAV_THEMES[drink.item_type === 'food' ? 'food' : (drink.drink_source || 'custom')] || FAV_THEMES.circle;
  const isCatalog = drink.item_type === 'food' || drink.drink_source === 'dasta_menu';
  // "Build & Order" retired from every customer-facing label (2026-09-19
  // revision, PC's call) -- the crafting decision this used to signal
  // (recipe_status !== 'ready') still happens exactly as before behind
  // the plain Order/Reorder tap (see OrderScreen's handleOrder), it's
  // just never surfaced as separate wording anymore.
  const orderLabel = drink.order_count > 0 ? 'Reorder' : 'Order';

  const catalogModifierIds = () => (drink.selected_modifiers || []).map(m => m.modifier_id).filter(id => id != null);

  const handleOrder = async () => {
    setBusyAction('order');
    try {
      if (isCatalog) {
        const payload = drink.item_type === 'food'
          ? { item_type: 'food', food_item_id: drink.food_item_id, drink_name: drink.drink_name, unit_price_cents: 0, quantity: 1 }
          : { item_type: 'drink', drink_source: 'dasta_menu', dasta_menu_item_id: drink.dasta_menu_item_id, selected_modifier_ids: catalogModifierIds(), unit_price_cents: 0, quantity: 1 };
        const { ok, data } = await cart.addToCart(payload);
        // onOk defers the actual onClose() until the customer dismisses
        // the InfoModal -- unlike Alert.alert (an OS-level overlay), this
        // modal lives inside FavoriteDetailModal's own render tree and
        // would vanish instantly if onClose() fired synchronously (it
        // sets the parent's `visible` false, and line ~1204's early
        // return unmounts everything, InfoModal included).
        if (ok && data?.success) showInfo('Added to Cart 🛒', `${drink.drink_name} — added to your order!`, onClose);
        else showInfo('Error', data?.detail || 'Could not add to your order.');
      } else {
        // Custom/Circle/Menu sip — same presetDrink path the Order tab's
        // "Choose from Favorites" and the Favorites-card Reorder button
        // both already use; carries drink_source through so a Circle/Menu
        // favorite is never mistakenly submitted (or crafted) as 'custom'.
        onClose();
        navigation.navigate('Order', { presetDrink: drink });
      }
    } catch { showInfo('Error', 'Could not add to your order.'); }
    finally { setBusyAction(null); }
  };

  const handleGift = async () => {
    setBusyAction('gift');
    try {
      let payload;
      if (drink.item_type === 'food') {
        payload = { item_type: 'food', food_item_id: drink.food_item_id, quantity: 1 };
      } else if (drink.drink_source === 'dasta_menu') {
        payload = { item_type: 'drink', drink_source: 'dasta_menu', dasta_menu_item_id: drink.dasta_menu_item_id, selected_modifier_ids: catalogModifierIds(), size_oz: drink.last_size_oz || undefined, quantity: 1 };
      } else {
        payload = {
          item_type: 'drink', drink_source: drink.drink_source || 'custom',
          drink: { drink_name: drink.drink_name, taste_description: drink.description, why_it_fits: drink.description, ingredients: drink.ingredients || [], build_ticket: {} },
          size_oz: drink.last_size_oz || 16, quantity: 1,
        };
      }
      const { ok, data } = await cart.addToGift(payload);
      if (ok && data?.success) showInfo('Added to Gift 🎁', `${drink.drink_name} is ready to send.`);
      else showInfo('Error', data?.detail || 'Could not add to your gift.');
    } catch { showInfo('Error', 'Could not add to your gift.'); }
    finally { setBusyAction(null); }
  };

  const handleToggleFavorite = async () => {
    setBusyAction('heart');
    const body = drink.custom_drink_id
      ? { customer_id: customer.id, custom_drink_id: drink.custom_drink_id, drink_source: drink.drink_source }
      : { customer_id: customer.id, drink_source: 'dasta_menu', item_type: 'drink', dasta_menu_item_id: drink.dasta_menu_item_id, selected_modifiers: drink.selected_modifiers, default_size: drink.last_size_oz };
    const { ok, data } = await apiFetch('/sip/toggle-favorite', { method: 'POST', body });
    setBusyAction(null);
    if (ok && data?.success) {
      onChanged?.();
      if (!data.is_favorite) onClose();
    } else {
      showInfo('Error', data?.detail || 'Could not update favorites.');
    }
  };

  const handleShare = async () => {
    if (!shareRecipient.trim()) return;
    setSharing(true);
    try {
      const channel = shareRecipient.includes('@') ? 'email' : 'sms';
      const { ok, data } = await apiFetch('/sip/share-drink', {
        method: 'POST',
        body: {
          customer_id: customer.id, custom_drink_id: drink.custom_drink_id, share_channel: channel,
          recipient: shareRecipient.trim(), drink_name: drink.drink_name, ingredients: drink.ingredients || [],
        },
      });
      if (ok && data?.success) {
        showInfo(data.status === 'already_ordered' ? 'Already Tried' : 'Sent! 📤', data.message || `${drink.drink_name} was shared.`);
        setShareOpen(false); setShareRecipient('');
      } else {
        showInfo('Error', data?.detail || 'Could not share this sip.');
      }
    } catch { showInfo('Error', 'Could not reach Dasta server.'); }
    finally { setSharing(false); }
  };

  return (
    <>
    <View style={S.modalOverlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      {/* KeyboardAvoidingView (2026-09-19 sweep) -- same fix as AddCardModal;
          the Share field near the bottom of this sheet was getting covered. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%', maxHeight: '90%' }}>
      <View style={[S.modalSheet, { maxHeight: '100%' }]}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 28 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={[S.favBadge, { backgroundColor: theme.badgeBg }]}><Text style={S.favBadgeText}>{theme.badgeText}</Text></View>
            <Pressable onPress={onClose} hitSlop={12}><Text style={{ fontSize: 22, color: C.black }}>✕</Text></Pressable>
          </View>
          <Text style={[S.drinkFullName, { color: theme.nameColor, marginTop: 8 }]}>{drink.drink_name}</Text>
          {!!drink.description && <Text style={S.drinkFullDesc}>{drink.description}</Text>}
          {drink.ingredients?.length > 0 && (
            <Text style={S.favIngredientsText}><Text style={{ fontWeight: '700', color: C.charcoal }}>Ingredients: </Text>{drink.ingredients.map(i => typeof i === 'string' ? i : (i?.name || i?.ingredient_name || '')).filter(Boolean).join(', ')}</Text>
          )}
          {!!drink.discovery_narrative && (
            <View style={{ marginTop: 8 }}>
              <Pressable onPress={() => setDiscoveryShown(v => !v)}><Text style={[S.linkText, { color: theme.border, marginTop: 0 }]}>✨ Discovery</Text></Pressable>
              {discoveryShown && (
                <View style={[S.favDiscoveryBox, { borderColor: theme.border }]}>
                  <Text style={S.favDiscoveryText}>{drink.discovery_narrative}</Text>
                </View>
              )}
            </View>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {drink.order_count > 0 && <View style={S.favStatPill}><Text style={S.favStatPillText}>Ordered {drink.order_count}×</Text></View>}
            {drink.shared_count > 0 && <View style={S.favStatPill}><Text style={S.favStatPillText}>Shared {drink.shared_count}×</Text></View>}
            {!!drink.shared_by_first_name && <View style={[S.favStatPill, { backgroundColor: theme.border }]}><Text style={[S.favStatPillText, { color: '#fff' }]}>Shared by {drink.shared_by_first_name}</Text></View>}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16, alignItems: 'center' }}>
            <Pressable style={[S.favActionHeart, drink.is_favorite && { backgroundColor: C.saffron, borderColor: C.saffron }]} onPress={handleToggleFavorite} disabled={!!busyAction}>
              {busyAction === 'heart' ? <ActivityIndicator size="small" color={drink.is_favorite ? '#fff' : C.saffron} /> : <Text style={{ fontSize: 16, color: drink.is_favorite ? '#fff' : C.saffron }}>{drink.is_favorite ? '♥' : '♡'}</Text>}
            </Pressable>
            <Pressable style={[S.favActionBtn, { backgroundColor: theme.border }]} onPress={handleOrder} disabled={!!busyAction}>
              {busyAction === 'order' ? <ActivityIndicator size="small" color="#fff" /> : <Text style={S.favActionBtnText}>{orderLabel}</Text>}
            </Pressable>
            {drink.order_count > 0 && !isCatalog && (
              <Pressable style={[S.favActionBtnOutline, { borderColor: theme.border }]} onPress={() => setShareOpen(v => !v)}>
                <Text style={[S.favActionBtnOutlineText, { color: theme.border }]}>Share</Text>
              </Pressable>
            )}
            <Pressable style={S.favActionBtnGold} onPress={handleGift} disabled={!!busyAction}>
              {busyAction === 'gift' ? <ActivityIndicator size="small" color={C.espresso} /> : <Text style={S.favActionBtnGoldText}>Gift</Text>}
            </Pressable>
          </View>

          {shareOpen && (
            <View style={{ marginTop: 12 }}>
              <TextInput style={S.input} value={shareRecipient} onChangeText={setShareRecipient}
                placeholder="Friend's phone or email" placeholderTextColor={C.muted} autoCapitalize="none" />
              <Pressable style={[S.btnSaffron, { marginTop: 8 }]} disabled={sharing} onPress={handleShare}>
                {sharing ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Send</Text>}
              </Pressable>
            </View>
          )}
        </ScrollView>
      </View>
      </KeyboardAvoidingView>
    </View>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }}
    />
    </>
  );
}

// ── SAY[MIC]GO (2026-09-18) ──────────────────────────────────────────
// Home-screen quick-links menu, per SipSense_DDD_SayMicGo.docx.
// Tap-only since 2026-09-30 (PC): voice recognition wasn't reliable enough,
// so the mic, the phrase/number matching and the listening hook were
// removed entirely; the header button is a lightning bolt. None of it was
// shared with the SipSense craving mic (OrderScreen), which keeps its own
// listeners and its own microphone-permission request, untouched.
const SAY_MIC_GO_ITEMS = [
  { n: 1, label: 'Order my favorite drink' },
  { n: 2, label: 'Gift a Sip' },
  { n: 3, label: 'Account balance' },
  { n: 4, label: 'Transaction history' },
  { n: 5, label: 'Gift cards' },
  { n: 6, label: 'Redeem a free drink' },
  { n: 7, label: 'Feedback' },
];

// Builds a POST /checkout/cart/items payload from one GET /favorites/preview
// row -- mirrors favorites_router.py's checkout_favorites ("Add All")
// per-item branching exactly, so a single favorite added this way goes
// through the identical shape the server's own bulk endpoint already
// produces (2026-09-19, Say[Mic]Go option 1 fix: was calling "Add All"
// for every favorite instead of just the one usual/selected drink).
function buildFavoriteAddPayload(item) {
  if (item.item_type === 'food') {
    return { item_type: 'food', food_item_id: item.food_item_id, drink_name: item.drink_name, unit_price_cents: 0, quantity: 1 };
  }
  if (item.drink_source === 'dasta_menu') {
    const modifier_ids = (item.selected_modifiers || []).map(m => m.modifier_id).filter(id => id != null);
    return { item_type: 'drink', drink_source: 'dasta_menu', dasta_menu_item_id: item.dasta_menu_item_id, selected_modifier_ids: modifier_ids, unit_price_cents: 0, quantity: 1 };
  }
  return {
    item_type: 'drink', drink_source: item.drink_source,
    drink: { drink_name: item.drink_name, ingredients: item.ingredients || [], build_ticket: item.build_ticket || {} },
    size_oz: item.size_oz, unit_price_cents: 0, quantity: 1,
    temperature_modifier: item.temperature_modifier, sweetness_modifier: item.sweetness_modifier,
  };
}

// Header back arrow (2026-09-29, My Circles; shared 2026-09-30) -- the one
// back-arrow style in the app: My Circles' Circle screen, the group order
// screen, and any screen opened from the Say[Mic]Go quick links.
function HeroBackArrow({ onPress, label = 'Back' }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} accessibilityLabel={label}>
      <Ionicons name="chevron-back" size={26} color={C.ivory} />
    </Pressable>
  );
}

// A hero title row with the back arrow when one is wanted (onBack set).
// Every single-line screen banner uses this (PC, 2026-10-01): 22pt title in
// a 44pt-min row, which matches the height of the two-line banners (22pt
// title + wordmarkSub subtitle) on Order / Scan / Rewards. A bare <Text>
// title has no min height, so its banner came out shorter.
function HeroTitleRow({ title, onBack, fontSize = 22 }) {
  return (
    <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {onBack ? <HeroBackArrow onPress={onBack} label="Back" /> : null}
      <Text style={[S.wordmark, { fontSize, flex: 1 }]}>{title}</Text>
    </View>
  );
}

// Every destination opened from here gets fromQuickLinks: true, so MainTabs
// shows it a back arrow to this list (and only then -- not when the same
// screen is reached any other way).
function SayMicGoOverlay({ visible, onClose, navigation, customer, topInset }) {
  const cart = useCart();
  const [infoModal, setInfoModal] = useState(null); // {title, message}
  const showInfo = (title, message) => setInfoModal({ title, message });

  const handleSelect = async (n) => {
    switch (n) {
      case 1: { // Order my favorite drink (2026-09-19 fix, PC's live report:
                // this used to call Favorites' "Add All" -- POST
                // /favorites/checkout -- which added EVERY saved favorite
                // (21, in PC's case) to the cart instead of just "my
                // usual." There's no separate single-item "My Usual" left
                // in the data model (merged into Favorites 2026-08-10), so
                // the count itself decides: exactly one favorite IS the
                // usual and gets ordered directly; more than one shows a
                // numbered picker (Choose Your Favorite) the customer can
                // tap, or say the number or the drink's own name for,
                // same phrase-or-number-or-tap premise as this menu.
        if (!customer) { onClose(); showInfo('Sign in required', 'Please sign in to order your favorite drink.'); return; }
        const { ok, data } = await apiFetch('/favorites/preview');
        if (!ok || !data?.success) {
          onClose();
          showInfo('Error', "Could not load your favorite drinks. Please try again.");
          return;
        }
        const items = data.items || [];
        if (items.length === 0) {
          onClose();
          showInfo('No Favorite Saved', "You don't have a favorite drink saved yet -- save one from the Menu to use this shortcut.");
        } else if (items.length === 1) {
          const { ok: addOk } = await cart?.addToCart?.(buildFavoriteAddPayload(items[0]));
          onClose();
          if (addOk) {
            navigation.navigate('Checkout', { customer, fromQuickLinks: true });
          } else {
            showInfo('Error', "Couldn't add your usual drink to the cart. Please try again.");
          }
        } else {
          onClose();
          navigation.navigate('ChooseFavorite', { customer, items, fromQuickLinks: true });
        }
        break;
      }
      case 2:
        // Repurposed 2026-09-23 (PC's live report) -- "SipSense" still
        // wasn't recognizing by voice even after the compound-word fix, so
        // PC asked to replace it with "Gift a Sip" instead of chasing STT
        // further. Same destination + same no-sign-in-gate behavior as the
        // "Gift a Sip or Food" Quick Actions tile (My Circle Account),
        // navigation.navigate('GiftDraft', { customer }) -- not a new flow.
        onClose();
        navigation.navigate('MainTabs', { initialTab: 'GiftDraft', customer, fromQuickLinks: true });
        break;
      case 3:
        if (!customer) { onClose(); showInfo('Sign in required', 'Please sign in to view your Dasta Account balance.'); return; }
        onClose();
        navigation.navigate('MyCircleAccount', { customer, fromQuickLinks: true, navKey: Date.now() });
        break;
      case 4:
        if (!customer) { onClose(); showInfo('Sign in required', 'Please sign in to view your transaction history.'); return; }
        onClose();
        navigation.navigate('MyCircleAccount', { customer, openTransactions: true, fromQuickLinks: true, navKey: Date.now() });
        break;
      case 5:
        onClose();
        navigation.navigate('GiftCardPurchase', { customer, fromQuickLinks: true });
        break;
      case 6:
        if (!customer) { onClose(); showInfo('Sign in required', 'Please sign in to redeem a free drink.'); return; }
        onClose();
        navigation.navigate('RedeemFreeDrink', { customer, fromQuickLinks: true });
        break;
      case 7:
        onClose();
        navigation.navigate('Contact', { fromQuickLinks: true });
        break;
      default:
        break;
    }
  };

  if (!visible) return null;

  return (
    <>
    {/* Full-screen panel between the top and bottom banners (2026-09-19
        redesign, PC's live report: the old small top-right dropdown
        overlapped the top brown banner). Sits inside HomeScreen's own
        {flex:1} wrapper (see MainTabs), so bottom:0 already lands exactly
        at the tab bar's top edge with no separate inset needed -- only
        the top needs the hero banner's measured height. Bigger rows +
        a plain vertical list, deliberately roomy so more options can be
        added later without a redesign. */}
    <View style={[S.sayMicGoPanel, { top: topInset }]}>
      <View style={S.sayMicGoPanelHeader}>
        <Ionicons name="flash-outline" size={30} color={C.saffron} />
        <Text style={S.sayMicGoPanelStatus} numberOfLines={2}>Tap an option</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={S.sayMicGoPanelClose}>✕</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {SAY_MIC_GO_ITEMS.map(item => (
          <Pressable key={item.n} style={S.sayMicGoPanelRow} onPress={() => handleSelect(item.n)}>
            <Text style={S.sayMicGoPanelRowNum}>{item.n}</Text>
            <Text style={S.sayMicGoPanelRowText}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => setInfoModal(null)}
    />
    </>
  );
}

function HomeScreen({ navigation, route, onSignOut, isActive, reopenQuickLinks }) {
  const customer = route?.params?.customer || null;
  const [pastDrinks,    setPastDrinks]    = useState([]);
  const [weatherEmoji,  setWeatherEmoji]  = useState('');
  const [featuredIdx,   setFeaturedIdx]   = useState(0);
  const [expandedFavId, setExpandedFavId] = useState(null);
  const [slotA,         setSlotA]         = useState(0); // image index in slot A
  const [slotB,         setSlotB]         = useState(1); // image index in slot B
  const [activeSlot,    setActiveSlot]    = useState('A'); // which slot is on top
  const opacityA = useRef(new Animated.Value(1)).current;
  const opacityB = useRef(new Animated.Value(0)).current;

  // NEW: location state + hook — triggered only on button tap, never on mount
  const [nearestStore, setNearestStore]   = useState(null);
  const { requestLocation, locationModal, dismissLocationModal } = useRequestLocation();

  // Say[Mic]Go (2026-09-18) -- kill switch fetched once on mount, mirrors
  // OrderScreen's own crafting_enabled fetch (GET /sip/build-config)
  // exactly. While false the button/overlay below never render at all,
  // no redeploy needed to turn it off.
  const [sayMicGoEnabled, setSayMicGoEnabled] = useState(false);
  const [sayMicGoOpen,    setSayMicGoOpen]    = useState(false);
  // Measured live off the hero banner's own onLayout (2026-09-19, PC's ask:
  // the popup was overlapping the top brown banner) rather than a guessed
  // pixel value, since the banner's real height isn't a fixed constant --
  // 140 is just a sane pre-layout default for the first paint.
  const [heroHeight,      setHeroHeight]      = useState(140);
  // Measured off the "Dasta / CHAI & BAGELS" block's own onLayout
  // (2026-09-19 fix, PC's live report: the mic still read as only
  // "Dasta"-tall, not the full two-line block) -- 46 is a sane pre-
  // layout default, not a guess baked into the final size.
  const [wordmarkBlockHeight, setWordmarkBlockHeight] = useState(46);
  useEffect(() => {
    apiFetch('/say-mic-go/config').then(({ ok, data }) => {
      if (ok) setSayMicGoEnabled(!!data?.say_mic_go_enabled);
    });
  }, []);
  // Close (and let SayMicGoOverlay's own effect stop listening) the moment
  // Home stops being the active tab (2026-09-19 fix, PC's live report) --
  // HomeScreen stays mounted with display:'none' when switching tabs
  // (MainTabs' kept-mounted pattern), so without this the panel's own
  // `visible` state would just sit stale (and the mic could keep
  // listening in the background) instead of actually closing.
  useEffect(() => {
    if (!isActive) setSayMicGoOpen(false);
  }, [isActive]);
  // A quick link's back arrow (2026-09-30, PC) lands here with the
  // lightning-bolt list open again, to try another option or close it.
  useEffect(() => {
    if (reopenQuickLinks) setSayMicGoOpen(true);
  }, [reopenQuickLinks]);

  useEffect(() => {
    if (customer?.id) loadPastDrinks();
    fetchMadisonWeather();
  }, [customer]);

  // Favorites/past-drinks refresh on tab focus (2026-09-19, PC's live
  // report: favoriting a drink elsewhere didn't show on Home until a
  // full app restart) -- HomeScreen stays mounted (display:'none')
  // across tab switches (same MainTabs pattern the Say[Mic]Go effect
  // above depends on), so the mount-time fetch right above this one
  // only ever ran once and never refreshed just from returning to this
  // tab. Web doesn't have this problem since Find My Drink's favorites
  // page is a real page load every time, not a kept-mounted tab.
  useEffect(() => {
    if (isActive && customer?.id) loadPastDrinks();
  }, [isActive]);

  // Double-buffer cross-fade — no flicker since next image pre-loads in hidden slot
  useEffect(() => {
    const timer = setInterval(() => {
      const next = (featuredIdx + 1) % FeaturedItems.length;
      if (activeSlot === 'A') {
        setSlotB(next); // pre-load next into hidden slot B first
        setTimeout(() => {
          Animated.parallel([
            Animated.timing(opacityA, { toValue: 0, duration: 900, useNativeDriver: true }),
            Animated.timing(opacityB, { toValue: 1, duration: 900, useNativeDriver: true }),
          ]).start(() => { setActiveSlot('B'); setFeaturedIdx(next); });
        }, 100); // 100ms for image to pre-load before fade starts
      } else {
        setSlotA(next);
        setTimeout(() => {
          Animated.parallel([
            Animated.timing(opacityA, { toValue: 1, duration: 900, useNativeDriver: true }),
            Animated.timing(opacityB, { toValue: 0, duration: 900, useNativeDriver: true }),
          ]).start(() => { setActiveSlot('A'); setFeaturedIdx(next); });
        }, 100);
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [featuredIdx, activeSlot]);

  const loadPastDrinks = async () => {
    try {
      // Path fixed 2026-09-11: this endpoint lives under sip_router.py's
      // /sip prefix (GET /sip/customer/{id}/past-custom-drinks), and now
      // requires an authenticated session (require_auth) rather than a
      // bare customer_id path param — both changed after this call was
      // written, so it was 404ing/401ing silently (already wrapped in a
      // swallowed catch).
      const { ok, data } = await apiFetch(`/sip/customer/${customer.id}/past-custom-drinks`);
      if (ok) setPastDrinks(data?.past_custom_drinks || []);
    } catch {}
  };

  const fetchMadisonWeather = async () => {
    try {
      const res  = await fetch(
        'https://api.open-meteo.com/v1/forecast?latitude=43.0731&longitude=-89.4012&current=weather_code&timezone=America%2FChicago'
      );
      const data = await res.json();
      const code = data?.current?.weather_code;
      if (code !== undefined) setWeatherEmoji(getWeatherEmoji(code));
    } catch {}
  };

  const greeting = getTimeGreeting();
  const favorites = pastDrinks.filter(d => d.is_favorite);
  const expandedFavDrink = favorites.find(d => (d.custom_drink_id ?? `${d.item_type}-${d.dasta_menu_item_id}-${d.food_item_id}`) === expandedFavId) || null;

  // Compute open/closed based on current time (Mon–Sun 7am–7pm CT)
  const nowH = new Date().getHours();
  const isOpen = nowH >= 7 && nowH < 19;

  return (
    <>
    <ScrollView
      style={S.screen}
      contentContainerStyle={{ paddingBottom: 120 }}
      pinchGestureEnabled
      maximumZoomScale={3}
      minimumZoomScale={1}
      bouncesZoom>
      <StatusBar style="light" />

      {/* Hero Header — espresso bar, no greeting card. The profile/cart/
          gift icon row used to live here — now a single persistent
          GlobalAccountHeader mounted once in MainTabs (2026-09-13, PC's
          ask: "keep My account/profile persistent across all screens,"
          same as the tab bar itself already is), not per-screen. */}
      {/* Same banner metrics as Rewards/More/Order (PC, 2026-10-01): 22pt title,
          2pt gap, subtitle, paddingBottom 20 -- it was the base wordmark's 28pt
          with 18 padding, so Home's banner sat taller than every other screen. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]} onLayout={(e) => setHeroHeight(e.nativeEvent.layout.height)}>
        <View style={[S.heroTop, { marginBottom: 0 }]}>
          {/* alignItems:'center' (2026-09-15, PC's ask) — "Dasta" is
              shorter than "CHAI & BAGELS" below it, so left-aligning both
              (the default before the account icons that used to share
              this row were moved out to GlobalAccountHeader) made "Dasta"
              look off-center against the wider subtitle. Centers the two
              lines against each other; the block itself still sits at
              the row's natural start position, unchanged. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 24 }}>
            <View style={{ alignItems: 'center' }} onLayout={(e) => setWordmarkBlockHeight(e.nativeEvent.layout.height)}>
              <Text style={[S.wordmark, { fontSize: 22 }]}>Dasta</Text>
              <Text style={[S.wordmarkSub, { marginTop: 2 }]}>CHAI & BAGELS</Text>
            </View>
            {/* Say[Mic]Go (2026-09-19 redesign, PC's live report: didn't like
                the "Say"/"Go" text lockup) — icon-only now, sized to the
                MEASURED height of the Dasta/CHAI & BAGELS block beside it
                (a guessed 44px still read as only "Dasta"-tall, not the
                full two-line block) so it reads as a standalone shortcut,
                not a wordmark suffix. gap:24 on the row above (was 10)
                keeps it from crowding "Dasta" -- same breathing room as
                the tab bar's own icon spacing. *0.85 (2026-09-19, PC's
                live report: matching the block's exact height read as
                slightly too big) -- a touch shorter than the full
                measured block height. Hidden entirely while
                say_mic_go_enabled is false (kill switch, no redeploy
                needed). */}
            {sayMicGoEnabled && (
              <Pressable onPress={() => setSayMicGoOpen(true)} hitSlop={8}>
                <Ionicons name="flash-outline" size={wordmarkBlockHeight * 0.85} color={C.saffron} />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {/* Greeting — ivory background, dark espresso text */}
      <View style={S.greetingStrip}>
        <Text style={S.greetingText}>
          {customer
            ? `${greeting}, ${customer.first_name} ${weatherEmoji}`
            : `${greeting}! ${weatherEmoji}`}
        </Text>
      </View>

      {/* SipSense™ Banner — left: text | right: image side by side */}
      <View style={S.section}>
        <View style={S.sipBannerSplit}>
          <View style={S.sipBannerRow}>
            <View style={S.sipBannerLeft}>
              <View>
                {/* The SipSense wordmark opens Meet SipSense (PC, 2026-09-30);
                    Craft My Drink below still starts the order flow. */}
                <Pressable style={{ flexDirection: 'row', alignItems: 'flex-start' }}
                  onPress={() => navigation.navigate('MeetSipSense')} accessibilityRole="link" accessibilityLabel="Meet SipSense">
                  <Text style={S.sipName} adjustsFontSizeToFit numberOfLines={1}>
                    <Text style={{ color: C.saffron }}>SipSense</Text>
                  </Text>
                  <Text style={S.tmMark}>™</Text>
                </Pressable>
                <Text style={S.sipDesc}>{'Tell me your mood\nor your craving -\nI will craft your\nperfect custom sip!'}</Text>
              </View>
              <Pressable
                style={({pressed}) => [S.sipBtn, pressed && {backgroundColor:'#c95722'}]}
                onPress={() => navigation.navigate('MainTabs', { initialTab: 'Order', customer })}>
                <Text style={S.sipBtnText}>Craft My Drink</Text>
              </Pressable>
            </View>
            <Image
              source={SipSenseBanner}
              style={S.sipBannerImg}
              resizeMode="contain"
            />
          </View>
          {/* Patent Pending line (2026-09-13, PC's ask #2) -- moved below
              Craft My Drink and centered across the full brown box width,
              not confined/left-justified inside the text column. */}
          <Text style={S.patentPendingText}>Patent Pending Technology</Text>
        </View>
      </View>

      {/* Favourites (2026-09-13 rework, PC's ask) — filtered to
          is_favorite=true (previously showed every past drink regardless,
          not matching its own "Favourites" label or web's actual
          Favorites/Custom-Sips split). Collapsed card stays the same
          small size; tapping opens the full detail as a modal instead of
          expanding in place. */}
      <View style={[S.section, { paddingTop: 8 }]}>
        <View style={S.secHeader}>
          <Text style={S.secTitle}>
            {customer ? 'Your Favourites' : 'Sign In for Favourites'}
          </Text>
        </View>
        {!customer ? (
          <View style={S.emptyFav}>
            <Text style={S.emptyFavText}>Sign in to see your past custom sips and reorder in one tap.</Text>
            <Pressable onPress={() => navigation.navigate('SignIn')}>
              <Text style={S.signInLink}>Sign in →</Text>
            </Pressable>
          </View>
        ) : favorites.length === 0 ? (
          <View style={S.emptyFav}>
            <Text style={S.emptyFavText}>No favourites yet — tap the ⭐ on any sip to add it here!</Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {favorites.map((d) => (
              <Pressable
                key={d.custom_drink_id ?? `${d.item_type}-${d.dasta_menu_item_id}-${d.food_item_id}`}
                style={S.favCard}
                onPress={() => setExpandedFavId(d.custom_drink_id ?? `${d.item_type}-${d.dasta_menu_item_id}-${d.food_item_id}`)}>
                <View style={{ flex: 1 }}>
                  <Text style={S.favName} numberOfLines={2}>{d.drink_name}</Text>
                  <Text style={S.favSub} numberOfLines={2}>{d.description}</Text>
                </View>
                <View style={[S.favBtn, { backgroundColor: FAV_THEMES[d.item_type === 'food' ? 'food' : (d.drink_source || 'custom')]?.border || C.espresso }]}>
                  <Text style={S.favBtnText}>{d.order_count > 0 ? 'Details ›' : 'New ✨'}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Fresh at Dasta — smooth cross-fade */}
      <View style={S.featSection}>
        <Text style={S.secTitle}>Fresh at Dasta</Text>
        <View style={S.featBig}>
          {/* Preload all images silently so they're in memory before cross-fade */}
          {FeaturedItems.map((item, i) => (
            <Image key={i} source={item.src} style={{ width: 0, height: 0, position: 'absolute' }} />
          ))}
          <Animated.Image
            source={FeaturedItems[slotA].src}
            style={[S.featBigImg, { opacity: opacityA }]}
            resizeMode="cover"
          />
          <Animated.Image
            source={FeaturedItems[slotB].src}
            style={[S.featBigImg, S.featBigImgAbs, { opacity: opacityB }]}
            resizeMode="cover"
          />
          <View style={S.featBigOverlay}>
            <Text style={S.featBigTag}>{FeaturedItems[featuredIdx].tag}</Text>
            <Text style={S.featBigName}>{FeaturedItems[featuredIdx].label}</Text>
          </View>
          <View style={S.featDots}>
            {FeaturedItems.map((_, i) => (
              <View key={i} style={[S.featDot, i === featuredIdx && S.featDotActive]} />
            ))}
          </View>
        </View>
      </View>

      {/* Location — address + hours + open/closed + Find nearest Dasta button */}
      <View style={[S.section, { paddingTop: 8, paddingBottom: 16, marginBottom: 8 }]}>
        <View style={S.infoCard}>
          <View style={S.infoRow}>
            <View style={S.infoLeft}>
              <Text style={{ fontSize: 18 }}>📍</Text>
              <Pressable onPress={() => openLink('https://maps.google.com/?q=151+W+Gorham+St+Madison+WI+53703')}>
                <Text style={S.infoTitle}>151 W Gorham St, Madison WI</Text>
                <Text style={S.infoHours}>🕐 Mon–Sun  7:00 AM – 7:00 PM</Text>
              </Pressable>
            </View>
            <View style={[S.openPill, !isOpen && S.closedPill]}>
              <Text style={[S.openText, !isOpen && S.closedText]}>{isOpen ? 'Open' : 'Closed'}</Text>
            </View>
          </View>
        </View>

        {/* NEW: Contextual location button — triggers OS permission only on tap */}
        <Pressable
          style={({ pressed }) => [{
            marginTop: 10,
            backgroundColor: C.espresso,
            borderRadius: 12,
            padding: 13,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            opacity: pressed ? 0.8 : 1,
          }]}
          onPress={() =>
            requestLocation((coords) => {
              setNearestStore(coords);
              // Open Google Maps with turn-by-turn from user's location to the store
              const dest = '151+W+Gorham+St+Madison+WI+53703';
              const url  = `https://maps.google.com/?saddr=${coords.latitude},${coords.longitude}&daddr=${dest}`;
              openLink(url);
            })
          }>
          <Ionicons name="navigate-outline" size={16} color={C.ivory} />
          <Text style={{ color: C.ivory, fontWeight: '700', fontSize: 13 }}>
            Get Directions to Dasta
          </Text>
        </Pressable>
      </View>

    </ScrollView>
    <SayMicGoOverlay
      visible={sayMicGoOpen}
      onClose={() => setSayMicGoOpen(false)}
      navigation={navigation}
      customer={customer}
      topInset={heroHeight}
    />
    <FavoriteDetailModal
      drink={expandedFavDrink}
      visible={!!expandedFavDrink}
      onClose={() => setExpandedFavId(null)}
      customer={customer}
      navigation={navigation}
      onChanged={loadPastDrinks}
    />
    {locationModal?.kind === 'denied' ? (
      <ConfirmModal
        visible
        title={locationModal.title}
        message={locationModal.message}
        confirmLabel="Open Settings"
        cancelLabel="Cancel"
        onConfirm={() => Linking.openSettings()}
        onClose={dismissLocationModal}
      />
    ) : (
      <InfoModal
        visible={locationModal?.kind === 'error'}
        title={locationModal?.title}
        message={locationModal?.message}
        onClose={dismissLocationModal}
      />
    )}
    </>
  );
}

// ── SIGN IN SCREEN ────────────────────────────────────────────
// Rewritten (2026-09-11) against the current Cognito passwordless flow
// (/auth/passwordless/start -> select-challenge -> verify). The old
// GET /customer-by-phone/{phone} lookup this screen used to call was
// deleted backend-side 2026-07-25 (see app.py's own removal comment) —
// that's why sign-in stopped working on this build. Mirrors
// SipSense_webflow's window.DastaPasswordless (head-code.html) exactly,
// minus WEB_AUTHN (passkey): no clean React Native equivalent for v1,
// so an account offering only a passkey is told to contact support
// instead (2026-09-20: no longer names dastacafe.com in this message,
// per PC's dastacafe.com-references audit). Sign-up is folded in here
// too — a brand-new identifier just
// creates its Cognito user on the same /passwordless/start call
// (server-side, see _create_cognito_user), so there's no separate
// "Create a Profile" entry point anymore; ProfileScreen below now only
// collects a name for a first-time verify.
const CHALLENGE_LABELS = { EMAIL_OTP: 'Email me a code', SMS_OTP: 'Text me a code' };

function SignInScreen({ navigation }) {
  const [step,          setStep]          = useState('identifier'); // identifier | chooser | code | mergeConfirm
  const [identifier,    setIdentifier]    = useState('');
  const [challenges,    setChallenges]    = useState([]);
  const [session,       setSession]       = useState(null);
  const [challengeName, setChallengeName] = useState(null);
  const [codeDest,      setCodeDest]      = useState('');
  const [code,          setCode]          = useState('');
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');
  const [infoModal,     setInfoModal]     = useState(null); // {title, message, onOk}
  const [mergeSummary,  setMergeSummary]  = useState(null); // {survivor, loser} from GET /auth/merge/pending
  const showInfo = (title, message, onOk) => setInfoModal({ title, message, onOk });

  const reset = () => {
    setStep('identifier'); setChallenges([]); setSession(null);
    setChallengeName(null); setCodeDest(''); setCode(''); setError('');
    setMergeSummary(null);
  };

  const handleStart = async (skipTrustedDevice) => {
    if (identifier.trim().length < 3) {
      showInfo('Required', 'Please enter your phone number or email.');
      return;
    }
    setLoading(true); setError('');
    try {
      // skipTrustedDevice (2026-09-12, "Use a code instead" fallback):
      // clears this device's trusted-device cookie server-side before
      // asking, forcing a genuine OTP challenge below even though the
      // cookie would otherwise short-circuit straight back to
      // trusted_device -- see the Face ID failure branch below.
      if (skipTrustedDevice) {
        try { await apiFetch('/auth/trusted-device/forget', { method: 'POST' }); } catch {}
      }
      const { ok, data } = await apiFetch('/auth/passwordless/start', {
        method: 'POST',
        body: { identifier: identifier.trim(), remember_device: true },
      });
      if (!ok) { setError(data?.detail || 'Could not start sign-in. Please try again.'); return; }

      // Trusted-device fast path (2026-09-12) — this device already
      // completed a full OTP sign-in for this identifier before and
      // carries a valid dasta_trusted_device cookie
      // (_try_trusted_device_login, auth_router.py); the backend has
      // ALREADY set the session cookie by the time this response comes
      // back. SMS/email OTP is meant to be a first-time/new-device
      // thing only, matching web (see head-code.html's ddP_start
      // checking this exact outcome) and per PC's explicit direction —
      // gate this fast path behind Face ID, if the customer has Quick
      // Unlock on, as the mobile-only extra check (same gate
      // BootstrapScreen applies on a cold app relaunch).
      if (data.outcome === 'trusted_device') {
        const quickUnlockOn = await getQuickUnlockEnabled();
        if (quickUnlockOn) {
          const { ok: bioOk } = await runBiometricCheck('Unlock Dasta');
          if (!bioOk) {
            setError('Face ID was not confirmed.');
            return;
          }
        }
        navigation.replace('MainTabs', { customer: data.customer });
        return;
      }

      const offered = (data.available_challenges || []).filter(c => c !== 'WEB_AUTHN');
      if (offered.length === 0) {
        setError('This account can only sign in with a passkey right now — please contact support for help.');
      } else if (offered.length === 1) {
        await handleSelectChallenge(offered[0], data.session);
      } else {
        setSession(data.session);
        setChallenges(offered);
        setStep('chooser');
      }
    } catch {
      setError('Could not reach Dasta server. Please try again.');
    } finally { setLoading(false); }
  };

  const handleSelectChallenge = async (challenge, sessionOverride) => {
    setLoading(true); setError('');
    try {
      const { ok, data } = await apiFetch('/auth/passwordless/select-challenge', {
        method: 'POST',
        body: { identifier: identifier.trim(), session: sessionOverride || session, challenge },
      });
      if (!ok) { setError(data?.detail || 'Could not continue sign-in. Please try again.'); return; }
      setSession(data.session);
      setChallengeName(data.challenge_name);
      setCodeDest((data.challenge_parameters || {}).CODE_DELIVERY_DESTINATION || '');
      setStep('code');
    } catch {
      setError('Could not reach Dasta server. Please try again.');
    } finally { setLoading(false); }
  };

  // Sign in with Apple (2026-09-16) — reuses the existing Managed Login
  // Authorization Code + PKCE flow (/auth/login, /auth/callback) with
  // Cognito's own federated identity providers ("SignInWithApple",
  // "Google"), rather than a separate native-token-verification path
  // per provider: /auth/callback's ensure_customer_identity already
  // maps ANY new Cognito identity to a Dasta customer row generically,
  // so nothing server-side needed to learn about either provider
  // specifically beyond /auth/login's ?provider= branch. Shared here
  // since the flow is identical for both -- only the provider slug and
  // the copy in the error message differ. openAuthSessionAsync (not
  // openBrowserAsync, the persistent in-app browser used elsewhere for
  // web content) opens a system-managed auth session that closes itself
  // the moment the redirect_uri below is hit, matching how a native
  // OAuth handoff should feel rather than a lingering browser tab.
  //
  // dastasipsensetest:// (app.json's "scheme") is what closes the loop —
  // /auth/social/callback/<provider>'s final redirect target.
  //
  // REAL BUG found on a real device (2026-09-16): this used to assume iOS
  // shares openAuthSessionAsync's cookie store with the app's own fetch()
  // calls, so GET /auth/me right after would already see the customer
  // signed in. Confirmed live it does NOT reliably work that way here —
  // backend logs showed a clean success for both Apple and Google (no
  // error, real session created), yet the very next /auth/me came back
  // logged-out on the device every time. Fixed by having the redirect
  // itself carry a short-lived, single-purpose exchange_token (parsed out
  // of result.url below, not received via any cookie), traded in via a
  // normal POST /auth/social/exchange call — an ordinary apiFetch in this
  // app's own request context, same as every other endpoint it already
  // calls successfully, sidestepping the cross-context cookie question
  // entirely instead of depending on it.
  const handleSocialSignIn = async (provider, label) => {
    setLoading(true); setError('');
    try {
      const redirectUrl = 'dastasipsensetest://auth-callback'; // matches app.json's "scheme"
      const authUrl = `${API_BASE_URL}/auth/login?provider=${provider}&redirect_to=${encodeURIComponent(redirectUrl)}`;
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      if (result.type === 'cancel' || result.type === 'dismiss') { setLoading(false); return; } // customer backed out — not an error
      if (result.type !== 'success') {
        setError(`Sign-in with ${label} didn't complete (${result.type}). Please try again.`);
        setLoading(false);
        return;
      }
      const exchangeToken = result.url ? (() => {
        try { return new URL(result.url).searchParams.get('exchange_token'); } catch { return null; }
      })() : null;
      if (!exchangeToken) {
        const authErrorDescription = result.url ? (() => {
          try { return new URL(result.url).searchParams.get('auth_error_description'); } catch { return null; }
        })() : null;
        setError(authErrorDescription || `Sign-in with ${label} didn't complete. Please try again.`);
        setLoading(false);
        return;
      }
      const exchange = await apiFetch('/auth/social/exchange', { method: 'POST', body: { exchange_token: exchangeToken } });
      if (!exchange.ok) {
        setError(`Sign-in with ${label} didn't complete. Please try again.`);
        setLoading(false);
        return;
      }
      const { ok, data, networkError } = await apiFetch('/auth/me');
      if (!ok || !data?.customer) {
        setError(`Signed in with ${label}, but could not load your account (${networkError ? 'network error' : 'not signed in'}). Please try again.`);
        setLoading(false);
        return;
      }
      navigation.replace('MainTabs', { customer: data.customer });
    } catch (e) {
      setError(`Could not reach Dasta server${e?.message ? `: ${e.message}` : ''}. Please try again.`);
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!code.trim()) return;
    setLoading(true); setError('');
    try {
      // timeoutMs: 20000 (2026-09-20, real bug found live-testing the merge
      // flow) -- this call sometimes also runs ensure_customer_identity's
      // conflict-detection queries + merge-cookie signing on top of the
      // normal Cognito round trip, and the default 8s client timeout fired
      // while the server was still working -- confirmed via server logs:
      // the request completed 200 OK a few seconds after the client had
      // already given up and shown "Could not verify that code," burning a
      // single-use Cognito session in the process. Longer timeout here
      // avoids the false failure; the server-side work itself wasn't slow
      // in absolute terms, just occasionally past 8s.
      const { ok, data } = await apiFetch('/auth/passwordless/verify', {
        method: 'POST',
        body: {
          identifier: identifier.trim(), session, challenge_name: challengeName,
          code: code.trim(), remember_device: true,
        },
        timeoutMs: 20000,
      });
      if (!ok) { setError(data?.detail || 'Could not verify that code. Please try again.'); return; }
      if (!data.success) {
        setSession(data.session);
        setError("That code didn't match — please try again.");
        setCode('');
        return;
      }
      if (data.outcome === 'merge_pending') {
        // Native merge confirmation (2026-09-20, replaces a dastacafe.com
        // hand-off) -- the passwordless/verify call above already set the
        // signed, HttpOnly dasta_merge_pending cookie (auth_router.py),
        // which GET /auth/merge/pending and POST /auth/merge/confirm both
        // read directly; nothing else to pass along here.
        const { ok: pOk, data: pData } = await apiFetch('/auth/merge/pending');
        if (!pOk || !pData?.success) {
          setError(pData?.detail || 'Could not load your account details for combining.');
          return;
        }
        setMergeSummary(pData);
        setStep('mergeConfirm');
        return;
      }
      if (data.is_new_customer) {
        navigation.replace('ProfileStack', { customer: data.customer });
      } else {
        navigation.replace('MainTabs', { customer: data.customer });
      }
    } catch {
      setError('Could not reach Dasta server. Please try again.');
    } finally { setLoading(false); }
  };

  // Combine Accounts (2026-09-20) -- explicit customer action per
  // /auth/merge/confirm's own "never automatic" requirement. A fresh
  // GET /auth/me afterward (rather than trusting merge_customers()'s own
  // return shape) matches how handleSocialSignIn already confirms a
  // session landed, instead of a second parallel convention.
  const confirmMerge = async () => {
    setLoading(true); setError('');
    try {
      const { ok, data } = await apiFetch('/auth/merge/confirm', { method: 'POST', timeoutMs: 20000 });
      if (!ok || !data?.success) {
        setError(data?.detail || 'Could not combine your accounts. Please try again.');
        return;
      }
      const { ok: meOk, data: meData } = await apiFetch('/auth/me');
      if (!meOk || !meData?.customer) {
        showInfo('Accounts combined', 'Your accounts were combined — please sign in again.', reset);
        return;
      }
      navigation.replace('MainTabs', { customer: meData.customer });
    } catch {
      setError('Could not reach Dasta server. Please try again.');
    } finally { setLoading(false); }
  };

  return (
    <>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView
      style={[S.screen, { backgroundColor: C.espresso }]}
      contentContainerStyle={S.centered}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      <StatusBar style="light" />

      <View style={S.signInHeader}>
        <Text style={[S.wordmark, { fontSize: 42, color: C.ivory }]}>Dasta</Text>
        <Text style={[S.wordmarkSub, { color: C.gold }]}>CHAI & BAGELS</Text>
        <Text style={S.goldTagline}>✦ Madison, Wisconsin ✦</Text>
      </View>

      <View style={S.card}>
        <Text style={S.cardTitle}>{step === 'mergeConfirm' ? 'Combine Your Accounts' : 'Welcome'}</Text>

        {step === 'identifier' && (
          <>
            <Text style={S.cardSub}>Sign in, or create an account with your phone or email</Text>
            <TextInput
              style={S.input}
              placeholder="Phone number or email"
              placeholderTextColor={C.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={identifier}
              onChangeText={setIdentifier}
            />
            {!!error && <Text style={S.errorText}>{error}</Text>}
            <Pressable style={({pressed})=>[S.btnSaffron,pressed&&{backgroundColor:"#c95722"}]} onPress={() => handleStart()} disabled={loading}>
              {loading
                ? <ActivityIndicator color={C.ivory} />
                : <Text style={S.btnSaffronText}>Continue</Text>}
            </Pressable>
            {error === 'Face ID was not confirmed.' && (
              <Pressable onPress={() => handleStart(true)} disabled={loading}>
                <Text style={S.linkText}>Use a code instead</Text>
              </Pressable>
            )}
          </>
        )}

        {step === 'chooser' && (
          <>
            <Text style={S.cardSub}>How would you like to sign in?</Text>
            {challenges.map(c => (
              <Pressable key={c} style={({pressed})=>[S.btnSaffron,pressed&&{backgroundColor:"#c95722"}]}
                onPress={() => handleSelectChallenge(c)} disabled={loading}>
                <Text style={S.btnSaffronText}>{CHALLENGE_LABELS[c] || c}</Text>
              </Pressable>
            ))}
            {!!error && <Text style={S.errorText}>{error}</Text>}
            <Pressable onPress={reset} disabled={loading}>
              <Text style={S.linkText}>← Use a different phone or email</Text>
            </Pressable>
          </>
        )}

        {step === 'code' && (
          <>
            <Text style={S.cardSub}>{codeDest ? `Code sent to ${codeDest}` : 'Enter the code we sent you'}</Text>
            <TextInput
              style={[S.input, { textAlign: 'center', letterSpacing: 4 }]}
              placeholder="Enter code"
              placeholderTextColor={C.muted}
              keyboardType="number-pad"
              value={code}
              onChangeText={setCode}
              autoFocus
            />
            {!!error && <Text style={S.errorText}>{error}</Text>}
            <Pressable style={({pressed})=>[S.btnSaffron,pressed&&{backgroundColor:"#c95722"}]} onPress={handleVerify} disabled={loading}>
              {loading
                ? <ActivityIndicator color={C.ivory} />
                : <Text style={S.btnSaffronText}>Verify</Text>}
            </Pressable>
            <Pressable onPress={reset} disabled={loading}>
              <Text style={S.linkText}>← Use a different phone or email</Text>
            </Pressable>
          </>
        )}

        {step === 'mergeConfirm' && mergeSummary && (
          <>
            <Text style={S.cardSub}>
              We found two Dasta accounts under you. Combining them keeps all
              your Leaves, rewards, and order history together in one
              account — this can't be undone.
            </Text>
            <View style={[S.card, { borderColor: C.saffron, marginBottom: 12, padding: 16 }]}>
              <Text style={S.fieldLabel}>KEEPING</Text>
              <Text style={{ color: C.charcoal, fontWeight: '700' }}>
                {mergeSummary.survivor.phone || mergeSummary.survivor.email}
              </Text>
              <Text style={S.cardSub}>{mergeSummary.survivor.lifetime_leaves || 0} Leaves</Text>
            </View>
            <View style={[S.card, { marginBottom: 16, padding: 16 }]}>
              <Text style={S.fieldLabel}>COMBINING IN</Text>
              <Text style={{ color: C.charcoal, fontWeight: '700' }}>
                {mergeSummary.loser.phone || mergeSummary.loser.email}
              </Text>
              <Text style={S.cardSub}>{mergeSummary.loser.lifetime_leaves || 0} Leaves</Text>
            </View>
            {!!error && <Text style={S.errorText}>{error}</Text>}
            <Pressable style={({pressed})=>[S.btnSaffron,pressed&&{backgroundColor:"#c95722"}]} onPress={confirmMerge} disabled={loading}>
              {loading
                ? <ActivityIndicator color={C.ivory} />
                : <Text style={S.btnSaffronText}>Combine Accounts</Text>}
            </Pressable>
            <Pressable onPress={reset} disabled={loading}>
              <Text style={S.linkText}>Not now</Text>
            </Pressable>
          </>
        )}

        {step !== 'mergeConfirm' && (
          <>
            <View style={S.dividerRow}>
              <View style={S.dividerLine} />
              <Text style={S.dividerText}>or continue with</Text>
              <View style={S.dividerLine} />
            </View>

            {/* Sign in with Apple/Google (2026-09-16) -- these two buttons
                already existed as a "Coming Soon" placeholder; wired to the
                real flow here rather than adding a second, separate pair of
                buttons elsewhere on this screen. Both go through the same
                backend-brokered browser OAuth redirect (not Apple's native
                ASAuthorizationAppleIDProvider bridge), so Apple sign-in works
                identically on Android -- no platform gate needed. */}
            <Pressable style={({pressed})=>[S.btnApple,pressed&&{backgroundColor:"#3D2B25"}]}
              onPress={() => handleSocialSignIn('apple', 'Apple')} disabled={loading}>
              {loading
                ? <ActivityIndicator color={C.white} />
                : <><Image source={require('./assets/apple-logo.png')} style={S.appleLogoImg} /><Text style={S.btnAppleText}>Sign in with Apple</Text></>}
            </Pressable>

            <Pressable style={({pressed})=>[S.btnGoogle,pressed&&{backgroundColor:"#f0f0f0"}]}
              onPress={() => handleSocialSignIn('google', 'Google')} disabled={loading}>
              {loading
                ? <ActivityIndicator color={C.charcoal} />
                : <><Image source={require('./assets/google-logo.png')} style={S.googleLogoImg} /><Text style={S.btnGoogleText}>Sign in with Google</Text></>}
            </Pressable>

            <View style={S.infoDivider} />

            <Pressable style={S.btnEspresso}
              onPress={() => navigation.navigate('MainTabs', { customer: null })}>
              <Text style={S.btnEspressoText}>Continue as Guest</Text>
            </Pressable>
          </>
        )}
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }}
    />
    </>
  );
}

// ── COMPLETE PROFILE SCREEN ───────────────────────────────────
// Reached only right after a brand-new customer's first successful
// /auth/passwordless/verify (is_new_customer === true) — the account
// and its Cognito identity already exist by this point, this just
// collects a name via PATCH /auth/profile (auth_router.py; cookie-
// session authenticated, no identifier/phone/email in the payload —
// those were already fixed at sign-in). Old POST /create-customer-
// profile this screen used to call was removed 2026-07-25 as a
// security fix (it was an unauthenticated customer-creation path).
function ProfileScreen({ navigation, route }) {
  const customer = route?.params?.customer || null;
  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [dob,       setDob]       = useState('');
  const [loading,   setLoading]   = useState(false);
  const [infoModal, setInfoModal] = useState(null); // {title, message}
  const showInfo = (title, message) => setInfoModal({ title, message });

  const handleCreate = async () => {
    if (!firstName.trim()) { showInfo('Required', 'Please enter your first name.'); return; }
    if (dob && (dob.length !== 4 || isNaN(dob))) {
      showInfo('Invalid Birthday', 'Please enter birthday as MMDD e.g. 0314 for March 14.'); return;
    }
    setLoading(true);
    try {
      const { ok, data } = await apiFetch('/auth/profile', {
        method: 'PATCH',
        body: {
          first_name: firstName.trim(),
          last_name:  lastName.trim() || null,
          dob_mmdd:   dob.trim()      || null,
        },
      });
      if (ok && data?.success) {
        navigation.replace('NotifyPerm', { customer: data.customer });
      } else {
        showInfo('Error', data?.detail || 'Could not save your profile.');
      }
    } catch {
      showInfo('Error', 'Could not reach Dasta server.');
    } finally { setLoading(false); }
  };

  return (
    <>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView
      style={[S.screen, { backgroundColor: C.espresso }]}
      contentContainerStyle={S.centered}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      <StatusBar style="light" />

      <View style={S.signInHeader}>
        <Text style={[S.wordmark, { fontSize: 36, color: C.ivory }]}>Dasta</Text>
        <Text style={[S.wordmarkSub, { color: C.gold }]}>CHAI & BAGELS</Text>
      </View>

      <View style={S.card}>
        <Text style={S.cardTitle}>Welcome to Dasta!</Text>
        <Text style={S.cardSub}>Tell us your name for favourites & history</Text>

        <TextInput style={S.input} placeholder="First name *"
          placeholderTextColor={C.muted} value={firstName} onChangeText={setFirstName} />
        <TextInput style={S.input} placeholder="Last name (optional)"
          placeholderTextColor={C.muted} value={lastName} onChangeText={setLastName} />
        <TextInput style={S.input} placeholder="Birthday MMDD e.g. 0314 (optional)"
          placeholderTextColor={C.muted} keyboardType="number-pad"
          maxLength={4} value={dob} onChangeText={setDob} />
        <Text style={S.fieldHint}>Month + Day only — we use this for birthday surprises! 🎂</Text>

        <Pressable style={[S.btnSaffron, { marginTop: 8 }]} onPress={handleCreate} disabled={loading}>
          {loading ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Continue</Text>}
        </Pressable>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => setInfoModal(null)}
    />
    </>
  );
}

// ── NEW: NOTIFY PERMISSION SCREEN ─────────────────────────────
// Sits between ProfileScreen and MainTabs in the navigation stack.
// Requests the OS-level push notification permission, then navigates to
// MainTabs. Compatible: iOS (APNs via Expo), Android 13+ (FCM +
// POST_NOTIFICATIONS); Webflow handles web push separately via the
// browser Notification API.
//
// patchPermissions() used to persist push_permission/push_token and an
// onboarding_complete flag to dasta_db via PATCH /customer/{id}/
// permissions and /customer/{id}/onboarding-complete — removed
// 2026-09-11: neither endpoint existed anywhere in the backend at the
// time. A real backend now exists (2026-09-24, see requestPushPermission
// AndRegister above) -- handleAllow below calls it on a 'granted' result,
// the same shared helper NotificationPreferencesScreen's toggle uses.
//
// Post-denial Settings fallback (2026-09-24, PC's ask -- he's seen this
// pattern in other apps): tapping "Don't Allow" on the native dialog used
// to just silently continue into MainTabs with no feedback at all. Now
// shows a ConfirmModal offering Open Settings, same visual pattern
// OrderScreen's location-denied fallback already uses (Linking.
// openSettings()) -- an offer, not a gate; Continue proceeds exactly as
// before. handleSkip (the in-app "skip" button, separate from the native
// dialog) is UNCHANGED -- no Settings prompt there, since the customer
// never got a native denial to react to.
function NotifyPermScreen({ navigation, route }) {
  const customer = route?.params?.customer || null;
  const [loading, setLoading] = useState(false);
  const [showDeniedModal, setShowDeniedModal] = useState(false);

  const handleAllow = async () => {
    setLoading(true);
    const result = await requestPushPermissionAndRegister();
    setLoading(false);
    if (result === 'denied') {
      setShowDeniedModal(true);
      return; // stay on this screen -- the modal itself offers Continue
    }
    // 'granted' or 'error' (permission itself may still be on even if
    // token registration failed) -- never block entry into the app over
    // registration failure.
    navigation.navigate('MainTabs', { customer });
  };

  const continueIntoApp = () => {
    setShowDeniedModal(false);
    navigation.navigate('MainTabs', { customer });
  };

  const handleSkip = () => {
    // No native dialog was shown here, so no Settings prompt -- the OS
    // itself remembers "not asked" and can still prompt from the app's
    // own permission request next time regardless.
    navigation.navigate('MainTabs', { customer });
  };

  return (
    <>
    <ScrollView
      style={[S.screen, { backgroundColor: C.espresso }]}
      contentContainerStyle={S.centered}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      <StatusBar style="light" />

      <View style={S.signInHeader}>
        <Text style={[S.wordmark, { fontSize: 36, color: C.ivory }]}>Dasta</Text>
        <Text style={[S.wordmarkSub, { color: C.gold }]}>CHAI & BAGELS</Text>
      </View>

      <View style={S.card}>

        {/* Bell icon */}
        <View style={{
          width: 64, height: 64, borderRadius: 16,
          backgroundColor: '#FFF3E8',
          alignItems: 'center', justifyContent: 'center',
          alignSelf: 'center', marginBottom: 16,
        }}>
          <Text style={{ fontSize: 30 }}>🔔</Text>
        </View>

        <Text style={S.cardTitle}>Stay in the loop</Text>
        <Text style={[S.cardSub, { marginBottom: 20 }]}>
          Get notified when your favourite drink is available or when SipSense™
          creates a new recommendation just for you.
        </Text>

        {/* Value propositions */}
        {[
          { icon: '☕', text: 'Favourite drink back in stock alerts'      },
          { icon: '✨', text: 'Personalised SipSense™ recommendations'   },
          { icon: '🎂', text: 'Birthday surprise notification'            },
          { icon: '🏷️', text: 'Seasonal specials & limited drops'        },
        ].map((item, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Text style={{ fontSize: 16 }}>{item.icon}</Text>
            <Text style={{ color: C.charcoal, fontSize: 13, flex: 1 }}>{item.text}</Text>
          </View>
        ))}

        <View style={{ height: 20 }} />

        <Pressable
          style={({ pressed }) => [S.btnSaffron, pressed && { backgroundColor: '#c95722' }]}
          onPress={handleAllow}
          disabled={loading}>
          {loading
            ? <ActivityIndicator color={C.ivory} />
            : <Text style={S.btnSaffronText}>Allow Notifications</Text>}
        </Pressable>

        <Pressable onPress={handleSkip} disabled={loading}>
          <Text style={[S.linkText, { color: C.black, marginTop: 8 }]}>
            Not now — I'll enable later in Settings
          </Text>
        </Pressable>

      </View>
    </ScrollView>
    <ConfirmModal
      visible={showDeniedModal}
      title="Notifications are off"
      message="You can still turn on notifications later in Settings, or from Notification Preferences in your account."
      confirmLabel="Open Settings"
      cancelLabel="Continue"
      onConfirm={() => Linking.openSettings()}
      onClose={continueIntoApp}
    />
    </>
  );
}

// ── ORDER / SIPSENSE SCREEN ───────────────────────────────────
// ── TODAY'S DISCOVERY MODAL (2026-09-13) ─────────────────────────
// Native rebuild of find-my-drink_embed3.html's openDiscoveryPopup —
// same data.discovery shape /generate-custom-drink already returns
// (log_id, sentence, personal_connection, did_you_know, region_label,
// color_theme, closing_line, local_pulse, signoff, category). Web's
// header uses a CSS gradient (color_theme.bg -> bg2); this uses a flat
// color_theme.bg background instead — no gradient library pulled in
// just for this one panel. Bottom-box priority matches web exactly:
// campus rhythm signoff > local pulse event > closing line.
function DiscoveryModal({ discovery, drinkName, visible, onClose }) {
  if (!visible || !discovery) return null;
  const ct = discovery.color_theme || {};
  const bg = ct.bg || '#534AB7';
  const accent = ct.accent || '#EEEDFE';
  const accentText = ct.accent_text || '#26215C';
  const accentBorder = ct.accent_border || '#534AB7';

  const lp = discovery.local_pulse;
  let bottomBox = null;
  if (discovery.signoff) {
    bottomBox = (
      <View style={[S.discoveryBottomBox, { backgroundColor: '#EEEDFE', borderColor: '#534AB7' }]}>
        <Text style={{ fontSize: 20 }}>🎓</Text>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={{ fontSize: 13, fontWeight: '500', color: '#26215C', fontStyle: 'italic' }}>"{discovery.signoff}"</Text>
          {!!discovery.region_label && <Text style={{ fontSize: 11, color: '#534AB7', opacity: 0.75, marginTop: 2 }}>{discovery.region_label}</Text>}
        </View>
      </View>
    );
  } else if (lp?.event_name) {
    const distStr = lp.event_date && lp.area_name ? `${lp.event_date} · ${lp.area_name}` : (lp.area_name || lp.event_date || 'Madison');
    bottomBox = (
      <View style={[S.discoveryBottomBox, { backgroundColor: accent, borderColor: accentBorder, flexDirection: 'column', alignItems: 'stretch' }]}>
        <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, color: accentBorder, textTransform: 'uppercase', marginBottom: 6 }}>❤️ LOCAL VIBES</Text>
        <Text style={{ fontSize: 13, fontWeight: '500', color: accentText }}>{lp.event_name} <Text style={{ fontWeight: '400', opacity: 0.8 }}> · {lp.event_date}</Text></Text>
        {!!lp.connection && <Text style={{ fontSize: 13, color: accentText, opacity: 0.9, marginTop: 4 }}>{lp.connection}</Text>}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <Text style={{ fontSize: 11, color: accentBorder, opacity: 0.7 }}>{distStr}</Text>
          {!!lp.display_url && (
            <Pressable onPress={() => openLink(lp.display_url)} style={{ backgroundColor: ct.link_bg || accent, borderColor: ct.link_border || accentBorder, borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: '500', color: ct.link_text || accentText }}>{lp.display_name} →</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  } else if (discovery.closing_line) {
    bottomBox = (
      <View style={[S.discoveryBottomBox, { backgroundColor: accent, flexDirection: 'column', alignItems: 'stretch', borderWidth: 0 }]}>
        <Text style={{ fontSize: 13, fontStyle: 'italic', color: accentText }}>"{discovery.closing_line}"</Text>
        <Text style={{ fontSize: 11, color: accentBorder, opacity: 0.7, marginTop: 4 }}>A thought from Dasta</Text>
      </View>
    );
  }

  return (
    <View style={S.modalOverlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={S.modalSheet}>
        <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
          <View style={[S.discoveryHeader, { backgroundColor: bg }]}>
            <Pressable onPress={onClose} style={S.discoveryCloseBtn} hitSlop={10}><Text style={{ color: '#fff', fontSize: 16 }}>✕</Text></Pressable>
            <Text style={S.discoveryEyebrow}>🌍 Today's Discovery</Text>
            <Text style={S.discoveryDrinkName}>{drinkName}</Text>
            {!!discovery.region_label && <Text style={S.discoveryRegion}>{discovery.region_label}</Text>}
          </View>
          <View style={{ padding: 20, paddingBottom: 6 }}>
            <Text style={S.discoverySentence}>
              Your <Text style={{ color: bg, fontWeight: '600' }}>{drinkName}</Text>
              {discovery.personal_connection ? ` — ${discovery.personal_connection}` : ` — ${discovery.sentence}`}
            </Text>
            {!!discovery.did_you_know && (
              <View style={[S.discoveryDykBox, { backgroundColor: accent, borderColor: accentBorder }]}>
                <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, color: accentText, textTransform: 'uppercase', marginBottom: 5 }}>Did you know?</Text>
                <Text style={{ fontSize: 13, color: accentText, opacity: 0.9, lineHeight: 19 }}>{discovery.did_you_know}</Text>
              </View>
            )}
          </View>
          {bottomBox && <View style={{ paddingHorizontal: 18 }}>{bottomBox}</View>}
        </ScrollView>
      </View>
    </View>
  );
}

// ── CRAFTING LOADER CARD (2026-09-13) ────────────────────────────
// Native port of find-my-drink_embed3.html's buildSipSenseLoaderCard/
// startSipSenseLoader — same rotating messages (1.2s cadence, elapsed
// seconds appended), same palette (#E26A2C border on #fff3e8), same
// "Stop crafting" affordance. Shown in place of the input form while
// /generate-custom-drink is in flight.
const CRAFTING_MESSAGES = [
  '☕ Brewing ideas...',
  '🌶️ Reading your flavor mood...',
  '🥛 Balancing sweetness and creaminess...',
  '🥯 Checking possible food pairings...',
  '✨ Finalizing your recommendation...',
];
function CraftingLoaderCard({ onStop }) {
  const [elapsed, setElapsed] = useState(0);
  const [msgIdx, setMsgIdx] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t1 = setInterval(() => setElapsed((Date.now() - start) / 1000), 1200);
    const t2 = setInterval(() => setMsgIdx(i => (i + 1) % CRAFTING_MESSAGES.length), 1200);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, []);
  // Centered overlay (2026-09-13, PC's ask) — was an inline card below the
  // form that needed a scroll to see; now shown the same way Build &
  // Order's "Building Your Sip…" overlay already is, dead center, no
  // scrolling required.
  return (
    <View style={S.buildOverlay}>
      <View style={S.craftLoaderCard}>
        <Text style={S.craftLoaderTitle}>{CRAFTING_MESSAGES[msgIdx]} {elapsed.toFixed(1)}s</Text>
        <Text style={S.craftLoaderDesc}>Blending your craving with Dasta flavors.</Text>
        <Pressable style={S.craftStopBtn} onPress={onStop}><Text style={S.craftStopBtnText}>Stop crafting</Text></Pressable>
      </View>
    </View>
  );
}

// ── BUILDING YOUR SIP OVERLAY (2026-09-13) ───────────────────────
// Native port of find-my-drink_embed8.html's "Building Your Sip…"
// overlay — same rotating messages (2.5s cadence), same elapsed-seconds
// heading (250ms tick), same "Stop building" affordance (which — exactly
// like web — only hides the overlay; the drink is already added to the
// cart by the time this shows, and craft-the-sip keeps running/finishing
// server-side regardless, same "item is still handled" comment web's own
// code carries).
const BUILD_MESSAGES = [
  'Balancing ingredients and portions…',
  'Dialing in shots, pumps, and sweetness…',
  'Checking preparation and finishing touches…',
  'Creating your Dasta Build Ticket…',
];
function BuildingSipOverlay({ visible, onStop }) {
  const [elapsed, setElapsed] = useState(0);
  const [msgIdx, setMsgIdx] = useState(0);
  const barAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    setElapsed(0); setMsgIdx(0);
    const start = Date.now();
    const t1 = setInterval(() => setElapsed((Date.now() - start) / 1000), 250);
    const t2 = setInterval(() => setMsgIdx(i => (i + 1) % BUILD_MESSAGES.length), 2500);
    const loop = Animated.loop(
      Animated.timing(barAnim, { toValue: 1, duration: 1100, useNativeDriver: true })
    );
    barAnim.setValue(0);
    loop.start();
    return () => { clearInterval(t1); clearInterval(t2); loop.stop(); };
  }, [visible]);
  if (!visible) return null;
  const translateX = barAnim.interpolate({ inputRange: [0, 1], outputRange: [-140, 300] });
  return (
    <View style={S.buildOverlay}>
      <View style={S.buildCard}>
        <Text style={S.buildHead}>Building Your Sip… {elapsed.toFixed(0)}s</Text>
        <Text style={S.buildSub}>Turning your custom creation into a barista-ready recipe.</Text>
        <View style={S.buildBarTrack}>
          <Animated.View style={[S.buildBarFill, { transform: [{ translateX }] }]} />
        </View>
        <Text style={S.buildRot}>{BUILD_MESSAGES[msgIdx]}</Text>
        <Pressable style={S.craftStopBtn} onPress={onStop}><Text style={S.craftStopBtnText}>Stop building</Text></Pressable>
      </View>
    </View>
  );
}

function OrderScreen({ route, navigation, onHeaderBack }) {
  const { guest, customer, presetDrink } = route?.params || { guest: true, customer: null };
  const scrollRef = useRef(null);
  const sipPagerRef = useRef(null);
  const wideSipPagerRef = useRef(null);
  const cart = useCart();
  const { width: screenWidth } = useWindowDimensions();

  const [userText,         setUserText]         = useState('');
  const [loading,          setLoading]          = useState(false);
  const [drink,            setDrink]            = useState(null);
  const [price,            setPrice]            = useState(null);
  const [loadingPrice,     setLoadingPrice]     = useState(false);
  const [ordering,         setOrdering]         = useState(false);
  const [ordered,          setOrdered]          = useState(false);
  const [lastInputWasChip, setLastInputWasChip] = useState(false);
  const [pairing,          setPairing]          = useState(null); // custom sip's pairing
  // Recommendation swipe navigation (2026-09-19, PC confirmed) -- circle
  // and menu sips previously had no pairing state at all (their food
  // pairing was fetched fresh and handed straight to the standalone
  // Pairing screen via navigation params, then discarded on return).
  // Tracked per-source now so each type's pairing page can be inserted
  // into the dynamic swipe sequence and survive swiping away and back.
  const [circlePairing,    setCirclePairing]    = useState(null);
  const [menuPairing,      setMenuPairing]      = useState(null);
  const [discoveryOpen,    setDiscoveryOpen]    = useState(false);

  // Voice input (2026-09-14, PC's ask — port of dastacafe.com's mic
  // button + language selector). micState: 'idle' | 'recording' |
  // 'processing', mirroring find-my-drink_embed2.html's setMic() exactly.
  const [micState,     setMicState]     = useState('idle');
  const [micStatus,    setMicStatus]    = useState('');
  const [heardEcho,    setHeardEcho]    = useState('');
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const micMaxTimerRef = useRef(null);
  // PATH A below sets this true the instant a real on-device result comes
  // back, mirroring web's own `got` flag (find-my-drink_embed2.html) — lets
  // the error/end handlers tell "user actually said something" apart from
  // "recognizer gave up with nothing", which is when we fall back to PATH B.
  const sttGotResultRef = useRef(false);
  // Typed-vs-voice source tracking (2026-09-15, PC's ask #2) -- "typed
  // text should show as-is on screen but translate to English before it
  // goes to backend." Voice already has its own correct handling (the
  // Whisper path translates non-English speech to English already; the
  // on-device path is a deliberate raw pass-through for en/hi per PC's
  // own earlier choice) -- re-translating voice-sourced text here would
  // be redundant at best and risk altering Hindi's already-approved
  // untranslated behavior at worst. A ref (not state) since it only
  // needs to be read once, at generate time, never to trigger a render.
  const lastInputSourceRef = useRef('typed'); // 'typed' | 'voice'
  // Selected language lives in LanguageContext (2026-09-15). The picker
  // pill itself briefly lived in the persistent GlobalAccountHeader
  // (moved there, then moved back here same day) — PC's live report:
  // sitting in the global header collided with other screens' own
  // controls, and since language only actually affects SipSense (this
  // screen) for now, it belongs on this screen's own greeting row, not
  // app-wide. Pushed to the far right of that row (see JSX below).
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const { language, setLanguage, t } = useLanguage();
  // Branded messages (2026-09-16 sweep) instead of native Alert.alert.
  // infoModal covers every plain single-button case below; choiceModal is
  // a separate, purpose-built two-peer-option picker (Hot/Iced,
  // Sweetened/Unsweetened) -- NOT reused via ConfirmModal, since that
  // component's Confirm button fires onClose() THEN onConfirm() together,
  // which would double-resolve the Promise these two use to force a real
  // pick (see resolveHotIced/resolveSweetness below). No backdrop-dismiss
  // on choiceModal, matching the original Alert.alert's own intent: "a
  // value is always sent, never silently defaulted."
  const [infoModal,   setInfoModal]   = useState(null); // {title, message, onOk}
  const [choiceModal, setChoiceModal] = useState(null); // {title, message, labelA, onA, labelB, onB}
  const showInfo = (title, message, onOk) => setInfoModal({ title, message, onOk });
  const activeVoiceLang = VOICE_LANGUAGES.find(l => l.code === language) || VOICE_LANGUAGES[0];

  // ══════════════════════════════════════════════════════════════════
  // PATH A — on-device speech recognition (English, instant) — mirrors
  // web's own dual-path split exactly (find-my-drink_embed2.html): the
  // browser's native SpeechRecognition API is instant with zero server
  // round trip, so English never touches the Whisper pipeline there.
  // Mobile has no browser, so expo-speech-recognition (iOS SFSpeech-
  // Recognizer / Android SpeechRecognizer) is the on-device equivalent.
  // Falls back to PATH B (Whisper) on denied permission or any error/
  // empty result, same as web's rec.onerror/onend fallback to runWhisper.
  // ══════════════════════════════════════════════════════════════════
  const clearMicMaxTimer = () => {
    if (micMaxTimerRef.current) { clearTimeout(micMaxTimerRef.current); micMaxTimerRef.current = null; }
  };
  // Which recorder is ACTUALLY running right now (2026-09-15 fix, PC's
  // live report: English STT "still not instant") — a ref, not derived
  // from `language`/`micState` at call time. Two real bugs this closes:
  // (1) the event handlers below used to gate on `micState`, a piece of
  // React state read inside a closure `useSpeechRecognitionEvent`
  // registers — if that closure went stale between renders the handler
  // could silently no-op instead of firing the Whisper fallback; a ref's
  // .current is always current, no staleness possible. (2) handleMicPress's
  // "stop" tap used to decide which recorder to stop by re-checking
  // `language`, not by checking what actually got started — so if PATH A
  // silently failed over to PATH B mid-attempt, tapping stop called
  // ExpoSpeechRecognitionModule.stop() (a no-op, nothing was listening)
  // instead of stopping the real Whisper recording, which then ran for
  // the full 15s safety cap every single time before transcribing --
  // exactly matching "not instantaneous, takes a very long time".
  const activeSttPathRef = useRef(null); // 'ondevice' | 'whisper' | null
  useSpeechRecognitionEvent('result', (event) => {
    if (activeSttPathRef.current !== 'ondevice') return; // stray/late event
    const transcript = event.results?.[0]?.transcript || '';
    if (!transcript) return;
    sttGotResultRef.current = true;
    activeSttPathRef.current = null;
    clearMicMaxTimer();
    setUserText(transcript);
    setLastInputWasChip(false);
    lastInputSourceRef.current = 'voice';
    setMicStatus('');
    setMicState('idle');
  });
  useSpeechRecognitionEvent('error', (event) => {
    if (activeSttPathRef.current !== 'ondevice') return; // stray event from a prior/other attempt
    if (event.error === 'not-allowed') {
      activeSttPathRef.current = null;
      clearMicMaxTimer();
      setMicState('idle'); setMicStatus('');
      showInfo('Microphone access needed', 'Please allow microphone access in Settings to use voice input.');
    } else if (!sttGotResultRef.current) {
      // Same resilience as web: on-device recognition failed outright —
      // silently retry through the server path rather than dead-ending.
      activeSttPathRef.current = null;
      clearMicMaxTimer();
      setMicState('idle'); setMicStatus('');
      startWhisperRecording();
    }
  });
  useSpeechRecognitionEvent('end', () => {
    if (activeSttPathRef.current === 'ondevice' && !sttGotResultRef.current) {
      activeSttPathRef.current = null;
      clearMicMaxTimer();
      setMicState('idle'); setMicStatus('');
    }
  });

  // getSupportedLocales() cache (2026-09-15) — see startOnDeviceSTT below
  // for why this matters: without it, .start() defaults to allowing
  // network-based recognition, which is real server round-trip latency,
  // not "on-device" in the sense that makes web's browser API instant.
  const onDeviceLocalesRef = useRef({}); // { [locale]: boolean }
  const isLocaleOnDevice = async (locale) => {
    if (onDeviceLocalesRef.current[locale] !== undefined) return onDeviceLocalesRef.current[locale];
    try {
      const { installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales({});
      const installed = (installedLocales || []).includes(locale);
      onDeviceLocalesRef.current[locale] = installed;
      return installed;
    } catch { return false; }
  };

  // Generalized 2026-09-15 (PC's ask, §5) — was English-only ("startEnglishSTT");
  // now also handles Hindi via STT_LOCALES so the mic actually recognizes
  // Hindi speech instead of mis-hearing it as English phonetics. The
  // resulting transcript is used completely unchanged (no translation
  // step) regardless of language — matches this feature's whole premise
  // that the backend stays English-agnostic and just receives whatever
  // text it's given, exactly as if the customer had typed it.
  //
  // requiresOnDeviceRecognition (2026-09-15 fix, root cause of PC's "not
  // instantaneous" report): expo-speech-recognition defaults this to
  // FALSE, meaning .start() was previously allowed to send audio over
  // the network to Apple/Google's own cloud recognizer instead of
  // running fully on-device — real server round-trip time, not the
  // local-only path web's browser SpeechRecognition uses, and the actual
  // reason PATH A wasn't behaving like web's "instant" despite being
  // labeled on-device. Per the library's own doc comment, this is only
  // safe to force once the locale is confirmed installed on-device
  // (isLocaleOnDevice above) — forcing it blind on an unsupported locale
  // would make recognition fail outright instead of degrading gracefully.
  const startOnDeviceSTT = async (langCode) => {
    sttGotResultRef.current = false;
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        showInfo('Microphone access needed', 'Please allow microphone access in Settings to use voice input.');
        return;
      }
      const locale = STT_LOCALES[langCode] || 'en-US';
      const onDevice = await isLocaleOnDevice(locale);
      activeSttPathRef.current = 'ondevice';
      setMicState('recording');
      setMicStatus(t('listening'));
      setHeardEcho('');
      ExpoSpeechRecognitionModule.start({ lang: locale, interimResults: false, continuous: false, requiresOnDeviceRecognition: onDevice });
      micMaxTimerRef.current = setTimeout(() => { ExpoSpeechRecognitionModule.stop(); }, 15000);
    } catch {
      activeSttPathRef.current = null;
      setMicState('idle');
      setMicStatus('');
      startWhisperRecording();
    }
  };

  // ══════════════════════════════════════════════════════════════════
  // PATH B — server-side Whisper transcription (every non-English
  // language, plus English's own fallback) — unchanged from the
  // original implementation, matches web's runWhisper(langCode).
  // ══════════════════════════════════════════════════════════════════
  const startWhisperRecording = async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      showInfo('Microphone access needed', 'Please allow microphone access in Settings to use voice input.');
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      activeSttPathRef.current = 'whisper';
      setMicState('recording');
      setMicStatus(t('listening'));
      setHeardEcho('');
      micMaxTimerRef.current = setTimeout(() => { stopWhisperRecording(); }, 15000);
    } catch {
      activeSttPathRef.current = null;
      setMicState('idle');
      setMicStatus('');
      showInfo('Error', 'Could not start recording. Please try again.');
    }
  };

  const stopWhisperRecording = async () => {
    if (micMaxTimerRef.current) { clearTimeout(micMaxTimerRef.current); micMaxTimerRef.current = null; }
    setMicState('processing');
    setMicStatus(t('processingVoice'));
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) { setMicState('idle'); setMicStatus(''); return; }
      const { ok, data } = await transcribeVoice(uri, language, customer?.id);
      if (!ok || !data?.success) {
        setMicStatus('');
        showInfo('Voice Input', data?.message || 'Could not process audio. Please try again.');
      } else {
        setUserText(data.transcript_english || '');
        setLastInputWasChip(false);
        lastInputSourceRef.current = 'voice';
        setMicStatus('');
        if (language !== 'en' && data.transcript_english) {
          setHeardEcho(`Heard: "${data.transcript_english}"`);
        }
      }
    } catch {
      setMicStatus('');
      showInfo('Error', 'Voice connection failed. Please try again.');
    } finally {
      activeSttPathRef.current = null;
      setMicState('idle');
    }
  };

  // STT_LOCALES has 'en' and 'hi' -- both TRY on-device recognition
  // (PATH A) first; the other 7 VOICE_LANGUAGES entries go straight to
  // the Whisper server path (PATH B). The stop branch reads
  // activeSttPathRef (what's actually running), not `language`, per the
  // fix above — `language` alone can't tell you PATH A silently failed
  // over to PATH B mid-attempt.
  const handleMicPress = () => {
    if (micState === 'processing') return;
    if (micState === 'recording') {
      if (activeSttPathRef.current === 'ondevice') ExpoSpeechRecognitionModule.stop();
      else stopWhisperRecording();
      return;
    }
    if (STT_LOCALES[language]) startOnDeviceSTT(language);
    else startWhisperRecording();
  };
  // Build & Order crafting overlay (2026-09-13, PC's ask) — gated behind
  // the same recipe_config.crafting_enabled kill switch web's own button
  // checks via GET /sip/build-config, so this stays inert if PC ever
  // flips crafting back off server-side.
  const [craftingEnabled,  setCraftingEnabled]  = useState(false);
  const [building,         setBuilding]         = useState(false);
  useEffect(() => {
    apiFetch('/sip/build-config').then(({ ok, data }) => { if (ok) setCraftingEnabled(!!data?.crafting_enabled); });
  }, []);
  const [loadingPairing,   setLoadingPairing]   = useState(false);
  const [selectedSize,     setSelectedSize]     = useState(16); // default 16oz matches website

  // Circle Sip / Menu Sip (2026-09-12) — the API has always returned
  // circle_pick/menu_pick alongside custom_drink (V3.0 three-card
  // architecture, see generate-custom-drink's own docstring); this
  // screen only ever rendered the custom_drink card. Each card gets its
  // own size/price/order state since they're three independent recipes,
  // not one drink with three names.
  const [circleSize,        setCircleSize]        = useState(16);
  const [circlePrice,       setCirclePrice]       = useState(null);
  const [circleLoadingPrice,setCircleLoadingPrice]= useState(false);
  const [circleOrdering,    setCircleOrdering]    = useState(false);
  const [circleOrdered,     setCircleOrdered]     = useState(false);

  const [menuSize,     setMenuSize]     = useState(16);
  const [menuOrdering, setMenuOrdering] = useState(false);
  const [menuOrdered,  setMenuOrdered]  = useState(false);

  const sizes = [
    { oz: 12, label: '12 oz', tag: 'Medium' },
    { oz: 16, label: '16 oz', tag: 'Large'  },
    { oz: 20, label: '20 oz', tag: 'XL'     },
  ];

  // Categories/options realigned to dastacafe.com (2026-09-12) — Blended
  // dropped from Temp (it was never a valid hot_iced value anyway, see
  // resolveHotIced below), Mood dropped, Texture added. Temp and
  // Sweetness moved out of this list 2026-09-15 (PC's ask) — they now
  // render as a dedicated merged "Temp & Sweetness" block below with two
  // required exclusive pill-pairs (see EXCLUSIVE_GROUPS), not as a
  // regular multi-select chip row.
  // "Steamed Milk" dropped from this row 2026-09-15 (PC's ask, §3 —
  // freeing up chip-row space) — a UI-shortcut trim only, not a removal
  // of steamed-milk drinks as a real option: still reachable by typing it
  // in the free-text craving (custom_drink_generator.py/ollama_parser.py
  // both treat it as an independent ingredient, unrelated to this chip)
  // and as an actual Menu category (dasta-menu_embed1.html) — confirmed
  // via source before removing, not assumed. `labelKey`/`chip_<value>`
  // (not a literal label string) is 2026-09-15's localization plumbing —
  // the displayed text is t(labelKey)/t('chip_'+value), but `value` (what
  // toggleChip/isChipSelected/handleGenerate actually use) always stays
  // this exact English string regardless of display language.
  const chipGroups = [
    { key: 'base',    labelKey: 'sectionBase',    options: ['Chai', 'Espresso', 'Matcha', 'Tea', 'Decaf'] },
    { key: 'flavor',  labelKey: 'sectionFlavor',  options: ['Floral', 'Fruity', 'Spiced'] },
    { key: 'energy',  labelKey: 'sectionEnergy',  options: ['Focused', 'Energizing', 'Relaxing'] },
    { key: 'texture', labelKey: 'sectionTexture', options: ['Refreshing', 'Creamy'] },
  ];

  // Exclusivity (2026-09-15) — ported from web's own SIP_CHIP_GROUPS
  // (find-my-drink_embed1.html): base/energy/texture are single-select
  // there (mobile never enforced this before — same missing-exclusivity
  // gap Hot/Iced had, now fixed everywhere at once rather than just for
  // this one ask). Steamed Milk is deliberately excluded from base's
  // exclusive set — web treats it as an independent add-on that never
  // disables or is disabled by anything. Temperature and sweetness are
  // exclusive pairs of their own (see chip block below).
  // Flavor made exclusive too (2026-09-19, PC's live report) -- reverses
  // web's own 2026-08-15 decision to drop flavor's exclusivity ("lavender
  // spiced sweet chai" used to select all three at once); PC now wants
  // flavor single-select like energy, on both mobile and web.
  const EXCLUSIVE_GROUPS = {
    base:        ['Chai', 'Espresso', 'Matcha', 'Tea', 'Decaf'],
    flavor:      ['Floral', 'Fruity', 'Spiced'],
    energy:      ['Focused', 'Energizing', 'Relaxing'],
    texture:     ['Refreshing', 'Creamy'],
    temperature: ['Hot', 'Iced'],
    sweetness:   ['Sweetened', 'Unsweetened'],
  };

  // Chips <-> text sync (2026-09-12) — the free-text field is now the
  // single source of truth, mirroring web's exact model (find-my-drink_
  // embed4.html): a chip tap appends/removes its value as a comma-
  // separated token in the SAME textarea a customer can also type into,
  // rather than a separate selectedChips object joined in only at
  // generate-time. That also gives the requested "delete text deselects
  // the chip" behavior for free, since a chip's highlighted state below
  // is derived from whether its token is still present in userText, not
  // from independent state that could drift out of sync with it.
  const textTokens = userText.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const isChipSelected = (value) => textTokens.includes(value.toLowerCase());

  const toggleChip = (value, groupKey) => {
    const tokens = userText.split(',').map(s => s.trim()).filter(Boolean);
    const idx = tokens.findIndex(t => t.toLowerCase() === value.toLowerCase());
    let next;
    if (idx >= 0) {
      next = tokens.filter((_, i) => i !== idx); // deselecting — never exclusivity-gated
    } else {
      const exclusiveSet = EXCLUSIVE_GROUPS[groupKey];
      next = exclusiveSet
        ? [...tokens.filter(t => !exclusiveSet.some(v => v.toLowerCase() === t.toLowerCase())), value]
        : [...tokens, value];
    }
    setUserText(next.join(', '));
    setLastInputWasChip(true);
    lastInputSourceRef.current = 'typed'; // chip tokens are always English (safe no-op to translate) and this is the more conservative default than leaving a stale 'voice' flag around
  };

  // Clear button (2026-09-15, PC's ask — port of dastacafe.com's Clear
  // control). Ported from clearAllSelections() (find-my-drink_embed4.
  // html): web clears the textarea, un-highlights every mood chip, and
  // resets the Hot/Iced pill pair. Mobile only needs to clear the text —
  // every chip AND the Temp/Sweetness pills are already 100% *derived*
  // from userText (isChipSelected checks token presence), not separate
  // state, so emptying it resets all of them for free, same as web's
  // "delete text deselects the chip" behavior already relies on.
  // heardEcho is mobile-only (no web equivalent) but left showing stale
  // transcript text after a full clear would look inconsistent, so it
  // resets too; micStatus is never stale (only set during active
  // recording) and isn't touched. Skips web's toast confirmation — the
  // textbox and every chip visibly resetting is feedback enough on a
  // screen this size.
  const handleClearAll = () => {
    setUserText('');
    setLastInputWasChip(false);
    setHeardEcho('');
  };

  const fetchPrice = async (drinkData, oz) => {
    try {
      const { ok, data } = await apiFetch('/calculate-custom-drink-price', {
        method: 'POST', body: { custom_drink: drinkData, size_oz: oz },
      });
      return ok ? data : null;
    } catch { return null; }
  };

  // Choose from Favorites (2026-09-13) — the Order tab chooser hands a
  // saved favorite drink here as route.params.presetDrink (same shape
  // GET /sip/customer/{id}/past-custom-drinks already returns) instead of
  // running it through /generate-custom-drink again. Renders in the exact
  // same "result phase" card below as a freshly-generated drink — no
  // second UI to build — since build_ticket is intentionally left {} here,
  // _upsert_custom_drink_for_order's own COALESCE logic leaves the
  // existing recipe on that row untouched at add-to-cart time (see
  // checkout_router.py/sip_router.py comments — a plain reorder is the
  // exact case that guard exists for).
  // presetSource/presetOriginalId (2026-09-13 fix, PC's live report) --
  // a favorited Circle/Menu sip reordered through this same card must
  // still be submitted to the cart as drink_source='circle'/'menu', not
  // hardcoded 'custom' — it already has its own build ticket via its
  // origin recipe, so treating it as 'custom' would both mis-tag it AND
  // (incorrectly) route it through the Build & Order craft-the-sip step,
  // which 400s on anything but drink_source='custom' anyway.
  const [presetSource, setPresetSource] = useState('custom');
  const [presetOriginalId, setPresetOriginalId] = useState(null);

  useEffect(() => {
    if (!presetDrink) return;
    const favDrink = {
      drink_name:        presetDrink.drink_name,
      taste_description: presetDrink.description || '',
      why_it_fits:       presetDrink.description || '',
      ingredients:       presetDrink.ingredients || [],
      build_ticket:      {},
      available:         true,
    };
    const oz = presetDrink.last_size_oz || 16;
    setDrink({ custom_drink: favDrink });
    setSelectedSize(oz);
    setPresetSource(presetDrink.drink_source || 'custom');
    setPresetOriginalId(presetDrink.custom_drink_id || null);
    fetchPrice(favDrink, oz).then(setPrice);
    setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 150);
  }, [presetDrink]);

  const handleSizeChange = async (oz) => {
    setSelectedSize(oz);
    // Keep pairing data — combo price auto-recalculates with new drink price
    if (drink?.custom_drink) {
      setLoadingPrice(true);
      const newPrice = await fetchPrice(drink.custom_drink, oz);
      setPrice(newPrice);
      setLoadingPrice(false);
    }
  };

  // Circle Sip has no catalog price (it's a community-order recipe, same
  // shape as a custom sip) — synthesize the same minimal drink object web
  // sends to /calculate-custom-drink-price for it (see find-my-drink_
  // embed3.html's circle-price-fetch).
  const fetchCirclePrice = async (circlePick, oz) => {
    if (!circlePick) return;
    setCircleLoadingPrice(true);
    const circleDrinkData = {
      drink_name: circlePick.drink_name,
      ingredients: circlePick.ingredients || [],
      build_ticket: {}, available: true,
    };
    setCirclePrice(await fetchPrice(circleDrinkData, oz));
    setCircleLoadingPrice(false);
  };

  const handleCircleSizeChange = async (oz) => {
    setCircleSize(oz);
    if (drink?.circle_pick) await fetchCirclePrice(drink.circle_pick, oz);
  };

  // Menu Sip DOES have a catalog price (price_medium) — same ±$0.70 per
  // size step web uses (menuSipPriceForSize in find-my-drink_embed3.html),
  // no extra API round trip needed.
  const menuPriceForSize = (priceMedium, oz) => {
    if (!priceMedium) return null;
    const p = oz === 12 ? priceMedium - 0.70 : oz === 20 ? priceMedium + 0.70 : priceMedium;
    return Math.max(0, p);
  };

  // Hot/Iced resolution (2026-09-12) — /generate-custom-drink has required
  // `hot_iced` ('hot'|'iced' only) since Phase 5 (2026-08-04, see app.py's
  // NaturalLanguageRequest); this app predates that and was omitting it
  // entirely, which the backend now rejects with a 422 ("Could not
  // generate drink" is what that surfaced as). Simplified now that Temp
  // chips write straight into the same textarea parseTemperatureSignal
  // already reads (ported verbatim from web) — picking "Hot"/"Iced" IS
  // typed text now, not a separate signal to reconcile, so there's only
  // one source left to check. A blocking Hot-or-Iced prompt is still the
  // last resort so a value is always sent, never silently defaulted.
  const resolveHotIced = (text) => new Promise((resolve) => {
    const signal = parseTemperatureSignal(text);
    if (signal) { resolve(signal); return; }
    setChoiceModal({
      title: t('hotOrIcedTitle'), message: t('hotOrIcedMsg'),
      labelA: t('hotLabel'), onA: () => resolve('hot'),
      labelB: t('icedLabel'), onB: () => resolve('iced'),
    });
  });

  // Sweetness resolution (2026-09-15, PC's ask) — same required-pick
  // pattern as Hot/Iced above, but there's no backend field to pass this
  // through separately (see parseSweetnessSignal's comment), so the
  // resolved word gets folded into the text handleGenerate actually sends
  // rather than a structured request param.
  const resolveSweetness = (text) => new Promise((resolve) => {
    const signal = parseSweetnessSignal(text);
    if (signal) { resolve(signal); return; }
    setChoiceModal({
      title: t('sweetOrUnsweetTitle'), message: t('sweetOrUnsweetMsg'),
      labelA: t('sweetenedLabel'), onA: () => resolve('sweetened'),
      labelB: t('unsweetenedLabel'), onB: () => resolve('unsweetened'),
    });
  });

  // Stop crafting (2026-09-13, PC's ask) — same real-abort behavior as
  // web's sipStopCrafting: aborts the in-flight /generate-custom-drink
  // request (not just hiding the loader while the server keeps working
  // toward a result nobody will see).
  const craftAbortRef = useRef(null);
  const handleStopCrafting = () => {
    craftAbortRef.current?.abort();
    setLoading(false);
  };

  const handleGenerate = async () => {
    const text = userText;
    if (!text.trim()) { showInfo('Tell us your mood!', "Pick some chips or type what you're craving."); return; }
    const resolvedHotIced = await resolveHotIced(text);
    const resolvedSweetness = await resolveSweetness(text);
    // hot_iced has its own request field, so `text` is sent as-is for it.
    // Sweetness has no such field — fold the resolved word in only if it
    // wasn't already present (chip taps already put it there; this only
    // fires for the Alert-fallback path, same as hot_iced's own fallback).
    let textForApi = parseSweetnessSignal(text) ? text : `${text}, ${resolvedSweetness}`.trim();
    // Translate typed text to English before sending (2026-09-15, PC's
    // ask #2) -- only for genuinely typed input; voice already has its
    // own correct translation handling per language (see
    // lastInputSourceRef's own comment), and this must never touch the
    // visible userText itself, only what's actually sent here.
    if (language !== 'en' && lastInputSourceRef.current !== 'voice') {
      textForApi = await translateTextForBackend(textForApi, language);
    }
    setLoading(true); setDrink(null); setPrice(null); setOrdered(false); setPairing(null);
    setCirclePrice(null); setCircleSize(16); setCircleOrdered(false);
    setMenuSize(16); setMenuOrdered(false);
    const controller = new AbortController();
    craftAbortRef.current = controller;
    try {
      const { ok, data } = await apiFetch('/generate-custom-drink', {
        method: 'POST',
        body: {
          user_text: textForApi, input_type: lastInputWasChip ? 'chips' : 'text',
          customer_id: customer?.id || null, hot_iced: resolvedHotIced,
        },
        signal: controller.signal,
      });
      if (!ok) throw new Error(data?.detail || 'Server error');
      setDrink(data);
      const newPrice = await fetchPrice(data.custom_drink, selectedSize);
      setPrice(newPrice);
      if (data.circle_pick && !data.circle_pick.is_fallback) fetchCirclePrice(data.circle_pick, 16);
      setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 150);
    } catch (e) {
      if (e?.name !== 'AbortError') showInfo('Error', 'Could not generate drink. Please try again.');
    }
    finally { setLoading(false); }
  };

  // Build & Order (2026-09-13, renamed from "Order This Drink" per PC) —
  // adds to the real cart (POST /checkout/cart/items, the same endpoint
  // Menu items and Circle/Menu Sip below all use) instead of the old
  // direct /order-custom-sip call. drink.custom_drink already carries its
  // own build_ticket (set at /generate-custom-drink time) inside the
  // `drink` dict add_cart_item persists verbatim onto the cart row, so
  // the ticket is fully built and ready well before checkout — nothing
  // extra to construct here.
  const handleOrder = async () => {
    if (!drink?.custom_drink) return;
    setOrdering(true);
    try {
      const { ok, data } = await cart.addToCart({
        item_type: 'drink', drink_source: presetSource, drink: drink.custom_drink,
        original_drink_id: presetSource !== 'custom' ? presetOriginalId : null,
        size_oz: selectedSize, quantity: 1,
        unit_price_cents: Math.round((price?.price || price?.price_breakdown?.final_price || 0) * 100),
        price_display: price?.price_display || null,
      });
      if (ok && data?.success) {
        setOrdered(true);
        // Build & Order (2026-09-13, PC's ask) — sequence matches web's
        // window.dastaBuildAndOrder exactly: add to cart FIRST (already
        // done above), THEN craft the recipe for the kitchen ticket.
        // "Stop building" only hides the overlay early — the drink is
        // already in the cart either way, same as web. Only ever runs
        // for drink_source='custom' -- a favorited Circle/Menu sip
        // reordered through this same card already has its own build
        // ticket via its origin recipe (craft-the-sip 400s on anything
        // else anyway, "Only custom sips can be built").
        if (craftingEnabled && data.custom_drink_id && presetSource === 'custom') {
          setBuilding(true);
          try {
            await apiFetch('/sip/craft-the-sip', { method: 'POST', body: { custom_drink_id: data.custom_drink_id } });
          } catch {}
          setBuilding(false);
          showInfo('Added to Cart 🛒', `${drink.custom_drink?.drink_name || 'Your custom sip'} is built and in your cart — checkout whenever you're ready.`);
        } else {
          showInfo('Added to Cart 🛒', `${drink.custom_drink?.drink_name || 'Your custom sip'} is in your cart — checkout whenever you're ready.`);
        }
      } else {
        showInfo('Error', data?.detail || 'Could not add to cart.');
      }
    } catch { showInfo('Error', 'Could not add to cart.'); }
    finally { setOrdering(false); }
  };

  // Circle/Menu Sip order (2026-09-13) — now routed through the exact
  // same cart endpoint as Build & Order/Menu items above (PC's direction:
  // "For circle sip order, menu sip order they get added to cart like
  // menu order"), replacing the old direct /order-custom-sip call.
  const handleOrderCircle = async () => {
    const circle = drink?.circle_pick;
    if (!circle) return;
    setCircleOrdering(true);
    try {
      const drinkPayload = {
        drink_name: circle.drink_name, taste_description: circle.reason, why_it_fits: circle.reason,
        ingredients: circle.ingredients || [], build_ticket: {}, available: true,
      };
      const { ok, data } = await cart.addToCart({
        item_type: 'drink', drink_source: 'circle', drink: drinkPayload,
        original_drink_id: !circle.is_fallback ? circle.custom_drink_id : null,
        size_oz: circleSize, quantity: 1,
        unit_price_cents: Math.round((circlePrice?.price || circlePrice?.price_breakdown?.final_price || 0) * 100),
      });
      if (ok && data?.success) {
        setCircleOrdered(true);
        showInfo('Added to Cart 🛒', `${circle.drink_name} is in your cart — checkout whenever you're ready.`);
      } else {
        showInfo('Error', data?.detail || 'Could not add to cart.');
      }
    } catch { showInfo('Error', 'Could not add to cart.'); }
    finally { setCircleOrdering(false); }
  };

  const handleOrderMenu = async () => {
    const menu = drink?.menu_pick;
    if (!menu) return;
    setMenuOrdering(true);
    try {
      const drinkPayload = {
        drink_name: menu.drink_name, taste_description: menu.description, why_it_fits: menu.reason,
        ingredients: [], build_ticket: {}, available: true,
      };
      const menuPrice = menuPriceForSize(menu.price_medium, menuSize);
      const { ok, data } = await cart.addToCart({
        item_type: 'drink', drink_source: 'menu', drink: drinkPayload,
        original_drink_id: menu.drink_id || null,
        size_oz: menuSize, quantity: 1,
        unit_price_cents: Math.round((menuPrice || 0) * 100),
      });
      if (ok && data?.success) {
        setMenuOrdered(true);
        showInfo('Added to Cart 🛒', `${menu.drink_name} is in your cart — checkout whenever you're ready.`);
      } else {
        showInfo('Error', data?.detail || 'Could not add to cart.');
      }
    } catch { showInfo('Error', 'Could not add to cart.'); }
    finally { setMenuOrdering(false); }
  };

  // Recommendation swipe navigation (2026-09-19, PC confirmed) -- on a
  // phone-width screen, a successful pairing no longer navigates to a
  // separate screen; it sets this type's pairing state (which
  // buildSipPages below turns into a new page inserted immediately after
  // this type's own base page, per PC's exact ordering rule) and jumps
  // the swipe pager there. The wide/tablet 2-up layout keeps the old
  // navigate-to-screen behavior -- that layout's own pairing-page
  // interleaving wasn't part of this feature's spec, see PairingPanel's
  // comment. goToNewPairingPage is deferred one tick (setTimeout 0) so
  // the ScrollView has already re-rendered with the new page before
  // scrollTo runs against it.
  const goToNewPairingPage = (pages, src) => {
    const idx = pages.findIndex(p => p.type === 'pairing' && p.source === src);
    if (idx >= 0) setTimeout(() => goToSipPage(idx), 0);
  };

  const handlePairing = async () => {
    if (!drink?.custom_drink) return;
    setLoadingPairing(true);
    try {
      const { ok, data } = await apiFetch('/pair-custom-sip', {
        method: 'POST',
        body: { custom_drink: drink.custom_drink, customer_id: customer?.id || null, size_oz: selectedSize },
      });
      if (!ok) throw new Error(data?.detail || 'Server error');
      setPairing(data);
      if (isWideSip) {
        navigation.navigate('Pairing', { pairing: data, drink, drinkName, price, selectedSize, customer, source: 'custom' });
      } else {
        goToNewPairingPage(buildSipPages({ pairingOverride: data }), 'custom');
      }
    } catch (e) {
      showInfo('Pairing Error', e.message || 'Could not get food pairing. Please try again.');
    }
    finally { setLoadingPairing(false); }
  };

  // Pair with Dasta Food — Circle Sip / Menu Sip (2026-09-13, PC's ask) —
  // same /pair-custom-sip endpoint and drinkForPairing shape as web's
  // pairCircleSip()/pairMenuSip() (find-my-drink_embed1.html), just built
  // from circle_pick/menu_pick instead of custom_drink. Shares the same
  // destination PairingScreen as the custom sip, distinguished by
  // `source` so it knows which drink payload to add to cart on "Order
  // Food & Drink"/"Food Only".
  const [loadingCirclePairing, setLoadingCirclePairing] = useState(false);
  const [loadingMenuPairing,   setLoadingMenuPairing]   = useState(false);

  const handlePairingCircle = async () => {
    const circle = drink?.circle_pick;
    if (!circle) return;
    setLoadingCirclePairing(true);
    try {
      const drinkForPairing = {
        drink_name: circle.drink_name, taste_description: circle.taste_description || circle.reason,
        why_it_fits: circle.reason, ingredients: circle.ingredients || [], build_ticket: {},
      };
      const { ok, data } = await apiFetch('/pair-custom-sip', {
        method: 'POST',
        body: { custom_drink: drinkForPairing, customer_id: customer?.id || null, size_oz: circleSize },
      });
      if (!ok) throw new Error(data?.detail || 'Server error');
      setCirclePairing(data);
      if (isWideSip) {
        navigation.navigate('Pairing', {
          pairing: data, drink, drinkName: circle.drink_name, price: circlePrice, selectedSize: circleSize,
          customer, source: 'circle',
        });
      } else {
        goToNewPairingPage(buildSipPages({ circlePairingOverride: data }), 'circle');
      }
    } catch (e) {
      showInfo('Pairing Error', e.message || 'Could not get food pairing. Please try again.');
    }
    finally { setLoadingCirclePairing(false); }
  };

  const handlePairingMenu = async () => {
    const menu = drink?.menu_pick;
    if (!menu) return;
    setLoadingMenuPairing(true);
    try {
      const drinkForPairing = {
        drink_name: menu.drink_name, taste_description: menu.description, why_it_fits: menu.reason,
        ingredients: [], build_ticket: {},
      };
      const menuPrice = { price: menuPriceForSize(menu.price_medium, menuSize) };
      const { ok, data } = await apiFetch('/pair-custom-sip', {
        method: 'POST',
        body: { custom_drink: drinkForPairing, customer_id: customer?.id || null, size_oz: menuSize },
      });
      if (!ok) throw new Error(data?.detail || 'Server error');
      setMenuPairing(data);
      if (isWideSip) {
        navigation.navigate('Pairing', {
          pairing: data, drink, drinkName: menu.drink_name, price: menuPrice, selectedSize: menuSize,
          customer, source: 'menu',
        });
      } else {
        goToNewPairingPage(buildSipPages({ menuPairingOverride: data }), 'menu');
      }
    } catch (e) {
      showInfo('Pairing Error', e.message || 'Could not get food pairing. Please try again.');
    }
    finally { setLoadingMenuPairing(false); }
  };

  // "View Food Pairing" -- jump back to a type's already-fetched pairing
  // page (2026-09-19: generalized from custom-only to all three sources,
  // since circle/menu now track their own pairing state too). On phone
  // width this is just a swipe-to-page (the pairing page already exists
  // in the sequence, nothing to re-fetch); wide/tablet still navigates
  // to the standalone screen with each source's own current price/size,
  // matching what handlePairing*/loadingPairing already computed there.
  const handleGoToFood = (src) => {
    if (isWideSip) {
      if (src === 'circle') {
        navigation.navigate('Pairing', {
          pairing: circlePairing, drink, drinkName: drink?.circle_pick?.drink_name,
          price: circlePrice, selectedSize: circleSize, customer, source: 'circle',
        });
      } else if (src === 'menu') {
        navigation.navigate('Pairing', {
          pairing: menuPairing, drink, drinkName: drink?.menu_pick?.drink_name,
          price: { price: menuPriceForSize(drink?.menu_pick?.price_medium, menuSize) },
          selectedSize: menuSize, customer, source: 'menu',
        });
      } else {
        navigation.navigate('Pairing', {
          pairing, drink, drinkName: drink?.custom_drink?.drink_name, price, selectedSize, customer, source: 'custom',
        });
      }
      return;
    }
    const idx = buildSipPages().findIndex(p => p.type === 'pairing' && p.source === src);
    if (idx >= 0) goToSipPage(idx);
  };

  const handleStartOver = () => {
    setDrink(null); setPrice(null); setPairing(null); setCirclePairing(null); setMenuPairing(null);
    setOrdered(false); setSelectedSize(16); setUserText(''); // reset to 16oz default
    setCirclePrice(null); setCircleSize(16); setCircleOrdered(false);
    setMenuSize(16); setMenuOrdered(false);
    // No sip-pager scroll reset needed -- setDrink(null) unmounts the
    // whole result-phase JSX (including the ScrollView), so the next
    // drink's swiper is a fresh instance starting at page 0 regardless.
  };

  // Combo pricing computed from current drink price + food price
  // API returns: price.price (top-level) and price.price_breakdown.final_price
  // API returns: pairing.pairing.best_pairing (nested under pairing key)
  const drinkAmt   = price?.price || price?.price_breakdown?.final_price || 0;
  const foodAmt    = pairing?.pairing?.best_pairing?.price || 0;
  const regularAmt = drinkAmt + foodAmt;
  const discount   = pairing?.combo_discount ?? 1.25;
  const comboAmt   = regularAmt > 0 ? regularAmt - discount : 0;

  // API merges creative copy into custom_drink — no separate 'creative' key exists
  const drinkName  = drink?.custom_drink?.drink_name || 'Custom Sip';
  // Sip-card swiper page bookkeeping (2026-09-16) -- same presence checks
  // each card's own conditional render already uses. Order is always
  // Custom -> Circle (if any) -> Menu (if any), so each card's own
  // back/forward arrows below are a direct function of these two flags,
  // not a separate "which page am I" computation.
  const hasCircleSip = !!(drink?.circle_pick && !drink.circle_pick.is_fallback);
  const hasMenuSip   = !!drink?.menu_pick;
  const goToSipPage = (i) => sipPagerRef.current?.scrollTo({ x: i * screenWidth, animated: true });

  // Recommendation swipe navigation (2026-09-19, PC confirmed) -- the
  // page sequence is a variable-length, dynamically-interleaved list now
  // (1-3 base types x whether each has been paired), not a fixed 3 or 6.
  // A type and its own pairing page always stay adjacent (PC's exact
  // ordering rule) because this function only ever pushes a pairing
  // descriptor immediately after that same type's base descriptor.
  // Accepts explicit overrides so a handler can compute the sequence
  // that WILL exist right after it sets pairing state, without waiting
  // for the state update to actually land (see goToNewPairingPage).
  const buildSipPages = ({ pairingOverride, circlePairingOverride, menuPairingOverride } = {}) => {
    const customPairingVal = pairingOverride       !== undefined ? pairingOverride       : pairing;
    const circlePairingVal = circlePairingOverride !== undefined ? circlePairingOverride : circlePairing;
    const menuPairingVal   = menuPairingOverride   !== undefined ? menuPairingOverride   : menuPairing;
    const pages = [{ type: 'base', source: 'custom' }];
    if (customPairingVal) pages.push({ type: 'pairing', source: 'custom' });
    if (hasCircleSip) {
      pages.push({ type: 'base', source: 'circle' });
      if (circlePairingVal) pages.push({ type: 'pairing', source: 'circle' });
    }
    if (hasMenuSip) {
      pages.push({ type: 'base', source: 'menu' });
      if (menuPairingVal) pages.push({ type: 'pairing', source: 'menu' });
    }
    return pages;
  };
  const sipPages = buildSipPages();

  // Wide-screen side-by-side (2026-09-17, Phase 1: Android + tablets) --
  // below WIDE_BREAKPOINT this stays the exact swipeable 3-card pager it
  // always was. At/above it, PC's live call after seeing a real 3-up row
  // on an unfolded-foldable/iPad-width screen: three full cards side by
  // side was too cramped, so this pairs cards two-per-page instead --
  // Custom + (Circle or Menu) on page 1, the leftover third card (Menu,
  // when all three exist) alone on page 2, swipeable between the two.
  // When there are only 1-2 cards total, everything already fits on one
  // page and no swipe is offered at all. See WIDE_BREAKPOINT's own
  // comment for the breakpoint value itself.
  const isWideSip = screenWidth >= WIDE_BREAKPOINT;
  const wideSipPages = isWideSip ? (() => {
    const secondCard = hasCircleSip ? circleSipPanel : (hasMenuSip ? menuSipPanel : null);
    const firstPage = [customSipPanel, secondCard].filter(Boolean);
    const pages = [firstPage];
    if (hasCircleSip && hasMenuSip) pages.push([menuSipPanel]);
    return pages;
  })() : [];
  const goToWideSipPage = (i) => wideSipPagerRef.current?.scrollTo({ x: i * screenWidth, animated: true });

  const customSipPanel = !drink ? null : (
    <View style={S.drinkFullCard}>

      <Text style={[S.drinkFullBadge, { color: C.saffron }]}>YOUR CUSTOM SIP</Text>
      <Text style={S.drinkFullName}>{drinkName}</Text>

      {/* Description — app.py merges creative copy into custom_drink.taste_description */}
      {drink.custom_drink?.taste_description ? (
        <Text style={S.drinkFullDesc}>
          {drink.custom_drink.taste_description}
        </Text>
      ) : null}

      {/* Why it fits */}
      <View style={S.drinkWhyBox}>
        <Text style={S.drinkWhyText}>
          💡 {drink.custom_drink?.why_it_fits}
        </Text>
      </View>

      {/* Today's Discovery (2026-09-13, PC's ask) — the Discovery
          Engine + Local Pulse data /generate-custom-drink has always
          returned (data.discovery) but this screen never rendered at
          all. Same trigger condition as web's own discoveryBtn
          (find-my-drink_embed3.html): only shown when a real
          sentence came back. */}
      {drink.discovery?.sentence && (
        <Pressable style={S.discoveryBtn} onPress={() => setDiscoveryOpen(true)}>
          <Text style={S.discoveryBtnText}>🌍 Today's Discovery</Text>
        </Pressable>
      )}

      {/* Ingredients as chips — handles both string[] and {name}[] formats */}
      {drink.custom_drink?.ingredients?.length > 0 && (
        <View style={S.ingredientsBox}>
          <Text style={S.ingredientsBoxTitle}>What's in it:</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {drink.custom_drink.ingredients.map((ing, i) => {
              const label = typeof ing === 'string' ? ing : (ing?.name || ing?.ingredient_name || '');
              if (!label) return null;
              return (
                <View key={i} style={S.ingredientChip}>
                  <Text style={S.ingredientChipText}>{label}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Size Selector */}
      <Text style={S.sizeSectionLabel}>Choose your size:</Text>
      <View style={S.sizeRow}>
        {sizes.map((s, i) => (
          <Pressable
            key={s.oz}
            style={({pressed})=>[S.sizeBtn,selectedSize===s.oz&&S.sizeBtnActive,i<sizes.length-1&&{marginRight:8},pressed&&{opacity:0.75}]}
            onPress={() => handleSizeChange(s.oz)}>
            <Text style={[S.sizeBtnLabel, selectedSize === s.oz && S.sizeBtnLabelActive]}>{s.label}</Text>
            <Text style={[S.sizeBtnTag, selectedSize === s.oz && S.sizeBtnTagActive]}>{s.tag}</Text>
          </Pressable>
        ))}
      </View>

      {/* Price row */}
      <View style={S.priceRow}>
        <Text style={S.priceLabel}>{selectedSize} oz</Text>
        {loadingPrice
          ? <ActivityIndicator color={C.saffron} />
          : <Text style={S.priceAmount}>${drinkAmt > 0 ? drinkAmt.toFixed(2) : '—'}</Text>}
      </View>

      {/* Order drink */}
      <Pressable style={({pressed})=>[S.btnSaffron,ordered&&S.btnSuccess,pressed&&!ordered&&{backgroundColor:"#c95722"}]}
        onPress={handleOrder} disabled={ordering || ordered}>
        {ordering
          ? <ActivityIndicator color={C.ivory} />
          : ordered
            ? <Text style={S.btnSaffronText}>✅ Added to Cart!</Text>
            : <View style={S.btnIconRow}>
                {/* "Build & Order" retired (2026-09-19, PC's call) -- always
                    "Add to Cart" now, regardless of source. Crafting still
                    happens exactly as before for a custom sip, it's just
                    never surfaced as separate wording/icon anymore. */}
                <Ionicons name="cart-outline" size={16} color={C.white} />
                <Text style={S.btnSaffronText}>Add to Cart</Text>
              </View>}
      </Pressable>

      {/* Pair / Return to Food button */}
      {!pairing && !loadingPairing && (
        <Pressable style={({pressed})=>[S.btnEspresso,pressed&&{backgroundColor:"#3D2B25"}]} onPress={handlePairing}>
          <View style={S.btnIconRow}>
            <Ionicons name="restaurant-outline" size={16} color={C.ivory} />
            <Text style={S.btnEspressoText}>Pair with Dasta Food</Text>
          </View>
        </Pressable>
      )}
      {pairing && !loadingPairing && (
        <Pressable
          style={({pressed})=>[S.btnEspresso,pressed&&{backgroundColor:"#3D2B25"}]}
          onPress={() => handleGoToFood('custom')}>
          <Text style={S.btnEspressoText}>🍽 View Food Pairing →</Text>
        </Pressable>
      )}
      {loadingPairing && (
        <View style={{ alignItems: 'center', paddingVertical: 20 }}>
          <ActivityIndicator color={C.saffron} size="large" />
          <Text style={[S.cardSub, { marginTop: 10 }]}>Finding your perfect pairing...</Text>
        </View>
      )}
    </View>
  );

  const circleSipPanel = !hasCircleSip ? null : (
    <View style={[S.drinkFullCard, { borderColor: '#534AB7', backgroundColor: '#F4F3FD' }]}>
      <Text style={[S.drinkFullBadge, { color: '#534AB7' }]}>DASTA MEMBERS SIP</Text>
      <Text style={[S.drinkFullName, { color: '#26215C' }]}>{drink.circle_pick.drink_name}</Text>
      {drink.circle_pick.taste_description ? (
        <Text style={S.drinkFullDesc}>{drink.circle_pick.taste_description}</Text>
      ) : null}
      <View style={[S.drinkWhyBox, { backgroundColor: '#EEEDFE' }]}>
        <Text style={[S.drinkWhyText, { color: '#443C99' }]}>★ {drink.circle_pick.reason}</Text>
      </View>

      <Text style={S.sizeSectionLabel}>Choose your size:</Text>
      <View style={S.sizeRow}>
        {sizes.map((s, i) => (
          <Pressable key={s.oz}
            style={({pressed})=>[S.sizeBtn, circleSize===s.oz&&{borderColor:'#534AB7',backgroundColor:'#EEEDFE'}, i<sizes.length-1&&{marginRight:8}, pressed&&{opacity:0.75}]}
            onPress={() => handleCircleSizeChange(s.oz)}>
            <Text style={[S.sizeBtnLabel, circleSize===s.oz&&{color:'#534AB7'}]}>{s.label}</Text>
            <Text style={[S.sizeBtnTag, circleSize===s.oz&&{color:'#534AB7'}]}>{s.tag}</Text>
          </Pressable>
        ))}
      </View>

      <View style={S.priceRow}>
        <Text style={S.priceLabel}>{circleSize} oz</Text>
        {circleLoadingPrice
          ? <ActivityIndicator color="#534AB7" />
          : <Text style={[S.priceAmount, { color: '#534AB7' }]}>
              ${(circlePrice?.price || circlePrice?.price_breakdown?.final_price || 0).toFixed(2)}
            </Text>}
      </View>

      <Pressable
        style={({pressed})=>[S.btnSaffron, { backgroundColor: '#534AB7' }, circleOrdered&&S.btnSuccess, pressed&&!circleOrdered&&{backgroundColor:'#443C99'}]}
        onPress={handleOrderCircle} disabled={circleOrdering || circleOrdered}>
        {circleOrdering
          ? <ActivityIndicator color={C.ivory} />
          : circleOrdered
            ? <Text style={S.btnSaffronText}>✅ Added to Cart!</Text>
            : <View style={S.btnIconRow}><Ionicons name="cart-outline" size={16} color={C.white} /><Text style={S.btnSaffronText}>Add to Cart</Text></View>}
      </Pressable>
      {/* Pair / Return to Food button (2026-09-13, PC's ask; 2026-09-19
          parity fix -- this used to always show "Pair with Dasta Food"
          even after already paired, unlike the custom card's own
          already-paired check just above). */}
      {!circlePairing && !loadingCirclePairing && (
        <Pressable
          style={({pressed})=>[S.btnEspresso, { marginTop: 10 }, pressed&&{backgroundColor:"#3D2B25"}]}
          onPress={handlePairingCircle}>
          <View style={S.btnIconRow}><Ionicons name="restaurant-outline" size={16} color={C.ivory} /><Text style={S.btnEspressoText}>Pair with Dasta Food</Text></View>
        </Pressable>
      )}
      {circlePairing && !loadingCirclePairing && (
        <Pressable
          style={({pressed})=>[S.btnEspresso, { marginTop: 10 }, pressed&&{backgroundColor:"#3D2B25"}]}
          onPress={() => handleGoToFood('circle')}>
          <Text style={S.btnEspressoText}>🍽 View Food Pairing →</Text>
        </Pressable>
      )}
      {loadingCirclePairing && (
        <View style={{ alignItems: 'center', paddingVertical: 12, marginTop: 10 }}>
          <ActivityIndicator color="#534AB7" />
        </View>
      )}
    </View>
  );

  const menuSipPanel = !hasMenuSip ? null : (
    <View style={[S.drinkFullCard, { borderColor: '#0F6E56', backgroundColor: '#EAFBF5' }]}>
      <Text style={[S.drinkFullBadge, { color: '#0F6E56' }]}>FROM OUR MENU</Text>
      <Text style={[S.drinkFullName, { color: '#04342C' }]}>{drink.menu_pick.drink_name}</Text>
      {drink.menu_pick.description ? (
        <Text style={S.drinkFullDesc}>{drink.menu_pick.description}</Text>
      ) : null}
      <View style={[S.drinkWhyBox, { backgroundColor: '#E1F5EE' }]}>
        <Text style={[S.drinkWhyText, { color: '#0F6E56' }]}>✦ {drink.menu_pick.reason}</Text>
      </View>

      <Text style={S.sizeSectionLabel}>Choose your size:</Text>
      <View style={S.sizeRow}>
        {sizes.map((s, i) => (
          <Pressable key={s.oz}
            style={({pressed})=>[S.sizeBtn, menuSize===s.oz&&{borderColor:'#0F6E56',backgroundColor:'#E1F5EE'}, i<sizes.length-1&&{marginRight:8}, pressed&&{opacity:0.75}]}
            onPress={() => setMenuSize(s.oz)}>
            <Text style={[S.sizeBtnLabel, menuSize===s.oz&&{color:'#0F6E56'}]}>{s.label}</Text>
            <Text style={[S.sizeBtnTag, menuSize===s.oz&&{color:'#0F6E56'}]}>{s.tag}</Text>
          </Pressable>
        ))}
      </View>

      <View style={S.priceRow}>
        <Text style={S.priceLabel}>{menuSize} oz</Text>
        <Text style={[S.priceAmount, { color: '#0F6E56' }]}>
          {(() => {
            const p = menuPriceForSize(drink.menu_pick.price_medium, menuSize);
            return p != null ? `$${p.toFixed(2)}` : '—';
          })()}
        </Text>
      </View>

      <Pressable
        style={({pressed})=>[S.btnSaffron, { backgroundColor: '#0F6E56' }, menuOrdered&&S.btnSuccess, pressed&&!menuOrdered&&{backgroundColor:'#0b5943'}]}
        onPress={handleOrderMenu} disabled={menuOrdering || menuOrdered}>
        {menuOrdering
          ? <ActivityIndicator color={C.ivory} />
          : menuOrdered
            ? <Text style={S.btnSaffronText}>✅ Added to Cart!</Text>
            : <View style={S.btnIconRow}><Ionicons name="cart-outline" size={16} color={C.white} /><Text style={S.btnSaffronText}>Add to Cart</Text></View>}
      </Pressable>
      {/* Pair / Return to Food button (2026-09-19 parity fix, same as
          circleSipPanel above). */}
      {!menuPairing && !loadingMenuPairing && (
        <Pressable
          style={({pressed})=>[S.btnEspresso, { marginTop: 10 }, pressed&&{backgroundColor:"#3D2B25"}]}
          onPress={handlePairingMenu}>
          <View style={S.btnIconRow}><Ionicons name="restaurant-outline" size={16} color={C.ivory} /><Text style={S.btnEspressoText}>Pair with Dasta Food</Text></View>
        </Pressable>
      )}
      {menuPairing && !loadingMenuPairing && (
        <Pressable
          style={({pressed})=>[S.btnEspresso, { marginTop: 10 }, pressed&&{backgroundColor:"#3D2B25"}]}
          onPress={() => handleGoToFood('menu')}>
          <Text style={S.btnEspressoText}>🍽 View Food Pairing →</Text>
        </Pressable>
      )}
      {loadingMenuPairing && (
        <View style={{ alignItems: 'center', paddingVertical: 12, marginTop: 10 }}>
          <ActivityIndicator color="#0F6E56" />
        </View>
      )}
    </View>
  );

  return (
    <>
    <ScrollView ref={scrollRef} style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 48 }}>

      {/* ── RESULT PHASE: Drink card + Pairing card ── */}
      {drink && !loading ? (
        <>
          {/* Hero bar */}
          {/* Start Over moved below the wordmark, out of the top row
              (2026-09-15 fix, PC's live report) — right-aligned in that
              shared row put it at the same y-position as the persistent
              GlobalAccountHeader (top:54,right:18), overlapping it.
              Stacking it below clears that band entirely regardless of
              alignment. */}
          {/* Start Over only (PC, 2026-10-01): the SipSense wordmark + "YOUR
              SIPS ARE READY" stacked above it made this banner much taller
              than every other screen's. Left-aligned in the same 44pt row as
              HeroTitleRow, clear of the account icons on the right. */}
          <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
            <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {onHeaderBack ? <HeroBackArrow onPress={onHeaderBack} label="Back" /> : null}
              <Pressable onPress={handleStartOver}
                style={({pressed})=>[S.startOverBtn,pressed&&{opacity:0.7}]}>
                <Text style={S.startOverText}>← Start Over</Text>
              </Pressable>
            </View>
          </View>

          {isWideSip ? (
            // Wide-screen: two cards per page (PC's live call after seeing
            // three full cards was too cramped on an unfolded-foldable/
            // iPad-width screen) -- swipe to the leftover third card when
            // all three exist; no swipe offered at all when everything
            // already fits on one page (1-2 total cards).
            // right insets below (here and the narrow pager further down)
            // use PROFILE_ICON_CENTER_INSET so every "next"/forward
            // circular arrow on this screen lines up horizontally with
            // the persistent header's circular profile icon above --
            // 2026-09-17, part of the same sweep that fixed My Circle
            // Account's own card-pager arrow, per PC's "check other
            // screens with the same pattern" ask.
            <ScrollView ref={wideSipPagerRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
              {wideSipPages.map((page, pi) => (
                <View key={pi} style={{ width: screenWidth, position: 'relative' }}>
                  {pi > 0 && (
                    <Pressable style={[S.sipArrowBtn, { left: 12 }]} onPress={() => goToWideSipPage(pi - 1)}>
                      <Text style={S.sipArrowText}>←</Text>
                    </Pressable>
                  )}
                  {pi < wideSipPages.length - 1 && (
                    <Pressable style={[S.sipArrowBtn, { right: PROFILE_ICON_CENTER_INSET - 17 }]} onPress={() => goToWideSipPage(pi + 1)}>
                      <Text style={S.sipArrowText}>→</Text>
                    </Pressable>
                  )}
                  <View style={{ flexDirection: 'row', paddingHorizontal: 8, gap: 8 }}>
                    {page.map((panel, ci) => <View key={ci} style={{ flex: 1 }}>{panel}</View>)}
                  </View>
                </View>
              ))}
            </ScrollView>
          ) : (
            /* Sip cards left-to-right (2026-09-16, PC's ask) -- Custom/
                Circle/Menu Sip, one full-width page per swipe, instead of
                stacking vertically in the outer ScrollView. Each page is a
                fixed-width wrapper around the exact same card content/
                styling as before (drinkFullCard's own margin/padding
                untouched), so nothing about an individual card's look
                changed -- only how the three sit relative to each other. */
            /* Single-pointer only (2026-09-19, per the pinch-zoom scoping
               ask cross-referenced in this feature's spec) -- a plain
               paging ScrollView, no PanResponder/gesture-handler Pan
               recognizer added, so a two-finger touch was never claimed
               here to begin with; nothing new here changes that. */
            <ScrollView ref={sipPagerRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
              {sipPages.map((page, i) => {
                const key = `${page.source}-${page.type}`;
                let panel;
                if (page.type === 'pairing') {
                  const cfg = page.source === 'circle'
                    ? { pairing: circlePairing, drinkName: drink?.circle_pick?.drink_name, price: circlePrice, selectedSize: circleSize }
                    : page.source === 'menu'
                    ? { pairing: menuPairing, drinkName: drink?.menu_pick?.drink_name, price: { price: menuPriceForSize(drink?.menu_pick?.price_medium, menuSize) }, selectedSize: menuSize }
                    : { pairing, drinkName: drink?.custom_drink?.drink_name, price, selectedSize };
                  panel = (
                    <PairingPanel
                      pairing={cfg.pairing} drink={drink} drinkName={cfg.drinkName} price={cfg.price}
                      selectedSize={cfg.selectedSize} customer={customer} source={page.source}
                      navigation={navigation} craftingEnabled={craftingEnabled}
                    />
                  );
                } else {
                  panel = page.source === 'circle' ? circleSipPanel : page.source === 'menu' ? menuSipPanel : customSipPanel;
                }
                return (
                  <View key={key} style={{ width: screenWidth, position: 'relative' }}>
                    {i > 0 && (
                      <Pressable style={[S.sipArrowBtn, { left: 28 }]} onPress={() => goToSipPage(i - 1)}>
                        <Text style={S.sipArrowText}>←</Text>
                      </Pressable>
                    )}
                    {i < sipPages.length - 1 && (
                      <Pressable style={[S.sipArrowBtn, { right: PROFILE_ICON_CENTER_INSET - 17 }]} onPress={() => goToSipPage(i + 1)}>
                        <Text style={S.sipArrowText}>→</Text>
                      </Pressable>
                    )}
                    {panel}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </>
      ) : (
        /* ── SELECTION PHASE ── */
        <>
          <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
            <HeroTitleRow title="SipSense™" onBack={onHeaderBack} />
          </View>

          <View style={{ padding: 16 }}>
            {/* Language pill (2026-09-15, moved back from GlobalAccountHeader
                same day, PC's live report) — on the greeting row, pushed
                to the far right via justifyContent:'space-between'. Fixes
                both problems he reported: it no longer sits in the
                global/persistent area where it collided with other
                screens' own controls, and it's now visibly scoped to
                SipSense specifically, matching what it actually affects. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <Text style={[S.greetingBig, { marginBottom: 4, color: C.charcoal, flexShrink: 1 }]}>
                {guest ? t('greetingGuest') : t('greeting')(customer?.first_name)}
              </Text>
              <Pressable onPress={() => setLangPickerOpen(true)}
                style={[S.langPill, language !== 'en' && S.langPillActive]}>
                <Text style={[S.langPillText, language !== 'en' && S.langPillTextActive]}>
                  {activeVoiceLang.flag} {activeVoiceLang.label}
                </Text>
              </Pressable>
            </View>
            <Text style={[S.cardSub, { marginBottom: 20, textAlign: 'left' }]}>
              {t('moodPrompt')}
            </Text>

            {/* Mic-in-textbox layout (2026-09-15, PC's layout-refinement
                doc, supersedes the earlier separate-circle-below-the-
                input layout) — one TextInput with paddingRight reserving
                a fixed-width zone exactly the mic icon's size, the mic
                itself a sibling absolutely-positioned inside that zone
                (not two boxes side by side, which doesn't handle the
                input's rounded border as cleanly). Still multiline —
                only the reserved right-hand padding changed, so long
                craving text wraps within the remaining width and never
                renders under the mic. */}
            <View style={S.textAreaWrap}>
              <TextInput style={[S.textArea, S.textAreaWithMic]}
                placeholder={t('placeholder')}
                placeholderTextColor={C.muted} multiline numberOfLines={3}
                value={userText}
                onChangeText={(txt) => { setUserText(txt); setLastInputWasChip(false); lastInputSourceRef.current = 'typed'; }} />
              {/* Clear button (2026-09-15, PC's ask) — ports web's
                  clearSelectionsBtn (find-my-drink_embed4.html), same
                  top-right-corner-of-the-box placement; sits above the
                  vertically-centered mic zone below it, not overlapping. */}
              {!!userText && (
                <Pressable onPress={handleClearAll} style={S.clearAllBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={S.clearAllBtnText}>{t('clearAll')}</Text>
                </Pressable>
              )}
              <View style={S.micZone} pointerEvents="box-none">
                <Pressable
                  onPress={handleMicPress}
                  disabled={micState === 'processing'}
                  style={[S.micBtnInline,
                    micState === 'recording' && S.micBtnRecording,
                    micState === 'processing' && S.micBtnProcessing]}>
                  <Image source={{ uri: MIC_ICON_URL }} style={S.micIconInline} resizeMode="contain" />
                </Pressable>
              </View>
            </View>
            {!!micStatus && <Text style={S.micStatusText}>{micStatus}</Text>}
            {!!heardEcho && <Text style={S.micHeardEcho}>{heardEcho}</Text>}

            <Text style={[S.orText, { marginTop: 18 }]}>{t('refineDivider')}</Text>
            {chipGroups.slice(0, 3).map(group => (
              <View key={group.key} style={{ marginBottom: 14 }}>
                <Text style={S.chipGroupLabel}>{t(group.labelKey)}</Text>
                <View style={S.chipRow}>
                  {group.options.map(opt => (
                    <Pressable key={opt}
                      style={[S.chip, isChipSelected(opt) && S.chipSelected]}
                      onPress={() => toggleChip(opt, group.key)}>
                      <Text style={[S.chipText, isChipSelected(opt) && S.chipTextSelected]}>{t('chip_' + opt)}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}

            {/* Temp & Sweetness (2026-09-15, PC's ask) — merged into one
                heading with two required, mutually-exclusive pill-pairs.
                Deliberately NOT the generic chipGroups system above: web's
                own Hot/Iced control is its own dedicated widget too, not
                part of the freeform mood-chip grid (find-my-drink_embed4.
                html's renderHotIcedPills). Sweetened/Unsweetened has no
                web equivalent (flagged to PC before building — see commit
                message) but follows the exact same required-pair pattern
                as Hot/Iced per PC's explicit choice. */}
            <View style={{ marginBottom: 14 }}>
              <Text style={S.chipGroupLabel}>{t('sectionTempSweetness')}</Text>
              <View style={S.chipRow}>
                {['Hot', 'Iced'].map(opt => (
                  <Pressable key={opt}
                    style={[S.chip, isChipSelected(opt) && S.chipSelected]}
                    onPress={() => toggleChip(opt, 'temperature')}>
                    <Text style={[S.chipText, isChipSelected(opt) && S.chipTextSelected]}>{t('chip_' + opt)}</Text>
                  </Pressable>
                ))}
                {['Sweetened', 'Unsweetened'].map(opt => (
                  <Pressable key={opt}
                    style={[S.chip, isChipSelected(opt) && S.chipSelected]}
                    onPress={() => toggleChip(opt, 'sweetness')}>
                    <Text style={[S.chipText, isChipSelected(opt) && S.chipTextSelected]}>{t('chip_' + opt)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {chipGroups.slice(3).map(group => (
              <View key={group.key} style={{ marginBottom: 14 }}>
                <Text style={S.chipGroupLabel}>{t(group.labelKey)}</Text>
                <View style={S.chipRow}>
                  {group.options.map(opt => (
                    <Pressable key={opt}
                      style={[S.chip, isChipSelected(opt) && S.chipSelected]}
                      onPress={() => toggleChip(opt, group.key)}>
                      <Text style={[S.chipText, isChipSelected(opt) && S.chipTextSelected]}>{t('chip_' + opt)}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}

            <Pressable style={({pressed})=>[S.btnSaffron,pressed&&{backgroundColor:"#c95722"}]} onPress={handleGenerate} disabled={loading}>
              {loading
                ? <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <ActivityIndicator color={C.ivory} />
                    <Text style={S.btnSaffronText}>{t('craftingYourDrink')}</Text>
                  </View>
                : <Text style={S.btnSaffronText}>{t('findMyDrink')}</Text>}
            </Pressable>
          </View>
          {/* Crafting loader card (2026-09-13, PC's ask) — rotating
              messages + elapsed seconds + real Stop crafting, same as
              find-my-drink_embed3.html's buildSipSenseLoaderCard. */}
          {loading && <CraftingLoaderCard onStop={handleStopCrafting} />}
        </>
      )}
    </ScrollView>
    <DiscoveryModal discovery={drink?.discovery} drinkName={drinkName} visible={discoveryOpen} onClose={() => setDiscoveryOpen(false)} />
    <BuildingSipOverlay visible={building} onStop={() => setBuilding(false)} />
    {langPickerOpen && (
      <View style={S.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setLangPickerOpen(false)} />
        <View style={S.modalSheet}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 28 }}>
            <Text style={S.confirmModalTitle}>{t('voiceLanguageTitle')}</Text>
            <Text style={[S.confirmModalMessage, { marginBottom: 12 }]}>{t('voiceLanguageMsg')}</Text>
            {VOICE_LANGUAGES.map(l => (
              <Pressable key={l.code}
                onPress={() => { setLanguage(l.code); setLangPickerOpen(false); }}
                style={[S.modifierRow, language === l.code && S.modifierRowSelected]}>
                <Text style={S.modifierRowText}>{l.flag}  {l.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    )}
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }}
    />
    {choiceModal && (
      <View style={S.modalOverlay}>
        <View style={S.modalSheet}>
          <View style={{ padding: 24 }}>
            <Text style={S.confirmModalTitle}>{choiceModal.title}</Text>
            {!!choiceModal.message && <Text style={S.confirmModalMessage}>{choiceModal.message}</Text>}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
              <Pressable style={S.confirmModalCancelBtn} onPress={() => { const cb = choiceModal.onA; setChoiceModal(null); cb(); }}>
                <Text style={S.confirmModalCancelText}>{choiceModal.labelA}</Text>
              </Pressable>
              <Pressable style={S.confirmModalConfirmBtn} onPress={() => { const cb = choiceModal.onB; setChoiceModal(null); cb(); }}>
                <Text style={S.confirmModalConfirmText}>{choiceModal.labelB}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    )}
    </>
  );
}

// ── REWARDS SCREEN ────────────────────────────────────────────
// Native rebuild (2026-09-12) of dastacafe.com's rewards page
// (rewards_embed1.html/rewards_embed2.html) — same mechanics: 10 leaves
// per cycle from GET /loyalty/status (total_earned, current_leaves,
// available_vouchers — NOTE the live web JS still reads a
// free_drinks_available field that doesn't exist on this endpoint
// anymore; flagging that as a likely dormant web bug, separate from
// this app), same cup photo + leaf-polygon overlay, same guest "tap to
// demo" mode. "Discover Dasta Rewards" links out to the Founders
// Circle tiers page (web-only, per PC's explicit ask — not rebuilt
// natively here).
const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);

// Rebuilt (2026-09-12, second pass) as JUST the plant + trackers per PC's
// explicit simplification — the step-explainer text, the guest demo, and
// the "Discover Dasta Rewards" link all moved elsewhere (Leaf Loyalty Demo
// and Discover Dasta Rewards both now live under More -> Discover Dasta;
// see LeafLoyaltyDemoScreen and MoreScreen). This screen is signed-in-only
// real data now -- what used to be My Circle Account's Leaf Loyalty page,
// moved here wholesale, since PC wanted exactly one home for it.
function RewardsScreen({ navigation, route, isActive }) {
  const customer = route?.params?.customer || null;
  const signedIn = !!customer;

  const [totalEarned,       setTotalEarned]       = useState(0);
  const [availableVouchers, setAvailableVouchers] = useState(0);
  const [loading,           setLoading]           = useState(signedIn);
  const [refreshing,        setRefreshing]        = useState(false);

  const leafAnims     = useRef(REWARDS_LEAF_POLYGONS.map(() => new Animated.Value(0))).current;
  const barWidthAnim  = useRef(new Animated.Value(0)).current;
  const voucherScale  = useRef(new Animated.Value(0)).current;
  const prevFilledRef = useRef(0);

  // Extracted (2026-09-13, PC's ask) so pull-to-refresh and the
  // tab-activate refetch below reuse this exact fetch instead of a
  // second copy of the same request.
  const fetchStatus = async () => {
    const { ok, data } = await apiFetch('/loyalty/status');
    if (ok && data?.success) {
      setTotalEarned(data.total_earned || 0);
      setAvailableVouchers(data.available_vouchers || 0);
    }
    return ok;
  };

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    (async () => { await fetchStatus(); if (!cancelled) setLoading(false); })();
    // Still poll every 60s in the background (unchanged) -- helps a
    // customer sitting on this tab waiting to see a status change (e.g.
    // after redeeming at the counter); the tab-activate refetch below is
    // the fix for stale data on RETURNING to the tab, not a replacement
    // for this.
    const interval = setInterval(fetchStatus, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [signedIn]);

  // Refetch-on-tab-activate (2026-09-13, PC's ask) -- Rewards stays
  // mounted for the whole app session (MainTabs display-toggles it,
  // never unmounts), so a customer who orders/earns a leaf and taps back
  // to this tab used to see stale data until the 60s poll happened to
  // land. Re-runs on every switch back to this tab instead.
  useEffect(() => {
    if (isActive && signedIn) fetchStatus();
  }, [isActive]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await fetchStatus(); } finally { setRefreshing(false); }
  };

  const currentLeaves = totalEarned % 10;
  const isComplete    = totalEarned > 0 && currentLeaves === 0;
  const filledCount   = isComplete ? 10 : currentLeaves;
  const leafPct       = Math.round((filledCount / 10) * 100);

  useEffect(() => {
    if (!signedIn) return;
    Animated.timing(barWidthAnim, { toValue: leafPct, duration: 550, useNativeDriver: false }).start();
    const prev = prevFilledRef.current;
    if (filledCount > prev) {
      const anims = [];
      for (let i = prev; i < filledCount; i++) {
        anims.push(Animated.timing(leafAnims[i], {
          toValue: 0.82, duration: 260, delay: (i - prev) * 220, useNativeDriver: false,
        }));
      }
      Animated.parallel(anims).start(({ finished }) => {
        if (finished && isComplete) {
          Animated.spring(voucherScale, { toValue: 1, friction: 5, tension: 140, useNativeDriver: false }).start();
        }
      });
    } else if (filledCount < prev) {
      leafAnims.forEach(a => a.setValue(0));
      voucherScale.setValue(0);
    }
    prevFilledRef.current = filledCount;
  }, [filledCount, signedIn]);

  const lifetimeSaplings = Math.floor(totalEarned / 50);
  const saplingCycle     = totalEarned % 50;
  const saplingPct       = saplingCycle * 2;

  return (
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.saffron} />}>
      <StatusBar style="light" />
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <Text style={[S.wordmark, { fontSize: 22 }]}>Dasta Rewards</Text>
        <Text style={[S.wordmarkSub, { marginTop: 2 }]}>EVERY SIP GROWS YOUR PLANT</Text>
      </View>

      <View style={{ padding: 16 }}>
        <View style={S.rewardCupWrap}>
          <Image source={{ uri: REWARDS_CUP_IMAGE_URL }} style={S.rewardCupImage} resizeMode="stretch" />
          <Svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} viewBox="0 0 1215 1295">
            {REWARDS_LEAF_POLYGONS.map((points, i) => (
              signedIn
                ? <AnimatedPolygon key={i} points={points} fill="#4a9a3f" opacity={leafAnims[i]} />
                : <Polygon key={i} points={points} fill="#4a9a3f" opacity={0} />
            ))}
          </Svg>
        </View>

        {!signedIn ? (
          <Text style={[S.rewardProgressMsg, { marginTop: 12, textAlign: 'center' }]}>Sign in to see your progress</Text>
        ) : loading ? (
          <ActivityIndicator color={C.saffron} style={{ marginTop: 16 }} />
        ) : (
          <>
            <View style={S.circleProgLabels}>
              <Text style={S.circleProgLeft}>{isComplete ? 'Full plant! Free drink ready' : `${currentLeaves} of 10 leaves`}</Text>
              <Text style={S.circleProgRight}>{isComplete ? 100 : leafPct}%</Text>
            </View>
            <View style={S.circleProgTrack}>
              <Animated.View style={[S.circleProgFill, {
                width: barWidthAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
              }]} />
            </View>

            {/* Always shown, including zero (2026-09-16, PC's ask) — this
                used to hide entirely at 0, leaving no indication a
                customer even HAS a free-drinks count until their first
                one is earned. Rendered as a plain View rather than
                voucherScale's Animated.View: that scale-pop was only ever
                driven by the leaf-fill effect above completing a cycle
                DURING this mount, so it stayed at its initial 0 (invisible)
                for anyone who already had vouchers before opening the
                screen -- a real, separate bug this same fix resolves,
                since a statically-visible box has no such initial-value
                trap. voucherScale itself is left wired to the leaf-fill
                effect unchanged, just no longer this box's visibility
                gate. */}
            {/* Tappable when there's something to redeem (2026-09-22, PC's
                ask) -- opens the same RedeemFreeDrinkScreen/QR the
                Say[Mic]Go menu's own "Redeem my free drink" option already
                uses, not a second implementation. Zero-vouchers state
                stays plain text, nothing to redeem yet. */}
            {availableVouchers > 0 ? (
              <Pressable style={[S.rewardVoucherBox, { marginBottom: 12 }]} onPress={() => navigation.navigate('RedeemFreeDrink', { customer, fromRewards: true })}>
                <Text style={S.rewardVoucherText}>
                  <Text style={{ fontWeight: '700' }}>{availableVouchers} Free Drink{availableVouchers > 1 ? 's' : ''} available for Redemption</Text> — show at the counter!
                </Text>
              </Pressable>
            ) : (
              <View style={[S.rewardVoucherBox, { marginBottom: 12 }]}>
                <Text style={S.rewardVoucherText}>
                  <Text style={{ fontWeight: '700' }}>0 Free Drinks earned</Text>
                </Text>
              </View>
            )}

            <View style={S.circleSaplingCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <Text style={S.circleHeading}>Lifetime Saplings</Text>
                <View style={S.circleLeafBadge}>
                  <Text style={S.circleLeafBadgeText}>{lifetimeSaplings} 🌱</Text>
                </View>
              </View>
              <View style={S.circleProgLabels}>
                <Text style={S.circleProgLeft}>Leaf tracking towards Saplings : {saplingCycle} of 50</Text>
                <Text style={S.circleProgRight}>{saplingPct}%</Text>
              </View>
              <View style={S.circleProgTrack}>
                <View style={[S.circleProgFill, { width: `${saplingPct}%` }]} />
              </View>
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

// ── LEAF LOYALTY DEMO ──────────────────────────────────────────
// The interactive "tap the plant" demo that used to live inline in
// RewardsScreen for guests -- moved to its own standalone screen under
// More -> Discover Dasta per PC (2026-09-12), reachable regardless of
// sign-in state since it's explicitly a demo, not real account data.
// Same exact async state machine as before (ported verbatim, see the
// original comment this carried): demoEarn()/celebrateAndWait()/
// startNewCycle() from rewards_embed2.html, not a derived value.
function LeafLoyaltyDemoScreen({ navigation, onHeaderBack }) {
  const [demoPlaced,   setDemoPlaced]   = useState(0);
  const [demoVouchers, setDemoVouchers] = useState(0);
  const placedRef  = useRef(0);
  const waitingRef = useRef(false);
  const busyRef    = useRef(false);
  const leafAnims     = useRef(REWARDS_LEAF_POLYGONS.map(() => new Animated.Value(0))).current;
  const voucherScale  = useRef(new Animated.Value(0)).current;
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const fillLeaf = (i) => {
    Animated.timing(leafAnims[i], { toValue: 0.82, duration: 260, useNativeDriver: false }).start();
  };
  const celebrateAndWait = async () => {
    waitingRef.current = true;
    setDemoVouchers(v => v + 1);
    Animated.spring(voucherScale, { toValue: 1, friction: 5, tension: 140, useNativeDriver: false }).start();
  };
  const startNewCycle = async () => {
    waitingRef.current = false;
    await sleep(240);
    leafAnims.forEach(a => a.setValue(0));
    voucherScale.setValue(0);
    placedRef.current = 0; setDemoPlaced(0); setDemoVouchers(0);
    await sleep(300);
    fillLeaf(0); placedRef.current = 1; setDemoPlaced(1);
  };
  const handleDemoTap = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    if (waitingRef.current) {
      await startNewCycle();
    } else {
      fillLeaf(placedRef.current);
      placedRef.current += 1;
      setDemoPlaced(placedRef.current);
      if (placedRef.current === 10) { await sleep(400); await celebrateAndWait(); }
    }
    busyRef.current = false;
  };

  return (
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 40 }}>
      <StatusBar style="light" />
      {/* Back-chevron removed (2026-09-23, PC's ask, app-wide audit) --
          the Home tab already gets you back just as fast; PC's call is
          that's enough everywhere, arrow or not (also flagged as
          misleading at times). Title now sits at S.hero's own left
          padding, same inset as HomeScreen's own title. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title="Leaf Loyalty Demo" onBack={onHeaderBack} />
      </View>

      <View style={{ padding: 16 }}>
        <Text style={[S.cardSub, { textAlign: 'left', marginBottom: 18 }]}>
          Every sip grows your plant. Every plant earns a free drink.
        </Text>

        <Pressable onPress={handleDemoTap} style={S.rewardCupWrap}>
          <Image source={{ uri: REWARDS_CUP_IMAGE_URL }} style={S.rewardCupImage} resizeMode="stretch" />
          <Svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} viewBox="0 0 1215 1295">
            {REWARDS_LEAF_POLYGONS.map((points, i) => (
              <AnimatedPolygon key={i} points={points} fill="#4a9a3f" opacity={leafAnims[i]} />
            ))}
          </Svg>
          <View style={S.rewardTapHint}>
            <View style={S.rewardTapHintPill}>
              <Text style={S.rewardTapHintText}>✨ Tap to see the magic</Text>
            </View>
          </View>
        </Pressable>

        <View style={S.rewardProgressCard}>
          <Text style={S.rewardProgressLabel}>DEMO — TAP THE PLANT TO TRY IT</Text>
          <View style={S.rewardProgressBarBg}>
            <View style={[S.rewardProgressBarFill, { width: `${(demoPlaced / 10) * 100}%` }]} />
          </View>
          <Text style={S.rewardProgressMsg}>Sign in to see your progress</Text>
          {demoVouchers > 0 && (
            <Animated.View style={[S.rewardVoucherBox, { transform: [{ scale: voucherScale }] }]}>
              <Text style={S.rewardVoucherText}>
                You have <Text style={{ fontWeight: '700' }}>{demoVouchers} free drink{demoVouchers > 1 ? 's' : ''}</Text> ready — show at the counter!
              </Text>
            </Animated.View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

// ── MENU SCREEN ────────────────────────────────────────────────
// Native rebuild (2026-09-12) of dastacafe.com/dasta-menu, backed by
// the same real GET /dasta-menu (dasta_menu_router.py) — a public,
// no-auth-required endpoint returning categories -> items with live
// Clover pricing, so this can never show a stale copy of the menu.
// Modifier-based add-to-cart (the same endpoint also carries modifier
// groups) is intentionally NOT built here — that's tied to the same
// not-yet-built cart/card checkout flagged elsewhere in Craft My
// Drink; this is browse-only, matching what was actually asked for.
// ── MENU ITEM MODAL (2026-09-13) ─────────────────────────────────
// Ported from dasta-menu_embed1.html's modifier popup: tapping a Dasta
// Menu item opens every one of its modifier_groups (already returned
// nested by GET /dasta-menu — see dasta_menu_router.py, nothing new to
// fetch), re-prices live via the same POST /dasta-menu/price-cart the
// web popup calls as selections change, then either "Add to Order"
// (POST /checkout/cart/items) or "Add to Gift" (POST /gift-orders/items)
// — the exact two endpoints/payload shapes web's own checkout already
// uses, not a reinvented mobile-only path.
function MenuItemPanel({ item, onClose, cart, customer, navigation, showInfo }) {
  // Round 6 (2026-09-23, PC's live report) -- renamed from MenuItemModal:
  // it isn't a modal/overlay anymore. Rounds 1-5 chased a series of
  // coordinate/sizing bugs while this was mounted as an overlay layered on
  // top of the screen (first position:'absolute' nested in the wrong
  // ScrollView, then a native <Modal>). Round 5 fixed the last visible
  // symptom (covering the SipSense chip/category tabs), but PC's next
  // retest surfaced the actual structural problem underneath all of it:
  // <Modal> renders via a real OS-level overlay/window, so EVERYTHING
  // behind it stops receiving touches no matter how narrow its visible
  // content is -- the category tabs, header, and tab bar were all frozen
  // while a sheet was open, and it still had bottom-sheet-style rounded
  // top corners despite PC wanting "the same window as the original menu."
  //
  // Fix: this is now a plain in-flow component. MenuScreen renders it as a
  // normal sibling inside the same flex:1 slot the item-list ScrollView
  // otherwise occupies (see MenuScreen's own return) -- not an overlay, no
  // position:'absolute', no Modal, no backdrop-dismiss Pressable (there's
  // no "outside" to tap once it's not layered on top of anything; the ✕
  // button below is the only close affordance now, same as it always
  // was). This is also why no top/bottom coordinate math is needed at
  // all anymore -- flex layout in MenuScreen handles it, the exact
  // approach PC's own brief recommended after round 3.
  const [selected, setSelected] = useState({}); // { [groupId]: Set<modifierId> }
  const [quantity, setQuantity] = useState(1);
  const [livePrice, setLivePrice] = useState(null); // cents
  const [pricing, setPricing] = useState(false);
  const [adding, setAdding] = useState(null); // 'order' | 'gift' | null
  // showInfo (2026-09-23, round 6) -- now a prop from MenuScreen, not local
  // state here. InfoModal itself must render as a direct child of
  // MenuScreen's own root View (S.screen) for its hardcoded S.modalOverlay
  // top:100/bottom:TAB_BAR_HEIGHT positioning to resolve against the full
  // screen, same as it always has everywhere else this pattern is used --
  // rendering it from inside this panel's own flex:1 box (the narrower
  // region between the fixed header and the tab bar) would make that math
  // wrong the same way rounds 1-3's coordinate bugs were wrong. See
  // MenuScreen's own showInfo/infoModal state and its <InfoModal /> render.

  useEffect(() => {
    if (!item) return;
    // Pre-select each group's is_default modifiers, matching web's popup
    // default state on open.
    const init = {};
    (item.modifier_groups || []).forEach(g => {
      init[g.id] = new Set(g.modifiers.filter(m => m.is_default).map(m => m.id));
    });
    setSelected(init);
    setQuantity(1);
  }, [item?.id]);

  const selectedIds = () => Object.values(selected).flatMap(s => Array.from(s));

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setPricing(true);
    apiFetch('/dasta-menu/price-cart', {
      method: 'POST',
      body: { dasta_menu_item_id: item.id, quantity, selected_modifier_ids: selectedIds() },
    }).then(({ ok, data }) => {
      if (cancelled) return;
      setLivePrice(ok && data?.success ? data.unit_price_cents : null);
      setPricing(false);
    });
    return () => { cancelled = true; };
  }, [item?.id, quantity, JSON.stringify(Object.fromEntries(Object.entries(selected).map(([k, v]) => [k, Array.from(v).sort()])))]);

  if (!item) return null;

  const toggleModifier = (group, modId) => {
    setSelected(prev => {
      const next = { ...prev };
      const cur = new Set(prev[group.id] || []);
      if (group.max_allowed === 1) {
        next[group.id] = cur.has(modId) && (group.min_required || 0) === 0 ? new Set() : new Set([modId]);
      } else {
        if (cur.has(modId)) cur.delete(modId);
        else if (cur.size < (group.max_allowed || 99)) cur.add(modId);
        next[group.id] = cur;
      }
      return next;
    });
  };

  const missingRequired = () => (item.modifier_groups || []).find(
    g => (g.min_required || 0) > (selected[g.id]?.size || 0)
  );

  const doAdd = async (kind) => {
    const missing = missingRequired();
    if (missing) { showInfo('One more thing', `${missing.name} needs at least ${missing.min_required} selection(s).`); return; }
    // onOk defers onClose()/navigate() until the InfoModal itself is
    // dismissed -- both would otherwise unmount this whole panel (swapping
    // MenuScreen's flex:1 region back to the item list) before the
    // customer ever saw the confirmation, same reasoning as
    // FavoriteDetailModal's own showInfo calls above in this file.
    if (!customer) { showInfo('Sign In', 'Please sign in to order.', () => { onClose(); navigation.navigate('SignIn'); }); return; }
    setAdding(kind);
    const payload = {
      item_type: 'drink', drink_source: 'dasta_menu', dasta_menu_item_id: item.id,
      selected_modifier_ids: selectedIds(), quantity,
      unit_price_cents: livePrice ?? item.price_cents,
    };
    const { ok, data } = kind === 'order' ? await cart.addToCart(payload) : await cart.addToGift(payload);
    setAdding(null);
    if (ok && data?.success) {
      showInfo(kind === 'order' ? 'Added to Cart 🛒' : 'Added to Gift 🎁', `${item.name} — ${quantity}x`, onClose);
    } else {
      showInfo('Error', data?.detail || 'Could not add this item.');
    }
  };

  return (
    /* Plain in-flow panel (2026-09-23, round 6) -- fills the flex:1 slot
       MenuScreen gives it, square corners (no borderTopLeftRadius/
       borderTopRightRadius -- this isn't a bottom-sheet popup, PC wants
       "the same window as the original menu"), no backdrop Pressable
       (nothing to dismiss "outside of" since it's not layered on top of
       anything -- the ✕ button below is the close affordance). InfoModal
       is NOT rendered here anymore -- see MenuScreen's own comment on
       why (its top:100/bottom:X math needs the full-screen box, not this
       panel's narrower one). */
    <View style={{ flex: 1, backgroundColor: C.ivory }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 20, paddingBottom: 28 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Text style={S.drinkFullName}>{item.name}</Text>
            <Pressable onPress={onClose} hitSlop={12}><Text style={{ fontSize: 22, color: C.black }}>✕</Text></Pressable>
          </View>
          {item.description ? <Text style={S.menuItemDesc}>{item.description}</Text> : null}

          {(item.modifier_groups || []).map(group => (
            <View key={group.id} style={{ marginTop: 16 }}>
              <Text style={S.ingredientsBoxTitle}>
                {group.name}{group.min_required > 0 ? ' (required)' : ''}
              </Text>
              {group.modifiers.map(mod => {
                const isSel = (selected[group.id] || new Set()).has(mod.id);
                // Already a single Pressable wrapping the whole row (label +
                // price) -- there's no separate radio-only touch target here
                // to fix structurally. Added accessibilityRole/State while
                // touching this (2026-09-22), per the task brief, regardless.
                return (
                  <Pressable key={mod.id} onPress={() => toggleModifier(group, mod.id)}
                    style={[S.modifierRow, isSel && S.modifierRowSelected]}
                    accessibilityRole={group.max_allowed === 1 ? 'radio' : 'checkbox'}
                    accessibilityState={{ selected: isSel, checked: isSel }}>
                    <Text style={S.modifierRowText}>{isSel ? '✓ ' : ''}{mod.name}</Text>
                    {mod.price_cents > 0 && <Text style={S.modifierRowPrice}>+${(mod.price_cents / 100).toFixed(2)}</Text>}
                  </Pressable>
                );
              })}
            </View>
          ))}

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Pressable onPress={() => setQuantity(q => Math.max(1, q - 1))} style={S.qtyBtn}><Text style={S.qtyBtnText}>−</Text></Pressable>
              <Text style={{ fontSize: 16, fontWeight: '700' }}>{quantity}</Text>
              <Pressable onPress={() => setQuantity(q => Math.min(20, q + 1))} style={S.qtyBtn}><Text style={S.qtyBtnText}>+</Text></Pressable>
            </View>
            {/* Fixed-height wrapper (2026-09-22 fix) -- this row toggles
                between an ActivityIndicator and differently-sized Text on
                every modifier tap (the live price-cart re-fetch), which
                shifts the layout of everything below it -- including right
                as the user starts a scroll gesture toward Add to
                Order/Add to Gift. minHeight keeps both states the same
                size so neither swap moves anything else on the screen. */}
            <View style={{ minHeight: 24, justifyContent: 'center' }}>
              {pricing ? <ActivityIndicator color={C.saffron} /> : (
                <Text style={S.menuItemPrice}>${(((livePrice ?? item.price_cents) * quantity) / 100).toFixed(2)}</Text>
              )}
            </View>
          </View>

          <Pressable style={[S.btnSaffron, { marginTop: 18 }]} disabled={!!adding} onPress={() => doAdd('order')}>
            {adding === 'order' ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>🛒 Add to Order</Text>}
          </Pressable>
          <Pressable style={[S.btnSaffron, { marginTop: 10, backgroundColor: C.gold }]} disabled={!!adding} onPress={() => doAdd('gift')}>
            {adding === 'gift' ? <ActivityIndicator color={C.espresso} /> : <Text style={[S.btnSaffronText, { color: C.espresso }]}>🎁 Add to Gift</Text>}
          </Pressable>
      </ScrollView>
    </View>
  );
}

function MenuScreen({ navigation, route, isActive, onHeaderBack }) {
  const customer = route?.params?.customer || null;
  const cart = useCart();
  const [categories, setCategories] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCat,  setActiveCat]  = useState(null);
  const [modalItem,  setModalItem]  = useState(null);
  // infoModal/showInfo (2026-09-23, round 6) -- lifted up from
  // MenuItemPanel. InfoModal's own hardcoded S.modalOverlay styling
  // (top:100/bottom:TAB_BAR_HEIGHT+...) needs to resolve against the full
  // screen box, same as every other caller of it in this file -- rendering
  // it from inside MenuItemPanel's own flex:1 box (the narrower region
  // between the fixed header and the tab bar) would make that math wrong
  // the same way rounds 1-3's coordinate bugs were. Rendered once below,
  // directly inside S.screen's own View, outside the nested flex:1 region.
  const [infoModal, setInfoModal] = useState(null); // {title, message, onOk}
  const showInfo = (title, message, onOk) => setInfoModal({ title, message, onOk });

  // Extracted (2026-09-13, PC's ask) so pull-to-refresh and the
  // tab-activate refetch below both call the exact same fetch, rather
  // than a second copy of the same request.
  const loadMenu = async () => {
    const { ok, data } = await apiFetch('/dasta-menu');
    if (ok && data?.categories) {
      // Fixed 2026-09-12: the API's category field is `name`, not
      // `display_name` (confirmed via a direct live call) -- category
      // tabs were rendering with blank labels. Also only keep
      // categories that actually have items, matching web's own
      // dasta-menu_embed1.html comment ("only categories with items
      // render at all") -- several categories exist in the DB with
      // zero active Clover items and would otherwise show as empty
      // tabs (Matcha, Green Tea, Bagel Sandwiches, Cream Cheese, as
      // of this check).
      const nonEmpty = data.categories.filter(c => (c.items || []).length > 0);
      setCategories(nonEmpty);
      // Keep the customer's current tab selected across a refresh if it
      // still exists; only fall back to the first tab on true first load
      // or if that category disappeared.
      setActiveCat(prev => (prev && nonEmpty.some(c => c.id === prev)) ? prev : (nonEmpty[0]?.id ?? null));
    }
    return ok;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadMenu();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Refetch-on-tab-activate (2026-09-13, PC's ask) -- Menu stays mounted
  // for the whole app session (MainTabs display-toggles it, never
  // unmounts), so its original useEffect(..., []) only ever ran once.
  // Re-runs the same fetch every time a customer switches back to this
  // tab, not just on a timer or a manual pull.
  useEffect(() => {
    if (isActive) loadMenu();
  }, [isActive]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await loadMenu(); } finally { setRefreshing(false); }
  };

  const activeCategory = categories.find(c => c.id === activeCat);

  return (
    <View style={S.screen}>
      <StatusBar style="light" />
      {/* SipSense button moved back into the title row, next to "Dasta
          Menu" (2026-09-23, PC's ask) -- it was moved OUT of this row on
          2026-09-15 for exactly the GlobalAccountHeader-overlap reason
          this fix now solves properly instead of avoiding: that header's
          account/cart/gift icons are absolutely positioned at MainTabs'
          level (top:54, right:18 -- see HomeScreen's own comment), worst
          case (signed-in customer with both a cart and a pending gift
          showing) spanning ~132px. paddingRight:140 below reserves that
          plus a small buffer so the pill's own right edge never reaches
          under them, regardless of which icons happen to be showing.
          alignItems:'center' on the row vertically centers the pill
          against the title's center line (not top/baseline). Pill made
          smaller than S.startOverBtn's other usages (reduced padding +
          font size, explicitly OK'd for this placement) since "Dasta
          Menu" + a pill sharing one row is tighter than a full row below
          it -- check on the smallest supported width. Not scrollable
          (round 6, 2026-09-23) -- this and the category tab row below it
          are now a fixed top block, with only the item list / open
          item's panel scrolling underneath, instead of the whole screen
          (title bar included) being one big ScrollView. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        {/* Two-line banner (title row + subtitle) like Rewards/More: no 44pt
            min on the row -- that's only for single-line banners, and with
            the subtitle under it this banner sat ~13pt taller (PC, 2026-10-01). */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 140 }}>
          {onHeaderBack ? <View style={{ marginRight: 10 }}><HeroBackArrow onPress={onHeaderBack} label="Back" /></View> : null}
          <Text style={[S.wordmark, { fontSize: 22 }]} numberOfLines={1}>Dasta Menu</Text>
          <Pressable style={({pressed})=>[S.startOverBtn,{paddingHorizontal:10,paddingVertical:4,marginLeft:10},pressed&&{opacity:0.7}]}
            onPress={() => navigation.navigate('StartNewDrink')}>
            <Text style={[S.startOverText,{fontSize:12}]} numberOfLines={1}>SipSense</Text>
          </Pressable>
        </View>
        <Text style={[S.wordmarkSub, { marginTop: 2 }]}>CHAI, COFFEE & MORE</Text>
        {/* Account/cart/gift icons come from the persistent
            GlobalAccountHeader (MainTabs), not a per-screen copy —
            see HomeScreen's own comment on this. */}
      </View>

      {loading ? (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <ActivityIndicator color={C.saffron} size="large" />
        </View>
      ) : categories.length === 0 ? (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <Text style={S.cardSub}>Could not load the menu right now.</Text>
          <Pressable style={[S.btnSaffron, { marginTop: 16 }]} onPress={() => openLink('https://www.dastacafe.com/dasta-menu')}>
            <Text style={S.btnSaffronText}>View on Website</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={{ position: 'relative' }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              style={{ marginTop: 10, marginBottom: 8 }} contentContainerStyle={{ paddingHorizontal: 16, paddingRight: 30, gap: 8 }}>
              {categories.map(cat => (
                <Pressable key={cat.id}
                  style={[S.menuCatTab, activeCat === cat.id && S.menuCatTabActive]}
                  // Also closes an open item panel (2026-09-23, PC's live
                  // report) -- round 6 made the category tabs tappable
                  // while a panel is open, but switching category left the
                  // SAME item's panel showing instead of that category's
                  // list, since modalItem alone controls which one the
                  // flex:1 region renders (see MenuScreen's own comment).
                  // Switching categories now backs out of the panel first,
                  // same as tapping Home/Rewards in the footer already did.
                  onPress={() => { setModalItem(null); setActiveCat(cat.id); }}>
                  <Text style={[S.menuCatTabText, activeCat === cat.id && S.menuCatTabTextActive]}>{cat.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {/* More-to-scroll hint (2026-09-16, PC's ask) -- testers weren't
                noticing the category row scrolls. A soft edge fade + chevron,
                not a hard cutoff, so it reads as "more this way" rather than
                looking like a rendering glitch. */}
            {categories.length > 1 && (
              <View pointerEvents="none" style={{ position: 'absolute', right: 0, top: 0, bottom: 8, width: 30, alignItems: 'flex-end', justifyContent: 'center' }}>
                <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 30, backgroundColor: C.ivory, opacity: 0.85 }} />
                <Text style={{ color: C.saffron, fontSize: 16, fontWeight: '700', marginRight: 2 }}>›</Text>
              </View>
            )}
          </View>

          {/* Round 6 (2026-09-23, PC's live report) -- this flex:1 region
              is "everything between the fixed top block above and the tab
              bar MainTabs renders below MenuScreen entirely" -- either the
              browsable item list, or (never both at once) the open item's
              customization panel, rendered as a plain in-flow sibling
              instead of an overlay/Modal layered on top of it. Because
              it's in-flow, not layered, the category tabs/header/tab bar
              above and below stay fully interactive while a panel is
              open -- there's nothing capturing their touches anymore. */}
          <View style={{ flex: 1 }}>
            {modalItem ? (
              <MenuItemPanel item={modalItem} onClose={() => setModalItem(null)}
                cart={cart} customer={customer} navigation={navigation} showInfo={showInfo} />
            ) : (
              <ScrollView pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom
                keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.saffron} />}>
                {(activeCategory?.items || []).map(item => (
                  <Pressable key={item.id} style={S.menuItemCard} onPress={() => setModalItem(item)}>
                    {item.image_url ? <Image source={{ uri: item.image_url }} style={S.menuItemImage} /> : null}
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Text style={S.menuItemName}>{item.name}</Text>
                        {item.featured && <Text style={S.menuItemFeatured}>★ FEATURED</Text>}
                      </View>
                      {item.description ? <Text style={S.menuItemDesc}>{item.description}</Text> : null}
                      <Text style={S.menuItemPrice}>${(item.price_cents / 100).toFixed(2)}</Text>
                      {item.modifier_groups?.length > 0 && <Text style={S.menuItemHint}>Tap to customize & order</Text>}
                    </View>
                  </Pressable>
                ))}
                {activeCategory && (activeCategory.items || []).length === 0 && (
                  <Text style={S.cardSub}>Nothing available in this category right now.</Text>
                )}
              </ScrollView>
            )}
          </View>
        </>
      )}
      {/* Rendered here, directly inside S.screen's own View (2026-09-23,
          round 6) -- NOT inside the flex:1 middle region above -- so its
          hardcoded S.modalOverlay top/bottom positioning resolves against
          the full screen box, matching every other caller of InfoModal in
          this file. See this state's own declaration above for why. */}
      <InfoModal
        visible={!!infoModal}
        title={infoModal?.title}
        message={infoModal?.message}
        onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }}
      />
    </View>
  );
}

// ── MY PROFILE: PERSONAL INFO ────────────────────────────────
// Native rebuild (2026-09-12) of dasta-circle_embed6.html's Personal
// Info screen, against the same GET/PATCH /auth/profile this app
// already used for new-customer onboarding (ProfileScreen). Phone/
// email/birthday are locked once set (matches web exactly) with a hint
// pointing at Sign-in & Contact — this screen never edits those fields.
function PersonalInfoScreen({ navigation }) {
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [profile,  setProfile]  = useState(null);
  const [firstName,setFirstName]= useState('');
  const [lastName, setLastName] = useState('');
  const [dob,      setDob]      = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city,     setCity]     = useState('');
  const [state,    setState]    = useState('');
  const [zipCode,  setZipCode]  = useState('');
  const [country,  setCountry]  = useState('');
  const [infoModal, setInfoModal] = useState(null); // {title, message}
  const showInfo = (title, message) => setInfoModal({ title, message });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { ok, data } = await apiFetch('/auth/profile');
      if (!cancelled && ok && data?.success) {
        const c = data.customer;
        setProfile(c);
        setFirstName(c.first_name || '');
        setLastName(c.last_name || '');
        setDob(c.dob_mmdd || '');
        setAddressLine1(c.address_line1 || '');
        setAddressLine2(c.address_line2 || '');
        setCity(c.city || '');
        setState(c.state || '');
        setZipCode(c.zip_code || '');
        setCountry(c.country || '');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    if (!firstName.trim()) { showInfo('Required', 'Please enter your first name.'); return; }
    setSaving(true);
    try {
      const { ok, data } = await apiFetch('/auth/profile', {
        method: 'PATCH',
        body: {
          first_name: firstName.trim(),
          last_name:  lastName.trim() || null,
          // dob_mmdd is locked server-side once set (409 if re-sent) --
          // only send it while it's still genuinely settable.
          dob_mmdd: profile?.dob_mmdd ? null : (dob.trim() || null),
          address_line1: addressLine1.trim() || null,
          address_line2: addressLine2.trim() || null,
          city: city.trim() || null,
          state: state.trim() || null,
          zip_code: zipCode.trim() || null,
          country: country.trim() || null,
        },
      });
      if (ok && data?.success) showInfo('Saved', 'Your info has been updated.');
      else showInfo('Error', data?.detail || 'Could not save your info.');
    } catch { showInfo('Error', 'Could not reach Dasta server.'); }
    finally { setSaving(false); }
  };

  if (loading) {
    return (
      <View style={[S.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.saffron} size="large" />
      </View>
    );
  }

  return (
    <>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 40 }}>
      <StatusBar style="light" />
      {/* Back-chevron removed (2026-09-23, PC's ask, app-wide audit) --
          Home tab is enough everywhere, arrow or not. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title={'Personal Info'} />
      </View>

      <View style={{ padding: 16 }}>
        <Text style={S.fieldLabel}>First Name</Text>
        <TextInput style={S.input} value={firstName} onChangeText={setFirstName} />

        <Text style={S.fieldLabel}>Last Name</Text>
        <TextInput style={S.input} value={lastName} onChangeText={setLastName} placeholder="(optional)" placeholderTextColor={C.muted} />

        <Text style={S.fieldLabel}>Phone</Text>
        {profile?.phone ? (
          <>
            <TextInput style={[S.input, S.inputLocked]} value={profile.phone} editable={false} />
            <Text style={S.fieldHint}>To update, use Sign-in &amp; Contact.</Text>
          </>
        ) : <Text style={S.fieldHint}>Not set — add one in Sign-in &amp; Contact.</Text>}

        <Text style={S.fieldLabel}>Email</Text>
        {profile?.email ? (
          <>
            <TextInput style={[S.input, S.inputLocked]} value={profile.email} editable={false} />
            <Text style={S.fieldHint}>To update, use Sign-in &amp; Contact.</Text>
          </>
        ) : <Text style={S.fieldHint}>Not set — add one in Sign-in &amp; Contact.</Text>}

        <Text style={S.fieldLabel}>Birthday</Text>
        {profile?.dob_mmdd ? (
          <TextInput style={[S.input, S.inputLocked]} value={formatDobDisplay(profile.dob_mmdd)} editable={false} />
        ) : (
          <>
            <TextInput style={S.input} value={dob} onChangeText={setDob}
              placeholder="MMDD e.g. 0314" placeholderTextColor={C.muted} keyboardType="number-pad" maxLength={4} />
            <Text style={S.fieldHint}>Month + Day only — locked once set. We use this for birthday surprises! 🎂</Text>
          </>
        )}

        <Text style={S.fieldLabel}>Address Line 1</Text>
        <TextInput style={S.input} value={addressLine1} onChangeText={setAddressLine1} />
        <Text style={S.fieldLabel}>Address Line 2</Text>
        <TextInput style={S.input} value={addressLine2} onChangeText={setAddressLine2} placeholder="(optional)" placeholderTextColor={C.muted} />
        <Text style={S.fieldLabel}>City</Text>
        <TextInput style={S.input} value={city} onChangeText={setCity} />
        <Text style={S.fieldLabel}>State</Text>
        <TextInput style={S.input} value={state} onChangeText={setState} />
        <Text style={S.fieldLabel}>ZIP Code</Text>
        <TextInput style={S.input} value={zipCode} onChangeText={setZipCode} keyboardType="number-pad" />
        <Text style={S.fieldLabel}>Country</Text>
        <TextInput style={S.input} value={country} onChangeText={setCountry} />

        <Pressable style={[S.btnSaffron, { marginTop: 12 }]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Save Changes</Text>}
        </Pressable>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => setInfoModal(null)}
    />
    </>
  );
}

// ── MY PROFILE: NOTIFICATION PREFERENCES ─────────────────────
// Against GET/PATCH /auth/notification-preferences — categories, labels,
// and forced/off-limits rules all come from the API itself, so this
// screen never hardcodes anything the backend could change independently.
function NotificationPreferencesScreen({ navigation }) {
  const [loading,    setLoading]    = useState(true);
  const [categories, setCategories] = useState([]);
  const [hasPhone,   setHasPhone]   = useState(false);
  const [savingKey,  setSavingKey]  = useState(null);
  const [infoModal, setInfoModal] = useState(null); // {title, message}
  const showInfo = (title, message) => setInfoModal({ title, message });

  // Push Notifications toggle (2026-09-24) -- a device-wide switch, own
  // row above the per-category list, NOT a fourth Email/Text/Off channel
  // option (PC's explicit call). "On" requires BOTH the OS permission to
  // actually be granted AND the server-side push_enabled flag to be true
  // -- either one alone must read as off, since neither can deliver a
  // push by itself (see pushEnabled's derivation below).
  const [pushEnabled,     setPushEnabled]     = useState(false);
  const [pushLoading,     setPushLoading]     = useState(false);
  const [pushDeniedModal, setPushDeniedModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [prefsResult, osPerm] = await Promise.all([
        apiFetch('/auth/notification-preferences'),
        Notifications.getPermissionsAsync(),
      ]);
      const { ok, data } = prefsResult;
      if (!cancelled && ok && data?.success) {
        setCategories(data.categories || []);
        setHasPhone(!!data.has_phone);
        setPushEnabled(osPerm.status === 'granted' && !!data.push_enabled);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleTogglePush = async (next) => {
    if (!next) {
      // Turning off never touches the OS permission (can't be revoked
      // from here anyway) or the stored token -- just stops the backend
      // from sending, so turning it back on later doesn't require
      // another OS permission round-trip.
      setPushLoading(true);
      const { ok } = await apiFetch('/auth/notification-preferences', {
        method: 'PATCH', body: { push_enabled: false },
      });
      setPushLoading(false);
      if (ok) setPushEnabled(false);
      else showInfo('Error', 'Could not update this preference.');
      return;
    }

    // Checked BEFORE calling the shared helper so a fresh native "Don't
    // Allow" (feedback enough on its own) can be told apart from an
    // already-permanent denial (no native dialog fires at all here --
    // silently doing nothing would look like the toggle is broken).
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    setPushLoading(true);
    const result = await requestPushPermissionAndRegister();
    setPushLoading(false);
    if (result === 'granted') {
      setPushEnabled(true);
    } else if (result === 'denied') {
      if (existingStatus === 'denied') setPushDeniedModal(true);
      // else: undetermined -> native dialog just fired and was declined,
      // that denial is its own feedback -- no modal needed.
    } else {
      showInfo('Error', "Couldn't turn on notifications right now. Please try again.");
    }
  };

  const handleSetChannel = async (cat, channel) => {
    if (cat.forced && channel === 'off') return;
    if (channel === 'sms' && !hasPhone) {
      showInfo('Phone needed', 'Add a phone number in Personal Info to enable SMS notifications.');
      return;
    }
    setSavingKey(cat.key);
    const { ok, data } = await apiFetch('/auth/notification-preferences', {
      method: 'PATCH', body: { category: cat.key, channel },
    });
    setSavingKey(null);
    if (ok && data?.success) {
      setCategories(prev => prev.map(c => (c.key === cat.key ? { ...c, channel } : c)));
    } else {
      showInfo('Error', data?.detail || 'Could not update this preference.');
    }
  };

  if (loading) {
    return (
      <View style={[S.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.saffron} size="large" />
      </View>
    );
  }

  const channelLabels = { email: 'Email', sms: 'Text', off: 'Off' };

  return (
    <>
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 40 }}>
      <StatusBar style="light" />
      {/* Back-chevron removed (2026-09-23, PC's ask, app-wide audit) --
          Home tab is enough everywhere, arrow or not. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title={'Notification Preferences'} />
      </View>

      <View style={{ padding: 16 }}>
        <View style={[S.notifCatCard, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={S.notifCatLabel}>Push Notifications</Text>
            <Text style={{ color: C.black, fontSize: 12, marginTop: 4 }}>
              Choose Email or Text for individual notification types below.
            </Text>
          </View>
          {pushLoading
            ? <ActivityIndicator color={C.saffron} />
            : <Switch value={pushEnabled} onValueChange={handleTogglePush}
                trackColor={{ false: C.border, true: C.saffron }} thumbColor={C.white} ios_backgroundColor={C.border} />}
        </View>

        {categories.map(cat => (
          <View key={cat.key} style={S.notifCatCard}>
            <Text style={S.notifCatLabel}>{cat.label}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              {['email', 'sms', 'off'].map(ch => {
                if (ch === 'off' && cat.forced) return null;
                const active   = cat.channel === ch;
                const disabled = savingKey === cat.key || (ch === 'sms' && !hasPhone);
                return (
                  <Pressable key={ch} disabled={disabled}
                    style={[S.notifChanBtn, active && S.notifChanBtnActive, disabled && { opacity: 0.4 }]}
                    onPress={() => handleSetChannel(cat, ch)}>
                    <Text style={[S.notifChanBtnText, active && S.notifChanBtnTextActive]}>{channelLabels[ch]}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => setInfoModal(null)}
    />
    <ConfirmModal
      visible={pushDeniedModal}
      title="Notifications are off"
      message="Notifications are turned off for Dasta in your phone's Settings. Turn them on there to enable this."
      confirmLabel="Open Settings"
      cancelLabel="Cancel"
      onConfirm={() => Linking.openSettings()}
      onClose={() => setPushDeniedModal(false)}
    />
    </>
  );
}

// ── MY PROFILE: SIGN-IN & CONTACT ────────────────────────────
// Phone/email change, against the exact same request/verify OTP
// endpoints auth_router.py already exposes (/auth/request-phone-change
// + /verify-phone-change, and the email equivalents) — Cognito holds
// the new value pending until the code is confirmed, same as web.
// Changing an already-SET value requires a recent login server-side
// (_require_fresh_auth); this screen surfaces that as a plain message
// rather than building a step-up re-auth flow, which is out of scope
// for this pass.
function SignInContactScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [phone,   setPhone]   = useState(null);
  const [email,   setEmail]   = useState(null);

  const [changeKind, setChangeKind] = useState(null); // 'phone' | 'email' | null
  const [step,       setStep]       = useState('input'); // 'input' | 'code'
  const [newValue,   setNewValue]   = useState('');
  const [code,       setCode]       = useState('');
  const [destination,setDestination]= useState('');
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState('');
  const [infoModal, setInfoModal] = useState(null); // {title, message}
  const showInfo = (title, message) => setInfoModal({ title, message });

  // Link Phone and Email (2026-09-21, web parity) -- dastacafe.com labels
  // this "Link Phone and Email" in the account menu, but it's actually the
  // same "Merge Phone and Email" active-merge flow Phase 5 built
  // (POST /auth/passwordless/link-start + /link-verify, then the same
  // GET /auth/merge/pending + POST /auth/merge/confirm every merge path
  // in this app uses -- see SignInScreen's own mergeConfirm step, the
  // passive trigger for this identical backend mechanism). Confirmed
  // against the real web implementation (dasta-circle_embed4.html's
  // dcShowMergeAccounts/dcSubmitMergeAccounts/dcMergeVerify/
  // dcShowMergeConfirm) before building this -- web does NOT show a
  // read-only "already linked" state even when the customer already has
  // both phone and email; the row is always actionable (falls back to
  // generic "if you signed up more than once" copy in that case), because
  // this is really "find and merge a second, separate Dasta account,"
  // not "fill in a missing field on this one" -- request-phone-change/
  // request-email-change already cover that simpler case. Mirrored here
  // rather than the read-only state PC's original ask assumed.
  const [mergeStep,       setMergeStep]       = useState('closed'); // closed | form | chooser | code | confirm
  const [mergeIdentifier, setMergeIdentifier] = useState('');
  const [mergeSession,    setMergeSession]    = useState(null);
  const [mergeChallengeName, setMergeChallengeName] = useState(null);
  const [mergeChallenges, setMergeChallenges] = useState([]);
  const [mergeDest,       setMergeDest]       = useState('');
  const [mergeCode,       setMergeCode]       = useState('');
  const [mergeSummary,    setMergeSummary]    = useState(null); // {survivor, loser}
  const [mergeBusy,       setMergeBusy]       = useState(false);
  const [mergeError,      setMergeError]      = useState('');

  const mergeFieldCopy = () => {
    if (phone && !email) return { sub: "You're signed in with a phone number. Enter the EMAIL ADDRESS of your other Dasta account below to combine them into one account. This can't be undone.", placeholder: 'Email address' };
    if (email && !phone) return { sub: "You're signed in with an email address. Enter the PHONE NUMBER of your other Dasta account below to combine them into one account. This can't be undone.", placeholder: 'Phone number' };
    return { sub: 'If you signed up more than once — once by phone, once by email — enter the OTHER phone number or email below to combine them into one account. This can\'t be undone.', placeholder: 'Phone number or email' };
  };

  const startMerge = () => { setMergeStep('form'); setMergeIdentifier(''); setMergeCode(''); setMergeError(''); };
  const cancelMerge = () => { setMergeStep('closed'); setMergeError(''); };

  const submitMergeIdentifier = async () => {
    if (!mergeIdentifier.trim()) return;
    setMergeBusy(true); setMergeError('');
    const { ok, data } = await apiFetch('/auth/passwordless/link-start', {
      method: 'POST', body: { identifier: mergeIdentifier.trim() },
    });
    setMergeBusy(false);
    if (!ok) { setMergeError(data?.detail || 'Could not link that account. Please try again.'); return; }
    setMergeSession(data.session);
    const offered = data.available_challenges || [];
    if (offered.length === 0) {
      setMergeError('That account can\'t be verified automatically. Please contact support to link it.');
    } else if (offered.length === 1) {
      await selectMergeChallenge(offered[0], data.session);
    } else {
      setMergeChallenges(offered);
      setMergeStep('chooser');
    }
  };

  const selectMergeChallenge = async (challenge, sessionOverride) => {
    setMergeBusy(true); setMergeError('');
    const { ok, data } = await apiFetch('/auth/passwordless/select-challenge', {
      method: 'POST', body: { identifier: mergeIdentifier.trim(), session: sessionOverride || mergeSession, challenge },
    });
    setMergeBusy(false);
    if (!ok) { setMergeError(data?.detail || 'Could not continue.'); return; }
    setMergeSession(data.session);
    setMergeChallengeName(data.challenge_name);
    setMergeDest((data.challenge_parameters || {}).CODE_DELIVERY_DESTINATION || '');
    setMergeStep('code');
  };

  const verifyMergeCode = async () => {
    if (!mergeCode.trim()) return;
    setMergeBusy(true); setMergeError('');
    const { ok, data } = await apiFetch('/auth/passwordless/link-verify', {
      method: 'POST',
      body: { identifier: mergeIdentifier.trim(), session: mergeSession, challenge_name: mergeChallengeName, code: mergeCode.trim() },
      timeoutMs: 20000,
    });
    if (!ok) { setMergeBusy(false); setMergeError(data?.detail || 'Incorrect code.'); return; }
    if (data.outcome === 'no_separate_account_found') {
      setMergeBusy(false);
      setMergeStep('form'); setMergeCode('');
      setMergeError('That account could not be linked. Please try again.');
      return;
    }
    // outcome === 'merge_pending' -- same GET /auth/merge/pending summary
    // fetch SignInScreen's own mergeConfirm step already uses.
    const { ok: pOk, data: pData } = await apiFetch('/auth/merge/pending');
    setMergeBusy(false);
    if (!pOk || !pData?.success) { setMergeError(pData?.detail || 'Could not load your account details for combining.'); return; }
    setMergeSummary(pData);
    setMergeStep('confirm');
  };

  const confirmMergeAccounts = async () => {
    setMergeBusy(true); setMergeError('');
    const { ok, data } = await apiFetch('/auth/merge/confirm', { method: 'POST', timeoutMs: 20000 });
    if (!ok || !data?.success) { setMergeBusy(false); setMergeError(data?.detail || 'Could not combine your accounts. Please try again.'); return; }
    // Refresh local phone/email state -- the survivor row may have picked
    // up whichever identifier only the other (loser) account had.
    const { ok: profOk, data: profData } = await apiFetch('/auth/profile');
    setMergeBusy(false);
    if (profOk && profData?.success) { setPhone(profData.customer.phone || null); setEmail(profData.customer.email || null); }
    setMergeStep('closed');
    showInfo('Accounts Combined', 'Your leaves, rewards, and history are now all in one place.');
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { ok, data } = await apiFetch('/auth/profile');
      if (!cancelled && ok && data?.success) {
        setPhone(data.customer.phone || null);
        setEmail(data.customer.email || null);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const startChange  = (kind) => { setChangeKind(kind); setStep('input'); setNewValue(''); setCode(''); setError(''); };
  const cancelChange = () => { setChangeKind(null); setError(''); };

  const submitNewValue = async () => {
    if (!newValue.trim()) return;
    setBusy(true); setError('');
    const path = changeKind === 'phone' ? '/auth/request-phone-change' : '/auth/request-email-change';
    const body = changeKind === 'phone' ? { new_phone: newValue.trim() } : { new_email: newValue.trim() };
    const { ok, data } = await apiFetch(path, { method: 'POST', body });
    setBusy(false);
    if (ok && data?.success) {
      setDestination(data.destination || '');
      setStep('code');
    } else {
      const detail = data?.detail || 'Could not start that change.';
      setError(detail.toLowerCase().includes('re-verify')
        ? 'For security, please sign out and sign back in before changing this.'
        : detail);
    }
  };

  const submitCode = async () => {
    if (!code.trim()) return;
    setBusy(true); setError('');
    const path = changeKind === 'phone' ? '/auth/verify-phone-change' : '/auth/verify-email-change';
    const { ok, data } = await apiFetch(path, { method: 'POST', body: { code: code.trim() } });
    setBusy(false);
    if (ok && data?.success) {
      if (changeKind === 'phone') setPhone(data.customer.phone);
      else setEmail(data.customer.email);
      const kind = changeKind;
      setChangeKind(null);
      showInfo('Updated', `Your ${kind} has been updated.`);
    } else {
      setError(data?.detail || "That code didn't match — please try again.");
    }
  };

  if (loading) {
    return (
      <View style={[S.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.saffron} size="large" />
      </View>
    );
  }

  const renderChangeFlow = () => (
    <View style={S.contactChangeBox}>
      {step === 'input' ? (
        <>
          <TextInput style={S.input}
            placeholder={changeKind === 'phone' ? 'New phone number' : 'New email address'}
            placeholderTextColor={C.muted}
            keyboardType={changeKind === 'phone' ? 'phone-pad' : 'email-address'}
            autoCapitalize="none"
            value={newValue} onChangeText={setNewValue} />
          {!!error && <Text style={S.errorText}>{error}</Text>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={[S.btnSaffron, { flex: 1 }]} onPress={submitNewValue} disabled={busy}>
              {busy ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Send Code</Text>}
            </Pressable>
            <Pressable style={[S.btnEspresso, { flex: 1 }]} onPress={cancelChange} disabled={busy}>
              <Text style={S.btnEspressoText}>Cancel</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={S.cardSub}>{destination ? `Code sent to ${destination}` : 'Enter the code we sent you'}</Text>
          <TextInput style={[S.input, { textAlign: 'center', letterSpacing: 4 }]}
            placeholder="Enter code" placeholderTextColor={C.muted}
            keyboardType="number-pad" value={code} onChangeText={setCode} />
          {!!error && <Text style={S.errorText}>{error}</Text>}
          <Pressable style={S.btnSaffron} onPress={submitCode} disabled={busy}>
            {busy ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Verify</Text>}
          </Pressable>
          <Pressable onPress={cancelChange} disabled={busy}><Text style={S.linkText}>Cancel</Text></Pressable>
        </>
      )}
    </View>
  );

  const renderMergeFlow = () => (
    <View style={S.contactChangeBox}>
      {mergeStep === 'form' && (
        <>
          <Text style={S.cardSub}>{mergeFieldCopy().sub}</Text>
          <TextInput style={S.input}
            placeholder={mergeFieldCopy().placeholder}
            placeholderTextColor={C.muted}
            autoCapitalize="none"
            value={mergeIdentifier} onChangeText={setMergeIdentifier} />
          {!!mergeError && <Text style={S.errorText}>{mergeError}</Text>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={[S.btnSaffron, { flex: 1 }]} onPress={submitMergeIdentifier} disabled={mergeBusy}>
              {mergeBusy ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Continue</Text>}
            </Pressable>
            <Pressable style={[S.btnEspresso, { flex: 1 }]} onPress={cancelMerge} disabled={mergeBusy}>
              <Text style={S.btnEspressoText}>Cancel</Text>
            </Pressable>
          </View>
        </>
      )}

      {mergeStep === 'chooser' && (
        <>
          <Text style={S.cardSub}>How would you like to verify that other account?</Text>
          {mergeChallenges.map(c => (
            <Pressable key={c} style={[S.btnSaffron, { marginTop: 8 }]} onPress={() => selectMergeChallenge(c)} disabled={mergeBusy}>
              <Text style={S.btnSaffronText}>{CHALLENGE_LABELS[c] || c}</Text>
            </Pressable>
          ))}
          {!!mergeError && <Text style={S.errorText}>{mergeError}</Text>}
          <Pressable onPress={cancelMerge} disabled={mergeBusy}><Text style={S.linkText}>Cancel</Text></Pressable>
        </>
      )}

      {mergeStep === 'code' && (
        <>
          <Text style={S.cardSub}>{mergeDest ? `Code sent to ${mergeDest}` : 'Enter the code to verify that account.'}</Text>
          <TextInput style={[S.input, { textAlign: 'center', letterSpacing: 4 }]}
            placeholder="Enter code" placeholderTextColor={C.muted}
            keyboardType="number-pad" value={mergeCode} onChangeText={setMergeCode} />
          {!!mergeError && <Text style={S.errorText}>{mergeError}</Text>}
          <Pressable style={S.btnSaffron} onPress={verifyMergeCode} disabled={mergeBusy}>
            {mergeBusy ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Verify</Text>}
          </Pressable>
          <Pressable onPress={cancelMerge} disabled={mergeBusy}><Text style={S.linkText}>Cancel</Text></Pressable>
        </>
      )}

      {mergeStep === 'confirm' && mergeSummary && (
        <>
          <Text style={S.cardTitle}>We found two Dasta accounts</Text>
          <Text style={S.cardSub}>
            {(mergeSummary.survivor.phone ? `••• ${mergeSummary.survivor.phone.slice(-4)}` : mergeSummary.survivor.email)} and{' '}
            {(mergeSummary.loser.phone ? `••• ${mergeSummary.loser.phone.slice(-4)}` : mergeSummary.loser.email)} both belong to you.
            Combining them keeps everything — leaves, rewards, and history — in one place. This can't be undone.
          </Text>
          {!!mergeError && <Text style={S.errorText}>{mergeError}</Text>}
          <Pressable style={S.btnSaffron} onPress={confirmMergeAccounts} disabled={mergeBusy}>
            {mergeBusy ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Combine my accounts</Text>}
          </Pressable>
          <Pressable onPress={cancelMerge} disabled={mergeBusy}><Text style={S.linkText}>Not now</Text></Pressable>
        </>
      )}
    </View>
  );

  return (
    <>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 40 }}>
      <StatusBar style="light" />
      {/* Back-chevron removed (2026-09-23, PC's ask, app-wide audit) --
          Home tab is enough everywhere, arrow or not. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title={'Sign-in & Contact'} />
      </View>

      <View style={{ padding: 16 }}>
        <View style={S.contactRow}>
          <View>
            <Text style={S.fieldLabel}>Phone</Text>
            <Text style={S.contactValue}>{phone || 'Not set'}</Text>
          </View>
          {changeKind !== 'phone' && (
            <Pressable onPress={() => startChange('phone')}>
              <Text style={S.linkText}>{phone ? 'Change' : 'Add'}</Text>
            </Pressable>
          )}
        </View>
        {changeKind === 'phone' && renderChangeFlow()}

        <View style={S.contactRow}>
          <View>
            <Text style={S.fieldLabel}>Email</Text>
            <Text style={S.contactValue}>{email || 'Not set'}</Text>
          </View>
          {changeKind !== 'email' && (
            <Pressable onPress={() => startChange('email')}>
              <Text style={S.linkText}>{email ? 'Change' : 'Add'}</Text>
            </Pressable>
          )}
        </View>
        {changeKind === 'email' && renderChangeFlow()}

        {/* Link Phone and Email (2026-09-21, web parity) -- always
            actionable, same as web, not gated on already having both
            (see renderMergeFlow's own comment on why). */}
        <View style={S.contactRow}>
          <View>
            <Text style={S.fieldLabel}>Link Phone and Email</Text>
            <Text style={S.contactValue}>Combine a second Dasta account into this one</Text>
          </View>
          {mergeStep === 'closed' && (
            <Pressable onPress={startMerge}>
              <Text style={S.linkText}>Link</Text>
            </Pressable>
          )}
        </View>
        {mergeStep !== 'closed' && renderMergeFlow()}
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => setInfoModal(null)}
    />
    </>
  );
}

// ── MY CIRCLE ACCOUNT ─────────────────────────────────────────
// Native rebuild (2026-09-12) of dastacafe.com/dasta-circle's dashboard
// (dasta-circle_embed1/2.html's 3-column layout: Leaf Loyalty / Dasta
// Card / Credit or Debit Card), as a swipeable 3-page screen -- PC's
// explicit ask, using customer 23 for testing. Every page keeps the
// same persistent header with a Home exit, so there's always a way out
// regardless of which page a customer is on.
//
// Leaf Loyalty here re-renders against the exact same leaf-polygon
// artwork/cup image/endpoint (GET /loyalty/status) RewardsScreen uses --
// a static "current state" snapshot rather than the full animated demo
// machine, since this is a quick-glance account view, not the Rewards
// tab's own interactive experience.
//
// Dasta Card and Credit/Debit Card are real, live data (GET /wallet/
// balance, POST /wallet/qr-token, GET/DELETE /wallet/cards -- all
// already-shipped endpoints, require_wallet_session accepts the normal
// session cookie, no special step-up). Adding a NEW card goes through
// AddCardModal (Clover card fields).
// Bundled (2026-10-01): the Webflow-hosted DastaCard_blank_template.png with
// its printed "DASTA CARD" lettering thickened ~1px for a bold look (PC's ask).
// The lettering is part of the image, not app text, so it can't be styled.
const DASTA_CARD_IMAGE = require('./assets/dasta-card-template.jpg');

// Ported verbatim from dasta-circle_embed2.html/embed5.html
function formatDastaCardId(id) {
  if (!id) return '';
  const match = id.replace(/\s/g, '').match(/.{1,4}/g);
  return match ? match.join(' ') : id;
}
function formatMemberSince(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}
// GIFT_CARD_PURCHASE added 2026-09-13 (PC's live report -- a real gift
// card purchase never showed up in transaction history at all; fixed
// server-side in _TRANSACTIONS_CTE, same "add the missing map entry"
// fix GIFT_ORDER_PURCHASE's own 2026-08-31 web-side fix already used).
const TX_LABELS = {
  LOAD_SETTLED: 'Dasta Cash load', BONUS_CREDITED: 'Welcome bonus', PURCHASE: 'Purchase at Dasta',
  REFUND_TO_WALLET: 'Refund to Dasta Cash', ACH_REVERSED: 'Load reversed', LOAD_FAILED: 'Load failed',
  SHARE_AWARD: 'Leaf earned — shared a Sip', GROUP_ORDER_BONUS: 'Group ordering earned you another leaf!', GIFT_ORDER_PURCHASE: 'Sent a gift',
  GIFT_CARD_PURCHASE: 'Gift card purchased', GIFT_ORDER_ITEM_CONVERTED_CREDIT: 'Gift converted to Dasta Cash',
};
const TX_ICONS = {
  LOAD_SETTLED: '💰', BONUS_CREDITED: '🎁', PURCHASE: '☕', REFUND_TO_WALLET: '↩️',
  ACH_REVERSED: '⚠️', LOAD_FAILED: '❌', SHARE_AWARD: '🎁', GROUP_ORDER_BONUS: '👥', GIFT_ORDER_PURCHASE: '🎉',
  GIFT_CARD_PURCHASE: '🎫', GIFT_ORDER_ITEM_CONVERTED_CREDIT: '🎁',
};

// Expanded transaction detail (PC, 2026-10-01): date with time, and how a
// purchase was paid, from the tender fields GET /wallet/transactions/{id}/
// detail already returns. card_brand holds the card brand, or the bare
// payment method type.
function formatTxDateTime(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}
const TX_CARD_METHOD_LABELS = {
  card: 'Card',
  visa: 'Visa card', mastercard: 'Mastercard', amex: 'American Express card', discover: 'Discover card',
};
function txPaidWith(detail) {
  const parts = [];
  if (detail.voucher_count > 0) {
    parts.push(detail.voucher_count > 1 ? `${detail.voucher_count} free drink vouchers` : 'Free drink voucher');
  }
  if (detail.gift_discount_display) parts.push(`Gift ${detail.gift_discount_display}`);
  if (detail.wallet_cash_display) parts.push(`Dasta Card ${detail.wallet_cash_display}`);
  if (detail.wallet_promo_display) parts.push(`Dasta Card promo ${detail.wallet_promo_display}`);
  if (detail.card_amount_display) {
    const m = detail.card_brand;
    const label = TX_CARD_METHOD_LABELS[m] || (m ? `${m[0].toUpperCase()}${m.slice(1)} card` : 'Card');
    parts.push(`${label} ${detail.card_amount_display}`);
  }
  return parts;
}

// ── AUTO-RELOAD ENABLE/EDIT (2026-09-13) ─────────────────────────
// Native rebuild of the enable/edit half of auto-reload — turning OFF
// already worked natively (handleAutoReloadTurnOff, no step-up needed,
// see set_auto_reload's own docstring on why); this was the "stays on
// dastacafe.com for now" half, per PC's live report now built. Same
// $10/$15/$20 presets + fixed $10 threshold, same consent_version
// ('v1_2026-08-08', dasta-circle_embed5.html's DC_AUTO_RELOAD_CONSENT_
// VERSION) and PATCH /wallet/auto-reload contract as web.
//
// Step-up re-auth (2026-09-13): enabling/editing needs a Cognito access
// token with auth_time inside the last 5 minutes (_require_fresh_auth,
// auth_router.py) — a returning mobile session (Face ID/trusted-device
// silent re-entry) is almost always well past that, so the very first
// attempt normally 401s. Web's own dcStartReauth handles this by
// re-running the SAME passwordless OTP ceremony the customer already
// used to sign in, then retrying; this does the identical thing with
// this app's own passwordless endpoints (SignInScreen already uses the
// same three calls) rather than inventing a separate mechanism. One
// simplification vs. web: this auto-picks the first offered non-passkey
// channel instead of showing a chooser, to keep this modal small — a
// customer with only one channel on file (the common case) never
// notices the difference.
function AutoReloadModal({ visible, onClose, identifier, savedCards, current, onSaved }) {
  const AMOUNT_PRESETS = [1000, 1500, 2000]; // $10/$15/$20 — matches wallet_router.py's AUTO_RELOAD_AMOUNT_PRESETS_CENTS
  const CONSENT_VERSION = 'v1_2026-08-08';
  const [amountCents, setAmountCents] = useState(1000);
  const [selectedPmId, setSelectedPmId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // reauth sub-flow: null (form) | 'code' (OTP entry)
  const [reauthStep, setReauthStep] = useState(null);
  const [reauthSession, setReauthSession] = useState(null);
  const [reauthChallengeName, setReauthChallengeName] = useState(null);
  const [reauthDest, setReauthDest] = useState('');
  const [reauthCode, setReauthCode] = useState('');

  useEffect(() => {
    if (!visible) return;
    setAmountCents(current?.amount_cents || 1000);
    setSelectedPmId(current?.stripe_pm_id || savedCards?.[0]?.stripe_pm_id || null);
    setReauthStep(null); setReauthCode(''); setError('');
  }, [visible, current, savedCards]);

  if (!visible) return null;

  const submitEnable = async () => {
    if (!selectedPmId) { setError('Please add a card first (under Cards on this screen).'); return; }
    setSaving(true); setError('');
    const { ok, status, data } = await apiFetch('/wallet/auto-reload', {
      method: 'PATCH',
      body: { enabled: true, amount_cents: amountCents, stripe_pm_id: selectedPmId, consent_version: CONSENT_VERSION },
    });
    setSaving(false);
    if (ok && data?.success) { onSaved(data); onClose(); return; }
    if (status === 401) { startReauth(); return; }
    setError(data?.detail || 'Could not update auto-reload.');
  };

  const startReauth = async () => {
    if (!identifier) { setError('No phone or email on file to verify with.'); return; }
    setSaving(true); setError('');
    const { ok, data } = await apiFetch('/auth/passwordless/start', {
      method: 'POST', body: { identifier, remember_device: false },
    });
    if (!ok) { setSaving(false); setError(data?.detail || 'Could not start verification.'); return; }
    const offered = (data.available_challenges || []).filter(c => c !== 'WEB_AUTHN');
    if (offered.length === 0) { setSaving(false); setError('Please contact support to verify your account and continue.'); return; }
    const { ok: ok2, data: data2 } = await apiFetch('/auth/passwordless/select-challenge', {
      method: 'POST', body: { identifier, session: data.session, challenge: offered[0] },
    });
    setSaving(false);
    if (!ok2) { setError(data2?.detail || 'Could not continue verification.'); return; }
    setReauthSession(data2.session);
    setReauthChallengeName(data2.challenge_name);
    setReauthDest((data2.challenge_parameters || {}).CODE_DELIVERY_DESTINATION || '');
    setReauthStep('code');
  };

  const verifyReauth = async () => {
    if (!reauthCode.trim()) return;
    setSaving(true); setError('');
    const { ok, data } = await apiFetch('/auth/passwordless/verify', {
      method: 'POST',
      body: { identifier, session: reauthSession, challenge_name: reauthChallengeName, code: reauthCode.trim(), remember_device: false }, timeoutMs: 20000,
    });
    if (!ok || !data?.success) {
      setSaving(false);
      setError(data?.detail || "That code didn't match — please try again.");
      setReauthCode('');
      return;
    }
    // Fresh auth_time is now on the session — retry the original call.
    setReauthStep(null);
    await submitEnable();
  };

  return (
    <View style={S.modalOverlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={saving ? undefined : onClose} />
      {/* KeyboardAvoidingView (2026-09-19 sweep) -- same fix as AddCardModal. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
      <View style={S.modalSheet}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 28 }}>
          {reauthStep === 'code' ? (
            <>
              <Text style={S.drinkFullName}>Confirm it's you</Text>
              <Text style={S.cardSub}>{reauthDest ? `Code sent to ${reauthDest}` : 'Enter the code sent to you'} — this keeps auto-reload authorization secure.</Text>
              <TextInput style={[S.input, { marginTop: 12 }]} value={reauthCode} onChangeText={setReauthCode}
                placeholder="Verification code" placeholderTextColor={C.muted} keyboardType="number-pad" maxLength={8} autoFocus />
              {!!error && <Text style={{ color: '#C0392B', marginTop: 8 }}>{error}</Text>}
              <Pressable style={[S.btnSaffron, { marginTop: 16 }]} disabled={saving} onPress={verifyReauth}>
                {saving ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Verify & Continue</Text>}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={S.drinkFullName}>{current?.enabled ? 'Edit Auto-reload' : 'Turn On Auto-reload'}</Text>
              <Text style={S.cardSub}>Automatically reload your Dasta Card when it drops below ${current?.threshold_display ? current.threshold_display.replace('$', '') : '10.00'}.</Text>

              <Text style={[S.fieldLabel, { marginTop: 16 }]}>Reload amount</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {AMOUNT_PRESETS.map(p => (
                  <Pressable key={p} style={[S.menuCatTab, { flex: 1, alignItems: 'center' }, amountCents === p && S.menuCatTabActive]}
                    onPress={() => setAmountCents(p)}>
                    <Text style={[S.menuCatTabText, amountCents === p && S.menuCatTabTextActive]}>${p / 100}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[S.fieldLabel, { marginTop: 16 }]}>Card to charge</Text>
              {(savedCards || []).length === 0 ? (
                <Text style={S.fieldHint}>No saved cards yet — add one under Cards on this screen first.</Text>
              ) : savedCards.map(c => (
                <Pressable key={c.id} onPress={() => setSelectedPmId(c.stripe_pm_id)}
                  style={[S.modifierRow, selectedPmId === c.stripe_pm_id && S.modifierRowSelected]}>
                  <Text style={S.modifierRowText}>{selectedPmId === c.stripe_pm_id ? '✓ ' : ''}{c.display}</Text>
                </Pressable>
              ))}

              <Text style={[S.fieldHint, { marginTop: 14 }]}>
                By turning this on, you authorize Dasta to automatically charge the selected card ${(amountCents / 100).toFixed(2)} whenever your Dasta Card balance drops below the threshold above, without asking you each time. You can turn this off anytime.
              </Text>

              {!!error && <Text style={{ color: '#C0392B', marginTop: 8 }}>{error}</Text>}

              <Pressable style={[S.btnSaffron, { marginTop: 16 }]} disabled={saving} onPress={submitEnable}>
                {saving ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>{current?.enabled ? 'Save Changes' : 'Turn On Auto-reload'}</Text>}
              </Pressable>
              <Pressable onPress={onClose} disabled={saving} style={{ marginTop: 12, alignItems: 'center' }}>
                <Text style={[S.linkText, { color: C.black }]}>Cancel</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Add a Card, native (2026-09-17; Clover for Dasta Test) ─────────
// POST /wallet/setup-card first (it gates the step-up below and returns
// data.clover), then CloverCardFields tokenizes the card and POST
// /payments/clover/cards saves it. The save is synchronous, so the card
// is already in GET /wallet/cards by the time onCardSaved runs.
//
// Same _require_fresh_auth step-up as setting up auto-reload (identical
// risk class per wallet_router.py's own comment on setup-card): reuses
// AutoReloadModal's exact reauth sub-flow rather than a second copy.
// After re-auth it retries whichever call got the 401 -- startSetup(),
// or the save with the token already in hand.
function AddCardModal({ visible, onClose, identifier, onCardSaved }) {
  const cardFieldsRef = useRef(null);
  const pendingSave = useRef(null); // {token, card} waiting on re-auth
  const [setupReady, setSetupReady] = useState(false);
  const [fieldsReady, setFieldsReady] = useState(false);
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reauthStep, setReauthStep] = useState(null); // null (loading/form) | 'code'
  const [reauthSession, setReauthSession] = useState(null);
  const [reauthChallengeName, setReauthChallengeName] = useState(null);
  const [reauthDest, setReauthDest] = useState('');
  const [reauthCode, setReauthCode] = useState('');

  const startSetup = async () => {
    setLoadingSetup(true); setError(''); setSetupReady(false); setFieldsReady(false);
    const { ok, status, data } = await apiFetch('/wallet/setup-card', { method: 'POST' });
    setLoadingSetup(false);
    if (ok && data?.success) { setSetupReady(true); return; }
    if (status === 401) { startReauth(); return; }
    setError(data?.detail || 'Could not start adding a card. Please try again.');
  };

  useEffect(() => {
    if (!visible) return;
    pendingSave.current = null;
    setReauthStep(null); setReauthCode(''); setError('');
    startSetup();
  }, [visible]);

  const startReauth = async () => {
    if (!identifier) { setError('No phone or email on file to verify with.'); return; }
    setLoadingSetup(true); setError('');
    const { ok, data } = await apiFetch('/auth/passwordless/start', {
      method: 'POST', body: { identifier, remember_device: false },
    });
    if (!ok) { setLoadingSetup(false); setError(data?.detail || 'Could not start verification.'); return; }
    const offered = (data.available_challenges || []).filter(c => c !== 'WEB_AUTHN');
    if (offered.length === 0) { setLoadingSetup(false); setError('Please contact support to verify your account and continue.'); return; }
    const { ok: ok2, data: data2 } = await apiFetch('/auth/passwordless/select-challenge', {
      method: 'POST', body: { identifier, session: data.session, challenge: offered[0] },
    });
    setLoadingSetup(false);
    if (!ok2) { setError(data2?.detail || 'Could not continue verification.'); return; }
    setReauthSession(data2.session);
    setReauthChallengeName(data2.challenge_name);
    setReauthDest((data2.challenge_parameters || {}).CODE_DELIVERY_DESTINATION || '');
    setReauthStep('code');
  };

  const verifyReauth = async () => {
    if (!reauthCode.trim()) return;
    setLoadingSetup(true); setError('');
    const { ok, data } = await apiFetch('/auth/passwordless/verify', {
      method: 'POST',
      body: { identifier, session: reauthSession, challenge_name: reauthChallengeName, code: reauthCode.trim(), remember_device: false }, timeoutMs: 20000,
    });
    if (!ok || !data?.success) {
      setLoadingSetup(false);
      setError(data?.detail || "That code didn't match — please try again.");
      setReauthCode('');
      return;
    }
    // Fresh auth_time is now on the session — retry the original call.
    setReauthStep(null);
    const retrySave = pendingSave.current;
    pendingSave.current = null;
    if (retrySave) { setLoadingSetup(false); await submitCard(retrySave); return; }
    await startSetup();
  };

  const submitCard = async (payload) => {
    setSaving(true); setError('');
    const { ok, status, data } = await apiFetch('/payments/clover/cards', { method: 'POST', body: payload, timeoutMs: 20000 });
    if (status === 401) { setSaving(false); setFieldsReady(false); pendingSave.current = payload; startReauth(); return; }
    if (!ok || data?.success === false) {
      setSaving(false);
      setError(data?.detail || 'That card could not be saved. Please check the details and try again.');
      return;
    }
    await onCardSaved();
    setSaving(false);
    onClose();
  };

  const handleSaveCard = async () => {
    if (!setupReady || !fieldsReady || saving) return;
    setSaving(true); setError('');
    const t = (await cardFieldsRef.current?.tokenize()) || { ok: false };
    if (!t.ok) {
      setSaving(false);
      setError(t.error || 'Please check your card details and try again.');
      return;
    }
    await submitCard({ token: t.token, card: t.card });
  };

  if (!visible) return null;
  return (
    <View style={S.modalOverlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={(saving || loadingSetup) ? undefined : onClose} />
      {/* KeyboardAvoidingView (2026-09-19, PC's live report: keyboard covered
          card number/expiry/CVC) -- modalOverlay's own justifyContent:
          'flex-end' pushes this sheet up as it grows, so 'padding' behavior
          here (adding bottom space equal to the keyboard height) is enough
          to keep it clear on iOS. Android gets 'height' (2026-10-01): under
          RN 0.81/Expo 54 edge-to-edge the OS's adjustResize no longer
          moves content, so undefined left the fields under the keyboard. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
      <View style={S.modalSheet}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 28 }}>
          {reauthStep === 'code' ? (
            <>
              <Text style={S.drinkFullName}>Confirm it's you</Text>
              <Text style={S.cardSub}>{reauthDest ? `Code sent to ${reauthDest}` : 'Enter the code sent to you'} — this keeps adding a card secure.</Text>
              <TextInput style={[S.input, { marginTop: 12 }]} value={reauthCode} onChangeText={setReauthCode}
                placeholder="Verification code" placeholderTextColor={C.muted} keyboardType="number-pad" maxLength={8} autoFocus />
              {!!error && <Text style={{ color: '#C0392B', marginTop: 8 }}>{error}</Text>}
              <Pressable style={[S.btnSaffron, { marginTop: 16 }]} disabled={loadingSetup} onPress={verifyReauth}>
                {loadingSetup ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Verify & Continue</Text>}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={S.drinkFullName}>Add a Card</Text>
              <Text style={S.cardSub}>Your card details go straight to Clover -- Dasta never sees or stores your full card number.</Text>

              {loadingSetup ? (
                <ActivityIndicator color={C.saffron} style={{ marginTop: 24 }} />
              ) : setupReady ? (
                <>
                  <CloverCardFields ref={cardFieldsRef} onReady={() => setFieldsReady(true)} />
                  {!!error && <Text style={{ color: '#C0392B', marginTop: 8 }}>{error}</Text>}
                  <Pressable style={[S.btnSaffron, { marginTop: 16 }, (!fieldsReady || saving) && { opacity: 0.6 }]} disabled={!fieldsReady || saving} onPress={handleSaveCard}>
                    {saving ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Save Card</Text>}
                  </Pressable>
                </>
              ) : (
                <>
                  {!!error && <Text style={{ color: '#C0392B', marginTop: 12 }}>{error}</Text>}
                  <Pressable style={[S.btnSaffron, { marginTop: 16 }]} onPress={startSetup}>
                    <Text style={S.btnSaffronText}>Try Again</Text>
                  </Pressable>
                </>
              )}
              <Pressable onPress={onClose} disabled={saving} style={{ marginTop: 12, alignItems: 'center' }}>
                <Text style={[S.linkText, { color: C.black }]}>Cancel</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Delete My Account (2026-09-16) ────────────────────────────
// App Store Guideline 5.1.1(v) / Google Play Account Deletion policy
// compliance. Same re-auth step-up pattern as AutoReloadModal above
// (deleting the whole account is at least as sensitive as turning on
// auto-reload) -- start passwordless -> select-challenge -> verify ->
// retry the original call, using this app's own existing endpoints
// rather than a new mechanism. identifier is fetched fresh via
// GET /auth/me when the modal opens rather than trusted from a
// possibly-stale prop, same reasoning as MyCircleAccountScreen's own
// comment on why it does the same thing.
function DeleteAccountModal({ visible, onClose, onDeleted }) {
  // step: 'loading' (fetching preview) | 'confirm' | 'code' (reauth) | 'error'
  const [step, setStep] = useState('loading');
  const [identifier, setIdentifier] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reauthSession, setReauthSession] = useState(null);
  const [reauthChallengeName, setReauthChallengeName] = useState(null);
  const [reauthDest, setReauthDest] = useState('');
  const [reauthCode, setReauthCode] = useState('');

  useEffect(() => {
    if (!visible) return;
    setStep('loading'); setError(''); setReauthCode('');
    (async () => {
      const [meRes, previewRes] = await Promise.all([
        apiFetch('/auth/me'),
        apiFetch('/account/delete-preview'),
      ]);
      if (meRes.ok && meRes.data?.customer) {
        setIdentifier(meRes.data.customer.phone || meRes.data.customer.email || null);
      }
      if (previewRes.ok && previewRes.data?.success) {
        setPreview(previewRes.data);
        setStep('confirm');
      } else {
        setError(previewRes.data?.detail || 'Could not load your account details.');
        setStep('error');
      }
    })();
  }, [visible]);

  if (!visible) return null;

  const submitDelete = async () => {
    setBusy(true); setError('');
    const { ok, status, data } = await apiFetch('/account/delete', { method: 'POST' });
    setBusy(false);
    if (ok) { onDeleted(); return; }
    if (status === 401) { startReauth(); return; }
    // Deliberately does NOT sign the customer out on failure -- if the
    // Cognito call failed, their session may still be fully valid, and
    // force-logging them out on a failed delete would be a worse bug
    // than the original gap (App Store instructions, Mobile section).
    setError(data?.detail || 'Could not delete your account right now. Please try again.');
  };

  const startReauth = async () => {
    if (!identifier) { setError('No phone or email on file to verify with.'); return; }
    setBusy(true); setError('');
    const { ok, data } = await apiFetch('/auth/passwordless/start', {
      method: 'POST', body: { identifier, remember_device: false },
    });
    if (!ok) { setBusy(false); setError(data?.detail || 'Could not start verification.'); return; }
    const offered = (data.available_challenges || []).filter(c => c !== 'WEB_AUTHN');
    if (offered.length === 0) { setBusy(false); setError('Please contact support to delete your account from Dasta.'); return; }
    const { ok: ok2, data: data2 } = await apiFetch('/auth/passwordless/select-challenge', {
      method: 'POST', body: { identifier, session: data.session, challenge: offered[0] },
    });
    setBusy(false);
    if (!ok2) { setError(data2?.detail || 'Could not continue verification.'); return; }
    setReauthSession(data2.session);
    setReauthChallengeName(data2.challenge_name);
    setReauthDest((data2.challenge_parameters || {}).CODE_DELIVERY_DESTINATION || '');
    setStep('code');
  };

  const verifyReauth = async () => {
    if (!reauthCode.trim()) return;
    setBusy(true); setError('');
    const { ok, data } = await apiFetch('/auth/passwordless/verify', {
      method: 'POST',
      body: { identifier, session: reauthSession, challenge_name: reauthChallengeName, code: reauthCode.trim(), remember_device: false }, timeoutMs: 20000,
    });
    if (!ok || !data?.success) {
      setBusy(false);
      setError(data?.detail || "That code didn't match — please try again.");
      setReauthCode('');
      return;
    }
    setStep('confirm');
    await submitDelete();
  };

  const dollars = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

  return (
    <View style={S.modalOverlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onClose} />
      {/* KeyboardAvoidingView (2026-09-19 sweep) -- same fix as AddCardModal. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
      <View style={S.modalSheet}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 28 }}>
          {step === 'loading' && (
            <View style={{ alignItems: 'center', paddingVertical: 20 }}>
              <ActivityIndicator color={C.saffron} size="large" />
            </View>
          )}

          {step === 'error' && (
            <>
              <Text style={S.drinkFullName}>Couldn't load your account</Text>
              <Text style={{ color: '#C0392B', marginTop: 8 }}>{error}</Text>
              <Pressable onPress={onClose} style={{ marginTop: 16, alignItems: 'center' }}>
                <Text style={[S.linkText, { color: C.black }]}>Close</Text>
              </Pressable>
            </>
          )}

          {step === 'code' && (
            <>
              <Text style={S.drinkFullName}>Confirm it's you</Text>
              <Text style={S.cardSub}>{reauthDest ? `Code sent to ${reauthDest}` : 'Enter the code sent to you'} — this keeps account deletion secure.</Text>
              <TextInput style={[S.input, { marginTop: 12 }]} value={reauthCode} onChangeText={setReauthCode}
                placeholder="Verification code" placeholderTextColor={C.muted} keyboardType="number-pad" maxLength={8} autoFocus />
              {!!error && <Text style={{ color: '#C0392B', marginTop: 8 }}>{error}</Text>}
              <Pressable style={[S.btnSaffron, { marginTop: 16 }]} disabled={busy} onPress={verifyReauth}>
                {busy ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Verify & Delete Account</Text>}
              </Pressable>
              <Pressable onPress={onClose} disabled={busy} style={{ marginTop: 12, alignItems: 'center' }}>
                <Text style={[S.linkText, { color: C.black }]}>Cancel</Text>
              </Pressable>
            </>
          )}

          {step === 'confirm' && (
            <>
              <Text style={S.drinkFullName}>Delete My Account</Text>
              {preview?.has_forfeitable_balance ? (
                <Text style={[S.cardSub, { textAlign: 'left', marginTop: 8 }]}>
                  You have {dollars((preview.wallet_cash_cents || 0) + (preview.wallet_promo_cents || 0))} in your Dasta Account
                  {preview.gift_card_balance_cents > 0 ? ` and ${dollars(preview.gift_card_balance_cents)} in unredeemed gift cards` : ''}
                  {preview.lifetime_leaves > 0 ? (
                    preview.next_tier
                      ? `, and ${preview.lifetime_leaves} leaves (${preview.leaves_to_next_tier} more to reach ${preview.next_tier})`
                      : `, and ${preview.lifetime_leaves} leaves${preview.current_tier ? ` (${preview.current_tier})` : ''}`
                  ) : ''}.
                  {'\n\n'}Deleting your account forfeits this balance and progress permanently. This cannot be undone. Continue?
                </Text>
              ) : (
                <Text style={[S.cardSub, { textAlign: 'left', marginTop: 8 }]}>
                  This will permanently delete your Dasta account and sign you out everywhere. This cannot be undone. Continue?
                </Text>
              )}
              {!!error && <Text style={{ color: '#C0392B', marginTop: 8 }}>{error}</Text>}
              <Pressable style={[S.btnSaffron, { marginTop: 16, backgroundColor: '#C0392B' }]} disabled={busy} onPress={submitDelete}>
                {busy ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Yes, Delete My Account</Text>}
              </Pressable>
              <Pressable onPress={onClose} disabled={busy} style={{ marginTop: 12, alignItems: 'center' }}>
                <Text style={[S.linkText, { color: C.black }]}>No, Keep My Account</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function MyCircleAccountScreen({ navigation, route, onHeaderBack }) {
  const customer = route?.params?.customer || null;
  const { width } = useWindowDimensions();
  const pagerRef = useRef(null);

  const [cardInfoLoading, setCardInfoLoading] = useState(true);
  const [dastaCardId,     setDastaCardId]     = useState(null);
  const [memberSince,     setMemberSince]     = useState(null);
  const [balance,         setBalance]         = useState(null);
  const [qrToken,         setQrToken]         = useState(null);
  const [qrLoading,       setQrLoading]       = useState(false);
  const [autoReload,      setAutoReload]      = useState(null);
  const [autoReloadModalOpen, setAutoReloadModalOpen] = useState(false);
  const [addCardOpen, setAddCardOpen] = useState(false);
  // Full phone/email (2026-09-13) -- the `customer` route param can be as
  // thin as {id, first_name} (the trusted-device fast-login path, see
  // SignInScreen), so auto-reload's step-up re-auth needs its own
  // reliable identifier — read off this screen's own GET /auth/me call
  // below rather than trusting what's in route.params.
  const [identifier,      setIdentifier]      = useState(null);
  const [infoModal, setInfoModal] = useState(null); // {title, message}
  const showInfo = (title, message) => setInfoModal({ title, message });

  const [cardsLoading, setCardsLoading] = useState(true);
  const [savedCards,   setSavedCards]   = useState([]);

  // Free Drinks status tile (2026-09-16, parity fix — PC noticed
  // dastacafe.com's Quick actions grid leads with a "Free drinks"
  // status tile that this screen's Quick Actions never had at all, not
  // even a stale/missing copy of it. Same GET /loyalty/status field
  // RewardsScreen already polls (available_vouchers), fetched here too
  // since this screen has no other reason to mount that tab.
  const [availableVouchers, setAvailableVouchers] = useState(0);

  const [txOpen,          setTxOpen]          = useState(false);
  const [txLoading,       setTxLoading]       = useState(false);
  const [txList,          setTxList]          = useState([]);
  // Expand/collapse detail per row (2026-09-12) — single-open accordion
  // (opening a row closes whichever was open before), the standard mobile
  // pattern for a transaction list rather than a separate detail screen
  // per tap. Detail is fetched lazily on first expand and cached by
  // row_key so re-expanding the same row never re-fetches.
  const [expandedTxId,    setExpandedTxId]    = useState(null);
  const [txDetailCache,   setTxDetailCache]   = useState({});
  // Transaction-history drink link (2026-09-13, PC's ask) -- tapping a
  // custom/circle/menu sip line opens the exact same FavoriteDetailModal
  // the Home screen's Favourites already use (view/share/gift/favorite),
  // built from a fresh GET /sip/customer/{id}/past-custom-drinks lookup
  // by custom_drink_id since the transaction-detail row itself only
  // carries the id, not the full recipe (description/ingredients/
  // discovery/order_count). Cached once per screen visit.
  const [pastDrinksCache, setPastDrinksCache] = useState(null);
  const [viewingDrink,    setViewingDrink]    = useState(null);
  const [loadingDrinkView,setLoadingDrinkView]= useState(null); // custom_drink_id currently loading
  const [dastaMenuFavBusy,setDastaMenuFavBusy]= useState(null); // dasta_menu_item_id currently toggling
  const [txDetailLoading, setTxDetailLoading] = useState(null);

  // One current pay code per customer since 2026-09-30 (shared with the
  // Apple/Google Wallet passes): the server replaces it the moment it's used
  // at the register, and otherwise once a day (4 AM Central, since 2026-10-03). POST /wallet/qr-token
  // returns the same code until then, so polling it quietly every few
  // seconds just picks up a new code within moments of a payment.
  const fetchQrToken = async (silent = false) => {
    if (!silent) setQrLoading(true);
    const { ok, data } = await apiFetch('/wallet/qr-token', { method: 'POST' });
    if (ok && data?.success) setQrToken(data.token);
    else if (!silent) setQrToken(null);
    if (!silent) setQrLoading(false);
  };

  const fetchAutoReload = async () => {
    const { ok, data } = await apiFetch('/wallet/auto-reload-status');
    if (ok && data?.success) setAutoReload(data);
  };

  // Extracted (2026-09-17) so AddCardModal's post-save refresh reuses the
  // exact same fetch as the initial mount load, instead of a second copy.
  // Returns the fresh list so a caller (the poll loop below) can inspect
  // it directly without waiting on a state update to land first.
  const fetchCards = async () => {
    const { ok, data } = await apiFetch('/wallet/cards');
    if (ok && data?.success) { setSavedCards(data.cards || []); return data.cards || []; }
    return null;
  };

  useEffect(() => {
    let cancelled = false;
    let qrInterval = null;
    (async () => {
      const [meRes, balRes, loyaltyRes] = await Promise.all([
        apiFetch('/auth/me'), apiFetch('/wallet/balance'), apiFetch('/loyalty/status'),
      ]);
      if (cancelled) return;
      if (meRes.ok && meRes.data?.success) {
        setDastaCardId(meRes.data.customer?.dasta_card_id || null);
        setMemberSince(meRes.data.customer?.created_at || null);
        setIdentifier(meRes.data.customer?.phone || meRes.data.customer?.email || null);
      }
      if (balRes.ok && balRes.data?.success) setBalance(balRes.data);
      if (loyaltyRes.ok && loyaltyRes.data?.success) setAvailableVouchers(loyaltyRes.data.available_vouchers || 0);
      setCardInfoLoading(false);
      fetchQrToken();
      qrInterval = setInterval(() => fetchQrToken(true), DASTA_CARD_QR_POLL_MS);
      fetchAutoReload();
    })();
    (async () => {
      await fetchCards();
      if (!cancelled) setCardsLoading(false);
    })();
    return () => { cancelled = true; if (qrInterval) clearInterval(qrInterval); };
  }, []);

  // Branded confirmation (2026-09-14, PC's ask) — was a plain OS
  // Alert.alert; the actual delete-card call is unchanged, only moved
  // into ConfirmModal's onConfirm below. pendingDeleteCard remembers
  // which card the modal is confirming for.
  const [pendingDeleteCard, setPendingDeleteCard] = useState(null);
  const handleDeleteCard = (card) => setPendingDeleteCard(card);
  const confirmDeleteCard = async () => {
    const card = pendingDeleteCard;
    if (!card) return;
    const { ok } = await apiFetch(`/wallet/cards/${card.id}`, { method: 'DELETE' });
    if (ok) setSavedCards(prev => prev.filter(c => c.id !== card.id));
    else showInfo('Error', 'Could not remove this card.');
  };

  // Turning auto-reload OFF is a plain, no-re-auth PATCH (see
  // wallet_router.py's set_auto_reload: "disabling is pure risk
  // reduction... a stale auth_time must never block a customer trying
  // to turn OFF"). Enabling/editing needs consent copy + a fresh-auth
  // step-up + card selection, which stays on dastacafe.com for now —
  // same "don't half-build the payment-adjacent flow" call made
  // elsewhere in this app.
  //
  // Branded confirmation (2026-09-14, PC's ask) — same real toggle-off
  // PATCH as before, just triggered from ConfirmModal's onConfirm
  // instead of a plain OS Alert.alert.
  const [showAutoReloadOffConfirm, setShowAutoReloadOffConfirm] = useState(false);
  const handleAutoReloadTurnOff = () => setShowAutoReloadOffConfirm(true);
  const confirmAutoReloadTurnOff = async () => {
    const { ok, data } = await apiFetch('/wallet/auto-reload', { method: 'PATCH', body: { enabled: false } });
    if (ok && data?.success) setAutoReload(prev => ({ ...prev, enabled: false }));
    else showInfo('Error', 'Could not turn off auto-reload.');
  };

  const openTransactionHistory = async () => {
    setTxOpen(true); setTxLoading(true);
    const { ok, data } = await apiFetch('/wallet/transactions');
    if (ok && data?.success) setTxList(data.transactions || []);
    setTxLoading(false);
  };

  // Discover Dasta > Transaction History (2026-09-13, PC's ask) -- opens
  // straight into this screen's own transaction view via a route param
  // instead of a second, duplicate history screen; Transaction History
  // still also lives here under My Circle Account, unchanged.
  // Every navigate here carries a fresh navKey (2026-09-30 fix), so opening
  // this screen while it's already showing (profile menu -> My Dasta Account
  // from Transaction History) still re-applies: the transactions panel opens
  // only when asked for and closes otherwise, and page 1 lands on the Saved
  // Cards + Quick Actions page (a Quick Action screen's back arrow).
  const txFromRouteRef = useRef(false);
  useEffect(() => {
    if (route?.params?.openTransactions) { txFromRouteRef.current = true; openTransactionHistory(); }
    else { txFromRouteRef.current = false; setTxOpen(false); }
    if (route?.params?.page != null) setTimeout(() => goToPage(route.params.page), 0);
  }, [route?.params?.openTransactions, route?.params?.navKey]);

  const toggleTxRow = async (tx) => {
    if (expandedTxId === tx.id) { setExpandedTxId(null); return; }
    setExpandedTxId(tx.id);
    if (txDetailCache[tx.id]) return;
    setTxDetailLoading(tx.id);
    const { ok, data } = await apiFetch(`/wallet/transactions/${tx.id}/detail`);
    setTxDetailLoading(null);
    if (ok && data?.success) setTxDetailCache(prev => ({ ...prev, [tx.id]: data }));
  };

  // View/share/gift/favorite a past custom/circle/menu sip from its
  // transaction-history line (2026-09-13, PC's ask).
  const openDrinkFromHistory = async (customDrinkId) => {
    setLoadingDrinkView(customDrinkId);
    try {
      let list = pastDrinksCache;
      if (!list) {
        const { ok, data } = await apiFetch(`/sip/customer/${customer.id}/past-custom-drinks`);
        list = ok ? (data?.past_custom_drinks || []) : [];
        setPastDrinksCache(list);
      }
      const match = list.find(d => d.custom_drink_id === customDrinkId);
      if (match) setViewingDrink(match);
      else showInfo('Not found', 'Could not load this drink — it may have been deleted.');
    } finally {
      setLoadingDrinkView(null);
    }
  };

  // Menu drinks have no recipe to view (no description/ingredients
  // narrative) -- just a direct favorite toggle, per PC's ask.
  const toggleDastaMenuFavoriteFromHistory = async (item) => {
    setDastaMenuFavBusy(item.dasta_menu_item_id);
    const { ok, data } = await apiFetch('/sip/toggle-favorite', {
      method: 'POST',
      body: {
        customer_id: customer.id, drink_source: 'dasta_menu', item_type: 'drink',
        dasta_menu_item_id: item.dasta_menu_item_id, selected_modifiers: item.selected_modifiers,
        default_size: item.size_oz,
      },
    });
    setDastaMenuFavBusy(null);
    if (ok && data?.success) {
      showInfo(data.is_favorite ? 'Saved to Favorites ⭐' : 'Removed from Favorites', item.name);
    } else {
      showInfo('Error', data?.detail || 'Could not update favorites.');
    }
  };

  // Icon swap (2026-09-13) -- vector icons instead of emoji standing in
  // as these tiles' only marker.
  const quickActions = [
    { icon: 'receipt-outline', label: 'Transaction History', onPress: openTransactionHistory },
    // fromQuickActions (2026-09-30, PC): each screen gets a back arrow to
    // this Quick Actions page (MainTabs' backOrigin).
    { icon: 'cash-outline', label: 'Add Money', onPress: () => navigation.navigate('AddMoney', { customer, fromQuickActions: true }) },
    { icon: 'gift-outline', label: 'Gift Card', onPress: () => navigation.navigate('GiftCardPurchase', { customer, fromQuickActions: true }) },
    { icon: 'pricetag-outline', label: 'Redeem a Gift Card', onPress: () => navigation.navigate('RedeemGiftCard', { customer, fromQuickActions: true }) },
    { icon: 'leaf-outline', label: 'Gift a Sip or Food', onPress: () => navigation.navigate('GiftDraft', { customer, fromQuickActions: true }) },
    // Gifts Received / Redeem a Gift (2026-09-15, PC's ask — new quick
    // actions) — the native claim flow this app never had before today
    // (claiming used to mean opening dastacafe.com's web claim page).
    { icon: 'mail-open-outline', label: 'Redeem a Gift', onPress: () => navigation.navigate('RedeemGift', { customer, fromQuickActions: true }) },
    { icon: 'archive-outline', label: 'Gifts Received', onPress: () => navigation.navigate('GiftsReceived', { customer, fromQuickActions: true }) },
  ];

  // Directional arrows, not dots or tabs (2026-09-16, PC's ask -- same
  // design as the sip-card swiper, which reads more clearly and still
  // supports a plain swipe too).
  const goToPage = (i) => pagerRef.current?.scrollTo({ x: i * width, animated: true });

  // Wide-screen side-by-side (2026-09-17, Phase 1: Android + tablets) --
  // below WIDE_BREAKPOINT this stays the exact swipeable pager it always
  // was; at/above it, both panels' content (unchanged) render in a fixed
  // row instead, no swipe. See WIDE_BREAKPOINT's own comment.
  const isWide = width >= WIDE_BREAKPOINT;

  const dastaCardPanel = (
    <>
      {/* "DASTA CARD" eyebrow removed (2026-09-14) per PC -- repeated
          the heading right below it. */}
      <Text style={S.circleHeading}>Your Dasta Card</Text>
      {cardInfoLoading ? <ActivityIndicator color={C.saffron} style={{ marginTop: 24 }} /> : (
        <>
          {/* Real card artwork (DastaCard_blank_template.png, same asset
              dasta-circle_embed1.html uses) with balance/number/member-
              since overlaid at the exact percentages measured off that
              PNG in web's own CSS comment -- not eyeballed. Web doesn't
              actually imprint the customer's name on the card graphic
              itself (that's shown in the dashboard header instead, a
              separate element) -- flagging that rather than guessing a
              placement with no real reference. */}
          <View style={S.dastaCardImageWrap}>
            <Image source={DASTA_CARD_IMAGE} style={S.dastaCardBg} resizeMode="cover" />
            <View style={S.dastaCardBalanceOverlay}>
              <Text style={S.dastaCardBalanceLabel}>Available balance</Text>
              <Text style={S.dastaCardBalanceVal}>{balance?.total_display || '$0.00'}</Text>
            </View>
            {dastaCardId ? (
              <Text style={[S.dastaCardNumberText, S.dastaCardNumberOverlay]}>{formatDastaCardId(dastaCardId)}</Text>
            ) : null}
            {memberSince ? (
              <Text style={[S.dastaCardSinceText, S.dastaCardSinceOverlay]}>MEMBER SINCE {formatMemberSince(memberSince)}</Text>
            ) : null}
          </View>

          {autoReload && (
            <View style={S.autoReloadRow}>
              <Text style={S.autoReloadText}>
                Auto-reload: <Text style={{ fontWeight: '700', color: autoReload.paused ? '#cc4444' : '#2a8f4f' }}>
                  {autoReload.paused ? 'PAUSED' : (autoReload.enabled ? 'ON' : 'OFF')}
                </Text>
                {autoReload.enabled && !autoReload.paused ? ` — ${autoReload.amount_display} when below ${autoReload.threshold_display}` : ''}
                {/* paused_reason (2026-09-22) -- was hardcoded '(card issue)'
                    for every pause, wrong for the new velocity_limit case
                    (routers/wallet_router.py's _maybe_trigger_auto_reload),
                    which isn't a card problem and already emailed the
                    customer with next steps -- "check your email" points
                    them at that instead of a misleading card-trouble label. */}
                {autoReload.paused ? ` (${autoReload.paused_reason === 'velocity_limit' ? 'check your email' : 'card issue'})` : ''}
              </Text>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                <Pressable onPress={() => setAutoReloadModalOpen(true)}>
                  <Text style={[S.linkText, { marginTop: 0 }]}>{autoReload.enabled ? 'Edit' : 'Turn on'}</Text>
                </Pressable>
                {autoReload.enabled && (
                  <Pressable onPress={handleAutoReloadTurnOff}>
                    <Text style={[S.linkText, { marginTop: 0, color: '#C0392B' }]}>Turn off</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}

          <View style={{ marginTop: 16, alignItems: 'center' }}>
            {qrLoading ? <ActivityIndicator color={C.saffron} />
              : qrToken ? <QRCode value={qrToken} size={160} />
              : <Text style={[S.cardSub, { maxWidth: 220 }]}>Load Dasta Cash to get your QR code</Text>}
            {qrToken && <Text style={[S.fieldHint, { marginTop: 8 }]}>Show this at the counter to pay</Text>}
            {qrToken && <Text style={[S.fieldHint, { color: C.black, marginTop: 2 }]}>Refreshes automatically after each use, and every morning, to keep your account safe.</Text>}
          </View>

          {/* REAL BUG fix (2026-09-16, PC's live report) — this opened
              dastacafe.com in a browser instead of the native
              AddMoneyScreen that already exists and is what the Quick
              Actions "Add Money" tile on the next page already uses.
              No reason this button should be any different. */}
          <Pressable style={[S.btnSaffron, { marginTop: 20, width: '100%' }]}
            onPress={() => navigation.navigate('AddMoney', { customer })}>
            <Text style={S.btnSaffronText}>Reload Dasta Card</Text>
          </Pressable>
        </>
      )}
    </>
  );

  const savedCardsPanel = (
    <>
      <Text style={[S.circleHeading, { textAlign: 'center' }]}>Saved Credit/Debit Cards</Text>
      {cardsLoading ? <ActivityIndicator color={C.saffron} style={{ marginTop: 16 }} /> : savedCards.length === 0 ? (
        <Text style={[S.cardSub, { marginTop: 16, marginBottom: 16, textAlign: 'left' }]}>No cards saved yet.</Text>
      ) : (
        <View style={{ marginTop: 12, marginBottom: 16 }}>
          {savedCards.map(card => (
            <View key={card.id} style={S.savedCardRow}>
              <View>
                <Text style={S.savedCardText}>{card.display}</Text>
                {card.is_default && <Text style={S.savedCardDefault}>Default</Text>}
              </View>
              <Pressable onPress={() => handleDeleteCard(card)}>
                <Text style={[S.linkText, { color: '#C0392B' }]}>Remove</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <Pressable style={S.btnEspresso} onPress={() => setAddCardOpen(true)}>
        <Text style={S.btnEspressoText}>Add a Card</Text>
      </Pressable>

      {/* Quick actions (2026-09-12) — Transaction History is real, native
          data (GET /wallet/transactions, no card payment involved); the other
          four open the real dastacafe.com flow rather than a half-built
          native gift-card/payment UI, same pattern as "Add a Card"
          above and Circle/Menu Sip checkout elsewhere in this app. */}
      <Text style={[S.moreSectionTitle, { marginTop: 20, marginBottom: 10 }]}>Quick Actions</Text>
      <View style={S.quickActionsGrid}>
        {/* Free Drinks status tile (2026-09-16) — leads the grid,
            matching dastacafe.com's own Quick actions layout exactly
            (dasta-circle_embed2.html's voucherTileHTML is always the
            first tile there too). Now tappable when there's something to
            redeem (2026-09-22, PC's ask) -- opens the same
            RedeemFreeDrinkScreen/QR every other free-drink entry point
            uses. Zero state stays a plain non-interactive tile, matching
            RewardsScreen's own zero-state treatment right above. */}
        {availableVouchers > 0 ? (
          <Pressable style={S.quickActionTile} onPress={() => navigation.navigate('RedeemFreeDrink', { customer, fromQuickActions: true })}>
            <Ionicons name="trophy-outline" size={20} color={C.saffron} style={{ marginBottom: 4 }} />
            <Text style={S.quickActionLabel}>{availableVouchers} Free Drink{availableVouchers === 1 ? '' : 's'}</Text>
            <Text style={[S.quickActionLabel, { color: C.charcoal + '99', marginTop: 2 }]}>ready!</Text>
          </Pressable>
        ) : (
          <View style={S.quickActionTile}>
            <Ionicons name="trophy-outline" size={20} color={C.saffron} style={{ marginBottom: 4 }} />
            <Text style={S.quickActionLabel}>{availableVouchers} Free Drink{availableVouchers === 1 ? '' : 's'}</Text>
            <Text style={[S.quickActionLabel, { color: C.charcoal + '99', marginTop: 2 }]}>earned</Text>
          </View>
        )}
        {quickActions.map(qa => (
          <Pressable key={qa.label} style={S.quickActionTile} onPress={qa.onPress}>
            <Ionicons name={qa.icon} size={20} color={C.saffron} style={{ marginBottom: 4 }} />
            <Text style={S.quickActionLabel}>{qa.label}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.ivory }}>
      <StatusBar style="light" />
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 16 }]}>
        {/* minHeight:44 (2026-09-17) -- matches the persistent global
            account icon's own 44px profileBtn box exactly (see
            S.profileBtn), so this row's centered content lands at the
            same vertical center the icon already uses. The icon is a
            fixed-position overlay (GlobalAccountHeader, mounted once,
            not part of this row), tuned against Home's taller two-line
            wordmark block -- without this, a shorter single-line title
            row centers itself higher up, landing above the icon instead
            of level with it. Height-driven, not width/title-length-
            driven, so this holds for any title using this pattern.
            Back-chevron removed (2026-09-23, PC's ask, app-wide audit) --
            Home tab is enough everywhere, arrow or not, and the arrow's
            inconsistent destination (Home for some screens, back to the
            same family for others) was itself confusing. */}
        <HeroTitleRow title="My Dasta Account" onBack={onHeaderBack} />
      </View>

      {isWide ? (
        // Wide-screen: both panels visible at once, no swipe (§2.1/§2.2).
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, alignItems: 'center' }}>
              {dastaCardPanel}
            </ScrollView>
          </View>
          <View style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              {savedCardsPanel}
            </ScrollView>
          </View>
        </View>
      ) : (
        <ScrollView ref={pagerRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
          {/* Page 1: Dasta Card (Leaf Loyalty moved to the Rewards tab, 2026-09-12) */}
          <View style={{ width, position: 'relative' }}>
            {/* right inset (2026-09-17) -- horizontally centered under the
                persistent header's circular profile icon directly above,
                per PROFILE_ICON_CENTER_INSET's own comment (sipArrowBtn's
                width is 34, so half-width 17). */}
            <Pressable style={[S.sipArrowBtn, { right: PROFILE_ICON_CENTER_INSET - 17, top: 12 }]} onPress={() => goToPage(1)}>
              <Text style={S.sipArrowText}>→</Text>
            </Pressable>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, alignItems: 'center' }}>
              {dastaCardPanel}
            </ScrollView>
          </View>

          {/* Page 2: Saved Credit/Debit Cards -- "CREDIT OR DEBIT CARD"
              eyebrow removed (2026-09-14) per PC, repeated this heading. */}
          <View style={{ width, position: 'relative' }}>
            <Pressable style={[S.sipArrowBtn, { left: 12, top: 12 }]} onPress={() => goToPage(0)}>
              <Text style={S.sipArrowText}>←</Text>
            </Pressable>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              {savedCardsPanel}
            </ScrollView>
          </View>
        </ScrollView>
      )}

      {/* Transaction History overlay — plain absolutely-positioned View,
          not React Native's <Modal> (see the profile dropdown's own
          2026-09-12 fix for why: Modal's native re-presentation is
          documented iOS flakiness this app already hit once). */}
      {txOpen && (
        <View style={S.txOverlay}>
          {/* Back-chevron removed (2026-09-23, PC's ask) -- missed in the
              first app-wide audit pass since this is technically an
              in-component overlay (setTxOpen), not a separate screen --
              but it presents as its own full-screen "Transaction History"
              page to the customer, exactly the pattern the rest of the
              audit covers. Same fix, same reasoning: Home tab is enough
              everywhere, arrow or not. */}
          {/* Back arrow (2026-09-30, PC): opened from the Quick Actions
              tile, it closes back to that page; opened from More or the
              quick links, it goes back there. */}
          <View style={[S.hero, { paddingTop: 54, paddingBottom: 16 }]}>
            <HeroTitleRow title="Transaction History"
              onBack={txFromRouteRef.current ? onHeaderBack : () => { setTxOpen(false); goToPage(1); }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={txLoading} onRefresh={openTransactionHistory} tintColor={C.saffron} />}>
            {txLoading ? <ActivityIndicator color={C.saffron} style={{ marginTop: 24 }} /> : txList.length === 0 ? (
              <Text style={S.cardSub}>No transactions yet.</Text>
            ) : (
              txList.map(tx => {
                const expanded = expandedTxId === tx.id;
                const detail = txDetailCache[tx.id];
                // Leaf count (2026-09-16, PC's ask — match dastacafe.com's
                // history view): a purchase shows its dollar amount with a
                // small "+N leaf(s)" badge underneath when it actually
                // earned any (voucher-only orders can legitimately earn 0);
                // a leaf-only bonus row (Share-a-Sip award, $0 by design —
                // see wallet_router.py) has no dollar amount at all, so the
                // leaf count takes over the main amount slot instead,
                // exactly mirroring dasta-circle_embed3.html's isLeafOnly.
                const isPurchase = tx.type === 'PURCHASE' || tx.type === 'GIFT_ORDER_PURCHASE';
                const isLeafOnly = tx.type === 'SHARE_AWARD' || tx.type === 'GROUP_ORDER_BONUS';
                const leafText = `🍃 +${tx.leaf_count} leaf${tx.leaf_count === 1 ? '' : 's'}`;
                return (
                  <View key={tx.id}>
                    <Pressable style={S.txRow} onPress={() => toggleTxRow(tx)}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                        <Text style={{ fontSize: 18 }}>{TX_ICONS[tx.type] || '•'}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={S.savedCardText}>
                            {tx.type === 'GIFT_ORDER_ITEM_CONVERTED_CREDIT' && tx.sender_name
                              ? `Gift from ${tx.sender_name}`
                              : (TX_LABELS[tx.type] || tx.type)}
                          </Text>
                          <Text style={S.txDate}>{new Date(tx.created_at).toLocaleDateString()}</Text>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[S.savedCardText, { color: tx.direction === 'credit' ? '#2a8f4f' : C.charcoal }]}>
                          {isLeafOnly ? leafText : `${tx.direction === 'credit' ? '+' : '-'}${tx.amount_display}`}
                        </Text>
                        {isPurchase && tx.leaf_count > 0 && (
                          <Text style={{ fontSize: 11, color: '#2a8f4f', marginTop: 2 }}>{leafText}</Text>
                        )}
                      </View>
                      <Text style={S.txChevron}>{expanded ? '▾' : '▸'}</Text>
                    </Pressable>

                    {expanded && (
                      <View style={S.txDetailBox}>
                        {txDetailLoading === tx.id ? (
                          <ActivityIndicator color={C.saffron} />
                        ) : !detail ? (
                          <Text style={S.cardSub}>Could not load details.</Text>
                        ) : (
                          <>
                            <Text style={[S.txDetailLine, { marginTop: 0, marginBottom: 4 }]}>{formatTxDateTime(detail.created_at || tx.created_at)}</Text>
                            {(detail.items || []).map((item, i) => (
                              <View key={i} style={S.txDetailItemRow}>
                                <View style={{ flex: 1 }}>
                                  <Text style={S.txDetailItemText}>
                                    {item.quantity > 1 ? `${item.quantity}× ` : ''}{item.name}
                                    {item.size_oz ? ` (${item.size_oz}oz)` : ''}
                                  </Text>
                                  {/* Custom/Circle/Menu sip -- tap to view/share/gift/favorite
                                      the actual recipe (2026-09-13, PC's ask). */}
                                  {item.custom_drink_id ? (
                                    <Pressable onPress={() => openDrinkFromHistory(item.custom_drink_id)} disabled={loadingDrinkView === item.custom_drink_id}>
                                      {loadingDrinkView === item.custom_drink_id
                                        ? <ActivityIndicator size="small" color={C.saffron} style={{ marginTop: 2, alignSelf: 'flex-start' }} />
                                        : <Text style={[S.linkText, { fontSize: 12, marginTop: 2 }]}>View this sip →</Text>}
                                    </Pressable>
                                  ) : item.dasta_menu_item_id ? (
                                    // Dasta Menu item -- no recipe to view, just favorite (PC's ask).
                                    <Pressable onPress={() => toggleDastaMenuFavoriteFromHistory(item)} disabled={dastaMenuFavBusy === item.dasta_menu_item_id}>
                                      {dastaMenuFavBusy === item.dasta_menu_item_id
                                        ? <ActivityIndicator size="small" color={C.saffron} style={{ marginTop: 2, alignSelf: 'flex-start' }} />
                                        : <Text style={[S.linkText, { fontSize: 12, marginTop: 2 }]}>☆ Favorite</Text>}
                                    </Pressable>
                                  ) : null}
                                </View>
                                {item.price_display && <Text style={S.txDetailItemText}>{item.price_display}</Text>}
                              </View>
                            ))}
                            {detail.card_display && <Text style={S.txDetailLine}>Card: {detail.card_display}</Text>}
                            {detail.notes && <Text style={S.txDetailLine}>{detail.notes}</Text>}
                            {detail.balance_before_display && detail.balance_after_display && (
                              <Text style={S.txDetailLine}>Balance: {detail.balance_before_display} → {detail.balance_after_display}</Text>
                            )}
                            {detail.recipient_name && <Text style={S.txDetailLine}>To: {detail.recipient_name}</Text>}
                            {detail.sender_name && <Text style={S.txDetailLine}>From: {detail.sender_name}</Text>}
                            {detail.voucher_discount_display && <Text style={S.txDetailLine}>Voucher discount: -{detail.voucher_discount_display}</Text>}
                            {detail.gift_discount_display && <Text style={S.txDetailLine}>Gift credit: -{detail.gift_discount_display}</Text>}
                            {txPaidWith(detail).length > 0 && (
                              <Text style={S.txDetailLine}>Paid with: {txPaidWith(detail).join(' · ')}</Text>
                            )}
                            {detail.total_display && (
                              <Text style={[S.txDetailLine, { fontWeight: '700', marginTop: 4 }]}>Total: {detail.total_display}</Text>
                            )}
                          </>
                        )}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      )}

      <AutoReloadModal
        visible={autoReloadModalOpen}
        onClose={() => setAutoReloadModalOpen(false)}
        identifier={identifier}
        savedCards={savedCards}
        current={autoReload}
        onSaved={(data) => setAutoReload(prev => ({ ...prev, enabled: true, paused: false, amount_cents: data.amount_cents, amount_display: data.amount_display }))}
      />
      <AddCardModal
        visible={addCardOpen}
        onClose={() => setAddCardOpen(false)}
        identifier={identifier}
        onCardSaved={fetchCards}
      />
      <FavoriteDetailModal
        drink={viewingDrink}
        visible={!!viewingDrink}
        onClose={() => setViewingDrink(null)}
        customer={customer}
        navigation={navigation}
        onChanged={() => setPastDrinksCache(null)}
      />
      <ConfirmModal
        visible={!!pendingDeleteCard}
        title="Remove this card?"
        message={pendingDeleteCard ? `Remove ${pendingDeleteCard.display}?` : ''}
        confirmLabel="Remove"
        onConfirm={confirmDeleteCard}
        onClose={() => setPendingDeleteCard(null)}
      />
      <ConfirmModal
        visible={showAutoReloadOffConfirm}
        title="Turn off Auto-reload?"
        message="Your Dasta Cash will no longer reload automatically when it runs low."
        confirmLabel="Turn Off"
        onConfirm={confirmAutoReloadTurnOff}
        onClose={() => setShowAutoReloadOffConfirm(false)}
      />
      <InfoModal
        visible={!!infoModal}
        title={infoModal?.title}
        message={infoModal?.message}
        onClose={() => setInfoModal(null)}
      />
    </View>
  );
}

// ── MORE SCREEN ───────────────────────────────────────────────
function MoreScreen({ navigation }) {
  // "Your Account" section removed (2026-09-12) per PC -- Sign Out and
  // everything else account-related now lives exclusively in the Home
  // header's My Profile dropdown (a guest tapping that same header icon
  // goes straight to Sign In), so this tab no longer needs its own copy.
  const links = [
    {
      section: 'Discover Dasta',
      items: [
        // Transaction History (2026-09-13, PC's ask) -- first entry, ahead
        // of The Journey to Dasta. Reuses MyCircleAccountScreen's own
        // transaction history view (openTransactionHistory) via a route
        // param instead of a second, duplicate history screen -- it still
        // also lives under My Circle Account itself, unchanged, per PC's
        // explicit "keep the transaction history on My circle account" ask.
        // Order (PC, 2026-09-30): Journey, Meet SipSense, Discover Dasta
        // Rewards, Leaf Loyalty Demo, Academic References. Native screens, content from GET /content/pages/{slug}.
        // Every item here passes fromMore so its screen shows a back arrow
        // to More (MainTabs' backOrigin).
        { label: 'The Journey to Dasta', icon: '🌍', action: () => navigation.navigate('JourneyToDasta', { fromMore: true }) },
        { label: 'Meet SipSense',        icon: '✨', action: () => navigation.navigate('MeetSipSense', { fromMore: true }) },
        // Moved here from the Rewards tab (2026-09-12) per PC -- Rewards is
        // now just the plant + trackers, real signed-in data only. This is
        // the public "why join" explainer, NOT the same screen as the
        // native RewardsScreen tab.
        { label: 'Discover Dasta Rewards', icon: '🍃', action: () => navigation.navigate('DiscoverRewards', { fromMore: true }) },
        { label: 'Leaf Loyalty Demo',      icon: '✨', action: () => navigation.navigate('LeafLoyaltyDemo', { fromMore: true }) },
        { label: 'Academic References',  icon: '📚', action: () => navigation.navigate('AcademicReferences', { fromMore: true }) },
        // Transaction History removed from here (2026-09-30, PC): it's on
        // the lightning-bolt quick links and My Dasta Account's Quick Actions.
      ],
    },
    {
      section: 'Support',
      items: [
        // Consolidated (2026-09-18, PC's ask) -- Contact Us and Provide
        // Feedback used to be two separate entries; there's no dedicated
        // feedback destination on the site, so this is now one entry ->
        // one native screen (ContactScreen) instead of two dead ends
        // (an in-app-browser page with a non-functional form, and a bare
        // mailto: link).
        { label: 'Provide Feedback', icon: '💬', action: () => navigation.navigate('Contact', { fromMore: true }) },
        // Native screen (2026-09-18) instead of opening dastacafe.com in
        // an in-app browser -- see JoinOurTeamScreen.
        { label: 'Join Our Team',    icon: '🤝', action: () => navigation.navigate('JoinOurTeam', { fromMore: true }) },
      ],
    },
    {
      section: 'Legal',
      items: [
        { label: 'Privacy Policy', icon: '🔒', action: () => navigation.navigate('PrivacyPolicy', { fromMore: true }) },
        { label: 'Terms of Use',   icon: '📄', action: () => navigation.navigate('TermsOfUse', { fromMore: true }) },
      ],
    },
  ];

  return (
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 40 }}>
      <StatusBar style="light" />

      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <Text style={[S.wordmark, { fontSize: 22 }]}>More</Text>
        <Text style={[S.wordmarkSub, { marginTop: 2 }]}>DASTA CHAI & BAGELS</Text>
      </View>

      {links.map((group, gi) => (
        <View key={gi} style={{ marginTop: 20, paddingHorizontal: 16 }}>
          <Text style={S.moreSectionTitle}>{group.section}</Text>
          <View style={S.moreCard}>
            {group.items.map((item, ii) => (
              <View key={ii}>
                <Pressable style={({pressed})=>[S.moreRow,pressed&&item.action&&{backgroundColor:C.ivory}]} onPress={item.action || undefined}>
                  {/* Icons removed (2026-09-14) per PC's ask -- plain text
                      labels only on this screen. */}
                  <View style={S.moreRowLeft}>
                    <Text style={S.moreRowLabel}>{item.label}</Text>
                  </View>
                  {item.action && <Text style={S.moreChevron}>›</Text>}
                </Pressable>
                {ii < group.items.length - 1 && <View style={S.moreRowDivider} />}
              </View>
            ))}
          </View>
        </View>
      ))}

      <Text style={S.versionText}>
        Dasta SipSense™ v1.0.0{'\n'}
        SipSense™ is a proprietary platform by Dasta{'\n'}
        © 2026 Dasta Cafe. All rights reserved.
      </Text>
    </ScrollView>
  );
}

// ── CONTENT-API STATIC SCREENS (2026-09-15) ──────────────────────
// Native replacements for the 5 destinations that used to open
// dastacafe.com in an in-app browser (Journey to Dasta, Academic
// References, Discover Dasta Rewards, Privacy Policy, Terms of Use).
// Content (every heading/paragraph/list item) comes from the new public
// GET /content/pages/{slug} endpoint -- a future copy edit on the
// backend never needs an app rebuild. In-memory cache (module scope, not
// persisted) so a flaky connection doesn't blank a screen the customer
// already successfully loaded once this session.
const _contentPageCache = {};

// Bundled fallback copy (2026-09-17, PC's ask: "all options under More
// should be available irrespective of whether the server is up or not
// for a guest customer" -- he hit a dead "Couldn't load this page" wall
// on Journey to Dasta/Academic References with the backend down). Snapshot
// of each page's live GET /content/pages/{slug} response at the time this
// was added, shipped in the JS bundle so these 5 screens always have real
// content with zero network -- not just a nicer error state. A live fetch
// still runs every time and silently overwrites this with fresh copy when
// the server IS reachable, so a backend copy edit still ships without an
// app rebuild exactly as before; this only changes what a guest sees when
// there's no server (or no network) to answer that fetch at all.
const DEFAULT_CONTENT_PAGES = {
  "journey-to-dasta": { title: "The Journey to Dasta", data: {"founder":{"name":"Sandeep Reddy","title":"Founder","initials":"SR"},"pullQuote":"“What began as a search for the perfect cup became a vision to share it.” — Sandeep Reddy","visionItems":["Authentic, culturally rich tea experiences","Unique East-meets-West concept","Operational excellence","Community-centered environment"],"visionHeading":"My Vision","journeyHeading":"The Journey to Dasta","journeyParagraphs":["Born and raised in Wisconsin, Sandeep Reddy is a graduate of Emory University with a degree in Financial Economics. But his journey into building Dasta did not begin in a classroom. It began on the streets of Hyderabad.","During his four years in India, Sandeep fell in love with chai culture. It was never just about the drink. It was about the experience. The warmth of the cup, the depth of spice, the aroma in the air. Each sip carried layers of flavor that lingered long after, almost dancing on the palate. What started as a simple routine quickly became something more meaningful: an appreciation for chai as a ritual, not just a beverage.","Inspired by this experience, Sandeep continued to explore the many variations of chai found not only in Hyderabad, but across India. At the same time, he launched a food and beverage venture in Hyderabad, where he worked alongside partners to build and operate Quake Arena, now ranked among the world’s top nightlife destinations—recognized as the 30th best nightclub globally and the number one nightclub in India. Together, they also developed a convention center with bookable halls designed to host large-scale events. Through these ventures, Sandeep gained hands-on experience across hospitality, entertainment, and food and beverage operations—yet throughout it all, his passion for chai remained a constant.","Now back in the United States, Sandeep realized that something he had come to value deeply during his time in India was missing: authentic, freshly brewed chai. He observed that many chain coffee shops, as well as specialty and artisanal cafés, relied on pre-made chai concentrates rather than traditional brewing methods. This contrast was disheartening. In that moment, his vision became clear—to recreate the experience he had fallen in love with and introduce it through a new kind of café, one rooted in authenticity, ritual, and innovation.","At Dasta, this vision comes to life through a simple yet powerful idea: East meets West; two rituals, one space.","Sandeep sought a way to thoughtfully introduce the ritual of chai, and believed that an authentic New York–style bagel — an already well-established ritual—would serve as the perfect bridge. The rich, traditional flavors of South Asian chai, paired with the iconic New York bagel, create a truly balanced experience—not just as food and drink, but as a daily ritual.","At Dasta, every detail reflects that vision. From authentic chai brewed with traditional spices to high-quality bagels inspired by New York classics, the menu blends culture and taste, introducing new flavors to curious minds. The space is designed for both productivity and comfort, giving students a place to focus while also offering a sense of familiarity to those far from home—a space that feels both globally inspired and locally loved.","But most importantly, it is about bringing people together through shared rituals. Because sometimes, the best moments do not come from rushing. Sometimes they come when you sit down and relax—with a cup of chai in hand."],"managementHeading":"Management Team","managementParagraph":"Dasta is supported by a team with experience in hospitality, customer service, and small business operations. Together, they ensure consistency in quality, service, and execution—bringing the brand’s vision to life every day."} },
  "academic-references": { title: "The Science of Study Fuel", data: {"intro":"At Dasta, we don't just sell drinks. We help you choose the right fuel for your academic moment.","heading":"The Science of Study Fuel","sources":["1. Fredholm, B. B., et al. (1999). Actions of caffeine in the brain. Pharmacological Reviews, 51(1), 83–133.","2. Smith, A. (2002). Effects of caffeine on human behavior. Food and Chemical Toxicology, 40(9), 1243–1255.","3. Juneja, L. R., et al. (1999). L-theanine and relaxation effects in humans. Trends in Food Science & Technology, 10(6–7), 199–204.","4. Haskell, C. F., et al. (2008). The combined effects of L-theanine and caffeine on cognitive performance and mood. Biological Psychology, 77(2), 113–122.","5. Institute of Medicine. (2001). Caffeine for the sustainment of mental task performance. National Academies Press.","6. Armstrong, L. E., et al. (2005). Caffeine and fluid balance. Exercise and Sport Sciences Reviews, 33(3), 135–140."],"tableRows":[["Brewed Coffee","90–120 mg","~0 mg","Fast Activation"],["Black Tea (Chai)","40–50 mg","5–15 mg","Sustained Focus"],["Green Tea","25–35 mg","5–20 mg","Calm Clarity"],["Matcha","60–80 mg","20–40 mg","Premium Focus"]],"studyModes":[{"body":"Coffee & Espresso for 8 AM lectures and quick wake-up resets.","emoji":"🔥","title":"Fast Boost"},{"body":"Authentic Chai for library marathons and steady 4-hour focus.","emoji":"🧠","title":"Deep Focus"},{"body":"Green Tea for late-night review without disrupting sleep.","emoji":"🌙","title":"Calm Clarity"}],"tableColumns":["Beverage","Caffeine (mg)","L-Theanine (mg)","Effect"],"tableHeading":"Typical Amounts Per 8 oz Cup","sourcesHeading":"Research & Sources","studyModeIntro":"College isn't one-speed. Neither is your brain. We categorize our menu by energy state to remove decision fatigue.","theaninePoints":[{"body":"Caffeine + L-Theanine improves task-switching and attention accuracy while reducing jitters.","icon":"⚖️","title":"The Power Combo"},{"body":"Tea provides a smoother energy curve, making it ideal for 3-4 hour study blocks.","icon":"⎳","title":"Cognitive Endurance"}],"theanineHeading":"The L-Theanine Advantage","studyModeHeading":"Choose Your Study Mode","theanineParagraph":"Unlike coffee, tea contains L-Theanine, an amino acid that promotes alpha brain wave activity. This creates a state of \"relaxed alertness\" or flow state."} },
  "meet-sipsense": { title: "Meet SipSense™", data: {"cta":{"label":"Try SipSense™","web_href":"/discover-drink?redirect_to=find-my-drink","app_action":"craft_custom_sip"},"tagline":"Where hospitality meets personalization.","sections":[{"blocks":[{"text":"Long before SipSense existed, there was Dasta.","type":"p"},{"text":"As Sandeep worked to bring his vision for Dasta to life, he was focused on creating something different—a café built around authentic chai, genuine hospitality, community, and discovery.","type":"p"},{"text":"Throughout that journey, many conversations took place with his family about the future of Dasta. His mother, who always encouraged him to think beyond conventional ideas, often asked thoughtful questions that challenged him to imagine what the café could become—not just what it was.","type":"p"},{"text":"One day, while discussing Dasta over coffee, the conversation turned to technology and how rapidly it was transforming industries around the world. Rather than asking how AI might replace people, his mom asked a much simpler question:","type":"p"},{"text":"\"Why can't we use AI in the café to create a better customer experience?\"","type":"strong"},{"text":"That single question changed everything.","type":"p"},{"text":"What began as a conversation between a mother and son quickly evolved into a vision for a new kind of café experience, where authentic hospitality and modern technology work together to serve people better.","type":"p"},{"type":"rich","segments":[{"bold":false,"text":"That vision became ","italic":false},{"bold":true,"text":"SipSense™","italic":false},{"bold":false,"text":".","italic":false}]}],"heading":"The Question That Started It All"},{"blocks":[{"text":"Most cafés offer menus.\nSipSense offers guidance.","type":"p"},{"text":"Rather than asking customers to sort through dozens of drinks, SipSense starts with something much more personal:","type":"p"},{"text":"How are you feeling today?","type":"strong"},{"text":"Whether you're looking for energy, comfort, focus, refreshment, or simply something new, SipSense takes your mood, cravings, and preferences and transforms them into a recommendation designed specifically for you.","type":"p"},{"text":"No two customers are exactly alike.\nYour recommendation shouldn't be either.","type":"p"}],"heading":"More Than a Recommendation Engine"},{"blocks":[{"text":"Step 1: Tell Us About Your Moment","type":"step"},{"text":"Are you studying for an exam?\nMeeting a friend?\nTaking a break between classes?\nLooking for something comforting on a cold day?\nLooking for something refreshing on a hot day?","type":"p"},{"text":"Simply tell SipSense how you're feeling or what you're craving.","type":"p"},{"text":"Step 2: Let SipSense Think","type":"step"},{"text":"SipSense carefully considers your preferences, flavor interests, and desired experience.","type":"p"},{"text":"Step 3: Discover Something New","type":"step"},{"text":"In just seconds, SipSense creates a personalized drink recommendation and food pairing designed specifically for you.","type":"p"},{"text":"Every recommendation is crafted with one goal:","type":"p"},{"text":"Helping you discover your perfect sip.","type":"strong"}],"heading":"How SipSense Works"},{"blocks":[{"text":"At Dasta, we believe great food and beverages are about more than ingredients.","type":"p"},{"text":"They're about traditions.\nThey're about culture.\nThey're about stories.\nThey're about people.","type":"p"},{"text":"Inspired by Dasta's philosophy of bringing the world to our customers, SipSense was built to help create moments of discovery.","type":"p"},{"text":"Today, that means personalized recommendations.","type":"p"},{"text":"Tomorrow, it means helping customers explore flavors, traditions, ingredients, and stories from around the world.","type":"p"},{"text":"Because every sip has a story waiting to be discovered.","type":"p"}],"heading":"Every Sip Has a Story"},{"blocks":[{"text":"One of the ideas that inspired Dasta was simple:","type":"p"},{"text":"What if a single café could help people experience flavors, traditions, and stories from around the world?","type":"p"},{"text":"What if a student taking a break from studying could discover a flavor inspired by another culture?","type":"p"},{"text":"What if a simple cup of chai or coffee could spark curiosity, conversation, or connection?","type":"p"},{"text":"SipSense helps make that vision possible.","type":"p"},{"text":"Not by replacing hospitality. But by enhancing it.","type":"p"},{"text":"One recommendation at a time.","type":"p"}],"heading":"A World From Your Chair"},{"blocks":[{"text":"The purpose of SipSense has never been technology for technology's sake.","type":"p"},{"text":"The purpose is creating a better customer experience.","type":"p"},{"text":"Helping someone discover a new favorite drink.","type":"p"},{"text":"Helping a student find the right study companion.","type":"p"},{"text":"Helping a customer feel understood.","type":"p"},{"text":"Helping make every visit a little more personal.","type":"p"},{"text":"Because great hospitality has always been about people.","type":"p"},{"text":"SipSense simply gives us a new way to serve them.","type":"p"}],"heading":"Built Around People"},{"blocks":[{"type":"rich","segments":[{"bold":false,"text":"SipSense started with a simple idea: understand what you're in the mood for. Today, it helps you discover new favorites inspired by ","italic":false},{"bold":true,"text":"Campus Rhythm","italic":true},{"bold":false,"text":", guided by ","italic":false},{"bold":true,"text":"Discovery Engines","italic":true},{"bold":false,"text":", and enhanced by the pulse of ","italic":false},{"bold":false,"text":"what's happening around you. (","italic":true},{"bold":true,"text":"Local Pulse Engine","italic":true},{"bold":false,"text":")","italic":true}]},{"text":"Future innovations will continue to make recommendations more personal, more meaningful, and more connected to the stories, moments, and discoveries that make every visit unique.","type":"p"},{"text":"As Dasta grows, SipSense will grow alongside it—continuing to blend hospitality, discovery, and innovation in ways that help create experiences worth remembering.","type":"p"}],"heading":"Looking Ahead"},{"blocks":[{"text":"Try SipSense™","type":"strong"},{"text":"Tell us your mood.\nTell us your craving.\nSipSense does the rest.","type":"p"},{"text":"Your sip. Your story.","type":"em"},{"text":"Your next favorite sip may be one recommendation away.","type":"em"}],"heading":"Ready to Discover Your Next Sip?"}]} },
  "discover-dasta-rewards": { title: "Discover Dasta Rewards", data: {"tiers":[{"name":"Fresh Leaf","intro":"Founder Journey Starts here:","perks":["Birthday Drink","Early access to seasonal drinks","Priority invitations to special events"],"highlight":"You're helping Dasta take root"},{"name":"Silver Leaf","intro":"Everything in Fresh Leaf plus:","perks":["Vote on future drinks","Founder Polls","Double-Leaf Days"],"highlight":"You're helping Dasta grow"},{"name":"Golden Leaf","intro":"Everything in Silver Leaf plus:","perks":["Secret Menu Access","Seasonal drink previews","Tasting event Invitations"],"highlight":"Helping shape the future of Dasta"},{"name":"Evergreen Leaf","intro":"Everything in Gold Leaf plus:","perks":["Status for Life","Wall Recognition","First access to major launches"],"highlight":"A permanent place in Dasta's story"}],"heading":"Dasta Rewards & Founders Circle","impactRows":[{"field":"leaves_collected","label":"Lifetime Leaves Earned:"},{"field":"free_drinks_redeemed","label":"Free Drinks Claimed"},{"field":"trees_to_be_planted","label":"Saplings to be Planted"},{"field":"founder_members","label":"Founder Members"}],"subheading":"Your Dasta Plant grows leaves for rewards, and\nYour grove with Dasta grows saplings !!","trustIntro":"Your payment information deserves the highest level of protection. That's why Dasta Account card payments are processed by Clover, a trusted payments platform.","trustTitle":"Your Trust Matters","circleIntro":"Collect Leaves. Earn free drinks. Grow your grove.","circleTitle":"Dasta Rewards","closingBody":"Because loyalty should never expire.","footerBanner":"Dasta Account : Protected by Clover. Built for Dasta.","trustBullets":["Bank-level encryption","Secure payment processing","Dasta never stores your banking credentials","Trusted by millions of customers worldwide"],"circleBullets":["Earn leaves with eligible purchases","Redeam leaves for free drinks","Grow lifetime saplings with Dasta Rewards","Your leaves never expire","Payments protected by Clover"],"closingItalic":"Leaves always stay green at Dasta.","impactApiPath":"/sip/community-impact","tiersImageAlt":"Four leaves in green, silver, gold, and dark green with labels showing leaves and saplings count.","tiersImageUrl":"https://cdn.prod.website-files.com/69dece9688dac5181962f293/6a374cf6235f0819a1b201c3_0ede7f2c0fd38d43bf612746399d804b_Fouders%20Tier.png","dastaCardIntro":"Load funds once and pay seamlessly in-store or online while earning Leaves with every purchase.","dastaCardTitle":"Dasta Card","memberBenefits":[{"body":"Earn rewards automatically as your plant grows.","title":"Free Drinks"},{"body":"Pay quickly using your Dasta Account.","title":"Faster Checkout"},{"body":"Connect with SipSense to create personalized drink recommendations and member experiences.","title":"Personalized Experiences"},{"body":"Members will receive access to special offers, bonus Leaf events, and seasonal rewards.","title":"Exclusive Promotions"}],"dastaCardFooter":"Every purchase made through Dasta Rewards helps your plant grow.","howItWorksSteps":[{"body":"Create your free account in minutes.","title":"Join Dasta Rewards"},{"body":"Every eligible Dasta purchase adds Leaves to your account.","title":"Earn Leaves"},{"body":"Use your leaves for free drinks.","title":"Enjoy Rewards"},{"body":"Your lifetime leaves help Dasta plant saplings every spring season. (50 leaves per sapling)","title":"Grow your grove"}],"howItWorksTitle":"How It Works :","impactCardTitle":"🌍 Dasta Community Impact","whyFounderIntro":"Most rewards programs recognize purchases. Founders Circle recognizes people.","whyFounderTitle":"Why Become a Founder?","cardPaymentsBody":"Dasta Account has an option to save their preferred payment method (up to 3 cards) and enjoy the same rewards and benefits. One of your saved cards could be set as the default card for payment and auto-reload Dasta Card.\n\nBank level security with card details stored at Clover.","dastaCardBullets":["Pay using a secure QR code","Track spending history","Access member rewards automatically"],"cardPaymentsTitle":"Credit or Debit Card payments","foundersCircleIntro":"Some leaves become free drinks. Every ten leaves become a real sapling. Together, we're growing something much bigger.\n\nFounders Circle recognizes the guests who help Dasta grow through every visit, every recommendation, and every shared experience.","foundersCircleTitle":"Founders Circle","growingTogetherBody":"At Dasta, leaves mean more than rewards. While 10 leaves unlock a free drink, they also contribute to something bigger. Every 50 leaves earned by our community, Dasta commits to planting one sapling each year. As our community grows, so does our impact.\n\nTogether, we're transforming everyday ritual into a greener future.","memberBenefitsTitle":"Member Benefits","growingTogetherTitle":"Growing Together","leavesNeverExpireNote":"Leaves never expire."} },
  "privacy-policy": { title: "Dasta Privacy Policy", data: {"sections":[{"body":"Last Updated: September 21, 2026","heading":"Effective Date: November 20, 2026"},{"body":"This Privacy Policy explains how Dasta LLC (\"Dasta,\" \"we,\" \"us,\" or \"our\") collects, uses, discloses, stores, and protects information when you use the Dasta mobile application, DastaCafe.com, SipSense, Dasta Rewards, Dasta Card, mobile ordering, gifting, gift cards, and other Dasta products, features, and services (collectively, the \"Dasta Services\"). It also explains the choices and rights available to you regarding your information.\n\nThis Privacy Policy is intended to describe Dasta's current privacy practices for the Dasta Services. Some features are optional, and the information Dasta processes depends on the features you choose to use, the permissions you grant, and the services available at a particular time or location.","heading":""},{"body":"Depending on how you use the Dasta Services, we may collect or process the following categories of information.","heading":"1. Information We Collect"},{"body":"We may collect your name, email address, telephone number, Dasta customer or account identifier, birthday month and day when you choose to provide it, and other contact or profile information you provide. Certain profile fields are optional and are used only for the purposes described when collected.","heading":"Account and Contact Information"},{"body":"We process information needed to create, authenticate, secure, and manage your account. This may include email or SMS verification information, authentication and session identifiers, trusted-device information, and information associated with Sign in with Apple or Google Sign-In when you choose those methods. Apple and Google determine what account information they provide to Dasta based on their services and your choices.","heading":"Authentication and Account Security Information"},{"body":"We may collect information about orders, purchased items, drink or food customizations, pickup details, transaction status, purchase history, refunds, rewards earned or redeemed, gifts, gift cards, Dasta Card transactions, and related activity necessary to provide the Dasta Services.","heading":"Order, Purchase, and Transaction Information"},{"body":"Eligible card payments are processed by Clover or another payment processor identified at the time of payment. Card credentials may be entered directly into interfaces provided by the payment processor. Dasta may receive limited payment-related information such as payment status, transaction identifiers, payment method type, and limited card descriptors made available by the processor. Dasta does not receive or store complete payment-card numbers or card security codes when those credentials are processed directly by the payment processor.","heading":"Payment Information"},{"body":"If you participate in Dasta Rewards, we process information such as leaves earned and redeemed, rewards, program status, and related activity. If you use Dasta Card, we process Dasta Card identifiers, balances, reload activity, transaction history, Auto Reload settings, and information needed to operate and secure the service. If you purchase or send a gift, we may process purchaser information, recipient information you provide, gift details, delivery information, redemption status, and associated transaction information.","heading":"Dasta Rewards, Dasta Card, and Gift Information"},{"body":"When you use SipSense, we may process information you provide about beverage preferences, cravings, mood, desired flavors, dietary preferences, customizations, previous selections, text prompts, voice input or transcriptions, and other information you choose to provide. We use this information to provide and improve personalized beverage or food recommendations and related Dasta experiences.\n\nSipSense recommendations are intended for discovery and convenience and should not be relied upon as a substitute for verifying ingredients, allergens, dietary restrictions, or other individual requirements directly with Dasta.","heading":"SipSense and Personalization Information"},{"body":"When you choose to use voice-enabled features, the Dasta mobile application or your browser on DastaCafe.com may access your device or browser microphone with your permission to recognize spoken navigation shortcuts, receive SipSense input, or perform another voice-enabled action you request. Depending on the feature, device, browser, operating system, language, and availability, speech may be processed through operating-system or browser speech-recognition services or transmitted securely to Dasta systems for transcription and processing. Dasta does not retain raw voice recordings on Dasta-controlled infrastructure after the applicable voice request has been processed. Where speech recognition is performed by an operating-system, browser, or platform service, that provider may process voice or speech data in accordance with its own privacy terms and device or browser settings. Dasta may process the resulting transcription as described in this Privacy Policy.","heading":"Voice and Speech Information"},{"body":"When you choose a location-based feature and grant permission, the Dasta mobile application or your browser on DastaCafe.com may access your device's or browser's foreground location to identify a nearby Dasta café, provide directions, or support another location-related feature you request. Dasta does not request background location for the current mobile-app or website functionality. You may decline or revoke location permission through your device or browser settings.","heading":"Location Information"},{"body":"We may process device type, operating system, app version, device or session identifiers, authentication/session information, IP address, diagnostic information, error information, and other technical information reasonably necessary to operate, secure, troubleshoot, and improve the Dasta Services. Information processed solely on your device or ephemerally may be treated differently under applicable platform disclosure rules.","heading":"Device, Session, and Technical Information"},{"body":"We may collect communications you send to Dasta, including customer-support requests, feedback, survey responses, email or SMS interactions, notification preferences, and other information you choose to submit.","heading":"Communications, Feedback, and Support"},{"body":"DastaCafe.com uses cookies and similar technologies that are necessary for the website to function, such as maintaining your session, remembering preferences, and protecting the security of the site. Consistent with Section 3, Dasta does not use cookies or similar technologies to sell personal information or to engage in cross-context behavioral advertising.","heading":"Cookies and Similar Technologies (DastaCafe.com)"},{"body":"We may use information described in this Privacy Policy to:\n• provide, operate, maintain, and improve the Dasta Services;\n• create, authenticate, secure, and manage Dasta accounts and trusted sessions;\n• process orders, payments, refunds, Dasta Card activity, gift cards, gifts, and related transactions;\n• operate Dasta Rewards, calculate and redeem leaves and rewards, and provide eligible program benefits;\n• generate and personalize SipSense recommendations and saved preferences;\n• process voice commands and transcriptions when you choose to use voice-enabled features;\n• identify nearby Dasta cafés and provide location-related functionality when you request it;\n• send transactional, account-security, order, reward, gift, and service communications;\n• send marketing communications where permitted and consistent with your choices;\n• provide customer support and respond to feedback or requests;\n• detect, investigate, and prevent fraud, abuse, unauthorized access, security incidents, and technical problems;\n• analyze and improve the performance, reliability, usability, and security of the Dasta Services, to the extent applicable; and\n• comply with legal, tax, accounting, regulatory, dispute-resolution, and enforcement obligations.","heading":"2. How We Use Information"},{"body":"We do not disclose personal information except as described in this Privacy Policy, as directed by you, or as otherwise permitted or required by law.","heading":"3. How We Disclose Information"},{"body":"We may disclose information to service providers that process information on our behalf or provide infrastructure and functionality needed to operate the Dasta Services. Depending on the feature used, these providers may include payment processors such as Clover; cloud, hosting, authentication, communications, and security providers; Apple and Google platform or identity services; Expo-related application infrastructure where used; mapping or location services; and other vendors that support Dasta operations.\n\nDasta requires service providers that receive personal information from Dasta to protect that information consistent with their contractual obligations, applicable law, and the protections described in this Privacy Policy, as appropriate to the services they provide.","heading":"Service Providers"},{"body":"Certain SipSense and voice features use automated processing, speech recognition, transcription, or artificial-intelligence technologies to respond to customer requests and generate personalized recommendations. SipSense may consider information voluntarily provided by the customer, such as preferences, cravings, mood, desired flavors, dietary preferences, customizations, and the context of a particular request.\n\nDasta does not sell or disclose customer personal information to third-party artificial-intelligence providers for their independent use, advertising, or model training. Where Dasta uses third-party technology providers to process information on Dasta's behalf, those providers may process only the information necessary to provide the applicable service, subject to applicable contractual, legal, and platform requirements.","heading":"Artificial Intelligence and Speech Processing"},{"body":"We may disclose information when we reasonably believe disclosure is necessary to comply with law or legal process, enforce our agreements, investigate fraud or security incidents, protect the rights, property, or safety of Dasta, our customers, or others, or in connection with a merger, financing, acquisition, reorganization, sale of assets, or similar corporate transaction, subject to applicable law.","heading":"Legal, Safety, and Corporate Purposes"},{"body":"Dasta does not sell personal information and does not share personal information for cross-context behavioral advertising or use customer personal information for third-party targeted advertising.","heading":"Sale and Targeted Advertising"},{"body":"The Dasta mobile application and DastaCafe.com request device or browser permissions only when they are relevant to an available feature. You may decline optional permissions, although the related feature may then be unavailable.\n• Location: manage foreground location permission in your iOS or Android device settings, or through your browser settings when using DastaCafe.com.\n• Microphone and Speech Recognition: manage microphone and speech-recognition permissions in your device or browser settings. Voice features are optional.\n• Notifications and Communications: manage eligible communication preferences within Dasta and through your device, browser, email, or SMS settings, as applicable. If push notifications are enabled in the version of the Dasta app you use, you may manage push-notification permission through your device settings. Certain transactional or security communications may still be sent through available channels when necessary to provide the service.\n• Marketing Email and SMS: use the applicable unsubscribe or opt-out mechanism and account preferences. Transactional or security communications may not be subject to marketing opt-out choices.\n• Profile Information: update eligible account information through the Dasta Services or contact Dasta.\n• Auto Reload: change or disable Auto Reload through Dasta Card settings; changes apply to future reloads.\n• Cookies: manage cookies and similar technologies through your browser settings. Dasta does not currently sell personal information or share it for cross-context behavioral advertising, so opt-out mechanisms for those practices, including recognition of Global Privacy Control signals, are not applicable at this time; if that changes, Dasta will provide an appropriate mechanism as required by law.\n\nWhere Dasta relies on consent to process information, you may withdraw that consent through the applicable settings or contact method. Withdrawal does not affect processing that was lawful before withdrawal.","heading":"4. Permissions and Your Choices"},{"body":"Dasta retains personal information only for as long as reasonably necessary for the purposes described in this Privacy Policy, including to provide the Dasta Services, maintain accounts and transaction records, meet legal, tax, accounting, and regulatory requirements, prevent fraud, resolve disputes, and enforce agreements. Retention periods vary based on the type of information, the feature involved, and applicable obligations.\n\nWhen information is no longer reasonably required, Dasta will delete, de-identify, aggregate, or otherwise dispose of it as appropriate. Some transaction, accounting, security, fraud-prevention, or legal records may be retained after account deletion when retention is required or permitted by law.\n\nRaw voice recordings processed by Dasta are not retained by Dasta after the applicable voice request has been processed. SipSense inputs, transcriptions, preferences, and recommendation history may be retained when necessary to provide saved preferences, personalization, account functionality, security, or service improvement, subject to the retention principles described above.","heading":"5. Data Retention"},{"body":"You may initiate deletion of your Dasta account through the account settings available on DastaCafe.com or from within the Dasta mobile application by opening your account menu and selecting Delete My Account.\n\nIf you no longer have access to your Dasta account or the Dasta mobile application, you may request deletion of your Dasta account and associated personal information by emailing privacy@dastacafe.com. Please submit the request using the email address associated with your Dasta account when possible. Dasta may take reasonable steps to verify your identity before completing the request.\n\nWhen an account-deletion request is completed, Dasta deletes or de-identifies personal information associated with the account except information that Dasta must or is permitted to retain for legitimate purposes such as legal, tax, accounting, security, fraud-prevention, regulatory, or dispute-resolution obligations.\n\nAccount deletion may affect unused rewards, saved preferences, gifts, and other account-linked benefits. Paid stored value, gift cards, and transaction records will be handled in accordance with applicable law and the Dasta Terms of Use.","heading":"6. Account and Data Deletion"},{"body":"Dasta uses administrative, technical, and organizational safeguards designed to protect personal information against unauthorized access, loss, misuse, alteration, or disclosure. Dasta uses secure network communications for its production services and relies on specialized service providers for certain functions such as payment processing. However, no method of electronic transmission or storage can guarantee absolute security.","heading":"7. Security"},{"body":"The Dasta Services are not directed to children under 13, and Dasta does not knowingly collect personal information from children under 13 without appropriate authorization. If Dasta learns that personal information from a child has been collected in violation of applicable law, Dasta will take appropriate steps to delete it.\n\nUsers who are minors in their jurisdiction should use the Dasta Services only with the involvement and consent required by applicable law and the Dasta Terms of Use. Dasta does not intend to use children's personal information for targeted advertising or profiling.","heading":"8. Children's Privacy"},{"body":"Depending on where you live and subject to applicable law and exemptions, you may have rights regarding personal information, which may include rights to request access, correction, deletion, or a copy of certain information, and rights relating to certain sales, sharing, or targeted advertising practices. Dasta will not discriminate against you for exercising rights provided by applicable law.\n\nTo submit a privacy request, contact Dasta using the information in Section 14. Dasta may need to verify your identity and may request information reasonably necessary to process the request. Authorized agents may submit requests where permitted by law and subject to appropriate verification.\n\nDepending on your state of residence, these rights may include the right to:\n• know or access the personal information Dasta has collected about you;\n• correct inaccurate personal information;\n• delete personal information, subject to certain exceptions;\n• obtain a copy of your personal information in a portable format; and\n• opt out of the sale or sharing of personal information, targeted advertising, and, where applicable, certain uses of sensitive personal information.\n\nAs described in Section 3, Dasta does not sell personal information and does not share personal information for cross-context behavioral advertising. Where Dasta processes any sensitive personal information, such as precise location or voice input, Dasta limits that processing to the purposes described in this Privacy Policy and does not use it to infer characteristics about you.\n\nIf Dasta declines to act on a privacy request, you may have the right to appeal that decision under applicable state law. To appeal, contact Dasta using the information in Section 14 and reference your original request; Dasta will respond to the appeal within the time required by applicable law.","heading":"9. U.S. State Privacy Rights"},{"body":"Dasta is based in the United States, and the Dasta Services are primarily intended for customers in the United States. If you access the Dasta Services from outside the United States, information may be processed in the United States and other locations where Dasta or its service providers operate, subject to applicable law. Availability of the Dasta mobile application through an app store in a particular jurisdiction does not necessarily mean that all Dasta Services are offered or available in that jurisdiction.","heading":"10. International Use"},{"body":"The Dasta Services may interact with third-party services, including Clover, Apple, Google, mapping services, authentication services, and other providers. Those providers may process information under their own privacy policies when you interact directly with their services. Dasta is not responsible for the privacy practices of independent third-party websites or services that are not acting as Dasta's service providers.\n\nDasta's use of a service provider does not authorize that provider to use Dasta customer information for unrelated purposes beyond what is permitted by applicable contracts, law, and platform requirements.","heading":"11. Third-Party Services and Links"},{"body":"Dasta distributes its mobile application through platforms that require separate privacy disclosures. Dasta maintains App Store privacy information for Apple and a Data Safety section for Google Play. Those disclosures are intended to reflect the data practices of the production version of the Dasta mobile application and should be read together with this Privacy Policy.\n\nDasta is responsible for keeping those platform disclosures accurate as the app changes, including disclosures relating to account/contact information, identifiers, purchase history, user content, location, voice or audio information where applicable, and data processed by third-party SDKs or service providers.\n\nApple and Google may independently collect information when you use their devices, app stores, operating systems, authentication services, speech-recognition services, or other platform features. Their processing is governed by their own privacy policies and terms.","heading":"12. Apple App Store and Google Play Privacy Disclosures"},{"body":"Dasta may update this Privacy Policy to reflect changes to the Dasta Services, data practices, technology, legal requirements, or platform requirements. Dasta will update the \"Last Updated\" date above and will provide additional notice when required by applicable law. Material changes will apply prospectively as required by law.","heading":"13. Changes to This Privacy Policy"},{"body":"Dasta LLC\n151 West Gorham Street\nMadison, WI 53703\nPrivacy inquiries: privacy@dastacafe.com\nCustomer support: support@dastacafe.com\n\nQuestions, complaints, requests to exercise privacy rights, or concerns about this Privacy Policy may be submitted using the contact information above.","heading":"14. Contact Us"}]} },
  "terms-of-use": { title: "Dasta Terms of Use", data: {"sections":[{"body":"Last Updated: September 21, 2026","heading":"Effective Date: November 20, 2026"},{"body":"These Terms of Use (\"Terms\") govern your access to and use of the Dasta mobile application, DastaCafe.com, SipSense, Dasta Account, Dasta Card, mobile ordering, gifting, gift cards, and other products, features, and services provided by Dasta (collectively, the \"Dasta Services\").\n\nBy accessing or using the Dasta Services, creating an account, placing an order, or participating in Dasta programs, you agree to these Terms and our Privacy Policy. If you do not agree to these Terms, you should not use the Dasta Services.","heading":"1. Acceptance of Terms"},{"body":"Certain Dasta Services may be used without creating an account. Other features, including My Circles, Dasta Card, saved preferences, gifting, and certain personalized services, may require a Dasta account.\n\nYou must be at least 13 years old to create a Dasta account. If you are a minor in your jurisdiction, you may use the Dasta Services, including Dasta Card and gift cards, only with the involvement and consent of a parent or legal guardian who holds the account and payment method. By creating an account, you represent that you meet these requirements.\n\nYou agree to provide accurate information and to keep your account information current. You are responsible for maintaining the security of your account and for activity occurring through your account.\n\nDasta may support authentication through email, phone number, Sign in with Apple, Google Sign-In, or other authentication methods made available from time to time.\n\nIf you believe your account has been accessed without authorization, contact Dasta promptly at support@dastacafe.com.","heading":"2. Eligibility and Accounts"},{"body":"Dasta allows customers to order beverages, food, and other eligible products for pickup or other available fulfillment methods.\n\nPrices, product availability, ingredients, customization options, taxes, fees, and promotions may vary by location and may change without notice. An order is not final until it has been accepted by Dasta.\n\nDasta may cancel or modify an order when an item is unavailable, an order cannot reasonably be fulfilled, a pricing or technical error occurs, or other circumstances prevent fulfillment. If Dasta cancels an order after payment has been captured, Dasta will provide an appropriate refund or other remedy consistent with Section 17 (Refunds and Cancellations) and applicable law.","heading":"3. Mobile Ordering and Purchases"},{"body":"Payments made through the Dasta mobile application may be processed by Clover or another payment processor identified at the time of purchase. Payment information provided for card transactions is processed by the applicable payment processor in accordance with its terms and privacy practices.\n\nDasta does not store complete payment-card numbers or card security codes on its own systems when those credentials are processed directly by our payment processor.\n\nBy submitting a payment method, you represent that you are authorized to use that payment method and authorize the applicable charges associated with your transaction.","heading":"4. Payments"},{"body":"Dasta Card is a stored-value feature that allows eligible customers to load funds and use the available balance for qualifying purchases from Dasta.\n\nFunds loaded to a Dasta Card are not a bank deposit, checking account, savings account, credit card, or general-purpose payment account and may be used only as permitted by Dasta.\n\nDasta Card balances are subject to applicable law and any additional terms presented when funds are loaded or used. Except where required by law, Dasta Card value is intended for purchases from Dasta and is not redeemable for cash. Nothing in these Terms limits rights that cannot lawfully be waived, including rights that may apply to stored value, unclaimed property, or refunds in a particular jurisdiction.\n\nAuto Reload. If you enable Auto Reload, you authorize Dasta and its payment processor to automatically charge your selected payment method according to the reload threshold and reload amount you select.\n\nYou may change or disable Auto Reload through your Dasta account settings. Disabling Auto Reload will apply to future automatic reloads and will not reverse transactions that have already been processed.\n\nAuto reload will be paused for 24h if there are two consecutive reloads within a span of 10 minutes. This specific feature is added to protect any fraud activity. During reload pause, the customer could use other option \"add money\" feature to load the card.","heading":"5. Dasta Card"},{"body":"Dasta may allow customers to purchase gift cards or send eligible beverages, food, rewards, or other gifts to another person.\n\nGift cards and gifts may be subject to redemption requirements, expiration restrictions where permitted by law, location restrictions, promotional conditions, and other terms displayed at the time of purchase.\n\nThe purchaser is responsible for providing accurate recipient information. Dasta is not responsible for delivery failures resulting from inaccurate recipient information supplied by the purchaser, except as required by applicable law.\n\nGift card purchases are non-refundable except as required by applicable law or as described in Section 17 (Refunds and Cancellations). Any expiration, inactivity, redemption, or cash-redemption terms applicable to a Dasta gift card will be administered in accordance with applicable law and any terms disclosed at purchase.","heading":"6. Gift Cards and Gifting"},{"body":"Dasta Rewards is Dasta's customer loyalty and rewards program. Eligible customers may earn leaves, rewards, benefits, promotional offers, status, or other program benefits through qualifying activity.\n\nLeaves and other Dasta Rewards benefits have no cash value unless expressly stated otherwise and may not be transferred, sold, or exchanged for cash except where required by law.\n\nDasta may establish or modify earning rules, redemption requirements, reward availability, promotional offers, program tiers, and other program terms. Material changes will be communicated as required by applicable law.","heading":"7. Dasta Rewards"},{"body":"SipSense is Dasta's personalized beverage discovery and recommendation experience. SipSense may use information you provide, including preferences, cravings, mood, customizations, text or voice input, prior selections, and other relevant information, to generate beverage and food recommendations.\n\nSipSense recommendations are generated for convenience and discovery. Recommendations may not always reflect every ingredient, dietary preference, allergy, nutritional requirement, or other individual consideration.\n\nCustomers with food allergies, intolerances, medical dietary restrictions, or other ingredient concerns should verify ingredients directly with Dasta before ordering and should not rely solely on a SipSense recommendation. See Section 19 (Disclaimer of Warranties) for additional information.","heading":"8. SipSense"},{"body":"Dasta may provide optional voice-enabled features that allow you to navigate the app, enter SipSense requests, use voice-activated shortcuts, or interact with certain Dasta Services using speech.\n\nVoice recognition may occasionally misunderstand or incorrectly transcribe spoken input. You are responsible for reviewing order details, selections, and other important information -- including anything added to your cart or submitted for purchase through a voice command -- before confirming a transaction.\n\nUse of voice features may involve microphone access and speech processing as described in the Dasta Privacy Policy. You can manage microphone and speech-recognition permissions through your device settings.","heading":"9. Voice Features"},{"body":"With your permission, the Dasta mobile application may use your device's location to identify nearby Dasta cafés, provide directions, or enable other location-related features.\n\nLocation access is optional. You may decline or disable location access through your device settings, although certain location-based features may then be unavailable.\n\nDasta's collection and use of location information is described in the Dasta Privacy Policy. The mobile application is designed to request location access only for location-related features made available to you.","heading":"10. Location Services"},{"body":"Depending on your settings and permissions, Dasta may communicate with you through email, SMS/text messages, in-app messages, or push notifications regarding orders, account activity, rewards, gifts, promotions, and other Dasta Services.\n\nYou may manage eligible communication preferences through your account, device settings, or applicable unsubscribe mechanisms. Certain transactional or account-security communications may still be sent when necessary to provide the Dasta Services.","heading":"11. Notifications and Communications"},{"body":"If you provide suggestions, comments, feedback, reviews, ideas, or other submissions regarding Dasta or the Dasta Services, you grant Dasta permission to use that feedback to operate, improve, and develop its products and services, subject to applicable law and our Privacy Policy.","heading":"12. Feedback and User Submissions"},{"body":"The Dasta Services and their associated software, designs, interfaces, branding, text, graphics, functionality, recommendations, and other content are owned by or licensed to Dasta and are protected by applicable intellectual-property laws.\n\nDasta, SipSense, Dasta Rewards, Dasta Card, associated logos, and other Dasta marks may be trademarks or service marks of Dasta.\n\nCertain SipSense technology and functionality are the subject of a pending U.S. patent application. \"Patent pending\" status does not imply that a patent has been granted but the application is under review by USPTO.","heading":"13. Intellectual Property"},{"body":"If you engage in any of the following actions, Dasta may suspend or terminate your access to the Dasta Services, pursue all available civil remedies, and refer the matter to law enforcement or other appropriate authorities where warranted:\n• fraud;\n• unauthorized account access;\n• abuse of promotions/rewards;\n• manipulating Dasta Account balances;\n• reverse engineering where legally permissible;\n• automated scraping;\n• interfering with the app/API;\n• attempting to access another customer's data;\n• fraudulent payments, gift cards, or Dasta Card activity.","heading":"14. Prohibited Uses"},{"body":"Dasta may restrict or suspend access when reasonably necessary to protect customers, investigate suspected fraud or misuse, comply with law, protect Dasta systems, or enforce these Terms.\n\nCustomers may stop using the Dasta Services at any time and may request deletion of their Dasta account through the account settings available in the mobile application. Dasta may also provide an external account-deletion request method for users who no longer have access to the application.","heading":"15. Account Suspension and Termination"},{"body":"You may initiate deletion of your Dasta account from within the Dasta mobile application. Account deletion permanently deletes or de-identifies associated personal information except information Dasta must retain for legitimate purposes such as legal, tax, accounting, fraud-prevention, dispute-resolution, or regulatory obligations.\n\nBefore deletion, Dasta may inform you of outstanding balances, unredeemed gifts, rewards, transactions, or other account items that may be affected by deletion. Deleting an account may result in the loss of unused rewards, saved preferences, and other account-linked benefits, subject to applicable law and any separate rights associated with paid stored value or gift cards. Dasta may require reasonable steps to verify your identity before completing a deletion request. Additional information about deletion, retention, and your privacy rights is provided in the Dasta Privacy Policy.","heading":"16. Account Deletion"},{"body":"Because Dasta prepares food and beverages, including custom SipSense creations, to order, all sales are generally final once an order has been accepted and preparation has begun. The following exceptions apply:\n• Dasta Error. If Dasta is unable to fulfill an order, made an error in preparing it, or a pricing or technical error occurred, Dasta will issue a refund to the Dasta card found on customer's Dasta Account.\n• Customer-Initiated Cancellation. You may cancel an order before Dasta has begun preparing it or in case of My Circles group order, you may cancel the order until cutoff time listed on the group order. Once preparation has begun -- including once a custom SipSense drink has been crafted into a build ticket -- the order can no longer be canceled for a refund except as described above.\n• Gift Cards. Gift card purchases are non-refundable except as required by applicable law.\n• Dasta Card. Funds loaded to a Dasta Card are non-refundable except as required by applicable law or as described in Section 5 (Dasta Card).\n• Rewards and Redemptions. If an order that would have earned leaves, rewards, or a free-drink redemption is canceled or refunded, any leaves, rewards, or redemption associated with that order may be reversed or forfeited.\n\nIn store refunds are typically issued to the original payment method as long as the original receipt is presented during the return. Anywhere permitted by law and agreed to by the customer, Dasta may offer another form of credit or remedy. Processing times vary by payment provider and financial institution.","heading":"17. Refunds and Cancellations"},{"body":"The Dasta Services may interoperate with or rely on third-party services, including payment processors, identity providers, device-platform services, mapping or location services, communications providers, and other technology providers. Your use of a third-party service may also be governed by that provider's terms and privacy practices. Dasta is not responsible for third-party services except to the extent required by applicable law or expressly stated in these Terms.","heading":"18. Third-Party Services"},{"body":"TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE DASTA SERVICES -- INCLUDING THE DASTA MOBILE APPLICATION, DASTACAFE.COM, SIPSENSE, DASTA REWARDS, DASTA CARD, AND ALL RELATED FEATURES AND CONTENT -- ARE PROVIDED \"AS IS\" AND \"AS AVAILABLE,\" WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING BUT NOT LIMITED TO THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.\n\nDasta does not warrant that the Dasta Services will be uninterrupted, secure, or error-free, that defects will be corrected, or that SipSense recommendations, voice-recognition results, or any other automatically generated content will be accurate, complete, or suitable for your individual dietary, allergy, or health needs. As described in Section 8 (SipSense), you should verify ingredients directly with Dasta rather than relying solely on a SipSense recommendation.\n\nNothing in this section is intended to limit any warranty that cannot be excluded under applicable law, including any statutory rights you may have as a consumer, or any warranty Dasta separately provides regarding the food and beverage products themselves under applicable food-safety law.","heading":"19. Disclaimer of Warranties"},{"body":"TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, DASTA AND ITS OFFICERS, EMPLOYEES, AND AGENTS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUE, DATA, OR GOODWILL, ARISING FROM OR RELATED TO YOUR USE OF THE DASTA SERVICES, EVEN IF DASTA HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.\n\nTO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, DASTA'S TOTAL LIABILITY TO YOU FOR ANY CLAIM ARISING FROM OR RELATED TO THE DASTA SERVICES WILL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID TO DASTA THROUGH THE DASTA SERVICES IN THE ONE HUNDRED EIGHTY (180) DAYS BEFORE THE EVENT GIVING RISE TO THE CLAIM, OR (B) FIFTY DOLLARS ($50).\n\nSome jurisdictions do not allow the exclusion or limitation of certain damages, so some or all of the exclusions and limitations in this section may not apply to you.","heading":"20. Limitation of Liability"},{"body":"To the maximum extent permitted by applicable law, you agree to indemnify, defend, and hold harmless Dasta, its officers, employees, and agents from and against any claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising from or related to: (a) your use or misuse of the Dasta Services; (b) your violation of these Terms; (c) your violation of any applicable law or the rights of a third party; or (d) any content, information, or payment method you submit through the Dasta Services.\n\nDasta reserves the right, at its own expense, to assume the exclusive defense and control of any matter otherwise subject to indemnification by you, in which case you agree to cooperate with Dasta's defense of that claim.","heading":"21. Indemnification"},{"body":"These Terms and any dispute arising from or related to the Dasta Services are governed by the laws of the State of Wisconsin, without regard to its conflict-of-laws principles, except to the extent superseded by applicable federal law.\n\nBefore initiating arbitration, the party asserting a dispute will first provide the other party with written notice describing the dispute and requested relief and allow a reasonable opportunity to resolve the matter informally. If the dispute is not resolved informally, any dispute, claim, or controversy arising from or relating to these Terms or the Dasta Services will be resolved by binding arbitration on an individual basis, rather than in court, except that either party may bring an individual action in small claims court where eligible. YOU AND DASTA EACH WAIVE THE RIGHT TO A JURY TRIAL AND TO PARTICIPATE IN A CLASS ACTION, CLASS ARBITRATION, OR REPRESENTATIVE ACTION, TO THE EXTENT PERMITTED BY APPLICABLE LAW.\n\nIf any part of this arbitration agreement is found unenforceable, that part will be severed and the remainder will remain in effect, except that if the class-action waiver is found unenforceable, the entire arbitration agreement will be unenforceable.","heading":"22. Governing Law and Dispute Resolution"},{"body":"Dasta may update these Terms from time to time. If Dasta makes a material change, Dasta will provide notice through the Dasta mobile application, by email, or by another reasonable method before the change takes effect. Your continued use of the Dasta Services after a change becomes effective constitutes acceptance of the updated Terms.","heading":"23. Changes to These Terms"},{"body":"If any provision of these Terms is found to be unenforceable or invalid, that provision will be limited or eliminated to the minimum extent necessary, and the remaining provisions will remain in full force and effect.","heading":"24. Severability"},{"body":"These Terms, together with the Privacy Policy and any additional terms presented for a specific Dasta Service (such as a promotion or gift card offer), constitute the entire agreement between you and Dasta regarding the Dasta Services and supersede any prior agreements on the same subject.","heading":"25. Entire Agreement"},{"body":"If you downloaded the Dasta mobile application from Apple's App Store, the following additional terms apply. These Terms are between you and Dasta, not Apple, and Dasta, not Apple, is solely responsible for the Dasta mobile application and its content.\n\nLicense Scope. Subject to these Terms, Dasta grants you a personal, limited, non-exclusive, non-transferable license to use the Dasta mobile application on Apple-branded products that you own or control and as permitted by the usage rules in the Apple Media Services Terms and Conditions, including use through permitted Family Sharing or volume-purchase arrangements where applicable.\n\nMaintenance and Support. Dasta, not Apple, is responsible for providing any maintenance and support services for the Dasta mobile application as required by applicable law or these Terms. Apple has no obligation to furnish maintenance or support services.\n\nWarranty. To the extent any warranty applies to the Dasta mobile application and the application fails to conform to that warranty, you may notify Apple, and Apple may refund the purchase price, if any, paid to Apple for the application. To the maximum extent permitted by applicable law, Apple has no other warranty obligation with respect to the Dasta mobile application. Dasta is responsible for any other claims, losses, liabilities, damages, costs, or expenses attributable to a failure to conform to an applicable warranty, subject to these Terms and applicable law.\n\nProduct Claims. Dasta, not Apple, is responsible for addressing claims by you or any third party relating to the Dasta mobile application or your possession or use of it, including product-liability claims, claims that the application fails to conform to applicable legal or regulatory requirements, and claims arising under consumer-protection, privacy, or similar law.\n\nIntellectual Property Claims. If a third party claims that the Dasta mobile application or your possession and use of it infringes that party's intellectual-property rights, Dasta, not Apple, is responsible for the investigation, defense, settlement, and discharge of that claim.\n\nLegal Compliance. You represent and warrant that you are not located in a country or region subject to a U.S. Government embargo or designated by the U.S. Government as a \"terrorist supporting\" country or region, and that you are not listed on any U.S. Government list of prohibited or restricted parties.\n\nThird-Party Terms. You must comply with applicable third-party terms when using the Dasta mobile application, including terms applicable to your wireless-data service, device platform, authentication provider, and payment provider.\n\nThird-Party Beneficiary. Apple and Apple's subsidiaries are third-party beneficiaries of these Terms as they relate to the Dasta mobile application. Upon your acceptance of these Terms, Apple will have the right (and will be deemed to have accepted the right) to enforce these Terms against you as a third-party beneficiary.\n\nDeveloper Contact. Questions, complaints, or claims relating to the Dasta mobile application should be directed to Dasta using the contact information in Section 27.","heading":"26. Apple End User License Agreement Terms"},{"body":"Dasta LLC\n151 West Gorham Street, Madison, WI 53703\nEmail: support@dastacafe.com\n\nQuestions, complaints, or claims regarding the Dasta Services may be directed to the contact information above. Privacy-related requests may also be submitted using the methods described in the Dasta Privacy Policy.","heading":"27. Contact"}]} },
};

function useContentPage(slug) {
  const seed = _contentPageCache[slug] || DEFAULT_CONTENT_PAGES[slug];
  const [data, setData] = useState(seed?.data || null);
  const [title, setTitle] = useState(seed?.title || null);
  const [loading, setLoading] = useState(!seed);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const alreadyHaveContent = !!(_contentPageCache[slug] || DEFAULT_CONTENT_PAGES[slug]);
      if (!alreadyHaveContent) setLoading(true);
      setFailed(false);
      const { ok, data: resp } = await apiFetch(`/content/pages/${slug}`);
      if (cancelled) return;
      if (ok && resp?.data) {
        _contentPageCache[slug] = { data: resp.data, title: resp.title };
        setData(resp.data);
        setTitle(resp.title);
      } else if (!alreadyHaveContent) {
        setFailed(true);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [slug, reloadKey]);

  return { data, title, loading, failed, retry: () => setReloadKey(k => k + 1) };
}

function ContentLoadError({ onRetry }) {
  return (
    <View style={S.contentLoadErrorBox}>
      <Text style={S.cardSub}>Couldn't load this page right now.</Text>
      <Pressable style={[S.btnSaffron, { marginTop: 8 }]} onPress={onRetry}>
        <Text style={S.btnSaffronText}>Try Again</Text>
      </Pressable>
    </View>
  );
}

function ContentScreenHeader({ title, navigation, onBack }) {
  // Back-chevron removed (2026-09-23, PC's ask, app-wide audit) -- every
  // screen using this shared header ('More' is a bottom tab: Journey to
  // Dasta, Academic References, Discover Dasta Rewards, Privacy Policy,
  // Terms of Use, Join Our Team, Provide Feedback) already had an
  // equally-fast way back via the tab bar; PC's call is that's enough
  // everywhere, arrow or not, so it's gone rather than kept as a second
  // way to do the same thing. minHeight:44 kept (same global-account-icon
  // alignment reasoning as before) so the title still vertically centers
  // against the header's fixed height; title now just sits at S.hero's
  // own left padding, same left inset as HomeScreen's own title, instead
  // of trailing an arrow that's no longer there.
  return (
    <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
      <HeroTitleRow title={title} onBack={onBack} />
    </View>
  );
}

// ── Legal document screen (shared: Privacy Policy + Terms of Use) ──
// Genuinely just flowing legal text -- one generic template, data shape
// is { sections: [{ heading, body }] } from the backend.
function LegalDocumentScreen({ slug, title, navigation, onHeaderBack }) {
  const { data, title: apiTitle, loading, failed, retry } = useContentPage(slug);

  if (loading) {
    return (
      <View style={[S.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.saffron} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom contentContainerStyle={{ paddingBottom: 40 }}>
      <StatusBar style="light" />
      <ContentScreenHeader title={apiTitle || title} navigation={navigation} onBack={onHeaderBack} />
      <View style={{ padding: 16 }}>
        {failed && !data ? <ContentLoadError onRetry={retry} /> : (data?.sections || [])
          // Apple EULA section (Terms of Use) is only relevant to the App
          // Store build -- a `platform` field on the section (set only for
          // that one section as of 2026-09-21) hides it on Android rather
          // than adding a Terms-of-Use-specific branch to this shared
          // screen.
          .filter(section => !section.platform || section.platform === Platform.OS)
          .map((section, i) => (
          <View key={i} style={{ marginBottom: 20 }}>
            {!!section.heading && <Text style={S.contentSectionTitle}>{section.heading}</Text>}
            <Text style={[S.contentParagraph, { marginTop: 8 }]}>{section.body}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ── Meet SipSense (2026-09-30, PC) ─────────────────────────────
// Native rebuild of dastacafe.com/meet-sipsense. Every word is from the
// content API (slug meet-sipsense): tagline, then sections of typed blocks
// -- p, strong (a standalone bold line), step (bold "Step N:" subheading),
// em (a standalone italic line), rich (inline bold/italic segments) -- and
// the closing Try SipSense button, which starts the same order flow as
// Home's Craft My Drink. Opened from Home's SipSense wordmark and More.
function MeetSipSenseScreen({ navigation, onHeaderBack }) {
  const { data, title, loading, failed, retry } = useContentPage('meet-sipsense');

  const block = (b, i) => {
    if (b.type === 'strong') return <Text key={i} style={[S.contentParagraph, { fontWeight: '700', color: C.charcoal }]}>{b.text}</Text>;
    if (b.type === 'step') return <Text key={i} style={S.meetStep}>{b.text}</Text>;
    if (b.type === 'em') return <Text key={i} style={[S.contentParagraph, { fontStyle: 'italic' }]}>{b.text}</Text>;
    if (b.type === 'rich') {
      return (
        <Text key={i} style={S.contentParagraph}>
          {(b.segments || []).map((sg, j) => (
            <Text key={j} style={[sg.bold && { fontWeight: '700' }, sg.italic && { fontStyle: 'italic' }]}>{sg.text}</Text>
          ))}
        </Text>
      );
    }
    return <Text key={i} style={S.contentParagraph}>{b.text}</Text>;
  };

  if (loading) {
    return (
      <View style={[S.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.saffron} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom contentContainerStyle={{ paddingBottom: 40 }}>
      <StatusBar style="light" />
      <ContentScreenHeader title={title || 'Meet SipSense™'} navigation={navigation} onBack={onHeaderBack} />
      <View style={{ padding: 16 }}>
        {failed && !data ? <ContentLoadError onRetry={retry} /> : (
          <>
            {!!data?.tagline && <Text style={S.meetTagline}>{data.tagline}</Text>}
            {(data?.sections || []).map((sec, i) => (
              <View key={i} style={{ marginBottom: 20 }}>
                {!!sec.heading && <Text style={[S.contentSectionTitle, { marginBottom: 8 }]}>{sec.heading}</Text>}
                {(sec.blocks || []).map(block)}
              </View>
            ))}
            {!!data?.cta?.label && (
              <Pressable style={[S.btnSaffron, { marginTop: 4 }]} onPress={() => navigation.navigate('StartNewDrink')}>
                <Text style={S.btnSaffronText}>{data.cta.label}</Text>
              </Pressable>
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}

// ── Journey to Dasta ──────────────────────────────────────────
// Bespoke rebuild of dastacafe.com/founder-owner-mobile -- founder/owner
// initials-in-circle cards, a checkmark vision list, the journey story,
// and a management-team closer. Every string below is a named field from
// the content API's data object, not hardcoded copy.
function JourneyToDastaScreen({ navigation, onHeaderBack }) {
  const { data, title, loading, failed, retry } = useContentPage('journey-to-dasta');

  if (loading) {
    return (
      <View style={[S.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.saffron} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom contentContainerStyle={{ paddingBottom: 40 }}>
      <StatusBar style="light" />
      <ContentScreenHeader title={title || 'The Journey to Dasta'} navigation={navigation} onBack={onHeaderBack} />
      <View style={{ padding: 16 }}>
        {failed && !data ? <ContentLoadError onRetry={retry} /> : !data ? null : (
          <>
            {/* Whoever the content lists, centered (2026-09-30, PC: the
                Owner card was removed; the Founder now sits centered). */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginBottom: 24 }}>
              {[data.founder, data.owner].filter(person => person?.name).map((person, i) => (
                <View key={i} style={{ width: 150, alignItems: 'center' }}>
                  <View style={S.contentInitialsCircle}><Text style={S.contentInitialsText}>{person.initials}</Text></View>
                  <Text style={S.contentPersonName}>{person.name}</Text>
                  <Text style={S.contentPersonTitle}>{person.title}</Text>
                </View>
              ))}
            </View>

            <View style={[S.infoCard, { marginBottom: 24 }]}>
              <Text style={S.contentSectionTitle}>{data.visionHeading}</Text>
              <View style={{ marginTop: 12 }}>
                {(data.visionItems || []).map((item, i) => (
                  <View key={i} style={S.contentChecklistRow}>
                    <Text style={S.contentCheckmark}>✓</Text>
                    <Text style={S.contentChecklistText}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>

            <Text style={S.contentSectionTitle}>{data.journeyHeading}</Text>
            <View style={S.contentAccentLine} />
            {(data.journeyParagraphs || []).map((p, i) => (
              <Text key={i} style={S.contentParagraph}>{p}</Text>
            ))}
            {!!data.pullQuote && (
              <View style={S.contentPullQuoteBox}>
                <Text style={S.contentPullQuoteText}>{data.pullQuote}</Text>
              </View>
            )}

            <View style={{ marginTop: 24 }}>
              <Text style={S.contentSectionTitle}>{data.managementHeading}</Text>
              <View style={S.contentAccentLine} />
              <Text style={S.contentParagraph}>{data.managementParagraph}</Text>
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

// ── Academic References ("The Science of Study Fuel") ────────────
// Bespoke rebuild of dastacafe.com/dasta-research-mobile -- Study Mode
// cards, the L-Theanine callouts, and the caffeine/L-theanine table.
function AcademicReferencesScreen({ navigation, onHeaderBack }) {
  const { data, title, loading, failed, retry } = useContentPage('academic-references');

  if (loading) {
    return (
      <View style={[S.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.saffron} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom contentContainerStyle={{ paddingBottom: 40 }}>
      <StatusBar style="light" />
      <ContentScreenHeader title={title || 'Academic References'} navigation={navigation} onBack={onHeaderBack} />
      <View style={{ padding: 16 }}>
        {failed && !data ? <ContentLoadError onRetry={retry} /> : !data ? null : (
          <>
            <Text style={S.contentSectionTitle}>{data.heading}</Text>
            <View style={S.contentAccentLine} />
            <Text style={S.contentParagraph}>{data.intro}</Text>

            <Text style={[S.contentSectionTitle, { fontSize: 17, marginTop: 12 }]}>{data.studyModeHeading}</Text>
            <Text style={[S.contentParagraph, { marginTop: 6 }]}>{data.studyModeIntro}</Text>
            {(data.studyModes || []).map((m, i) => (
              <View key={i} style={S.contentModeCard}>
                <Text style={S.contentModeEmoji}>{m.emoji}</Text>
                <Text style={S.contentModeTitle}>{m.title}</Text>
                <Text style={S.contentModeBody}>{m.body}</Text>
              </View>
            ))}

            <Text style={[S.contentSectionTitle, { fontSize: 17, marginTop: 16 }]}>{data.theanineHeading}</Text>
            <Text style={[S.contentParagraph, { marginTop: 6 }]}>{data.theanineParagraph}</Text>
            {(data.theaninePoints || []).map((pt, i) => (
              <View key={i} style={S.contentPointRow}>
                <Text style={S.contentPointIcon}>{pt.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={S.contentPointTitle}>{pt.title}</Text>
                  <Text style={S.contentPointBody}>{pt.body}</Text>
                </View>
              </View>
            ))}

            <Text style={[S.contentSectionTitle, { fontSize: 17, marginTop: 8 }]}>{data.tableHeading}</Text>
            <View style={[S.contentTable, { marginTop: 10, marginBottom: 20 }]}>
              <View style={S.contentTableHeaderRow}>
                {(data.tableColumns || []).map((col, i) => (
                  <Text key={i} style={S.contentTableHeaderCell}>{col}</Text>
                ))}
              </View>
              {(data.tableRows || []).map((row, ri) => (
                <View key={ri} style={[S.contentTableRow, ri % 2 === 1 && S.contentTableRowAlt]}>
                  {row.map((cell, ci) => (
                    <Text key={ci} style={S.contentTableCell}>{cell}</Text>
                  ))}
                </View>
              ))}
            </View>

            <Text style={[S.contentSectionTitle, { fontSize: 17 }]}>{data.sourcesHeading}</Text>
            <View style={{ marginTop: 10 }}>
              {(data.sources || []).map((src, i) => (
                <Text key={i} style={S.contentSourceText}>{src}</Text>
              ))}
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

// ── Discover Dasta Rewards ────────────────────────────────────
// Bespoke rebuild of dastacafe.com/dasta-founders-circle-mobile -- the
// marketing/explainer page about the rewards program. NOT the same
// screen as the native RewardsScreen tab (that's live leaf-progress UI
// for a signed-in customer; this is the public "why join" explainer).
// The one live-data element on the page -- the "Dasta Community Impact"
// counters -- is genuinely live site-wide stats, not static copy, so
// it's fetched separately from the same GET /sip/community-impact
// endpoint the web page itself calls, using data.impactApiPath /
// data.impactRows from the content API to know which fields to show.
function DiscoverRewardsScreen({ navigation, onHeaderBack }) {
  const { data, title, loading, failed, retry } = useContentPage('discover-dasta-rewards');
  const [impact, setImpact] = useState(null);

  useEffect(() => {
    if (!data?.impactApiPath) return;
    let cancelled = false;
    (async () => {
      const { ok, data: resp } = await apiFetch(data.impactApiPath);
      if (!cancelled && ok && resp) setImpact(resp);
    })();
    return () => { cancelled = true; };
  }, [data?.impactApiPath]);

  if (loading) {
    return (
      <View style={[S.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.saffron} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom contentContainerStyle={{ paddingBottom: 40 }}>
      <StatusBar style="light" />
      <ContentScreenHeader title={title || 'Discover Dasta Rewards'} navigation={navigation} onBack={onHeaderBack} />
      <View style={{ padding: 16 }}>
        {failed && !data ? <ContentLoadError onRetry={retry} /> : !data ? null : (
          <>
            <Text style={S.contentSectionTitle}>{data.heading}</Text>
            {!!data.subheading && <Text style={[S.contentParagraph, { marginTop: 6 }]}>{data.subheading}</Text>}
            <View style={S.contentAccentLine} />

            {!!data.impactRows && (
              <View style={S.contentImpactCard}>
                <Text style={S.contentImpactTitle}>{data.impactCardTitle}</Text>
                {data.impactRows.map((row, i) => (
                  <View key={i} style={S.contentImpactRow}>
                    <Text style={S.contentImpactLabel}>{row.label}</Text>
                    <Text style={S.contentImpactNumber}>{impact ? (impact[row.field] ?? '—') : '—'}</Text>
                  </View>
                ))}
              </View>
            )}

            <Text style={S.contentPersonName}>{data.circleTitle}</Text>
            <Text style={[S.contentParagraph, { marginTop: 4 }]}>{data.circleIntro}</Text>
            {(data.circleBullets || []).map((b, i) => (
              <View key={i} style={S.contentBulletRow}>
                <Text style={S.contentBulletDot}>•</Text>
                <Text style={S.contentBulletText}>{b}</Text>
              </View>
            ))}

            <Text style={[S.contentSectionTitle, { fontSize: 17, marginTop: 20 }]}>{data.howItWorksTitle}</Text>
            {(data.howItWorksSteps || []).map((step, i) => (
              <View key={i} style={[S.contentStepRow, { marginTop: 12 }]}>
                <View style={S.contentStepNum}><Text style={S.contentStepNumText}>{i + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={S.contentStepTitle}>{step.title}</Text>
                  <Text style={S.contentStepBody}>{step.body}</Text>
                </View>
              </View>
            ))}
            {!!data.leavesNeverExpireNote && <Text style={[S.contentParagraph, { fontWeight: '700' }]}>{data.leavesNeverExpireNote}</Text>}

            <Text style={[S.contentSectionTitle, { fontSize: 17, marginTop: 12 }]}>{data.memberBenefitsTitle}</Text>
            {(data.memberBenefits || []).map((b, i) => (
              <View key={i} style={{ marginTop: 10 }}>
                <Text style={S.contentStepTitle}>{b.title}</Text>
                <Text style={S.contentStepBody}>{b.body}</Text>
              </View>
            ))}

            <Text style={[S.contentSectionTitle, { fontSize: 17, marginTop: 20 }]}>{data.trustTitle}</Text>
            <Text style={[S.contentParagraph, { marginTop: 6 }]}>{data.trustIntro}</Text>
            {(data.trustBullets || []).map((b, i) => (
              <View key={i} style={S.contentBulletRow}>
                <Text style={S.contentBulletDot}>•</Text>
                <Text style={S.contentBulletText}>{b}</Text>
              </View>
            ))}

            <Text style={[S.contentSectionTitle, { fontSize: 17, marginTop: 20 }]}>{data.dastaCardTitle}</Text>
            <Text style={[S.contentParagraph, { marginTop: 6 }]}>{data.dastaCardIntro}</Text>
            {(data.dastaCardBullets || []).map((b, i) => (
              <View key={i} style={S.contentBulletRow}>
                <Text style={S.contentBulletDot}>•</Text>
                <Text style={S.contentBulletText}>{b}</Text>
              </View>
            ))}
            {!!data.dastaCardFooter && <Text style={S.contentParagraph}>{data.dastaCardFooter}</Text>}

            <Text style={[S.contentSectionTitle, { fontSize: 17, marginTop: 12 }]}>{data.cardPaymentsTitle}</Text>
            <Text style={[S.contentParagraph, { marginTop: 6 }]}>{data.cardPaymentsBody}</Text>

            <Text style={[S.contentSectionTitle, { fontSize: 17, marginTop: 20 }]}>{data.foundersCircleTitle}</Text>
            <Text style={[S.contentParagraph, { marginTop: 6 }]}>{data.foundersCircleIntro}</Text>

            {!!data.tiersImageUrl && (
              <Image source={{ uri: data.tiersImageUrl }} style={S.contentTierImage} resizeMode="contain"
                accessibilityLabel={data.tiersImageAlt} />
            )}

            <Text style={[S.contentSectionTitle, { fontSize: 17 }]}>{data.whyFounderTitle}</Text>
            <Text style={[S.contentParagraph, { marginTop: 6 }]}>{data.whyFounderIntro}</Text>

            <Text style={[S.contentSectionTitle, { fontSize: 16, marginTop: 8 }]}>{data.growingTogetherTitle}</Text>
            <Text style={[S.contentParagraph, { marginTop: 6 }]}>{data.growingTogetherBody}</Text>

            {(data.tiers || []).map((tier, i) => (
              <View key={i} style={S.contentTierCard}>
                <Text style={S.contentTierName}>{tier.name}</Text>
                {!!tier.intro && <Text style={S.contentTierIntro}>{tier.intro}</Text>}
                {(tier.perks || []).map((perk, pi) => (
                  <View key={pi} style={S.contentBulletRow}>
                    <Text style={S.contentBulletDot}>•</Text>
                    <Text style={S.contentBulletText}>{perk}</Text>
                  </View>
                ))}
                {!!tier.highlight && <Text style={S.contentTierHighlight}>{tier.highlight}</Text>}
              </View>
            ))}

            {!!data.closingItalic && (
              <Text style={[S.contentParagraph, { fontStyle: 'italic', fontWeight: '700', textAlign: 'center', marginTop: 8 }]}>
                {data.closingItalic}
              </Text>
            )}
            {!!data.closingBody && <Text style={[S.contentParagraph, { textAlign: 'center' }]}>{data.closingBody}</Text>}

            {!!data.footerBanner && (
              <View style={S.contentFooterBanner}>
                <Text style={S.contentFooterBannerText}>{data.footerBanner}</Text>
              </View>
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}

// ── JOIN OUR TEAM (2026-09-18) ────────────────────────────────
// Native replacement for the "Join Our Team" More-screen entry, which
// used to open dastacafe.com/join-dasta-team-mobile in an in-app
// browser -- that page's Open Positions list/dropdown were hardcoded
// static HTML and its application form never actually submitted
// anywhere (action="#", no fetch()). Now backed by real endpoints:
// GET /careers/openings (job_openings table) + POST /careers/applications
// (job_applications table) -- see routers/careers_router.py.
const WHY_WORK_WITH_US = [
  { title: 'Real Hospitality Experience', body: 'Learn chai brewing, espresso, and food prep in a fast-paced cafe built around genuine ritual, not just a paycheck.' },
  { title: 'Flexible Scheduling', body: 'Shifts built around class schedules -- we work with students, not against them.' },
  { title: 'Grow With Us', body: 'Dasta is early. The people who join now grow into the team that shapes what comes next.' },
];

// Email OTP verification (2026-09-18, PC's ask after a junk application
// came through with a made-up email address) -- shared by both
// JoinOurTeamScreen and ContactScreen. Send Code -> POST /email-otp/request
// (SES sends a 6-digit code) -> enter code -> POST /email-otp/verify ->
// bubbles the resulting single-use verification_token up via onVerified,
// which the parent screen includes in its final submission. resetSignal
// (bumped by the parent whenever the email field changes away from the
// already-verified address -- a token is only good for the exact email it
// was issued for) clears this widget's local sent/code/status state.
function EmailVerifyWidget({ email, purpose, isVerified, resetSignal, onVerified }) {
  const [sending, setSending] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [statusIsError, setStatusIsError] = useState(false);

  useEffect(() => {
    setCodeSent(false); setCode(''); setStatusText(''); setStatusIsError(false);
  }, [resetSignal]);

  const sendCode = async () => {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) { setStatusText('Enter a valid email first.'); setStatusIsError(true); return; }
    setSending(true);
    const { ok, data } = await apiFetch('/email-otp/request', { method: 'POST', body: { email: trimmed, purpose } });
    setSending(false);
    if (ok) {
      setCodeSent(true);
      setStatusText(`Code sent to ${trimmed}.`);
      setStatusIsError(false);
    } else {
      setStatusText(data?.detail || 'Could not send code.');
      setStatusIsError(true);
    }
  };

  const confirmCode = async () => {
    if (!code.trim()) return;
    setChecking(true);
    const { ok, data } = await apiFetch('/email-otp/verify', { method: 'POST', body: { email: email.trim(), purpose, code: code.trim() } });
    setChecking(false);
    if (ok) {
      setCodeSent(false);
      setCode('');
      setStatusText('');
      onVerified(email.trim().toLowerCase(), data.verification_token);
    } else {
      setStatusText(data?.detail || 'Incorrect code.');
      setStatusIsError(true);
    }
  };

  if (isVerified) {
    return <Text style={{ color: '#1E7A34', fontWeight: '600', marginTop: 4 }}>{'✓ Email verified'}</Text>;
  }

  return (
    <View style={{ marginTop: 6 }}>
      {!codeSent ? (
        <Pressable style={[S.btnSaffron, { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8 }]} disabled={sending} onPress={sendCode}>
          {sending ? <ActivityIndicator color={C.ivory} /> : <Text style={[S.btnSaffronText, { fontSize: 13 }]}>Verify Email</Text>}
        </Pressable>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput style={[S.input, { width: 110 }]} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6}
            placeholder="Code" placeholderTextColor={C.muted} />
          <Pressable style={[S.btnSaffron, { paddingHorizontal: 14, paddingVertical: 8 }]} disabled={checking} onPress={confirmCode}>
            {checking ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Confirm</Text>}
          </Pressable>
        </View>
      )}
      {!!statusText && <Text style={{ color: statusIsError ? '#B3261E' : '#1E7A34', fontSize: 12, marginTop: 4 }}>{statusText}</Text>}
    </View>
  );
}

function JoinOurTeamScreen({ navigation, onHeaderBack }) {
  const [openings, setOpenings] = useState(null); // null = loading
  const [fetchFailed, setFetchFailed] = useState(false);
  const [jobOpeningId, setJobOpeningId] = useState(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [availability, setAvailability] = useState('');
  const [whyJoin, setWhyJoin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [infoModal, setInfoModal] = useState(null); // {title, message, onOk}
  const showInfo = (title, message, onOk) => setInfoModal({ title, message, onOk });

  const [verifiedEmail, setVerifiedEmail] = useState(null);
  const [verificationToken, setVerificationToken] = useState(null);
  const [otpResetSignal, setOtpResetSignal] = useState(0);
  const handleEmailChange = (v) => {
    setEmail(v);
    if (verifiedEmail && v.trim().toLowerCase() !== verifiedEmail) {
      setVerifiedEmail(null); setVerificationToken(null); setOtpResetSignal(s => s + 1);
    }
  };

  // Both collapsed by default (2026-09-19, PC's ask) -- "Why Work With
  // Us" and "Open Positions" used to always render fully expanded,
  // pushing "Apply Now" far down the screen. Now both are tap-to-expand,
  // and Open Positions doubles as the actual position picker for the
  // application below (no more separate, redundant pill picker).
  const [whyExpanded, setWhyExpanded] = useState(false);
  const [positionsExpanded, setPositionsExpanded] = useState(false);

  const loadOpenings = async () => {
    setFetchFailed(false);
    const { ok, data } = await apiFetch('/careers/openings');
    if (ok && Array.isArray(data)) {
      setOpenings(data);
      if (data.length > 0) setJobOpeningId(data[0].id);
    } else {
      setOpenings([]);
      setFetchFailed(true);
    }
  };

  useEffect(() => { loadOpenings(); }, []);

  const handleSubmit = async () => {
    if (!fullName.trim()) { showInfo('Name required', 'Please enter your full name.'); return; }
    // Email is mandatory now (2026-09-18) -- it used to be email-or-phone,
    // but OTP verification needs somewhere to send the code, so phone
    // alone is no longer sufficient. Phone stays optional.
    if (!email.trim()) { showInfo('Email required', 'Please enter your email so we can verify it and reach you.'); return; }
    if (!jobOpeningId) { showInfo('Pick a position', 'Please select a position you\'re interested in.'); return; }
    if (verifiedEmail !== email.trim().toLowerCase()) { showInfo('Verify your email', 'Please verify your email before submitting.'); return; }

    setSubmitting(true);
    const { ok, data } = await apiFetch('/careers/applications', {
      method: 'POST',
      body: {
        job_opening_id: jobOpeningId,
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        availability: availability.trim() || undefined,
        why_join: whyJoin.trim() || undefined,
        source: 'mobile',
        verification_token: verificationToken,
      },
    });
    setSubmitting(false);

    if (ok) {
      showInfo('Application Sent', 'Thanks for your interest in joining Dasta -- we\'ll be in touch soon.', () => {
        setFullName(''); setEmail(''); setPhone(''); setAvailability(''); setWhyJoin('');
        setVerifiedEmail(null); setVerificationToken(null);
      });
    } else {
      showInfo('Couldn\'t Submit', data?.detail || 'Something went wrong sending your application. Please try again.');
    }
  };

  return (
    <>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 40 }}>
      <StatusBar style="light" />
      <ContentScreenHeader title="Join Our Team" navigation={navigation} onBack={onHeaderBack} />
      <View style={{ padding: 16 }}>
        <Pressable style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          onPress={() => setWhyExpanded(e => !e)}>
          <Text style={S.contentSectionTitle}>Why Work With Us</Text>
          <Text style={{ color: C.black, fontSize: 16 }}>{whyExpanded ? '▲' : '▼'}</Text>
        </Pressable>
        <View style={S.contentAccentLine} />
        {whyExpanded && WHY_WORK_WITH_US.map((item, i) => (
          <View key={i} style={{ marginTop: 10 }}>
            <Text style={S.contentStepTitle}>{item.title}</Text>
            <Text style={S.contentStepBody}>{item.body}</Text>
          </View>
        ))}

        <Text style={[S.contentSectionTitle, { marginTop: 24 }]}>Open Positions</Text>
        <View style={S.contentAccentLine} />
        {openings === null ? (
          <ActivityIndicator color={C.saffron} style={{ marginTop: 12 }} />
        ) : openings.length === 0 ? (
          <View style={{ marginTop: 8 }}>
            <Text style={S.cardSub}>{fetchFailed ? "Couldn't load open positions right now." : 'No open positions at this time -- check back soon.'}</Text>
            {fetchFailed && (
              <Pressable style={[S.btnSaffron, { marginTop: 12, alignSelf: 'flex-start' }]} onPress={loadOpenings}>
                <Text style={S.btnSaffronText}>Try Again</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={{ marginTop: 8 }}>
            <Pressable style={[S.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
              onPress={() => setPositionsExpanded(e => !e)}>
              <Text style={{ color: jobOpeningId ? C.charcoal : C.muted }}>
                {jobOpeningId ? openings.find(o => o.id === jobOpeningId)?.title : 'Select a position'}
              </Text>
              <Text style={{ color: C.black, fontSize: 16 }}>{positionsExpanded ? '▲' : '▼'}</Text>
            </Pressable>
            {positionsExpanded && openings.map(o => (
              <Pressable key={o.id} style={[S.modifierRow, jobOpeningId === o.id && S.modifierRowSelected]}
                onPress={() => { setJobOpeningId(o.id); setPositionsExpanded(false); }}>
                <View style={{ flex: 1 }}>
                  <Text style={S.modifierRowText}>{jobOpeningId === o.id ? '✓ ' : ''}{o.title}</Text>
                  <Text style={[S.cardSub, { fontSize: 12 }]}>{o.employment_type}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {openings && openings.length > 0 && (
          <>
            <Text style={[S.contentSectionTitle, { marginTop: 24 }]}>Apply Now</Text>
            <View style={S.contentAccentLine} />
            {!!jobOpeningId && (
              <Text style={[S.cardSub, { marginBottom: 8 }]}>
                Applying for: <Text style={{ fontWeight: '600' }}>{openings.find(o => o.id === jobOpeningId)?.title}</Text>
              </Text>
            )}

            <Text style={S.fieldLabel}>Full Name</Text>
            <TextInput style={S.input} value={fullName} onChangeText={setFullName} />

            <Text style={S.fieldLabel}>Email</Text>
            <TextInput style={S.input} value={email} onChangeText={handleEmailChange} keyboardType="email-address" autoCapitalize="none" />
            <EmailVerifyWidget email={email} purpose="careers" isVerified={verifiedEmail === email.trim().toLowerCase() && !!email.trim()}
              resetSignal={otpResetSignal} onVerified={(verified, token) => { setVerifiedEmail(verified); setVerificationToken(token); }} />

            <Text style={S.fieldLabel}>Phone</Text>
            <TextInput style={S.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

            <Text style={S.fieldLabel}>Availability (Days/Hours)</Text>
            <TextInput style={S.input} value={availability} onChangeText={setAvailability} placeholder="e.g. Weekday mornings, weekends" placeholderTextColor={C.muted} />

            <Text style={S.fieldLabel}>Why do you want to join Dasta?</Text>
            <TextInput style={[S.input, { height: 90 }]} value={whyJoin} onChangeText={setWhyJoin} multiline placeholderTextColor={C.muted} />

            <Pressable style={[S.btnSaffron, { marginTop: 20 }]} disabled={submitting} onPress={handleSubmit}>
              {submitting ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Submit Application</Text>}
            </Pressable>
          </>
        )}
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }}
    />
    </>
  );
}

// ── PROVIDE FEEDBACK / CONTACT (2026-09-18) ───────────────────
// Consolidated destination for the More screen's old separate "Contact
// Us" (opened dastacafe.com/contactpage-mobile in an in-app browser)
// and "Provide Feedback" (a bare mailto: link) entries. PC's 2026-09-18
// decision: there's no separate feedback destination on the site
// (/feedback 404s, isn't linked anywhere) -- Contact Us already serves
// that purpose, so the app now shows ONE "Provide Feedback" entry
// pointing here. Static info below matches dastacafe.com/contactpage;
// the "Send a Message" form now actually submits, via the new
// POST /contact/messages (routers/contact_router.py) -- the web form
// had the same action="#" dead-end problem this fixes.
function ContactScreen({ navigation, onHeaderBack }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [infoModal, setInfoModal] = useState(null); // {title, message, onOk}
  const showInfo = (title, message, onOk) => setInfoModal({ title, message, onOk });

  const [verifiedEmail, setVerifiedEmail] = useState(null);
  const [verificationToken, setVerificationToken] = useState(null);
  const [otpResetSignal, setOtpResetSignal] = useState(0);
  const handleEmailChange = (v) => {
    setEmail(v);
    if (verifiedEmail && v.trim().toLowerCase() !== verifiedEmail) {
      setVerifiedEmail(null); setVerificationToken(null); setOtpResetSignal(s => s + 1);
    }
  };

  const handleSubmit = async () => {
    if (!fullName.trim() || !email.trim() || !subject.trim() || !message.trim()) {
      showInfo('Missing Info', 'Please fill in your name, email, subject, and message.');
      return;
    }
    if (verifiedEmail !== email.trim().toLowerCase()) { showInfo('Verify your email', 'Please verify your email before submitting.'); return; }

    setSubmitting(true);
    const { ok, data } = await apiFetch('/contact/messages', {
      method: 'POST',
      body: {
        full_name: fullName.trim(), email: email.trim(), subject: subject.trim(), message: message.trim(), source: 'mobile',
        verification_token: verificationToken,
      },
    });
    setSubmitting(false);

    if (ok) {
      showInfo('Message Sent', 'Thanks for reaching out -- we\'ll get back to you soon.', () => {
        setFullName(''); setEmail(''); setSubject(''); setMessage('');
        setVerifiedEmail(null); setVerificationToken(null);
      });
    } else {
      showInfo('Couldn\'t Send', data?.detail || 'Something went wrong sending your message. Please try again.');
    }
  };

  return (
    <>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 260 }}>
      <StatusBar style="light" />
      <ContentScreenHeader title="Provide Feedback" navigation={navigation} onBack={onHeaderBack} />
      <View style={{ padding: 16 }}>
        <Text style={S.fieldLabel}>Your Name</Text>
        <TextInput style={S.input} value={fullName} onChangeText={setFullName} />

        <Text style={S.fieldLabel}>Email Address</Text>
        <TextInput style={S.input} value={email} onChangeText={handleEmailChange} keyboardType="email-address" autoCapitalize="none" />
        <EmailVerifyWidget email={email} purpose="contact" isVerified={verifiedEmail === email.trim().toLowerCase() && !!email.trim()}
          resetSignal={otpResetSignal} onVerified={(verified, token) => { setVerifiedEmail(verified); setVerificationToken(token); }} />

        <Text style={S.fieldLabel}>Subject</Text>
        <TextInput style={S.input} value={subject} onChangeText={setSubject} />

        <Text style={S.fieldLabel}>Message</Text>
        <TextInput style={[S.input, { height: 100 }]} value={message} onChangeText={setMessage} multiline />

        <Pressable style={[S.btnSaffron, { marginTop: 20 }]} disabled={submitting} onPress={handleSubmit}>
          {submitting ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Send Message</Text>}
        </Pressable>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }}
    />
    </>
  );
}

// ── PAIRING PANEL (2026-09-19) ─────────────────────────────────
// Extracted from the old standalone PairingScreen so the exact same
// card + business logic can be (a) shown as an inline page in
// OrderScreen's own dynamic swipe sequence (recommendation-swipe-
// navigation feature, PC confirmed 2026-09-19) and (b) still shown via
// the standalone screen below, which is now a thin wrapper kept alive
// only for the wide/tablet 2-up layout (that layout's own combinatorics
// for interleaving a variable number of pairing pages per side weren't
// part of this feature's spec -- flagging that scope boundary rather
// than silently redesigning the tablet layout too).
// craftingEnabled is a required prop, not fetched here, so the 3 inline
// instances OrderScreen mounts at once don't each redundantly hit
// GET /sip/build-config -- OrderScreen already fetches it once for its
// own Build & Order button.
function PairingPanel({ pairing, drink, drinkName, price, selectedSize, customer, source, navigation, craftingEnabled }) {
  const cart = useCart();
  const [addingCombo, setAddingCombo] = useState(false);
  const [addingFoodOnly, setAddingFoodOnly] = useState(false);
  const [addingDrinkOnly, setAddingDrinkOnly] = useState(false);
  const [building, setBuilding] = useState(false);
  const [infoModal, setInfoModal] = useState(null); // {title, message}
  const showInfo = (title, message) => setInfoModal({ title, message });

  // Build & Order gating (2026-09-19 fix, Sept 18 tester report) -- the
  // Combo and Drink Only buttons here never called craft-the-sip at all,
  // so a customer picking either for a not-yet-built custom sip got an
  // order with no pump counts/toppings/prep note. Mirrors OrderScreen's
  // own handleOrder exactly: same GET /sip/build-config kill switch
  // (passed down, see above), and (source === 'custom' only -- a
  // favorited Circle/Menu sip already has its build ticket via its
  // origin recipe, craft-the-sip 400s on anything else) craft AFTER the
  // cart-add, using the custom_drink_id that add returns. Deliberately
  // NOT gated on recipe_status the way FavoriteDetailModal's label is --
  // nowhere else in this app checks recipe_status before deciding
  // whether to craft; OrderScreen's own Build & Order (fresh generation
  // AND favorite reorder alike) always crafts unconditionally whenever
  // the source is 'custom', trusting craft-the-sip itself to be a safe
  // no-op on an already-'ready' recipe. Matching that same simpler,
  // already-proven convention here instead of inventing a new
  // not-ready/ready branch this codebase doesn't use anywhere else.
  const isCustomSource = source === 'custom';

  const drinkAmt   = price?.price || price?.price_breakdown?.final_price || 0;
  const foodAmt    = pairing?.pairing?.best_pairing?.price || 0;
  const regularAmt = drinkAmt + foodAmt;
  const discount   = pairing?.combo_discount ?? 1.25;
  const comboAmt   = regularAmt > 0 ? (regularAmt - discount) : 0;
  const best       = pairing?.pairing?.best_pairing;
  const name       = drinkName || drink?.creative?.custom_name || drink?.custom_drink?.drink_name || 'Custom Sip';

  // Real cart-add for "Order Food & Drink"/"Food Only" (2026-09-13 fix —
  // both buttons had NO onPress at all before, confirmed by reading this
  // screen; found while wiring circle/menu pairing in for PC's ask).
  // Mirrors orderComboWombo/orderFoodOnly exactly (find-my-drink_embed2.
  // html): drink leg added at full price first, then the food leg with
  // combo_discount_cents + pair_with_cart_item_id so checkout_router.py's
  // combo-pairing mechanism (not a client-computed discount) is what
  // actually prices it.
  const drinkPayloadForSource = () => {
    if (source === 'circle') {
      const circle = drink?.circle_pick;
      return {
        drink_source: 'circle',
        drink: { drink_name: circle?.drink_name, taste_description: circle?.taste_description || circle?.reason,
                 why_it_fits: circle?.reason, ingredients: circle?.ingredients || [], build_ticket: {} },
        original_drink_id: circle && !circle.is_fallback ? circle.custom_drink_id : null,
      };
    }
    if (source === 'menu') {
      const menu = drink?.menu_pick;
      return {
        drink_source: 'menu',
        drink: { drink_name: menu?.drink_name, taste_description: menu?.description, why_it_fits: menu?.reason, ingredients: [], build_ticket: {} },
        original_drink_id: menu?.drink_id || null,
      };
    }
    return { drink_source: 'custom', drink: drink?.custom_drink, original_drink_id: null };
  };

  // Craft the drink leg AFTER it's in the cart (2026-09-19 fix) -- same
  // cart-then-craft sequence as OrderScreen's own handleOrder, which
  // matches web's window.dastaBuildAndOrder exactly: the drink is
  // already safely in the cart either way, craft-the-sip only fills in
  // the kitchen ticket on top of that. Errors are swallowed the same way
  // OrderScreen's own call does -- a craft failure never blocks the
  // order that's already in the cart.
  const craftIfNeeded = async (customDrinkId) => {
    if (craftingEnabled && customDrinkId && isCustomSource) {
      // Same "Building Your Sip…" full-screen overlay OrderScreen's own
      // handleOrder shows during this exact call (2026-09-19 revision) --
      // the customer-facing "Build & Order" label is gone, but the real
      // multi-second wait it used to warn about is still happening here,
      // so the in-progress feedback stays.
      setBuilding(true);
      try { await apiFetch('/sip/craft-the-sip', { method: 'POST', body: { custom_drink_id: customDrinkId } }); } catch {}
      setBuilding(false);
    }
  };

  const handleOrderComboWombo = async () => {
    if (!best?.food_item_id) { showInfo('Error', 'Could not add this combo. Please try again.'); return; }
    setAddingCombo(true);
    try {
      const { drink_source, drink: drinkDict, original_drink_id } = drinkPayloadForSource();
      const drinkRes = await cart.addToCart({
        item_type: 'drink', drink_source: drink_source, drink: drinkDict, original_drink_id,
        size_oz: selectedSize, quantity: 1, unit_price_cents: Math.round(drinkAmt * 100),
      });
      if (!drinkRes.ok || !drinkRes.data?.success) { showInfo('Error', 'Could not add the full combo to your order.'); return; }
      await craftIfNeeded(drinkRes.data.custom_drink_id);
      const foodRes = await cart.addToCart({
        item_type: 'food', food_item_id: best.food_item_id, drink_name: best.food_name,
        description: best.pairing_reason || '', quantity: 1,
        unit_price_cents: Math.round(foodAmt * 100),
        combo_discount_cents: Math.round(discount * 100),
        pair_with_cart_item_id: drinkRes.data.cart_item_id,
      });
      if (foodRes.ok && foodRes.data?.success) {
        showInfo('Wombo Combo! 🎉', `${name} (${selectedSize}oz) + ${best.food_name} — $${comboAmt.toFixed(2)} added to your order!`);
        navigation.navigate('Cart', { customer });
      } else {
        showInfo('Error', 'Could not add the full combo to your order.');
      }
    } catch { showInfo('Error', 'Could not reach Dasta server.'); }
    finally { setAddingCombo(false); }
  };

  const handleOrderFoodOnly = async () => {
    if (!best?.food_item_id) { showInfo('Error', 'Could not add this food item. Please try again.'); return; }
    setAddingFoodOnly(true);
    try {
      const { ok, data } = await cart.addToCart({
        item_type: 'food', food_item_id: best.food_item_id, drink_name: best.food_name,
        description: best.pairing_reason || '', quantity: 1, unit_price_cents: Math.round(foodAmt * 100),
      });
      if (ok && data?.success) {
        showInfo('Added to Cart 🍽', `${best.food_name} — $${foodAmt.toFixed(2)} added to your order!`);
        navigation.navigate('Cart', { customer });
      } else {
        showInfo('Error', 'Could not add to your order.');
      }
    } catch { showInfo('Error', 'Could not reach Dasta server.'); }
    finally { setAddingFoodOnly(false); }
  };

  // "Drink Only" (2026-09-17, PC's ask) -- mirrors handleOrderFoodOnly
  // exactly, but for the drink leg instead of the food leg, so a customer
  // doesn't have to back out to the drink screen to order just the drink.
  const handleOrderDrinkOnly = async () => {
    setAddingDrinkOnly(true);
    try {
      const { drink_source, drink: drinkDict, original_drink_id } = drinkPayloadForSource();
      const { ok, data } = await cart.addToCart({
        item_type: 'drink', drink_source: drink_source, drink: drinkDict, original_drink_id,
        size_oz: selectedSize, quantity: 1, unit_price_cents: Math.round(drinkAmt * 100),
      });
      if (ok && data?.success) {
        await craftIfNeeded(data.custom_drink_id);
        showInfo('Added to Cart 🥤', `${name} (${selectedSize}oz) — $${drinkAmt.toFixed(2)} added to your order!`);
        navigation.navigate('Cart', { customer });
      } else {
        showInfo('Error', 'Could not add to your order.');
      }
    } catch { showInfo('Error', 'Could not reach Dasta server.'); }
    finally { setAddingDrinkOnly(false); }
  };

  return (
    <>
      {/* Pairing Card -- no own ScrollView/header here (2026-09-19): this
          panel is meant to sit inside a caller's own page (OrderScreen's
          per-page pager View, or PairingScreen's ScrollView below), same
          "plain View, outer ScrollView handles vertical overflow" pattern
          customSipPanel/circleSipPanel/menuSipPanel already use. */}
      <View style={S.pairingFullCard}>
        <Text style={S.pairingFullBadge}>RECOMMENDED PAIRING</Text>
        <Text style={S.pairingFullFood}>{best?.food_name}</Text>

        {/* Suppressed when the category is already a substring of the
            item's own name (2026-09-19, PC's live report: "Veggie Delight
            Panini" + a separate "PANINI" tag read as redundant) -- a
            general rule, not special-cased to Panini, so e.g. "Blueberry
            Muffin" + "MUFFIN" is hidden too but "Avocado Toast" + "TOAST"
            (if the name DIDN'T already contain the category word) would
            still show normally. */}
        {best?.food_category && !(best.food_name || '').toLowerCase().includes(best.food_category.toLowerCase()) ? (
          <Text style={S.pairingFullCategory}>{best.food_category}</Text>
        ) : null}

        <Text style={S.pairingFullWhy}>
          <Text style={{ color: C.saffron, fontWeight: '700' }}>✦ Why it pairs</Text>
          {'  —  '}{best?.pairing_reason}
        </Text>

        {/* Pricing breakdown */}
        <View style={S.pairingPriceBox}>
          <View style={S.pairingPriceLine}>
            <Text style={S.pairingPriceItem} numberOfLines={1}>{name} ({selectedSize}oz)</Text>
            <Text style={S.pairingPriceVal}>${drinkAmt.toFixed(2)}</Text>
          </View>
          <View style={S.pairingPriceLine}>
            <Text style={S.pairingPriceItem}>{best?.food_name}</Text>
            <Text style={S.pairingPriceVal}>${foodAmt.toFixed(2)}</Text>
          </View>
          <View style={S.pairingDivider} />
          <View style={S.pairingPriceLine}>
            <Text style={S.pairingPriceItem}>Regular total</Text>
            <Text style={[S.pairingPriceVal, { textDecorationLine: 'line-through', color: C.black }]}>
              ${regularAmt.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Wombo Combo Deal */}
        <View style={S.comboDealRow}>
          <View>
            <Text style={S.comboDealLabel}>Wombo Combo Deal!</Text>
            <Text style={S.comboSavings}>You saved ${discount.toFixed(2)}</Text>
          </View>
          <Text style={S.comboPrice}>${comboAmt.toFixed(2)}</Text>
        </View>

        {/* Personal note */}
        <View style={S.pairingNote}>
          <Text style={S.pairingNoteText}>
            Your mood, your brew. SipSense loved crafting{' '}
            <Text style={{ fontWeight: '700' }}>{name}</Text>
            {' '}just for you{customer ? `, ${customer.first_name}` : ''} — enjoy every sip!
          </Text>
        </View>

        {/* Order buttons -- plain "Order"-family wording always now
            (2026-09-19 revision, PC's call: "Build & Order" retired from
            every customer-facing label, confusing to show two different
            words for the same action depending on internal recipe state
            the customer can't see). Crafting for a not-yet-built custom
            sip still happens exactly as before, invisibly, via
            craftIfNeeded above -- see the "Building Your Sip…" overlay
            below for the in-progress feedback that replaces the old
            label as the wait signal. Food Only is unaffected either way. */}
        <Pressable style={({pressed})=>[S.btnSaffron,pressed&&{backgroundColor:"#c95722"}]}
          onPress={handleOrderComboWombo} disabled={addingCombo || addingFoodOnly || addingDrinkOnly}>
          {addingCombo ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>🛒 Order Food & Drink</Text>}
        </Pressable>
        <Pressable style={S.btnEspresso} onPress={handleOrderDrinkOnly} disabled={addingCombo || addingFoodOnly || addingDrinkOnly}>
          {addingDrinkOnly ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnEspressoText}>Order Drink Only</Text>}
        </Pressable>
        <Pressable style={S.btnEspresso} onPress={handleOrderFoodOnly} disabled={addingCombo || addingFoodOnly || addingDrinkOnly}>
          {addingFoodOnly ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnEspressoText}>Food Only</Text>}
        </Pressable>
      </View>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => setInfoModal(null)}
    />
    <BuildingSipOverlay visible={building} onStop={() => setBuilding(false)} />
    </>
  );
}

// ── PAIRING SCREEN (wide/tablet fallback only, 2026-09-19) ─────
// Kept alive as a standalone full-screen route ONLY for the wide/tablet
// 2-up sip pager (OrderScreen's isWideSip branch), which doesn't
// interleave pairing pages the way the phone-width dynamic swipe
// sequence now does -- see PairingPanel's own comment above for why.
// This is now a thin header-chrome wrapper around that shared panel,
// not a separate copy of its business logic.
function PairingScreen({ route, navigation }) {
  const { pairing, drink, drinkName, price, selectedSize, customer, source } = route?.params || {};
  const [craftingEnabled, setCraftingEnabled] = useState(false);
  useEffect(() => {
    apiFetch('/sip/build-config').then(({ ok, data }) => { if (ok) setCraftingEnabled(!!data?.crafting_enabled); });
  }, []);

  return (
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 48 }}>
      {/* Header */}
      {/* Both buttons moved below the wordmark, out of the top row
          (2026-09-15 fix, PC's live report) — same overlap-with-
          GlobalAccountHeader issue as OrderScreen's Start Over button;
          see that screen's own comment on this fix. */}
      {/* Buttons only, in a 44pt row -- same as the drink result banner
          (PC, 2026-10-01). */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => navigation.goBack()} style={({pressed})=>[S.startOverBtn,pressed&&{opacity:0.7}]}>
            <Text style={S.startOverText}>← My Drink</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate('StartNewDrink')}
            style={({pressed})=>[S.startOverBtn,{backgroundColor:'rgba(226,106,44,0.25)'},pressed&&{opacity:0.7}]}>
            <Text style={[S.startOverText,{color:C.gold}]}>✨ New Drink</Text>
          </Pressable>
        </View>
      </View>
      <PairingPanel
        pairing={pairing} drink={drink} drinkName={drinkName} price={price} selectedSize={selectedSize}
        customer={customer} source={source} navigation={navigation} craftingEnabled={craftingEnabled}
      />
    </ScrollView>
  );
}

// ── CART ──────────────────────────────────────────────────────
// Native rebuild of dastacafe.com's "Your Order" cart view — same
// GET/DELETE /checkout/cart(/items/{id}) this app's own new add-to-cart
// calls above already populate.
// Same label maps as your-order_embed2.html's YO_TEMP_MOD_LABELS/
// YO_SWEET_MOD_LABELS, ported verbatim.
const TEMP_MOD_LABELS  = { regular: 'Regular', extra_hot: 'Extra Hot', light_ice: 'Light Ice', extra_ice: 'Extra Ice' };
const SWEET_MOD_LABELS = { unsweetened: 'Unsweetened', light: 'Light', regular: 'Regular', extra: 'Extra' };

function CartScreen({ navigation, route }) {
  const customer = route?.params?.customer || null;
  const cart = useCart();
  const { groupOrder, setGroupOrder } = useGroupOrder();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [subtotal, setSubtotal] = useState(0);
  const [favBusy, setFavBusy] = useState(null); // cart_item_id currently toggling
  const [infoModal, setInfoModal] = useState(null); // {title, message}
  const showInfo = (title, message) => setInfoModal({ title, message });

  const load = async () => {
    setLoading(true);
    const { ok, data } = await apiFetch('/checkout/cart');
    if (ok && data?.success) { setItems(data.items || []); setSubtotal(data.subtotal_cents || 0); }
    setLoading(false);
  };
  // Re-sync the header badge with the server whenever the cart opens
  // (2026-10-01): a card checkout can empty the cart server-side after
  // the badge last refreshed, leaving it stuck at 1
  // over an empty cart.
  useEffect(() => { load(); cart?.refreshCounts?.(); }, []);

  const removeItem = async (id) => {
    const { ok } = await apiFetch(`/checkout/cart/items/${id}`, { method: 'DELETE' });
    if (ok) { load(); cart.refreshCounts(); }
  };

  // Branded confirmation (2026-09-14, PC's ask — same ConfirmModal as
  // Sign Out/Remove Card/Turn off Auto-reload) — was a plain OS
  // Alert.alert; the actual clear-cart call is unchanged.
  const [showClearCartConfirm, setShowClearCartConfirm] = useState(false);
  const clearCart = () => setShowClearCartConfirm(true);
  const confirmClearCart = async () => {
    const { ok } = await apiFetch('/checkout/cart', { method: 'DELETE' });
    if (ok) { load(); cart.refreshCounts(); }
  };

  // Quantity +/- (2026-09-13, PC's ask) — PATCH /checkout/cart/items/{id},
  // the same endpoint web's own quantity stepper uses. Re-derives price
  // server-side same as every other cart write in this app; never trusts
  // a client-computed total.
  const changeQuantity = async (it, delta) => {
    const next = it.quantity + delta;
    if (next < 1) { removeItem(it.id); return; }
    const { ok } = await apiFetch(`/checkout/cart/items/${it.id}`, { method: 'PATCH', body: { quantity: next } });
    if (ok) load();
  };

  const changeSize = async (it, oz) => {
    const { ok } = await apiFetch(`/checkout/cart/items/${it.id}/size`, { method: 'PATCH', body: { size_oz: oz } });
    if (ok) load();
  };

  const setModifier = async (it, temperature_modifier, sweetness_modifier) => {
    const { ok } = await apiFetch(`/checkout/cart/items/${it.id}/modifiers`, {
      method: 'PATCH', body: { temperature_modifier, sweetness_modifier },
    });
    if (ok) load();
  };

  // Favorite from cart (2026-09-13, PC's ask) — same POST /sip/toggle-
  // favorite every other favorite heart in this app uses, built from
  // whatever this cart line already carries (custom_drink_id for a real
  // drink, dasta_menu_item_id+selected_modifiers for a Dasta Menu item).
  // Food items have no favorite concept on the drink side of this
  // endpoint's fast path here, so the heart only renders for drinks.
  const toggleFavorite = async (it) => {
    if (!customer?.id) { showInfo('Sign In', 'Please sign in to save favorites.'); return; }
    setFavBusy(it.id);
    const body = it.custom_drink_id
      ? { customer_id: customer.id, custom_drink_id: it.custom_drink_id, drink_source: it.drink_source }
      : { customer_id: customer.id, drink_source: 'dasta_menu', item_type: 'drink',
          dasta_menu_item_id: it.dasta_menu_item_id, selected_modifiers: it.selected_modifiers,
          default_size: it.size_oz };
    const { ok, data } = await apiFetch('/sip/toggle-favorite', { method: 'POST', body });
    setFavBusy(null);
    if (ok && data?.success) {
      showInfo(data.is_favorite ? 'Saved to Favorites ⭐' : 'Removed from Favorites', it.drink_name);
    } else {
      showInfo('Error', data?.detail || 'Could not update favorites.');
    }
  };

  return (
    <>
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 120 }}>
      <StatusBar style="light" />
      {/* "Clear all" moved below the title row, out of the top row
          (2026-09-15 fix, PC's live report) — same overlap-with-
          GlobalAccountHeader issue as OrderScreen's Start Over button;
          see that screen's own comment on this fix. */}
      {/* Back-chevron removed (2026-09-23, PC's ask, app-wide audit) --
          Home tab is enough everywhere, arrow or not. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title={'🛒 Your Cart'} />
        {items.length > 0 && (
          <Pressable onPress={clearCart} style={{ marginTop: 10, alignSelf: 'flex-start' }}>
            <Text style={[S.linkText, { color: '#C0392B', marginTop: 0 }]}>Clear all</Text>
          </Pressable>
        )}
      </View>
      {!!groupOrder && (
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <GroupOrderBanner onCancel={() => {
            const go = groupOrder;
            setGroupOrder(null);
            if (go?.is_new) apiFetch(`/group-orders/${go.group_order_id}/discard`, { method: 'POST' });
          }} />
        </View>
      )}
      {loading ? (
        <ActivityIndicator color={C.saffron} size="large" style={{ marginTop: 40 }} />
      ) : items.length === 0 ? (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <Text style={S.cardSub}>Your cart is empty.</Text>
          <Pressable style={[S.btnSaffron, { marginTop: 16 }]} onPress={() => navigation.navigate('MainTabs', { initialTab: 'Menu' })}>
            <Text style={S.btnSaffronText}>Browse the Menu</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ padding: 16 }}>
          {items.map(it => {
            const isDastaMenu = it.drink_source === 'dasta_menu';
            const isDrink = it.item_type === 'drink';
            const tempValues = it.served_temperature === 'iced'
              ? ['light_ice', 'regular', 'extra_ice'] : ['regular', 'extra_hot'];
            return (
              <View key={it.id} style={[S.menuItemCard, { flexDirection: 'column', alignItems: 'stretch' }]}>
                <View style={{ flexDirection: 'row' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={S.menuItemName}>{it.drink_name}</Text>
                    {it.size_oz ? <Text style={S.menuItemDesc}>{it.size_oz}oz{it.served_temperature ? ` · ${it.served_temperature === 'iced' ? 'Iced' : 'Hot'}` : ''}</Text> : null}
                    <Text style={S.menuItemPrice}>${(it.line_total_cents / 100).toFixed(2)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 10 }}>
                    {isDrink && (
                      <Pressable onPress={() => toggleFavorite(it)} hitSlop={10} disabled={favBusy === it.id}
                        accessibilityRole="button" accessibilityLabel="Save to favorites">
                        {favBusy === it.id ? <ActivityIndicator size="small" color={C.saffron} /> : <Ionicons name="star-outline" size={20} color={C.muted} />}
                      </Pressable>
                    )}
                    <Pressable onPress={() => removeItem(it.id)} hitSlop={10}
                      accessibilityRole="button" accessibilityLabel="Remove item">
                      <Ionicons name="trash-outline" size={20} color={C.muted} />
                    </Pressable>
                  </View>
                </View>

                {/* Dasta Menu selected modifiers — read-only tags, locked in at the popup */}
                {isDastaMenu && it.selected_modifiers?.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {it.selected_modifiers.map((m, i) => (
                      <View key={i} style={S.dastaMenuModTag}>
                        <Text style={S.dastaMenuModTagText}>{m.name}{m.price_cents > 0 ? ` (+$${(m.price_cents / 100).toFixed(2)})` : ''}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Size pills — real drinks only, matches yoItemSizeHTML's own gate */}
                {isDrink && !isDastaMenu && (
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                    {[12, 16, 20].map(oz => (
                      <Pressable key={oz} onPress={() => changeSize(it, oz)}
                        style={[S.sizePill, it.size_oz === oz && S.sizePillActive]}>
                        <Text style={[S.sizePillText, it.size_oz === oz && S.sizePillTextActive]}>{oz}oz</Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {/* Temp/Sweetness pills — real drinks only, matches yoItemModifiersHTML's own gate */}
                {isDrink && !isDastaMenu && (
                  <View style={{ marginTop: 8, gap: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Text style={S.modRowLabel}>Temp</Text>
                      {tempValues.map(v => (
                        <Pressable key={v} onPress={() => setModifier(it, v, it.sweetness_modifier || 'regular')}
                          style={[S.sizePill, (it.temperature_modifier || 'regular') === v && S.sizePillActive]}>
                          <Text style={[S.sizePillText, (it.temperature_modifier || 'regular') === v && S.sizePillTextActive]}>{TEMP_MOD_LABELS[v]}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Text style={S.modRowLabel}>Sweet</Text>
                      {['unsweetened', 'light', 'regular', 'extra'].map(v => (
                        <Pressable key={v} onPress={() => setModifier(it, it.temperature_modifier || 'regular', v)}
                          style={[S.sizePill, (it.sweetness_modifier || 'regular') === v && S.sizePillActive]}>
                          <Text style={[S.sizePillText, (it.sweetness_modifier || 'regular') === v && S.sizePillTextActive]}>{SWEET_MOD_LABELS[v]}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}

                {/* Quantity stepper */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 }}>
                  <Pressable onPress={() => changeQuantity(it, -1)} style={S.qtyBtn}><Text style={S.qtyBtnText}>−</Text></Pressable>
                  <Text style={{ fontWeight: '700' }}>{it.quantity}</Text>
                  <Pressable onPress={() => changeQuantity(it, 1)} style={S.qtyBtn}><Text style={S.qtyBtnText}>+</Text></Pressable>
                </View>
              </View>
            );
          })}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingHorizontal: 4 }}>
            <Text style={S.secTitle}>Subtotal</Text>
            <Text style={S.secTitle}>${(subtotal / 100).toFixed(2)}</Text>
          </View>
          <Pressable style={[S.btnSaffron, { marginTop: 18 }]} onPress={() => navigation.navigate('Checkout', { customer })}>
            <Text style={S.btnSaffronText}>Checkout →</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
    <ConfirmModal
      visible={showClearCartConfirm}
      title="Clear cart?"
      message="This removes every item from your order."
      confirmLabel="Clear"
      onConfirm={confirmClearCart}
      onClose={() => setShowClearCartConfirm(false)}
    />
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => setInfoModal(null)}
    />
    </>
  );
}

// Checkout tip buttons (Clover, 2026-10-08): percent of the pre-tax order
// total after free drinks.
const CHECKOUT_TIP_PCTS = [10, 15, 20];
// Custom tip picker: two linked wheels, $ in $0.25 steps and % in 1%
// steps, from 0 with no upper limit; every value carries its own unit.
// The $ value is what's sent.
const TIP_WHEEL_USD_STEP = 25; // cents
const TIP_WHEEL_DRAG_PX = 20;  // swipe distance per step
const CHECKOUT_COMPACT_H = 72; // free drink / Dasta Card boxes and the tip picker
// % wheel: from a fractional % (set by the $ wheel) the first step lands on
// the next whole percent in that direction.
function stepTipPct(t, dir, base) {
  const pct = Math.max(0, dir > 0 ? Math.floor(t.pct) + 1 : Math.ceil(t.pct) - 1);
  return { pct, cents: Math.round(base * pct / 100) };
}
// $ wheel: off-step amounts (set by the % wheel) snap to the nearest $0.25
// in the direction turned.
function stepTipCents(t, dir, base) {
  const next = dir > 0
    ? Math.floor(t.cents / TIP_WHEEL_USD_STEP) * TIP_WHEEL_USD_STEP + TIP_WHEEL_USD_STEP
    : Math.ceil(t.cents / TIP_WHEEL_USD_STEP) * TIP_WHEEL_USD_STEP - TIP_WHEEL_USD_STEP;
  const cents = Math.max(0, next);
  return { cents, pct: base ? cents / base * 100 : 0 };
}
const tipPctLabel = (pct) => (Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`);

// One wheel of the tip picker, iOS time-picker style: a small grey value
// above (one step down), the selected value in the middle, a small grey
// value below (one step up). Swipe up/down to turn it a step at a time,
// or tap the value above/below. onDragging lets the screen stop its
// ScrollView from stealing the swipe.
function TipWheel({ above, value, below, onStep, onDragging, disabled, accessibilityLabel }) {
  const latest = useRef({});
  latest.current = { onStep, onDragging, disabled };
  const anchor = useRef(0);
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled,
    onMoveShouldSetPanResponder: () => !latest.current.disabled,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { anchor.current = 0; latest.current.onDragging?.(true); },
    onPanResponderMove: (_e, g) => {
      let d = anchor.current - g.dy; // swipe up = larger values
      while (d >= TIP_WHEEL_DRAG_PX) { latest.current.onStep(1); anchor.current -= TIP_WHEEL_DRAG_PX; d -= TIP_WHEEL_DRAG_PX; }
      while (d <= -TIP_WHEEL_DRAG_PX) { latest.current.onStep(-1); anchor.current += TIP_WHEEL_DRAG_PX; d += TIP_WHEEL_DRAG_PX; }
    },
    onPanResponderRelease: () => latest.current.onDragging?.(false),
    onPanResponderTerminate: () => latest.current.onDragging?.(false),
  })).current;
  const side = (dir, text) => (
    <Pressable onPress={() => onStep(dir)} disabled={disabled || text == null} hitSlop={4}
      style={{ height: 21, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: C.muted, fontSize: 11 }}>{text ?? ''}</Text>
    </Pressable>
  );
  return (
    <View {...responder.panHandlers} accessibilityRole="adjustable" accessibilityLabel={accessibilityLabel} accessibilityValue={{ text: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onStep(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      {side(-1, above)}
      <View style={{ height: 28, justifyContent: 'center' }}>
        <Text style={{ color: C.saffron, fontSize: 13, fontWeight: '700' }}>{value}</Text>
      </View>
      {side(1, below)}
    </View>
  );
}

// "VISA" / "visa" -> "Visa" for the collapsed new-card row.
const CARD_BRAND_LABELS = { visa: 'Visa', mastercard: 'Mastercard', mc: 'Mastercard', amex: 'Amex', american_express: 'Amex', americanexpress: 'Amex', discover: 'Discover' };
function cardBrandLabel(brand) {
  if (!brand) return 'Card';
  const k = String(brand).toLowerCase().replace(/\s+/g, '_');
  return CARD_BRAND_LABELS[k] || CARD_BRAND_LABELS[k.replace(/_/g, '')] || `${k[0].toUpperCase()}${k.slice(1).replace(/_/g, ' ')}`;
}

// ── CHECKOUT ──────────────────────────────────────────────────
// Native rebuild of your-order_embed3.html's Payment step — same
// GET /checkout/summary + POST /checkout/confirm contract. Everything is
// chosen on this one screen (no popups after Pay): a saved card is charged
// by /checkout/confirm itself; a new card is entered inline (Clover card
// fields, tokenized by "Use this card") and charged right after via
// POST /payments/clover/confirm. A free-drinks/Dasta-Card-only order
// never takes a card at all, exactly like web.
function CheckoutScreen({ navigation, route, onHeaderBack }) {
  const customer = route?.params?.customer || null;
  const cart = useCart();
  const payWithCard = usePayWithCard();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [voucherCount, setVoucherCount] = useState(0);
  const [useWallet, setUseWallet] = useState(false);
  const [pickupName, setPickupName] = useState(customer?.first_name || '');
  const [paying, setPaying] = useState(false);
  const [infoModal, setInfoModal] = useState(null); // {title, message, onOk}
  const showInfo = (title, message, onOk) => setInfoModal({ title, message, onOk });
  // Pickup ASAP/Schedule (2026-09-13, PC's ask) -- same yoSetPickupType/
  // pickup_slots contract as your-order_embed1.html: ASAP defaults on,
  // unless the store's already closed (is_open_now false), matching web's
  // own init ("!d.is_open_now ... scheduledTime = pickup_slots[0]").
  const [pickupType, setPickupType] = useState('asap');
  const [scheduledTime, setScheduledTime] = useState(null);
  const [slotsOpen, setSlotsOpen] = useState(false); // inline pickup-time drop-down
  // Have a gift card? (2026-09-13, PC's ask) -- same POST /checkout/confirm
  // gift_card_number/gift_card_redeem_code fields checkout_router.py's
  // _redeem_gift_card-at-checkout branch already accepts; nothing new
  // server-side, just never wired up on mobile.
  const [giftCardOpen, setGiftCardOpen] = useState(false);
  const [giftCardNumber, setGiftCardNumber] = useState('');
  const [giftCardCode, setGiftCardCode] = useState('');
  const clientRequestId = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
  // Pay with (Clover, 2026-10-08) -- your-order_embed1.html's "Charge
  // remainder to": a saved card's card_ref, or 'new' for a card entered
  // inline below.
  const [selectedTender, setSelectedTender] = useState('new');
  // Inline new card: CloverCardFields until "Use this card" tokenizes it,
  // then {token, card} (shown collapsed). cardFieldsKey remounts empty fields.
  const cardFieldsRef = useRef(null);
  const [cardFieldsKey, setCardFieldsKey] = useState(0);
  const [cardFieldsReady, setCardFieldsReady] = useState(false);
  const [newCard, setNewCard] = useState(null); // {token, card}
  const [tokenizing, setTokenizing] = useState(false);
  const [saveNewCard, setSaveNewCard] = useState(false);
  const [cardError, setCardError] = useState('');
  const [payError, setPayError] = useState('');
  const [payLocked, setPayLocked] = useState(false); // 409: an earlier Pay is still being charged
  // Tip (inline, Clover 2026-10-08): 0 (No tip) | 10 | 15 | 20 | 'custom'.
  // Custom is two linked dials, {pct, cents}; cents is what's sent.
  const [tipChoice, setTipChoice] = useState(10);
  const [customTip, setCustomTip] = useState({ pct: 10, cents: 0 });
  const [dialDragging, setDialDragging] = useState(false);
  // Gift card fields kept above the keyboard (see focusGiftField).
  const scrollRef = useRef(null);
  const scrollY = useRef(0);
  const contentY = useRef(0);   // padded content View's y in the ScrollView
  const giftBlockY = useRef(0); // gift card block's y in that View
  const giftBlockRef = useRef(null);
  const giftCodeRef = useRef(null);
  const giftFocused = useRef(false);
  // My Circles group order (2026-09-27) -- when set, pickup is the group's
  // shared time (no ASAP/schedule choice) and group_order_id rides along
  // with /checkout/confirm, which re-checks the join cutoff server-side.
  const { groupOrder, setGroupOrder } = useGroupOrder();

  // Safety net (2026-10-01, PC's live report): paying outside group mode
  // while one of the customer's Circles has a group order still taking
  // joins -- ask first, since the cart may be meant for it (e.g. the group
  // context was lost to a sign-out). Soonest cutoff wins if there are
  // several. "Order separately" is remembered for this checkout only.
  const [groupOffer, setGroupOffer] = useState(null);
  const [groupOfferOpen, setGroupOfferOpen] = useState(false);
  const groupOfferDeclined = useRef(false);
  useEffect(() => {
    if (groupOrder || !customer) return;
    let cancelled = false;
    (async () => {
      const { ok, data } = await apiFetch('/circles');
      if (cancelled || !ok || !data?.success) return;
      const now = new Date();
      const open = (data.circles || [])
        .filter(c => c.status === 'active')
        .flatMap(c => (c.live_group_orders || []).map(g => ({ ...g, circle_display_name: c.display_name })))
        .filter(g => new Date(g.join_cutoff_at) > now)
        .sort((a, b) => new Date(a.join_cutoff_at) - new Date(b.join_cutoff_at));
      setGroupOffer(open[0] || null);
    })();
    return () => { cancelled = true; };
  }, [groupOrder, customer?.id]);

  const joinOfferedGroup = async () => {
    const g = groupOffer;
    setGroupOfferOpen(false);
    setPaying(true);
    const { ok, data } = await apiFetch(`/group-orders/${g.group_order_id}/join`, { method: 'POST' });
    if (!ok || !data?.success) {
      setPaying(false);
      setGroupOffer(null);
      showInfo("Can't join", data?.detail || 'That group order is no longer taking joins.');
      return;
    }
    const go = { group_order_id: g.group_order_id, circle_display_name: g.circle_display_name,
      pickup_time: data.pickup_time, join_cutoff_at: data.join_cutoff_at, is_starter: g.started_by_me,
      is_new: g.status === 'pending' };
    setGroupOrder(go);
    setPaying(false);
    handlePay(go);
  };

  const leaveGroupCheckout = async () => {
    const go = groupOrder;
    setGroupOrder(null);
    // Backing out of a brand-new group order before paying -- nobody else has seen it yet.
    if (go?.is_new) apiFetch(`/group-orders/${go.group_order_id}/discard`, { method: 'POST' });
  };

  // Where to land after a successful payment: the group order itself
  // (clearing the in-progress context), or Home for an ordinary order.
  const afterPaid = (title, message, goOverride) => {
    const go = goOverride || groupOrder;
    if (go) {
      setGroupOrder(null);
      const openDetails = () => navigation.navigate('JoinGroupOrder', { group_order_id: go.group_order_id, justPaid: true, refreshKey: Date.now() });
      if (go.is_new) {
        // Instructions §3: "Order Details", not "View Group Order".
        setInfoModal({ title: 'You started a group order 🎉',
          message: `${go.circle_display_name} is being notified now. Pickup at ${formatLocalTime(go.pickup_time)}; cutoff time ${formatLocalTime(go.join_cutoff_at)}.\n\n${GROUP_HOLD_NOTE(go.join_cutoff_at)}`,
          buttonLabel: 'Order Details', onOk: openDetails });
      } else {
        setInfoModal({ title: 'Group order updated 🎉',
          message: `You're in the group order for ${go.circle_display_name}. Pickup at ${formatLocalTime(go.pickup_time)}.\n\n${GROUP_HOLD_NOTE(go.join_cutoff_at)}`,
          buttonLabel: 'Order Details', onOk: openDetails });
      }
      return;
    }
    showInfo(title, message, () => navigation.navigate('MainTabs', { initialTab: 'Home' }));
  };

  // A saved card's ref: card_ref, or the older stripe_pm_id name for the
  // same Clover card ref until the API drops it.
  const cardRefOf = (c) => c.card_ref || c.stripe_pm_id;
  // Same default as web: summary.default_tender, else the first saved card,
  // else a new card.
  const defaultTender = (s) => {
    const cards = s.saved_cards || [];
    if (s.default_tender && cards.some(c => cardRefOf(c) === s.default_tender)) return s.default_tender;
    return cards[0] ? cardRefOf(cards[0]) : 'new';
  };

  const load = async () => {
    setLoading(true);
    const { ok, data } = await apiFetch('/checkout/summary');
    if (ok && data?.success) {
      setSummary(data);
      setVoucherCount(data.voucher_default_count || 0);
      setUseWallet(!!data.wallet?.default_checked);
      setSelectedTender(defaultTender(data));
      if (!data.is_open_now && data.pickup_slots?.length) {
        setPickupType('scheduled');
        setScheduledTime(data.pickup_slots[0]);
      }
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Pickup slots: "Fri 2:00 PM" on the button; in the drop-down, a day
  // header (Today / Tomorrow / "Sat Oct 11") over "2:00 PM" rows.
  const slotTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const slotButtonLabel = (iso) => `${new Date(iso).toLocaleDateString('en-US', { weekday: 'short' })} ${slotTime(iso)}`;
  const slotDayLabel = (iso) => {
    const d = new Date(iso), today = new Date();
    const dayDiff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
    if (dayDiff === 0) return 'Today';
    if (dayDiff === 1) return 'Tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  };
  const slotGroups = (summary?.pickup_slots || []).reduce((groups, iso) => {
    const day = slotDayLabel(iso);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.slots.push(iso); else groups.push({ day, slots: [iso] });
    return groups;
  }, []);

  // Multi-voucher fix (2026-09-13, PC's live report) -- total_cents_with_
  // voucher/tax_cents_with_voucher are a fixed count=1 preview (see
  // get_checkout_summary's own "with_idx = min(1, max_vouchers_applicable)"
  // comment) and never move as the stepper changes past 1. The real,
  // per-count numbers live in summary.voucher_previews[count] — the same
  // array web's own checkout indexes into (your-order_embed1.html's
  // yoRenderCheckout: "const idx = ...; const preview = s.voucher_previews[idx]").
  const voucherPreview = summary?.voucher_previews?.[voucherCount] ?? summary?.voucher_previews?.[0];
  const totalCents = voucherPreview?.total_cents ?? summary?.total_cents_no_voucher;
  const taxCents = voucherPreview?.tax_cents ?? summary?.tax_cents_no_voucher;
  // Tip + remainder, as web's yoComputeWaterfall: the tip is a percent of
  // the pre-tax subtotal BEFORE free-drink discounts (items at full price),
  // so a free drink still gets a tip; it's added on top of the order, then
  // Dasta Card covers what it can and a card pays the rest.
  const tipsOn = !!summary?.tips_enabled;
  const tipBaseCents = summary?.subtotal_cents || 0;
  const freeDrinkCents = voucherCount > 0 ? (voucherPreview?.discount_cents || 0) : 0;
  const tipFor = (pct) => Math.round(tipBaseCents * pct / 100);
  const tipCents = !tipsOn ? 0 : tipChoice !== 'custom' ? tipFor(tipChoice) : customTip.cents;
  const tipOverBase = tipCents > tipBaseCents; // a note only; Pay still works
  const tipPctNow = tipChoice === 'custom' ? customTip.pct : tipChoice;
  const orderTotalCents = (totalCents || 0) + tipCents;
  const walletApplied = useWallet && summary?.wallet && orderTotalCents > 0
    ? Math.min(summary.wallet.total_cents || 0, orderTotalCents) : 0;
  const cardAmountCents = orderTotalCents - walletApplied;
  const fmt = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;
  // The custom picker always opens at 10%. If the base changes, keep the %
  // and recompute the $.
  const tipBaseRef = useRef(tipBaseCents);
  tipBaseRef.current = tipBaseCents;
  const chooseTip = (val) => {
    if (val === 'custom' && tipChoice !== 'custom') setCustomTip({ pct: 10, cents: tipFor(10) });
    setTipChoice(val); setPayError('');
  };
  useEffect(() => {
    setCustomTip(t => {
      const cents = Math.round(tipBaseCents * t.pct / 100);
      return cents === t.cents ? t : { ...t, cents };
    });
  }, [tipBaseCents]);
  const stepPctWheel = (dir) => setCustomTip(t => stepTipPct(t, dir, tipBaseRef.current));
  const stepUsdWheel = (dir) => setCustomTip(t => stepTipCents(t, dir, tipBaseRef.current));

  // Gift card fields: scroll the whole block (both fields) above the
  // keyboard on focus, then once more if the real keyboard still covers it.
  const focusGiftField = () => {
    giftFocused.current = true;
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, contentY.current + giftBlockY.current - 24), animated: true });
    }, 250);
  };
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', (e) => {
      if (!giftFocused.current || !giftBlockRef.current) return;
      const kbTop = e.endCoordinates.screenY;
      giftBlockRef.current.measureInWindow((_x, y, _w, h) => {
        const overlap = y + h + 16 - kbTop;
        if (overlap > 0) scrollRef.current?.scrollTo({ y: scrollY.current + overlap, animated: true });
      });
    });
    return () => sub.remove();
  }, []);

  // "Use this card": tokenize the inline fields and collapse them.
  const tokenizeNewCard = async () => {
    if (!cardFieldsRef.current) return null;
    setTokenizing(true); setCardError('');
    const t = await cardFieldsRef.current.tokenize();
    setTokenizing(false);
    if (!t.ok) { setCardError(t.error || 'Please check your card details.'); return null; }
    const nc = { token: t.token, card: t.card };
    setNewCard(nc);
    return nc;
  };
  // "Change" (or a decline): back to empty fields.
  const reopenCardFields = () => {
    setNewCard(null); setCardFieldsReady(false); setCardFieldsKey(k => k + 1);
  };

  // goOverride: the group order just joined from the safety-net prompt
  // (the context update hasn't re-rendered yet).
  const handlePay = async (goOverride) => {
    const go = goOverride?.group_order_id ? goOverride : groupOrder;
    if (!go && pickupType === 'scheduled' && !scheduledTime) { setPayError('Please choose a pickup time.'); return; }
    if ((giftCardNumber.trim() || giftCardCode.trim()) && !(giftCardNumber.trim() && giftCardCode.trim())) {
      setPayError('Please enter both the gift card number and its redemption code.');
      return;
    }
    // A new card must be entered before Pay; if the fields are filled in
    // but "Use this card" wasn't tapped, tokenize them now.
    let card = selectedTender === 'new' ? newCard : null;
    if (cardAmountCents > 0 && selectedTender === 'new' && !card) {
      if (!cardFieldsReady) { setPayError('Enter your card details above.'); return; }
      setPaying(true); setPayError('');
      card = await tokenizeNewCard();
      setPaying(false);
      if (!card) { setPayError('Please check your card details above.'); return; }
    }
    if (!go && groupOffer && !groupOfferDeclined.current) { setGroupOfferOpen(true); return; }
    setPaying(true); setPayError('');
    try {
      const { ok, data } = await apiFetch('/checkout/confirm', {
        method: 'POST',
        body: {
          ...(go
            ? { pickup_type: 'scheduled', scheduled_time: go.pickup_time, group_order_id: go.group_order_id }
            : { pickup_type: pickupType, scheduled_time: pickupType === 'scheduled' ? scheduledTime : undefined }),
          voucher_count: voucherCount, use_wallet: useWallet,
          pickup_name: pickupName || undefined, client_request_id: clientRequestId.current,
          gift_card_number: giftCardNumber.trim() || undefined,
          gift_card_redeem_code: giftCardCode.trim() || undefined,
          // A saved card is charged server-side right away; left out for a
          // new card, which is charged next via /payments/clover/confirm.
          card_ref: selectedTender !== 'new' ? selectedTender : undefined,
          tip_cents: tipCents,
        },
      });
      if (!ok) { setPayError(data?.detail || 'Could not place your order.'); return; }
      if (data.status === 'confirmed') {
        cart.refreshCounts();
        // onOk defers the navigate() until the InfoModal is dismissed --
        // this screen is unmounted the instant activeTab changes away
        // (CheckoutScreen isn't one of MainTabs' kept-mounted screens),
        // which would otherwise kill the modal before it's ever read.
        afterPaid('Order Placed! ☕', 'Your order has been confirmed.', go);
        return;
      }
      // The cart may be cleared server-side a moment after the payment
      // reports success -- check again shortly after.
      const paid = () => {
        cart.refreshCounts();
        setTimeout(() => cart.refreshCounts(), 2500);
        setTimeout(() => cart.refreshCounts(), 6000);
        afterPaid('Order Placed! ☕', 'Payment received — your order is confirmed.', go);
      };
      // Saved card charged (or, for a group order, authorized) server-side
      // -- nothing left for the customer to do.
      if (data.payment_status === 'succeeded' || data.payment_status === 'requires_capture') { paid(); return; }
      if (data.clover && data.payment_ref) {
        // New card entered above: charge it now, no card sheet. Success also
        // covers status authorized (a group-order hold).
        if (card) {
          const res = await apiFetch('/payments/clover/confirm', {
            method: 'POST',
            body: { payment_ref: data.payment_ref, token: card.token, card: card.card, save_card: saveNewCard },
            timeoutMs: 45000,
          });
          if (res.ok && res.data?.success) { paid(); return; }
          if (res.status === 409) {
            setPayLocked(true);
            setPayError(`${res.data?.detail || 'This payment is already being processed.'} Check your order history in a minute.`);
            return;
          }
          // Declined or expired token: fresh fields, Pay again (same
          // client_request_id, so it's still the same order).
          reopenCardFields();
          setPayError(res.data?.detail || (res.networkError
            ? "We couldn't reach Dasta to confirm your payment. Please check your connection and try again."
            : 'Your card could not be charged. Please re-enter it and try again.'));
          return;
        }
        // No card entered here (e.g. Dasta Card or a gift card looked like
        // enough, but the server still wants a card) -- fall back to the sheet.
        const result = await payWithCard(data);
        if (result.canceled) return;
        if (!result.ok) { setPayError(result.error || 'Could not complete payment.'); return; }
        paid();
        return;
      }
      setPayError(data.detail || 'Could not start your payment. Please try again.');
    } catch { setPayError('Could not reach Dasta server.'); }
    finally { setPaying(false); }
  };

  if (loading || !summary) {
    return <View style={[S.screen, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={C.saffron} size="large" /></View>;
  }

  return (
    <>
    {/* iOS: the ScrollView insets itself for the keyboard
        (automaticallyAdjustKeyboardInsets), so no KeyboardAvoidingView
        padding on top of it. Android: 'height' with app.json's
        softwareKeyboardLayoutMode "resize". */}
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
    <ScrollView ref={scrollRef} style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 60 }}
      automaticallyAdjustKeyboardInsets scrollEnabled={!dialDragging}
      onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}>
      <StatusBar style="light" />
      {/* Back-chevron removed (2026-09-23, PC's ask, app-wide audit) --
          Home tab is enough everywhere, arrow or not. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title="Checkout" onBack={onHeaderBack} />
      </View>

      <View style={{ padding: 16 }} onLayout={(e) => { contentY.current = e.nativeEvent.layout.y; }}>
        <GroupOrderBanner onCancel={leaveGroupCheckout} />
        {/* Order Items (2026-09-19, PC's live report) -- checkout used to
            jump straight to Subtotal/Tax/Total with no line items at all.
            Web has the same gap, but it's less noticeable there since Cart
            and Checkout can both be on screen together; mobile only ever
            shows one screen at a time, so the customer had no way to see
            WHAT they were paying for on this screen. Backend already
            returns this exact itemized breakdown (GET /checkout/summary's
            `items`) -- this was a rendering gap only, no new endpoint
            needed. Read-only here (no qty/remove controls -- that's Cart's
            job), same name/size/price styling as CartScreen's own rows. */}
        {(summary.items || []).length > 0 && (
          <View style={{ marginBottom: 4 }}>
            <Text style={S.fieldLabel}>Order Items</Text>
            {summary.items.map(it => (
              <View key={it.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={S.menuItemName}>{it.quantity > 1 ? `${it.quantity}× ` : ''}{it.drink_name}</Text>
                  {it.size_oz ? (
                    <Text style={S.menuItemDesc}>{it.size_oz}oz{it.served_temperature ? ` · ${it.served_temperature === 'iced' ? 'Iced' : 'Hot'}` : ''}</Text>
                  ) : null}
                </View>
                <Text style={S.menuItemPrice}>${(it.line_total_cents / 100).toFixed(2)}</Text>
              </View>
            ))}
          </View>
        )}

        {!customer?.first_name && (
          <>
            <Text style={S.fieldLabel}>Name for this order</Text>
            <TextInput style={S.input} value={pickupName} onChangeText={setPickupName} placeholder="Your name" placeholderTextColor={C.muted} />
          </>
        )}

        {/* Free drinks and Dasta Card side by side, same compact height. */}
        {(summary.available_vouchers > 0 || summary.wallet?.total_cents > 0) && (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            {summary.available_vouchers > 0 && (() => {
              const max = summary.max_vouchers_applicable || 0;
              const canDown = voucherCount > 0, canUp = voucherCount < max;
              return (
                <View style={[S.checkoutHalfBox, { justifyContent: 'space-between' }]}>
                  <Text style={S.checkoutHalfTitle} numberOfLines={1}>Free Drink(s)</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Pressable onPress={() => setVoucherCount(c => Math.max(0, c - 1))} disabled={!canDown || paying}
                      accessibilityLabel="One fewer free drink" style={[S.qtyBtn, !canDown && { opacity: 0.35 }]}><Text style={S.qtyBtnText}>−</Text></Pressable>
                    <Text style={{ fontWeight: '700', color: C.charcoal, minWidth: 14, textAlign: 'center' }}>{voucherCount}</Text>
                    <Pressable onPress={() => setVoucherCount(c => Math.min(max, c + 1))} disabled={!canUp || paying}
                      accessibilityLabel="One more free drink" style={[S.qtyBtn, !canUp && { opacity: 0.35 }]}><Text style={S.qtyBtnText}>+</Text></Pressable>
                  </View>
                </View>
              );
            })()}
            {summary.wallet?.total_cents > 0 && (
              <Pressable style={[S.checkoutHalfBox, { justifyContent: 'space-between' }]} onPress={() => setUseWallet(v => !v)} disabled={paying}
                accessibilityRole="switch" accessibilityState={{ checked: useWallet }}>
                <Text style={S.checkoutHalfTitle} numberOfLines={1}>Use Dasta Card</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.black, fontSize: 13 }}>{fmt(summary.wallet.total_cents)}</Text>
                  <Switch value={useWallet} onValueChange={setUseWallet} disabled={paying} trackColor={{ false: C.muted, true: C.saffron }} ios_backgroundColor={C.muted} thumbColor={C.white} />
                </View>
              </Pressable>
            )}
          </View>
        )}

        {/* Pay with -- shown whenever free drinks and Dasta Card leave
            something to pay, same rule as web's "Charge remainder to". */}
        {cardAmountCents > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={S.fieldLabel}>Pay with</Text>
            <View style={{ backgroundColor: C.white, borderRadius: 10, overflow: 'hidden' }}>
              {[...(summary.saved_cards || []).map(c => ({ value: cardRefOf(c), label: c.display })),
                { value: 'new', label: 'Use a new card' }].map((t, i) => {
                const on = selectedTender === t.value;
                return (
                  <Pressable key={t.value} disabled={paying} onPress={() => { if (t.value === 'new' && selectedTender !== 'new') setCardFieldsReady(false); setSelectedTender(t.value); setPayError(''); }}
                    accessibilityRole="radio" accessibilityState={{ checked: on }}
                    style={[S.profileMenuRow, { gap: 10 }, i > 0 && { borderTopWidth: 1, borderTopColor: C.border }]}>
                    <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? C.saffron : C.muted} />
                    <Text style={[S.profileMenuRowText, { flex: 1 }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
              {selectedTender === 'new' && (
                <View style={{ paddingHorizontal: 16, paddingBottom: 14, borderTopWidth: 1, borderTopColor: C.border }}>
                  {newCard ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 12 }}>
                      <Ionicons name="card-outline" size={20} color={C.saffron} />
                      <Text style={[S.profileMenuRowText, { flex: 1 }]}>
                        {cardBrandLabel(newCard.card?.brand)} •••• {newCard.card?.last4 || '····'} (new card)
                      </Text>
                      <Pressable onPress={reopenCardFields} disabled={paying} hitSlop={8}>
                        <Text style={[S.linkText, { marginTop: 0 }]}>Change</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <>
                      <CloverCardFields key={cardFieldsKey} ref={cardFieldsRef} onReady={() => setCardFieldsReady(true)} />
                      <Pressable style={[S.btnSaffron, { marginTop: 10, marginBottom: 0 }, (!cardFieldsReady || tokenizing || paying) && { opacity: 0.6 }]}
                        disabled={!cardFieldsReady || tokenizing || paying} onPress={() => { setPayError(''); tokenizeNewCard(); }}>
                        {tokenizing ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Use this card</Text>}
                      </Pressable>
                    </>
                  )}
                  {!!cardError && !newCard && <Text style={{ color: '#C0392B', marginTop: 8 }}>{cardError}</Text>}
                  <Pressable disabled={paying} onPress={() => setSaveNewCard(v => !v)}
                    accessibilityRole="checkbox" accessibilityState={{ checked: saveNewCard }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12 }}>
                    <Ionicons name={saveNewCard ? 'checkbox' : 'square-outline'} size={20} color={saveNewCard ? C.saffron : C.muted} />
                    <Text style={S.profileMenuRowText}>Save this card for next time</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Add a tip -- inline (no popup). Percent of the pre-tax order
            total after free drinks; exactly one choice, 10% to start. One
            row of five compact buttons (fits a 360dp-wide phone). */}
        {tipsOn && (
          <View style={{ marginTop: 16 }}>
            <Text style={S.fieldLabel}>Add a tip</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {[{ val: 0, label: 'No tip' },
                ...CHECKOUT_TIP_PCTS.map(p => ({ val: p, label: `${p}%` })),
                { val: 'custom', label: 'Custom' }].map(o => {
                const on = tipChoice === o.val;
                return (
                  <Pressable key={String(o.val)} disabled={paying} onPress={() => chooseTip(o.val)}
                    accessibilityRole="radio" accessibilityState={{ checked: on }}
                    style={{ flex: 1, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                      paddingHorizontal: 2, borderWidth: 1.5, borderColor: on ? C.saffron : C.border, backgroundColor: on ? C.saffron : C.white }}>
                    <Text style={{ color: on ? C.white : C.charcoal, fontSize: 13, fontWeight: '700' }} numberOfLines={1} adjustsFontSizeToFit>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {tipChoice === 'custom' && (
              <View style={{ height: CHECKOUT_COMPACT_H, marginTop: 10, flexDirection: 'row', borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.white, overflow: 'hidden' }}>
                {/* Selection band across the middle, behind both wheels. */}
                <View pointerEvents="none" style={{ position: 'absolute', left: 6, right: 6, top: (CHECKOUT_COMPACT_H - 2 - 28) / 2, height: 28,
                  borderRadius: 8, borderWidth: 1, borderColor: C.saffron, backgroundColor: '#FDEDE3' }} />
                <TipWheel accessibilityLabel="tip amount" disabled={paying} onStep={stepUsdWheel} onDragging={setDialDragging}
                  above={customTip.cents > 0 ? fmt(stepTipCents(customTip, -1, tipBaseCents).cents) : null}
                  value={fmt(customTip.cents)}
                  below={fmt(stepTipCents(customTip, 1, tipBaseCents).cents)} />
                <TipWheel accessibilityLabel="tip percent" disabled={paying} onStep={stepPctWheel} onDragging={setDialDragging}
                  above={customTip.pct > 0 ? tipPctLabel(stepTipPct(customTip, -1, tipBaseCents).pct) : null}
                  value={tipPctLabel(customTip.pct)}
                  below={tipPctLabel(stepTipPct(customTip, 1, tipBaseCents).pct)} />
              </View>
            )}
            {tipOverBase && <Text style={{ color: C.saffron, fontSize: 12, marginTop: 6 }}>The tip is more than the order itself</Text>}
          </View>
        )}

        {groupOrder ? (
          <>
            <Text style={[S.fieldLabel, { marginTop: 16 }]}>Pickup</Text>
            <Text style={S.cardSub}>{formatLocalTime(groupOrder.pickup_time)}, together with your Circle</Text>
          </>
        ) : (<>
        <Text style={[S.fieldLabel, { marginTop: 16 }]}>When would you like it?</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            disabled={summary.is_open_now === false}
            style={[S.pickupPill, pickupType === 'asap' && S.pickupPillActive, summary.is_open_now === false && S.pickupPillDisabled]}
            onPress={() => { setPickupType('asap'); setSlotsOpen(false); }}>
            <Text style={[S.pickupPillText, pickupType === 'asap' && S.pickupPillTextActive]} numberOfLines={1} adjustsFontSizeToFit>
              {summary.is_open_now !== false ? 'ASAP · in 10–15 min' : 'ASAP (7am–7pm daily)'}
            </Text>
          </Pressable>
          <Pressable style={[S.pickupPill, pickupType === 'scheduled' && S.pickupPillActive]} onPress={() => setSlotsOpen(v => !v)}
            accessibilityState={{ expanded: slotsOpen }}>
            <Text style={[S.pickupPillText, pickupType === 'scheduled' && S.pickupPillTextActive]} numberOfLines={1} adjustsFontSizeToFit>
              {pickupType === 'scheduled' && scheduledTime ? `Pick up at ${slotButtonLabel(scheduledTime)} ▾` : 'Schedule for later'}
            </Text>
          </Pressable>
        </View>
        {slotsOpen && (
          <View style={{ marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.white, overflow: 'hidden' }}>
            <RNScrollView style={{ maxHeight: 5 * 40 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {slotGroups.length === 0 && (
                <Text style={{ color: C.black, fontSize: 13, padding: 12 }}>No pickup times available right now.</Text>
              )}
              {slotGroups.map(g => (
                <View key={g.day}>
                  <Text style={{ color: C.charcoal, fontSize: 12, fontWeight: '700', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, backgroundColor: C.ivory }}>{g.day}</Text>
                  {g.slots.map(iso => {
                    const on = pickupType === 'scheduled' && scheduledTime === iso;
                    return (
                      <Pressable key={iso} onPress={() => { setScheduledTime(iso); setPickupType('scheduled'); setSlotsOpen(false); setPayError(''); }}
                        accessibilityRole="radio" accessibilityState={{ checked: on }}
                        style={{ height: 40, justifyContent: 'center', paddingHorizontal: 12, backgroundColor: on ? C.saffron : C.white }}>
                        <Text style={{ color: on ? C.white : C.charcoal, fontSize: 14, fontWeight: on ? '700' : '400' }}>{slotTime(iso)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </RNScrollView>
          </View>
        )}
        </>)}

        <Pressable onPress={() => setGiftCardOpen(v => !v)} style={{ marginTop: 16 }}>
          <Text style={S.linkText}>{giftCardOpen ? '▲' : '▼'} Have a gift card?</Text>
        </Pressable>
        {giftCardOpen && (
          <View ref={giftBlockRef} collapsable={false} style={{ marginTop: 8 }}
            onLayout={(e) => { giftBlockY.current = e.nativeEvent.layout.y; }}>
            <TextInput style={S.input} value={giftCardNumber} onChangeText={setGiftCardNumber}
              placeholder="Gift card number" placeholderTextColor={C.muted} autoCapitalize="none"
              returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => giftCodeRef.current?.focus()}
              onFocus={focusGiftField} onBlur={() => { giftFocused.current = false; }} />
            <TextInput ref={giftCodeRef} style={S.input} value={giftCardCode} onChangeText={setGiftCardCode}
              placeholder="Redemption code" placeholderTextColor={C.muted} autoCapitalize="characters"
              returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()}
              onFocus={focusGiftField} onBlur={() => { giftFocused.current = false; }} />
          </View>
        )}


        <View style={{ marginTop: 20, gap: 2 }}>
          <View style={S.checkoutTotalRow}><Text style={S.checkoutTotalText}>Subtotal</Text><Text style={S.checkoutTotalText}>{fmt(summary.subtotal_cents)}</Text></View>
          {freeDrinkCents > 0 && (
            <View style={S.checkoutTotalRow}>
              <Text style={[S.checkoutTotalText, { color: '#2a8f4f' }]}>Free drink{voucherCount > 1 ? 's' : ''}</Text>
              <Text style={[S.checkoutTotalText, { color: '#2a8f4f' }]}>−{fmt(freeDrinkCents)}</Text>
            </View>
          )}
          <View style={S.checkoutTotalRow}><Text style={S.checkoutTotalText}>Tax</Text><Text style={S.checkoutTotalText}>{fmt(taxCents)}</Text></View>
          {tipsOn && (
            <View style={S.checkoutTotalRow}><Text style={S.checkoutTotalText}>Tip ({tipPctLabel(tipPctNow)})</Text><Text style={S.checkoutTotalText}>{fmt(tipCents)}</Text></View>
          )}
          <View style={[S.checkoutTotalRow, { marginTop: 2 }]}><Text style={[S.secTitle, { fontSize: 17 }]}>Total</Text><Text style={[S.secTitle, { fontSize: 17 }]}>{fmt(orderTotalCents)}</Text></View>
        </View>

        {!!payError && <Text style={{ color: '#C0392B', marginTop: 16, textAlign: 'center' }}>{payError}</Text>}
        <Pressable style={[S.btnSaffron, { marginTop: 20 }, payLocked && { opacity: 0.6 }]} disabled={paying || payLocked} onPress={() => handlePay()}>
          {paying ? <ActivityIndicator color={C.ivory} /> : (
            <Text style={S.btnSaffronText}>{orderTotalCents === 0 ? '✅ Place Order' : `Pay ${fmt(orderTotalCents)}`}</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      buttonLabel={infoModal?.buttonLabel}
      onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }}
    />
    {/* Group-order safety net. Not ConfirmModal: its backdrop tap and
        Cancel are the same callback, and here a stray tap must place
        nothing -- only the two buttons act. */}
    {groupOfferOpen && !!groupOffer && (
      <View style={S.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setGroupOfferOpen(false)} />
        <View style={S.modalSheet}>
          <View style={{ padding: 24 }}>
            <Text style={S.confirmModalTitle}>Add this to the group order?</Text>
            <Text style={S.confirmModalMessage}>
              {groupOffer.circle_display_name} has a group order open — pickup at {formatLocalTime(groupOffer.pickup_time)}, cutoff time {formatLocalTime(groupOffer.join_cutoff_at)}. Add this order to it, or place it on its own?
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
              <Pressable style={({ pressed }) => [S.confirmModalCancelBtn, pressed && { opacity: 0.7 }]}
                onPress={() => { groupOfferDeclined.current = true; setGroupOfferOpen(false); handlePay(); }}>
                <Text style={S.confirmModalCancelText}>Order separately</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [S.confirmModalConfirmBtn, pressed && { backgroundColor: '#c95722' }]}
                onPress={joinOfferedGroup}>
                <Text style={S.confirmModalConfirmText}>Add to group order</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    )}
    </>
  );
}

// ── GIFT A SIP OR FOOD (draft + checkout) ────────────────────────
// Native rebuild of the "Gift a Sip or Food" flow — same
// GET/PATCH /gift-orders/draft(/items/{id}) + POST /gift-orders/draft/
// checkout-intent this app's own Add to Gift buttons already populate.
function GiftDraftScreen({ navigation, route, onHeaderBack }) {
  const customer = route?.params?.customer || null;
  const cart = useCart();
  const payWithCard = usePayWithCard();
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(null);
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [occasion, setOccasion] = useState('celebrations');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [infoModal, setInfoModal] = useState(null); // {title, message, onOk}
  const showInfo = (title, message, onOk) => setInfoModal({ title, message, onOk });

  // Occasion codes + preset messages (2026-09-13, PC's live report) --
  // ported verbatim from find-my-drink_embed6.html's window.DASTA_OCCASIONS_SIP.
  // Occasion codes themselves are a fixed 5-value allowlist shared by both
  // Gift Card and Gift-a-Sip on the backend (core/gift_cards.py's
  // OCCASION_CODES) -- not a database table (checked directly; there is
  // no occasions table), same as web: the copy/labels/presets live
  // client-side, only the taxonomy is shared. This mirrors that same
  // client-side structure rather than inventing a different one.
  const OCCASIONS = [
    { code: 'celebrations', label: '🎉 Celebrations', messages: [
      "I'd love to celebrate your birthday with a Sip. Hope you have an amazing day!",
      'Congratulations on your achievement! You deserve a special Sip today.',
      'Proud of you! Celebrate this milestone with a drink on me.',
      "Here's a Sip to celebrate something awesome!",
    ]},
    { code: 'appreciation', label: '🙏 Appreciation', messages: [
      "Thank you for everything you do. Enjoy this drink—you've earned it.",
      "Just wanted to remind you how much you're appreciated.",
      'A little treat to brighten your day.',
      'Hope this Sip brings a smile to your day.',
    ]},
    { code: 'encouragement', label: '💪 Encouragement', messages: [
      'Wishing you the very best—go ace it!',
      "You've got this! Here's a little boost for the day.",
      "One Sip at a time—you've got this.",
      "You're capable of amazing things. Enjoy this drink!",
    ]},
    { code: 'care_support', label: '💛 Care & Support', messages: [
      'Hope this brightens your day. Wishing you a speedy recovery.',
      'Thinking of you and sending a little comfort.',
      'Just because you deserve it.',
    ]},
    { code: 'everyday_moments', label: '☕ Everyday Moments', messages: [
      "Let's grab a drink together soon!",
      'No special occasion—just wanted to make your day.',
      'Start your day with something delicious!',
      'A little energy boost on me.',
    ]},
  ];
  const selectedOccasion = OCCASIONS.find(o => o.code === occasion) || OCCASIONS[0];

  const load = async () => {
    setLoading(true);
    const { ok, data } = await apiFetch('/gift-orders/draft');
    if (ok && data?.success) {
      setDraft(data);
      setRecipientName(data.recipient_name || '');
      setRecipientEmail(data.recipient_email || '');
      setOccasion(data.occasion_code || 'celebrations');
      setMessage(data.message_text || '');
    } else {
      setDraft(null);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const removeItem = async (id) => {
    const { ok } = await apiFetch(`/gift-orders/draft/items/${id}`, { method: 'DELETE' });
    if (ok) { load(); cart.refreshCounts(); }
  };

  const handleSend = async () => {
    if (!recipientName.trim() || !recipientEmail.trim()) { showInfo('Almost there', 'Please add a recipient name and email.'); return; }
    setSaving(true);
    const saveRes = await apiFetch('/gift-orders/draft', {
      method: 'PATCH',
      body: { recipient_name: recipientName.trim(), recipient_email: recipientEmail.trim(), occasion_code: occasion, message_text: message || null },
    });
    setSaving(false);
    if (!saveRes.ok) { showInfo('Error', saveRes.data?.detail || 'Could not save recipient info.'); return; }

    setPaying(true);
    try {
      const { ok, data } = await apiFetch('/gift-orders/draft/checkout-intent', { method: 'POST' });
      if (!ok) { showInfo('Error', data?.detail || 'Could not start payment.'); return; }
      const result = await payWithCard(data);
      if (result.canceled) return;
      if (!result.ok) { showInfo('Payment Error', result.error || 'Could not complete payment.'); return; }
      cart.refreshCounts();
      showInfo('Gift Sent! 🎁', `${recipientName} will get an email to claim it.`,
        () => navigation.navigate('MainTabs', { initialTab: 'Home' }));
    } catch { showInfo('Error', 'Could not reach Dasta server.'); }
    finally { setPaying(false); }
  };

  return (
    <>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 60 }}>
      <StatusBar style="light" />
      {/* Back-chevron removed (2026-09-23, PC's ask, app-wide audit) --
          Home tab is enough everywhere, arrow or not. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title="🎁 Gift a Sip or Food" onBack={onHeaderBack} />
      </View>
      {loading ? (
        <ActivityIndicator color={C.saffron} size="large" style={{ marginTop: 40 }} />
      ) : !draft || (draft.items || []).length === 0 ? (
        <View style={{ paddingVertical: 40, paddingHorizontal: 24, alignItems: 'center' }}>
          {/* Longer empty-state copy (2026-09-23, PC's ask) -- covers the
              whole gifting flow (browse/craft -> Add to Gift -> checkout ->
              leaves earned), not just "tap Add to Gift." paddingHorizontal
              narrowed from the original padding:40 (40px both axes) to
              give this much longer paragraph more width to wrap into
              before it gets tall -- paddingVertical kept at 40 so spacing
              from the header/button above and below is otherwise
              unchanged. "Add to Gift" bolded via the same nested-Text
              convention already used elsewhere in the app for referencing
              a button name in body copy (e.g. RewardsScreen's
              "Ingredients:" label).

              Round 2 (2026-09-23, PC's live report) -- bigger text and one
              sentence per line instead of one flowing paragraph, since
              there's plenty of room on this screen; closing line bolded
              in full. fontSize 13->16 (up from S.cardSub's own default),
              each sentence its own Text block with its own marginBottom
              instead of S.cardSub's single 16px block-level margin. */}
          {/* color: C.charcoal (2026-09-23, PC's live report) -- was
              S.cardSub's own muted gray; C.charcoal is the app's existing
              near-black body-text token (see e.g. fieldLabel), not a raw
              'black' literal, to stay consistent with the rest of the
              palette. */}
          <Text style={[S.cardSub, { fontSize: 16, marginBottom: 10, color: C.charcoal }]}>No gift in progress yet.</Text>
          <Text style={[S.cardSub, { fontSize: 16, marginBottom: 10, color: C.charcoal }]}>
            Browse the menu below, or craft a custom sip from the Home screen — then tap <Text style={{ fontWeight: '700' }}>Add to Gift</Text> on any drink or food you'd like to send.
          </Text>
          <Text style={[S.cardSub, { fontSize: 16, marginBottom: 10, color: C.charcoal }]}>
            Once it's added, check out by entering the receiver's email and paying for the gift.
          </Text>
          <Text style={[S.cardSub, { fontSize: 16, fontWeight: '700', color: C.charcoal }]}>
            Your Dasta Account earns leaves for every gift you share — thanks for spreading the Dasta love!
          </Text>
          <Pressable style={[S.btnSaffron, { marginTop: 16 }]} onPress={() => navigation.navigate('MainTabs', { initialTab: 'Menu' })}>
            <Text style={S.btnSaffronText}>Browse the Menu</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ padding: 16 }}>
          {draft.items.map(it => (
            <View key={it.id} style={S.menuItemCard}>
              <View style={{ flex: 1 }}>
                <Text style={S.menuItemName}>{it.quantity}x {it.item_name_snapshot}</Text>
                <Text style={S.menuItemPrice}>${(it.line_total_cents / 100).toFixed(2)}</Text>
              </View>
              <Pressable onPress={() => removeItem(it.id)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Remove item">
                <Ionicons name="trash-outline" size={20} color={C.muted} />
              </Pressable>
            </View>
          ))}
          <Text style={[S.secTitle, { marginTop: 12 }]}>Total: ${(draft.total_price_cents / 100).toFixed(2)}</Text>

          <Text style={[S.fieldLabel, { marginTop: 18 }]}>Recipient Name</Text>
          <TextInput style={S.input} value={recipientName} onChangeText={setRecipientName} />
          <Text style={S.fieldLabel}>Recipient Email</Text>
          <TextInput style={S.input} value={recipientEmail} onChangeText={setRecipientEmail} keyboardType="email-address" autoCapitalize="none" />

          <Text style={S.fieldLabel}>Occasion</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {OCCASIONS.map(o => (
              <Pressable key={o.code} style={[S.menuCatTab, occasion === o.code && S.menuCatTabActive]} onPress={() => setOccasion(o.code)}>
                <Text style={[S.menuCatTabText, occasion === o.code && S.menuCatTabTextActive]}>{o.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={S.fieldLabel}>Pick a message (or write your own below)</Text>
          {selectedOccasion.messages.map((m, i) => (
            <Pressable key={i} onPress={() => setMessage(m)}
              style={[S.modifierRow, message === m && S.modifierRowSelected]}>
              <Text style={[S.modifierRowText, { flex: 1 }]}>{message === m ? '✓ ' : ''}{m}</Text>
            </Pressable>
          ))}

          <Text style={[S.fieldLabel, { marginTop: 12 }]}>Message (optional)</Text>
          <TextInput style={[S.input, { height: 80 }]} value={message} onChangeText={setMessage} multiline placeholder="Write your own note..." placeholderTextColor={C.muted} />

          <Pressable style={[S.btnSaffron, { marginTop: 20 }]} disabled={saving || paying} onPress={handleSend}>
            {(saving || paying) ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>💳 Pay & Send Gift — ${(draft.total_price_cents / 100).toFixed(2)}</Text>}
          </Pressable>
        </View>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }}
    />
    </>
  );
}

// ── ADD MONEY TO DASTA CARD ───────────────────────────────────
// Native rebuild of the Add Money flow this app's My Circle Account tile
// only ever linked out to the website for — same POST /wallet/reload
// contract (fixed $10/$25/$50 presets or a custom amount), the Clover
// card sheet for the actual charge.
function AddMoneyScreen({ navigation, route, onHeaderBack }) {
  const customer = route?.params?.customer || null;
  const payWithCard = usePayWithCard();
  const PRESETS = [1000, 2500, 5000]; // cents — $10/$25/$50, matches wallet_router.py's RELOAD_PRESET_CENTS
  const [amountCents, setAmountCents] = useState(1000);
  const [customAmount, setCustomAmount] = useState('');
  const [paying, setPaying] = useState(false);
  // Branded InfoModal (2026-09-16, PC's live report) instead of the native
  // Alert.alert this whole flow used before -- see InfoModal's own comment
  // for why Alert.alert can never match Dasta's colors. onOk lets the one
  // success case still navigate back on dismiss, same as the Alert.alert
  // button-callback it replaces.
  const [infoModal, setInfoModal] = useState(null); // {title, message, onOk}
  const showInfo = (title, message, onOk) => setInfoModal({ title, message, onOk });

  const effectiveAmount = customAmount ? Math.round(parseFloat(customAmount) * 100) : amountCents;

  const handleReload = async () => {
    if (!effectiveAmount || effectiveAmount < 1000) { showInfo('Minimum $10', 'Reloads start at $10.'); return; }
    setPaying(true);
    try {
      const { ok, data } = await apiFetch('/wallet/reload', { method: 'POST', body: { amount_cents: effectiveAmount } });
      if (!ok) { showInfo('Error', data?.detail || 'Could not start reload.'); return; }
      const result = await payWithCard(data);
      if (result.canceled) return;
      if (!result.ok) { showInfo('Payment Error', result.error || 'Could not complete payment.'); return; }
      showInfo('Dasta Card Reloaded! 💵', `$${(effectiveAmount / 100).toFixed(2)} is on its way to your Dasta Card.`,
        () => navigation.navigate('MyCircleAccount', { customer }));
    } catch { showInfo('Error', 'Could not reach Dasta server.'); }
    finally { setPaying(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 60 }}>
      <StatusBar style="light" />
      {/* Back-chevron removed (2026-09-23, PC's ask, app-wide audit) --
          Home tab is enough everywhere, arrow or not. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title="💵 Add Money" onBack={onHeaderBack} />
      </View>
      <View style={{ padding: 16 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {PRESETS.map(p => (
            <Pressable key={p} style={[S.menuCatTab, { flex: 1, alignItems: 'center' }, amountCents === p && !customAmount && S.menuCatTabActive]}
              onPress={() => { setAmountCents(p); setCustomAmount(''); }}>
              <Text style={[S.menuCatTabText, amountCents === p && !customAmount && S.menuCatTabTextActive]}>${p / 100}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[S.fieldLabel, { marginTop: 16 }]}>Or custom amount</Text>
        <TextInput style={S.input} value={customAmount} onChangeText={setCustomAmount} keyboardType="decimal-pad" placeholder="$0.00" placeholderTextColor={C.muted} />
        <Text style={S.fieldHint}>Max Dasta Card balance is $200.</Text>
        <Pressable style={[S.btnSaffron, { marginTop: 20 }]} disabled={paying} onPress={handleReload}>
          {paying ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>💳 Add ${(effectiveAmount / 100 || 0).toFixed(2)}</Text>}
        </Pressable>
      </View>
      <InfoModal
        visible={!!infoModal}
        title={infoModal?.title}
        message={infoModal?.message}
        onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }}
      />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── CHOOSE YOUR FAVORITE (2026-09-19) ──────────────────────────
// Say[Mic]Go option 1's fallback when the customer has more than one
// saved favorite (PC's live report: 21 favorites were ALL being added
// to cart at once). Items come pre-fetched from GET /favorites/preview
// (passed via route params, not re-fetched here). Tap-only since
// 2026-09-30, like the Say[Mic]Go menu itself.
function ChooseFavoriteScreen({ navigation, route, onHeaderBack }) {
  const customer = route?.params?.customer || null;
  const items    = route?.params?.items    || [];
  const cart = useCart();
  const [infoModal, setInfoModal] = useState(null);
  const [busyIdx,   setBusyIdx]   = useState(null);
  const showInfo = (title, message) => setInfoModal({ title, message });

  const handlePick = async (idx) => {
    const item = items[idx];
    if (!item || busyIdx !== null) return;
    setBusyIdx(idx);
    const { ok } = await cart?.addToCart?.(buildFavoriteAddPayload(item));
    setBusyIdx(null);
    if (ok) {
      navigation.navigate('Checkout', { customer, fromQuickLinks: true });
    } else {
      showInfo('Error', "Couldn't add that drink to the cart. Please try again.");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.ivory }}>
      {/* Back-chevron removed (2026-09-23, PC's ask, app-wide audit) --
          Home tab is enough everywhere, arrow or not. minHeight:44 kept
          for vertical alignment against the persistent profile icon. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 16 }]}>
        <HeroTitleRow title="Choose Your Favorite" onBack={onHeaderBack} />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {items.map((item, idx) => (
          <Pressable key={item.custom_drink_id ?? idx} style={S.sayMicGoPanelRow}
            disabled={busyIdx !== null} onPress={() => handlePick(idx)}>
            <Text style={S.sayMicGoPanelRowNum}>{idx + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={S.sayMicGoPanelRowText}>{item.drink_name}</Text>
              {item.price_display ? <Text style={[S.fieldHint, { marginTop: 2 }]}>{item.price_display}</Text> : null}
            </View>
            {busyIdx === idx ? <ActivityIndicator color={C.saffron} /> : null}
          </Pressable>
        ))}
      </ScrollView>
      <InfoModal
        visible={!!infoModal}
        title={infoModal?.title}
        message={infoModal?.message}
        onClose={() => setInfoModal(null)}
      />
    </View>
  );
}

// ── REDEEM MY FREE DRINK (2026-09-18) ──────────────────────────
// Say[Mic]Go option 6. First real redemption path for the free-drink
// count already shown (purely informational until now) on Rewards/Home
// -- backed by GET /rewards/free-drink-status (say_mic_go_router.py),
// which reads the same loyalty_vouchers table GET /loyalty/status
// already does. The actual decrement is NOT triggered from this screen
// or anywhere client-side -- register staff scan this QR and call the
// existing POST /loyalty/redeem-free-drink (loyalty_router.py, POS-key
// gated, atomic exactly-once). No self-service customer decrement here
// by design.
// Free-drink status + QR (shared, 2026-09-29) -- the Redeem My Free Drink
// screen and the Scan tab's Free Drink panel show the exact same code. The
// code is a one-time token that expires in 60s (server-side), so both
// screens re-fetch it every 30s while it's on screen, like the Dasta Card
// pay QR -- load(true) refreshes quietly, no spinner.
const FREE_DRINK_QR_REFRESH_MS = 30000;
function useFreeDrinkStatus() {
  const [loading, setLoading] = useState(true);
  const [failed,  setFailed]  = useState(false);
  const [count,   setCount]   = useState(0);
  const [qrPayload, setQrPayload] = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setFailed(false); }
    const { ok, data } = await apiFetch('/rewards/free-drink-status');
    if (ok && data?.success) {
      setCount(data.count || 0);
      setQrPayload(data.qr_payload || null);
      setFailed(false);
    } else if (!silent) {
      setFailed(true);
    }
    if (!silent) setLoading(false);
  }, []);

  return { loading, failed, count, qrPayload, load };
}

function FreeDrinkQrPanel({ status }) {
  const { loading, failed, count, qrPayload, load } = status;
  if (loading) return <ActivityIndicator color={C.saffron} style={{ marginTop: 24 }} />;
  if (failed) {
    return (
      <>
        <Text style={[S.cardSub, { marginTop: 16, textAlign: 'center' }]}>
          Couldn't load your free-drink status. Please try again.
        </Text>
        <Pressable style={[S.btnSaffron, { marginTop: 16 }]} onPress={load}>
          <Text style={S.btnSaffronText}>Retry</Text>
        </Pressable>
      </>
    );
  }
  return (
    <>
      <Text style={S.circleHeading}>
        {count} free drink{count === 1 ? '' : 's'} available
      </Text>
      {/* Zero free drinks (PC, 2026-09-29): the screen still shows, with a
          greyed QR marked VOID -- a placeholder code if the server sent none,
          so it's always clear there's nothing valid to scan. */}
      <View style={{ marginTop: 24, alignItems: 'center' }}>
        <View style={{ opacity: count > 0 ? 1 : 0.4 }}>
          {count > 0 && qrPayload ? (
            <QRCode value={qrPayload} size={200} color={C.espresso} />
          ) : count === 0 ? (
            <QRCode value={qrPayload || 'DASTA-NO-FREE-DRINK'} size={200} color="#999999" />
          ) : null}
        </View>
        {count === 0 ? (
          <View style={S.redeemVoidedOverlay} pointerEvents="none">
            <Text style={S.redeemVoidedText}>VOID</Text>
          </View>
        ) : null}
      </View>
      <Text style={[S.qrCaption, { marginTop: 16, maxWidth: 280 }]}>
        {count > 0
          ? 'Show this at the counter and redeem a free drink'
          : 'Start earning leaves - redeem free drinks'}
      </Text>
      {count > 0 && qrPayload ? (
        <Text style={[S.qrCaption, { marginTop: 4, maxWidth: 280 }]}>Refreshes every 30 seconds to keep your account safe.</Text>
      ) : null}
    </>
  );
}

function RedeemFreeDrinkScreen({ navigation, route, onHeaderBack }) {
  const customer = route?.params?.customer || null;
  const status = useFreeDrinkStatus();
  const { load } = status;

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), FREE_DRINK_QR_REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  return (
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom contentContainerStyle={{ paddingBottom: 120 }}>
      <StatusBar style="light" />
      {/* Back-chevron removed (2026-09-23, PC's ask, app-wide audit) --
          Home tab is enough everywhere, arrow or not. minHeight:44 kept
          for vertical alignment against the persistent profile icon. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title="Redeem My Free Drink" onBack={onHeaderBack} />
      </View>

      <View style={{ padding: 20, alignItems: 'center' }}>
        <FreeDrinkQrPanel status={status} />
      </View>
    </ScrollView>
  );
}

// ── SCAN TAB (2026-09-29, PC) ─────────────────────────────────
// Replaces the Menu tab (a duplicate of Order -> Dasta Menu). Everything a
// customer shows at the register, one swipe apart: the Dasta Card pay QR
// (same POST /wallet/qr-token, refreshed every 30s exactly like My Dasta
// Account's, only while this tab is on screen) and the Free Drink QR (same
// panel as Redeem My Free Drink). Both are QR codes today, so they stay QR.
// A Saved Cards panel is deliberately NOT here yet -- waiting on PC to
// confirm it's reference-only; no card data is ever encoded in a code.
function ScanScreen({ route, navigation, isActive }) {
  const customer = route?.params?.customer || null;
  const { width } = useWindowDimensions();
  const pagerRef = useRef(null);
  const [page, setPage] = useState(0);
  const [balance, setBalance] = useState(null);
  const [dastaCardId, setDastaCardId] = useState(null);
  const [memberSince, setMemberSince] = useState(null);
  const [identifier, setIdentifier] = useState(null);
  const [cardLoading, setCardLoading] = useState(true);
  const [autoReload, setAutoReload] = useState(null);
  const [savedCards, setSavedCards] = useState([]);
  const [autoReloadModalOpen, setAutoReloadModalOpen] = useState(false);
  const [confirmAutoReloadOff, setConfirmAutoReloadOff] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);

  // Add to Apple Wallet / Save to Google Wallet (2026-09-30, PC). The server
  // returns a link (Apple: a 10-minute signed .pkpass download; Google: the
  // "save to Google Wallet" URL); opening it hands off to the OS's own add-
  // to-wallet sheet. The pass shows this same Dasta Card code and updates
  // itself when the code changes (core/wallet_passes.py).
  const walletBadge = Platform.OS === 'ios'
    ? { image: APPLE_WALLET_BADGE_IMAGE, ratio: APPLE_WALLET_BADGE_RATIO, label: 'Add to Apple Wallet' }
    : { image: GOOGLE_WALLET_BUTTON_IMAGE, ratio: GOOGLE_WALLET_BUTTON_RATIO, label: 'Add to Google Wallet' };
  const addToWallet = async () => {
    setWalletBusy(true);
    const { ok, data } = await apiFetch(Platform.OS === 'ios' ? '/wallet/apple/pass-link' : '/wallet/google/save-link', { method: 'POST' });
    setWalletBusy(false);
    if (!ok || !data?.url) { setInfoModal({ title: "Couldn't add to Wallet", message: data?.detail || 'Please try again.' }); return; }
    Linking.openURL(data.url);
  };
  const [infoModal, setInfoModal] = useState(null);
  const [qrToken, setQrToken] = useState(null);
  const [qrLoading, setQrLoading] = useState(true);
  const freeDrink = useFreeDrinkStatus();
  const loadFreeDrink = freeDrink.load;

  // Everything loads (and the pay QR refreshes every 30s) only while this
  // tab is on screen -- same data and cadence as My Dasta Account.
  useEffect(() => {
    if (!isActive || !customer) return;
    let cancelled = false;
    const fetchQr = async () => {
      const { ok, data } = await apiFetch('/wallet/qr-token', { method: 'POST' });
      if (cancelled) return;
      setQrToken(ok && data?.success ? data.token : null);
      setQrLoading(false);
    };
    (async () => {
      const [meRes, balRes, arRes, cardsRes] = await Promise.all([
        apiFetch('/auth/me'), apiFetch('/wallet/balance'), apiFetch('/wallet/auto-reload-status'), apiFetch('/wallet/cards'),
      ]);
      if (cancelled) return;
      if (meRes.ok && meRes.data?.success) {
        setDastaCardId(meRes.data.customer?.dasta_card_id || null);
        setMemberSince(meRes.data.customer?.created_at || null);
        setIdentifier(meRes.data.customer?.phone || meRes.data.customer?.email || null);
      }
      if (balRes.ok && balRes.data?.success) setBalance(balRes.data);
      if (arRes.ok && arRes.data?.success) setAutoReload(arRes.data);
      if (cardsRes.ok && cardsRes.data?.success) setSavedCards(cardsRes.data.cards || []);
      setCardLoading(false);
    })();
    fetchQr();
    loadFreeDrink();
    const interval = setInterval(fetchQr, DASTA_CARD_QR_POLL_MS);
    const fdInterval = setInterval(() => loadFreeDrink(true), FREE_DRINK_QR_REFRESH_MS);
    return () => { cancelled = true; clearInterval(interval); clearInterval(fdInterval); };
  }, [isActive, customer, loadFreeDrink]);

  const turnAutoReloadOff = async () => {
    const { ok, data } = await apiFetch('/wallet/auto-reload', { method: 'PATCH', body: { enabled: false } });
    if (ok && data?.success) setAutoReload(prev => ({ ...prev, enabled: false }));
    else setInfoModal({ title: 'Error', message: 'Could not turn off auto-reload.' });
  };

  const goToPage = (i) => { pagerRef.current?.scrollTo({ x: i * width, animated: true }); setPage(i); };

  const hero = (
    <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
      {/* 44pt min only when signed out (title alone, like HeroTitleRow); signed
          in, title + subtitle set the height exactly as on Rewards -- the min
          made Scan a couple of points taller (PC, 2026-10-01). */}
      <View style={customer ? null : { minHeight: 44, justifyContent: 'center' }}>
        <Text style={[S.wordmark, { fontSize: 22 }]}>Scan</Text>
        {!!customer && <Text style={[S.wordmarkSub, { marginTop: 2 }]}>{page === 0 ? 'DASTA CARD' : 'FREE DRINK'}</Text>}
      </View>
    </View>
  );

  if (!customer) {
    return (
      <View style={S.screen}>
        <StatusBar style="light" />
        {hero}
        <View style={{ padding: 24, alignItems: 'center' }}>
          <Text style={[S.cardSub, { textAlign: 'center' }]}>
            Sign in to see your Dasta Card and free-drink codes to scan at the register.
          </Text>
          <Pressable style={[S.btnSaffron, { marginTop: 16 }]} onPress={() => navigation.navigate('SignIn')}>
            <Text style={S.btnSaffronText}>Sign In</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Pinch-zoom on both pages (accessibility -- PC, 2026-09-29), same props
  // as every other screen; the flex style is what turns it on for Android.
  const zoomProps = { pinchGestureEnabled: true, maximumZoomScale: 3, minimumZoomScale: 1, bouncesZoom: true, style: { flex: 1 } };

  return (
    <>
    <View style={S.screen}>
      <StatusBar style="light" />
      {hero}
      <RNScrollView ref={pagerRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}>
        {/* Page 1: Dasta Card -- same layout as My Dasta Account: the card,
            then auto-reload, then the pay QR and Reload Dasta Card. */}
        <View style={{ width, position: 'relative' }}>
          <Pressable style={[S.sipArrowBtn, { right: 16, top: 12, zIndex: 2 }]} onPress={() => goToPage(1)}>
            <Text style={S.sipArrowText}>→</Text>
          </Pressable>
          <ScrollView {...zoomProps} contentContainerStyle={{ padding: 16, paddingBottom: 120, alignItems: 'center' }}>
            <Text style={S.circleHeading}>Your Dasta Card</Text>
            {cardLoading ? <ActivityIndicator color={C.saffron} style={{ marginTop: 24 }} /> : (
              <>
                <View style={S.dastaCardImageWrap}>
                  <Image source={DASTA_CARD_IMAGE} style={S.dastaCardBg} resizeMode="cover" />
                  <View style={S.dastaCardBalanceOverlay}>
                    <Text style={S.dastaCardBalanceLabel}>Available balance</Text>
                    <Text style={S.dastaCardBalanceVal}>{balance?.total_display || '$0.00'}</Text>
                  </View>
                  {dastaCardId ? (
                    <Text style={[S.dastaCardNumberText, S.dastaCardNumberOverlay]}>{formatDastaCardId(dastaCardId)}</Text>
                  ) : null}
                  {memberSince ? (
                    <Text style={[S.dastaCardSinceText, S.dastaCardSinceOverlay]}>MEMBER SINCE {formatMemberSince(memberSince)}</Text>
                  ) : null}
                </View>

                {autoReload && (
                  <View style={S.autoReloadRow}>
                    <Text style={S.autoReloadText}>
                      Auto-reload: <Text style={{ fontWeight: '700', color: autoReload.paused ? '#cc4444' : '#2a8f4f' }}>
                        {autoReload.paused ? 'PAUSED' : (autoReload.enabled ? 'ON' : 'OFF')}
                      </Text>
                      {autoReload.enabled && !autoReload.paused ? ` — ${autoReload.amount_display} when below ${autoReload.threshold_display}` : ''}
                      {autoReload.paused ? ` (${autoReload.paused_reason === 'velocity_limit' ? 'check your email' : 'card issue'})` : ''}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                      <Pressable onPress={() => setAutoReloadModalOpen(true)}>
                        <Text style={[S.linkText, { marginTop: 0 }]}>{autoReload.enabled ? 'Edit' : 'Turn on'}</Text>
                      </Pressable>
                      {autoReload.enabled && (
                        <Pressable onPress={() => setConfirmAutoReloadOff(true)}>
                          <Text style={[S.linkText, { marginTop: 0, color: '#C0392B' }]}>Turn off</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                )}

                <View style={{ marginTop: 16, alignItems: 'center', minHeight: 200, justifyContent: 'center' }}>
                  {qrLoading ? <ActivityIndicator color={C.saffron} />
                    : qrToken ? <QRCode value={qrToken} size={200} color={C.espresso} />
                    : <Text style={[S.qrCaption, { maxWidth: 260 }]}>Load Dasta Cash to get your QR code</Text>}
                </View>
                {qrToken && <Text style={[S.qrCaption, { marginTop: 10, fontWeight: '700' }]}>Show this at the counter to pay</Text>}
                {qrToken && <Text style={[S.qrCaption, { marginTop: 4 }]}>Refreshes automatically after each use, and every morning, to keep your account safe.</Text>}

                <Pressable style={[S.btnSaffron, { marginTop: 20, width: '100%' }]}
                  onPress={() => navigation.navigate('AddMoney', { customer })}>
                  <Text style={S.btnSaffronText}>Reload Dasta Card</Text>
                </Pressable>
                {/* Official Apple / Google artwork, unaltered (brand rules). */}
                {walletBadge && (
                  <Pressable onPress={addToWallet} disabled={walletBusy} accessibilityRole="button"
                    accessibilityLabel={walletBadge.label} style={({ pressed }) => [{ marginTop: 14, alignSelf: 'center' }, (pressed || walletBusy) && { opacity: 0.6 }]}>
                    <Image source={walletBadge.image} style={{ width: 200, height: 200 / walletBadge.ratio }} resizeMode="contain" />
                  </Pressable>
                )}
              </>
            )}
          </ScrollView>
        </View>
        {/* Page 2: Free Drink -- same panel as Redeem My Free Drink. */}
        <View style={{ width, position: 'relative' }}>
          <Pressable style={[S.sipArrowBtn, { left: 16, top: 12, zIndex: 2 }]} onPress={() => goToPage(0)}>
            <Text style={S.sipArrowText}>←</Text>
          </Pressable>
          <ScrollView {...zoomProps} contentContainerStyle={{ padding: 20, paddingBottom: 120, alignItems: 'center' }}>
            <FreeDrinkQrPanel status={freeDrink} />
          </ScrollView>
        </View>
      </RNScrollView>
    </View>
    <AutoReloadModal
      visible={autoReloadModalOpen}
      onClose={() => setAutoReloadModalOpen(false)}
      identifier={identifier}
      savedCards={savedCards}
      current={autoReload}
      onSaved={(data) => setAutoReload(prev => ({ ...prev, enabled: true, paused: false, amount_cents: data.amount_cents, amount_display: data.amount_display }))}
    />
    <ConfirmModal visible={confirmAutoReloadOff} title="Turn off Auto-reload?"
      message="Your Dasta Cash will no longer reload automatically when it runs low."
      confirmLabel="Turn Off" onConfirm={turnAutoReloadOff} onClose={() => setConfirmAutoReloadOff(false)} />
    <InfoModal visible={!!infoModal} title={infoModal?.title} message={infoModal?.message}
      onClose={() => setInfoModal(null)} />
    </>
  );
}

// ── GIFT CARD PURCHASE ────────────────────────────────────────
// Native rebuild of the Gift Card purchase flow — same
// POST /wallet/gift-cards/purchase contract, the Clover card sheet for the charge.
function GiftCardPurchaseScreen({ navigation, route, onHeaderBack }) {
  const customer = route?.params?.customer || null;
  const payWithCard = usePayWithCard();
  const PRESETS = [1000, 2500, 5000, 10000];
  const [amountCents, setAmountCents] = useState(2500);
  const [customAmount, setCustomAmount] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage] = useState('');
  const [paying, setPaying] = useState(false);
  const [infoModal, setInfoModal] = useState(null); // {title, message, onOk}
  const showInfo = (title, message, onOk) => setInfoModal({ title, message, onOk });

  const effectiveAmount = customAmount ? Math.round(parseFloat(customAmount) * 100) : amountCents;

  const handleBuy = async () => {
    if (!effectiveAmount || effectiveAmount < 500) { showInfo('Minimum $5', 'Gift cards start at $5.'); return; }
    setPaying(true);
    try {
      const { ok, data } = await apiFetch('/wallet/gift-cards/purchase', {
        method: 'POST',
        body: {
          amount_cents: effectiveAmount,
          recipient_name: recipientName.trim() || undefined,
          recipient_email: recipientEmail.trim() || undefined,
          gift_message: message.trim() || undefined,
        },
      });
      if (!ok) { showInfo('Error', data?.detail || 'Could not start purchase.'); return; }
      const result = await payWithCard(data);
      if (result.canceled) return;
      if (!result.ok) { showInfo('Payment Error', result.error || 'Could not complete payment.'); return; }
      showInfo('Gift Card Purchased! 🎁', recipientEmail.trim() ? `${recipientEmail} will get an email with the card.` : 'Check your email for the gift card.',
        () => navigation.navigate('MyCircleAccount', { customer }));
    } catch { showInfo('Error', 'Could not reach Dasta server.'); }
    finally { setPaying(false); }
  };

  return (
    <>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 60 }}>
      <StatusBar style="light" />
      {/* Back-chevron removed (2026-09-23, PC's ask, app-wide audit) --
          Home tab is enough everywhere, arrow or not. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title="🎁 Gift Card" onBack={onHeaderBack} />
      </View>
      <View style={{ padding: 16 }}>
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          {PRESETS.map(p => (
            <Pressable key={p} style={[S.menuCatTab, { alignItems: 'center' }, amountCents === p && !customAmount && S.menuCatTabActive]}
              onPress={() => { setAmountCents(p); setCustomAmount(''); }}>
              <Text style={[S.menuCatTabText, amountCents === p && !customAmount && S.menuCatTabTextActive]}>${p / 100}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[S.fieldLabel, { marginTop: 16 }]}>Or custom amount</Text>
        <TextInput style={S.input} value={customAmount} onChangeText={setCustomAmount} keyboardType="decimal-pad" placeholder="$0.00" placeholderTextColor={C.muted} />

        <Text style={S.fieldLabel}>Recipient Name (optional)</Text>
        <TextInput style={S.input} value={recipientName} onChangeText={setRecipientName} />
        <Text style={S.fieldLabel}>Recipient Email (optional)</Text>
        <TextInput style={S.input} value={recipientEmail} onChangeText={setRecipientEmail} keyboardType="email-address" autoCapitalize="none" />
        <Text style={S.fieldLabel}>Message (optional)</Text>
        <TextInput style={[S.input, { height: 80 }]} value={message} onChangeText={setMessage} multiline />

        <Pressable style={[S.btnSaffron, { marginTop: 20 }]} disabled={paying} onPress={handleBuy}>
          {paying ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>💳 Buy ${(effectiveAmount / 100 || 0).toFixed(2)} Gift Card</Text>}
        </Pressable>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }}
    />
    </>
  );
}

// ── REDEEM A GIFT CARD ────────────────────────────────────────
// No card payment involved — POST /wallet/gift-cards/redeem just credits the
// Dasta Card balance from an existing card's code, same as web's form.
function RedeemGiftCardScreen({ navigation, route, onHeaderBack }) {
  const customer = route?.params?.customer || null;
  const [cardNumber, setCardNumber] = useState('');
  const [redeemCode, setRedeemCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [infoModal, setInfoModal] = useState(null); // {title, message, onOk}
  const showInfo = (title, message, onOk) => setInfoModal({ title, message, onOk });

  const handleRedeem = async () => {
    if (!cardNumber.trim() || !redeemCode.trim()) { showInfo('Almost there', 'Enter both the card number and redeem code.'); return; }
    setRedeeming(true);
    try {
      const { ok, data } = await apiFetch('/wallet/gift-cards/redeem', {
        method: 'POST', body: { card_number: cardNumber.trim(), redeem_code: redeemCode.trim().toUpperCase() },
      });
      if (ok && data?.success) {
        showInfo('Redeemed! 🎉', `$${((data.amount_cents || 0) / 100).toFixed(2)} added to your Dasta Card.`,
          () => navigation.navigate('MyCircleAccount', { customer }));
      } else {
        showInfo('Error', data?.detail || 'Could not redeem this gift card.');
      }
    } catch { showInfo('Error', 'Could not reach Dasta server.'); }
    finally { setRedeeming(false); }
  };

  return (
    <>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 60 }}>
      <StatusBar style="light" />
      {/* Back-chevron removed (2026-09-23, PC's ask, app-wide audit) --
          Home tab is enough everywhere, arrow or not. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title="🎟️ Redeem a Gift Card" onBack={onHeaderBack} />
      </View>
      <View style={{ padding: 16 }}>
        <Text style={S.fieldLabel}>Card Number</Text>
        <TextInput style={S.input} value={cardNumber} onChangeText={setCardNumber} autoCapitalize="none" />
        <Text style={S.fieldLabel}>Redeem Code</Text>
        <TextInput style={S.input} value={redeemCode} onChangeText={setRedeemCode} autoCapitalize="characters" />
        <Pressable style={[S.btnSaffron, { marginTop: 20 }]} disabled={redeeming} onPress={handleRedeem}>
          {redeeming ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Redeem</Text>}
        </Pressable>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }}
    />
    </>
  );
}

// ── REDEEM A GIFT (Sip or Food) — entry point (2026-09-15) ─────
// PC's ask (item 4): a real native claim flow on mobile, not a hand-off
// to the web claim page. The gift email's "Claim your gift →" link is a
// plain https://dastacafe.com/dasta-circle?... URL (confirmed via
// core/notifications.py + wallet_router.py, not guessed) -- making that
// link open this app directly needs Universal Links (an apple-app-site-
// association file hosted on dastacafe.com plus an associatedDomains
// entitlement, a real native build, and real-device verification), which
// is website-hosting work outside this repo and outside what's safe to
// wire up blind in this pass. This screen is the WORKING path in the
// meantime: paste the link (or just the token) from the email, same
// gift, same claim screen either way -- once Universal Links are set up
// later, tapping the email link can route straight to GiftClaimScreen
// with zero change needed here.
function RedeemGiftScreen({ navigation, route, onHeaderBack }) {
  const customer = route?.params?.customer || null;
  const [input, setInput] = useState('');
  const [infoModal, setInfoModal] = useState(null); // {title, message}
  const showInfo = (title, message) => setInfoModal({ title, message });

  const handleContinue = () => {
    const trimmed = input.trim();
    if (!trimmed) { showInfo('Almost there', 'Paste the link or code from your gift email.'); return; }
    // Accept either the full claim URL or just the bare token -- a
    // customer pasting the whole link is the realistic common case
    // (long-press "Copy Link" on the email), a bare token is the
    // fallback for anyone who only copies part of it.
    const match = trimmed.match(/[?&]token=([^&\s]+)/);
    const token = match ? decodeURIComponent(match[1]) : trimmed;
    navigation.navigate('GiftClaim', { token, customer });
  };

  return (
    <>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 60 }}>
      <StatusBar style="light" />
      {/* Back-chevron removed (2026-09-23, PC's ask, app-wide audit) --
          Home tab is enough everywhere, arrow or not. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title="Redeem a Gift" onBack={onHeaderBack} />
      </View>
      <View style={{ padding: 16 }}>
        <Text style={S.cardSub}>
          Someone sent you a Gift a Sip or Food? Paste the link or code from
          that email below.
        </Text>
        <Text style={[S.fieldLabel, { marginTop: 16 }]}>Gift link or code</Text>
        <TextInput style={S.input} value={input} onChangeText={setInput}
          autoCapitalize="none" autoCorrect={false} placeholder="https://dastacafe.com/dasta-circle?..."
          placeholderTextColor={C.muted} />
        <Pressable style={[S.btnSaffron, { marginTop: 20 }]} onPress={handleContinue}>
          <Text style={S.btnSaffronText}>Continue</Text>
        </Pressable>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => setInfoModal(null)}
    />
    </>
  );
}

// Thank-You presets (2026-09-24, §4/§6) -- keys must match
// routers/gift_orders_router.py's THANK_YOU_PRESETS exactly; labels shown
// here are what the RECIPIENT taps (the sender sees their own copy of
// this same phrase in the push notification).
const THANK_YOU_PRESETS = {
  grateful:    'Thank you! 🙏',
  made_my_day: 'You made my day! ☕',
  excited:     "Can't wait to try it!",
};

// ── GIFT CLAIM (2026-09-15, PC's ask) ──────────────────────────
// The native claim picker itself. Two claim actions per PC's redesign:
// "Claim & Save for Later" (Gifts Received, no cart row, claimed
// immediately) and "Claim & Add to Cart" (stages a $0 cart line, claimed
// once checkout settles) -- applies to every currently-selected item at
// once, matching the backend's own batch-claim shape
// (gift_order_item_ids: list[int]).
function GiftClaimScreen({ navigation, route }) {
  const customer = route?.params?.customer || null;
  const token = route?.params?.token;
  // Circle-to-Circle Gift Delivery (2026-09-24) -- a matched gift is
  // opened by gift_order_id (from Gifts Received's "New" pending list, or
  // the push notification's tap target) instead of a pasted token; the
  // two are mutually exclusive entry points into this same screen.
  const giftOrderIdParam = route?.params?.gift_order_id;
  const cart = useCart();
  const [loading, setLoading] = useState(true);
  const [giftInfo, setGiftInfo] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [submitting, setSubmitting] = useState(null); // 'save' | 'cart' | null
  const [infoModal, setInfoModal] = useState(null); // {title, message, onOk}
  const showInfo = (title, message, onOk) => setInfoModal({ title, message, onOk });
  // Thank-You prompt (2026-09-24, §6) -- shown after a successful claim,
  // before navigating away; null when not showing.
  const [thankYou, setThankYou] = useState(null); // {giftOrderId, targetTab}

  const loadClaim = async () => {
    setLoading(true);
    const { ok, data } = giftOrderIdParam
      ? await apiFetch(`/gift-orders/${giftOrderIdParam}/claim-info`)
      : await apiFetch(`/gift-orders/claim/${encodeURIComponent(token)}`);
    if (ok && data?.success) {
      setGiftInfo(data);
      setSelectedIds(data.items.filter(i => i.available).map(i => i.id));
    } else {
      showInfo('Gift link', data?.detail || 'This gift is no longer valid.',
        () => navigation.navigate('MyCircleAccount', { customer }));
    }
    setLoading(false);
  };

  useEffect(() => { if (token || giftOrderIdParam) loadClaim(); }, [token, giftOrderIdParam]);

  const toggleSelected = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleClaim = async (action) => {
    if (selectedIds.length === 0) { showInfo('Pick at least one item', 'Select what you\'d like to claim first.'); return; }
    setSubmitting(action);
    const { ok, data } = await apiFetch('/gift-orders/claim', {
      method: 'POST',
      body: giftOrderIdParam
        ? { gift_order_id: giftOrderIdParam, gift_order_item_ids: selectedIds, action }
        : { claim_token: token, gift_order_item_ids: selectedIds, action },
    });
    setSubmitting(null);
    if (!ok || !data?.success) {
      showInfo('Error', data?.detail || 'Could not claim your gift. Please try again.');
      return;
    }
    if (action === 'cart') cart?.refreshCounts?.();
    const claimedCount = (data.claimed_item_ids || []).length + (data.saved_item_ids || []).length;
    const skippedCount = (data.already_claimed_ids || []).length;
    const convertedCount = (data.converted_item_ids || []).length;
    let message = action === 'save'
      ? `${claimedCount} item${claimedCount === 1 ? '' : 's'} saved to your Gifts Received.`
      : `${claimedCount} item${claimedCount === 1 ? '' : 's'} added to your cart.`;
    if (convertedCount > 0) message += ` ${convertedCount} item${convertedCount === 1 ? ' was' : 's were'} no longer available and converted to Dasta Cash credit instead.`;
    if (skippedCount > 0) message += ` ${skippedCount} item${skippedCount === 1 ? ' was' : 's were'} already claimed.`;
    const targetTab = action === 'save' ? 'GiftsReceived' : 'Cart';
    showInfo('Claimed! 🎉', message,
      () => setThankYou({ giftOrderId: giftInfo.gift_order_id, targetTab }));
  };

  const leaveScreen = (targetTab) => navigation.navigate(targetTab, { customer });

  const sendThankYou = async (presetKey) => {
    const targetTab = thankYou?.targetTab;
    const giftOrderId = thankYou?.giftOrderId;
    setThankYou(null);
    if (presetKey && giftOrderId) {
      // Fire-and-forget -- a failed/duplicate thank-you must never block
      // leaving this screen (§6: "not a blocking modal").
      apiFetch(`/gift-orders/${giftOrderId}/thank`, { method: 'POST', body: { preset: presetKey } }).catch(() => {});
    }
    leaveScreen(targetTab);
  };

  if (loading) {
    return (
      <View style={[S.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={C.saffron} size="large" />
      </View>
    );
  }
  // infoModal still rendered here (2026-09-16 sweep) -- this branch is
  // exactly what shows after loadClaim's failure path above sets
  // infoModal with an invalid/expired link, and giftInfo stays null in
  // that case, so the old `return null;` would have thrown the message
  // away the instant loading finished.
  if (!giftInfo) {
    return (
      <>
      <View style={[S.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="light" />
      </View>
      <InfoModal
        visible={!!infoModal}
        title={infoModal?.title}
        message={infoModal?.message}
        onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }}
      />
      </>
    );
  }

  return (
    <>
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 60 }}>
      <StatusBar style="light" />
      {/* Back-chevron removed (2026-09-23, PC's ask, app-wide audit) --
          Home tab is enough everywhere, arrow or not. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title={'🎁 Claim Your Gift'} />
      </View>
      <View style={{ padding: 16 }}>
        {!!giftInfo.message_text && (
          <View style={S.drinkWhyBox}>
            <Text style={S.drinkWhyText}>"{giftInfo.message_text}"</Text>
          </View>
        )}
        <Text style={[S.cardSub, { marginTop: 12, marginBottom: 12, textAlign: 'left' }]}>
          Total gifted: ${(giftInfo.total_price_cents / 100).toFixed(2)}
        </Text>
        {giftInfo.items.map(item => {
          const selected = selectedIds.includes(item.id);
          return (
            <Pressable key={item.id}
              disabled={!item.available}
              onPress={() => toggleSelected(item.id)}
              style={[S.menuItemCard, { opacity: item.available ? 1 : 0.55 }, selected && item.available && { borderColor: C.saffron, borderWidth: 2 }]}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={S.menuItemName}>{item.quantity}× {item.item_name_snapshot}</Text>
                  <Ionicons name={selected && item.available ? 'checkmark-circle' : 'ellipse-outline'}
                    size={20} color={item.available ? C.saffron : C.muted} />
                </View>
                <Text style={S.menuItemPrice}>${(item.unit_price_cents * item.quantity / 100).toFixed(2)}</Text>
                {!item.available && (
                  <Text style={S.menuItemHint}>
                    {item.status === 'converted_to_credit'
                      ? 'No longer available — converted to Dasta Cash credit'
                      : item.claimed_at
                        ? `Already claimed on ${new Date(item.claimed_at).toLocaleString()}`
                        : 'Not available'}
                    {item.claimed_location_name ? ` at ${item.claimed_location_name}` : ''}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}

        <Pressable style={[S.btnEspresso, { marginTop: 12 }]} disabled={!!submitting} onPress={() => handleClaim('save')}>
          {submitting === 'save'
            ? <ActivityIndicator color={C.ivory} />
            : <Text style={S.btnEspressoText}>Claim & Save for Later</Text>}
        </Pressable>
        <Pressable style={[S.btnSaffron, { marginTop: 10 }]} disabled={!!submitting} onPress={() => handleClaim('cart')}>
          {submitting === 'cart'
            ? <ActivityIndicator color={C.ivory} />
            : <Text style={S.btnSaffronText}>Claim & Add to Cart</Text>}
        </Pressable>
      </View>
    </ScrollView>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }}
    />
    {/* Thank-You prompt (2026-09-24, §6) -- lightweight, skippable, one
        tap, no free text (decision 3). Not RN's <Modal>, same plain-View
        pattern ConfirmModal/InfoModal already use in this file. */}
    {!!thankYou && (
      <View style={S.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => sendThankYou(null)} />
        <View style={S.modalSheet}>
          <View style={{ padding: 24 }}>
            <Text style={S.confirmModalTitle}>Say thanks?</Text>
            <Text style={S.confirmModalMessage}>Let the sender know you got their gift.</Text>
            {Object.entries(THANK_YOU_PRESETS).map(([key, label]) => (
              <Pressable key={key}
                style={({ pressed }) => [S.btnEspresso, { marginTop: 12 }, pressed && { opacity: 0.85 }]}
                onPress={() => sendThankYou(key)}>
                <Text style={S.btnEspressoText}>{label}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => sendThankYou(null)} style={{ marginTop: 14, alignItems: 'center' }}>
              <Text style={[S.linkText, { color: C.black }]}>Skip</Text>
            </Pressable>
          </View>
        </View>
      </View>
    )}
    </>
  );
}

// ── GIFTS RECEIVED (2026-09-15, PC's ask) — new quick action ───
// Items claimed via "Claim & Save for Later" above live here until the
// customer chooses to move one into their cart, at which point it's the
// same $0 cart line "Claim & Add to Cart" would have staged directly.
function GiftsReceivedScreen({ navigation, route, onHeaderBack }) {
  const customer = route?.params?.customer || null;
  const cart = useCart();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  // Circle-to-Circle Gift Delivery (2026-09-24) -- pending, Circle-matched
  // gifts not yet claimed at all (still status='issued' server-side).
  // Kept in a SEPARATE list/section from `items` above (already-'saved'
  // claimed gifts) -- a clear "New -- tap to claim" treatment, not merged
  // into the same rows.
  const [pendingItems, setPendingItems] = useState([]);
  const [movingId, setMovingId] = useState(null);
  const [infoModal, setInfoModal] = useState(null); // {title, message}
  const showInfo = (title, message) => setInfoModal({ title, message });

  const loadReceived = async () => {
    setLoading(true);
    const { ok, data } = await apiFetch('/gift-orders/received');
    if (ok && data?.success) {
      setItems(data.items || []);
      setPendingItems(data.pending_items || []);
    }
    setLoading(false);
  };

  useEffect(() => { loadReceived(); }, []);

  const handleAddToCart = async (item) => {
    setMovingId(item.id);
    const { ok, data } = await apiFetch(`/gift-orders/received/${item.id}/add-to-cart`, { method: 'POST' });
    setMovingId(null);
    if (ok && data?.success) {
      cart?.refreshCounts?.();
      setItems(prev => prev.filter(i => i.id !== item.id));
      showInfo('Added to Cart! 🛒', `${item.item_name_snapshot} is ready for checkout.`);
    } else {
      showInfo('Error', data?.detail || 'Could not add this gift to your cart.');
      loadReceived(); // may have been converted to credit server-side — refresh either way
    }
  };

  return (
    <>
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={loadReceived} tintColor={C.saffron} />}>
      <StatusBar style="light" />
      {/* Back-chevron removed (2026-09-23, PC's ask, app-wide audit) --
          Home tab is enough everywhere, arrow or not. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title="Gifts Received" onBack={onHeaderBack} />
      </View>
      {loading && items.length === 0 && pendingItems.length === 0 ? (
        <ActivityIndicator color={C.saffron} size="large" style={{ marginTop: 40 }} />
      ) : items.length === 0 && pendingItems.length === 0 ? (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <Text style={S.cardSub}>No gifts right now.</Text>
        </View>
      ) : (
        <View style={{ padding: 16 }}>
          {pendingItems.length > 0 && (
            <>
              <Text style={[S.sectionHeading, { marginBottom: 8 }]}>New</Text>
              {pendingItems.map(item => (
                <Pressable key={`pending-${item.id}`}
                  onPress={() => navigation.navigate('GiftClaim', { gift_order_id: item.gift_order_id })}
                  style={[S.menuItemCard, { borderColor: C.saffron, borderWidth: 1.5 }]}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ backgroundColor: C.saffron, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ color: C.white, fontSize: 10, fontWeight: '700' }}>NEW</Text>
                      </View>
                      <Text style={S.menuItemName}>{item.quantity}× {item.item_name_snapshot}</Text>
                    </View>
                    <Text style={S.menuItemPrice}>${(item.unit_price_cents * item.quantity / 100).toFixed(2)}</Text>
                    <Text style={S.menuItemHint}>From {item.gift_order_sender_name || 'a gift'}</Text>
                  </View>
                  {/* Explicit "Tap to Claim" affordance (2026-09-24, PC's
                      live report -- the whole card was already tappable,
                      but nothing signaled that clearly enough). Saffron,
                      not muted, so it reads as a call-to-action rather
                      than blending into the card's other info lines. */}
                  <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: C.saffron, fontSize: 11, fontWeight: '700', marginBottom: 2 }}>Tap to Claim</Text>
                    <Ionicons name="chevron-forward-circle" size={24} color={C.saffron} />
                  </View>
                </Pressable>
              ))}
              {items.length > 0 && <Text style={[S.sectionHeading, { marginTop: 16, marginBottom: 8 }]}>Claimed</Text>}
            </>
          )}
          {items.map(item => (
            <View key={item.id} style={S.menuItemCard}>
              <View style={{ flex: 1 }}>
                <Text style={S.menuItemName}>{item.quantity}× {item.item_name_snapshot}</Text>
                <Text style={S.menuItemPrice}>${(item.unit_price_cents * item.quantity / 100).toFixed(2)}</Text>
                {/* Fixed 2026-09-23, PC's live report -- was reading
                    gift_order_recipient_name, which is literally the
                    recipient's OWN name (whoever is viewing this screen),
                    not the sender's. Backend now returns the real sender
                    name as gift_order_sender_name (gift_orders_router.py's
                    GET /gift-orders/received, new LEFT JOIN to customers
                    via purchased_by_customer_id). */}
                <Text style={S.menuItemHint}>
                  From {item.gift_order_sender_name || 'a gift'} · claimed {item.claimed_at ? new Date(item.claimed_at).toLocaleDateString() : ''}
                </Text>
                <Pressable style={[S.btnSaffron, { marginTop: 10 }]} disabled={movingId === item.id} onPress={() => handleAddToCart(item)}>
                  {movingId === item.id
                    ? <ActivityIndicator color={C.ivory} />
                    : <View style={S.btnIconRow}><Ionicons name="cart-outline" size={16} color={C.white} /><Text style={S.btnSaffronText}>Add to Cart</Text></View>}
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => setInfoModal(null)}
    />
    </>
  );
}

// ── SHARED WITH YOU (2026-09-24, Share-a-Drink Circle-to-Circle retrofit) ──
// Landing page for the "Shared Sip" push notification's tap target --
// only reached when the share was matched directly to this customer's
// account server-side (routers/sip_router.py's share_drink, skipped the
// email/SMS + share_token/discover-drink web flow entirely). No claim
// step here, unlike Gift a Sip or Food -- purely informational, with a
// straight-to-crafting shortcut.
function SharedWithYouScreen({ navigation, route }) {
  const customer = route?.params?.customer || null;
  const shareId = route?.params?.share_id;
  const [loading, setLoading] = useState(true);
  const [shared, setShared] = useState(null);
  const [infoModal, setInfoModal] = useState(null); // {title, message}
  const showInfo = (title, message) => setInfoModal({ title, message });

  useEffect(() => {
    if (!shareId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { ok, data } = await apiFetch(`/sip/shared-with-you/${shareId}`);
      if (!cancelled) {
        if (ok && data?.success) setShared(data);
        else showInfo('Not available', data?.detail || 'This shared sip is no longer available.');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [shareId]);

  const handleCraft = () => {
    if (!shared) return;
    // Same presetDrink shape OrderScreen's own "Choose from Favorites" /
    // Reorder paths already feed it (App.js ~line 3670) -- routes into
    // the normal crafting flow, re-priced live, rather than a raw cart
    // add (this customer doesn't own the sharer's custom_drink_id, so
    // there's nothing to "reorder" directly).
    navigation.navigate('Order', {
      presetDrink: {
        drink_name:   shared.drink_name,
        description:  shared.description,
        ingredients:  shared.ingredients || [],
        drink_source: shared.drink_source === 'menu' ? 'menu' : 'custom',
        last_size_oz: 16,
      },
    });
  };

  if (loading) {
    return (
      <View style={[S.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={C.saffron} size="large" />
      </View>
    );
  }

  return (
    <>
    <ScrollView style={S.screen} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 60 }}>
      <StatusBar style="light" />
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title={'🍹 Shared With You'} />
      </View>
      {!shared ? (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <Text style={S.cardSub}>This shared sip is no longer available.</Text>
        </View>
      ) : (
        <View style={{ padding: 16 }}>
          <Text style={S.menuItemHint}>From {shared.sharer_first_name}</Text>
          <Text style={[S.drinkFullName, { marginTop: 4 }]}>{shared.drink_name}</Text>
          {!!shared.description && <Text style={S.drinkFullDesc}>{shared.description}</Text>}
          {shared.ingredients?.length > 0 && (
            <Text style={S.favIngredientsText}>
              <Text style={{ fontWeight: '700', color: C.charcoal }}>Ingredients: </Text>
              {shared.ingredients.map(i => typeof i === 'string' ? i : (i?.name || i?.ingredient_name || '')).filter(Boolean).join(', ')}
            </Text>
          )}
          {!!shared.discovery_narrative && (
            <View style={S.favDiscoveryBox}>
              <Text style={S.favDiscoveryText}>{shared.discovery_narrative}</Text>
            </View>
          )}
          <Pressable style={[S.btnSaffron, { marginTop: 20 }]} onPress={handleCraft}>
            <Text style={S.btnSaffronText}>Craft This Sip</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
    <InfoModal
      visible={!!infoModal}
      title={infoModal?.title}
      message={infoModal?.message}
      onClose={() => setInfoModal(null)}
    />
    </>
  );
}

// ── ORDER CHOOSER (2026-09-13) ────────────────────────────────
// Replaces the old behavior where the bottom tab bar's Order (✨) button
// jumped straight into the Craft-a-Custom-Sip flow. Now offers PC's 3
// options; Favorites reuses OrderScreen's own drink-result card via
// presetDrink (see OrderScreen's own comment) instead of a second,
// duplicate "drink card" UI.
function OrderChooserScreen({ navigation, route, onHeaderBack }) {
  const customer = route?.params?.customer || null;
  // In the group-order flow (opened with a backTo), each choice gets a back
  // arrow to here, and here back to the group order screen. Only while
  // onHeaderBack is live -- tabParams can hold a stale backTo otherwise.
  const backHere = onHeaderBack ? { backTo: { screen: 'OrderChooser', params: { backTo: route?.params?.backTo } } } : {};
  const [favOpen, setFavOpen] = useState(false);
  const [loadingFavs, setLoadingFavs] = useState(false);
  const [favorites, setFavorites] = useState([]);

  // Favorites open in a scrollable popup (PC, 2026-10-01) instead of
  // expanding inline, so the three choices stay evenly spaced. Reloaded on
  // every open so a just-saved favorite shows up.
  const openFavorites = async () => {
    setFavOpen(true);
    if (!customer?.id) return;
    setLoadingFavs(true);
    const { ok, data } = await apiFetch(`/sip/customer/${customer.id}/past-custom-drinks`);
    if (ok) setFavorites((data?.past_custom_drinks || []).filter(d => d.is_favorite));
    setLoadingFavs(false);
  };

  return (
    <>
    <ScrollView style={S.screen} pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ flexGrow: 1, paddingBottom: 60 }}>
      <StatusBar style="light" />
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
        {onHeaderBack ? <HeroBackArrow onPress={onHeaderBack} label="Back" /> : null}
        <View style={{ flex: 1 }}>
          <Text style={[S.wordmark, { fontSize: 22 }]}>SipSense™</Text>
          <Text style={[S.wordmarkSub, { marginTop: 2 }]}>HOW WOULD YOU LIKE TO ORDER?</Text>
        </View>
      </View>
      {/* Cards drop drinkFullCard's own margin (16 all round) so this View's
          spacing is the only spacing, and the three are spread evenly down
          the screen (PC, 2026-10-01). */}
      <View style={{ padding: 16, gap: 12, flexGrow: 1, justifyContent: 'space-evenly' }}>
        <Pressable style={[S.drinkFullCard, { margin: 0 }]} onPress={() => navigation.navigate('Order', backHere)}>
          <Text style={[S.drinkFullName, { textAlign: 'center' }]}>Craft My Drink</Text>
          <Text style={[S.cardSub, { marginBottom: 0 }]}>SipSense transforms your mood, cravings, and preferences into a personalized drink and food pairing crafted uniquely for you</Text>
        </Pressable>
        <Pressable style={[S.drinkFullCard, { margin: 0 }]} onPress={() => navigation.navigate('Menu', backHere)}>
          <Text style={[S.drinkFullName, { textAlign: 'center' }]}>Dasta Menu</Text>
          <Text style={[S.cardSub, { marginBottom: 0 }]}>Chai, Coffee and Food menu</Text>
        </Pressable>
        <Pressable style={[S.drinkFullCard, { margin: 0 }]} onPress={openFavorites}>
          <Text style={[S.drinkFullName, { textAlign: 'center' }]}>Favorites</Text>
          <Text style={[S.cardSub, { marginBottom: 0 }]}>Select & Reorder</Text>
        </Pressable>
      </View>
    </ScrollView>
    <SheetModal visible={favOpen} title="Your Favorites" onClose={() => setFavOpen(false)}>
      {loadingFavs ? <ActivityIndicator color={C.saffron} style={{ marginVertical: 20 }} /> :
        favorites.length === 0 ? <Text style={[S.cardSub, { marginTop: 8 }]}>No favorites saved yet.</Text> :
        favorites.map(f => (
          <Pressable key={f.custom_drink_id} style={S.profileMenuRow}
            onPress={() => { setFavOpen(false); navigation.navigate('Order', { presetDrink: f, ...backHere }); }}>
            <Text style={S.profileMenuRowText}>{f.drink_name}</Text>
          </Pressable>
        ))}
    </SheetModal>
    </>
  );
}

// ── MY CIRCLES (2026-09-27, mobile only for v1) ───────────────────
// SipSense_DDD_MyCircles.docx + "My Circles (Mobile App Only, v1)"
// instructions. Backend: SipSense_prod's routers/circles_router.py and
// core/my_circles.py. Every permission rule (owner-only add, owner-or-self
// remove, the join cutoff) is enforced server-side; hiding a control here
// is a courtesy, never the guard.

// Seconds until an ISO timestamp, re-rendering once a second.
function useSecondsUntil(iso) {
  const target = iso ? new Date(iso).getTime() : null;
  const [secs, setSecs] = useState(() => (target ? Math.max(0, Math.round((target - Date.now()) / 1000)) : 0));
  useEffect(() => {
    if (!target) return;
    const tick = () => setSecs(Math.max(0, Math.round((target - Date.now()) / 1000)));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [target]);
  return secs;
}

function formatCountdown(secs) {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}`;
}

// Full-screen QR scanner overlay. Scans only QR codes and stops after the
// first read (scannedRef) so one code can't fire two add-member calls.
function QrScanOverlay({ visible, title, hint, onScanned, onClose }) {
  const [permission, requestPermission] = useCameraPermissions();
  // Sits BETWEEN the persistent account header and the tab bar, like the
  // app's other popups (S.modalOverlay) -- it used to cover both, and the
  // header's profile icon drew on top of the scanner's own close X
  // (testing fixes round 1, item 4a). One header, one close control.
  const safeBottom = useSafeAreaInsets().bottom;
  const bottomInset = TAB_BAR_HEIGHT + (Platform.OS === 'android' ? safeBottom : 0);
  const scannedRef = useRef(false);
  useEffect(() => { if (visible) scannedRef.current = false; }, [visible]);
  if (!visible) return null;
  return (
    <View style={[S.qrScanOverlay, { bottom: bottomInset }]}>
      <View style={S.qrScanHeader}>
        <Text style={[S.wordmark, { fontSize: 18 }]}>{title}</Text>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close scanner">
          <Ionicons name="close" size={26} color={C.white} />
        </Pressable>
      </View>
      {!permission ? (
        <ActivityIndicator color={C.gold} size="large" style={{ marginTop: 80 }} />
      ) : !permission.granted ? (
        <View style={{ padding: 24, alignItems: 'center' }}>
          <Text style={[S.cardSub, { color: C.ivory, textAlign: 'center' }]}>
            Dasta needs your camera to scan a Dasta Account ID QR code.
          </Text>
          {permission.canAskAgain ? (
            <Pressable style={[S.btnSaffron, { marginTop: 16, alignSelf: 'stretch' }]} onPress={requestPermission}>
              <Text style={S.btnSaffronText}>Allow Camera</Text>
            </Pressable>
          ) : (
            <Pressable style={[S.btnSaffron, { marginTop: 16, alignSelf: 'stretch' }]} onPress={() => Linking.openSettings()}>
              <Text style={S.btnSaffronText}>Open Settings</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (scannedRef.current || !data) return;
              scannedRef.current = true;
              onScanned(data);
            }}
          />
          <View pointerEvents="none" style={S.qrScanFrameWrap}>
            <View style={S.qrScanFrame} />
            {!!hint && <Text style={S.qrScanHint}>{hint}</Text>}
          </View>
        </View>
      )}
    </View>
  );
}

function DastaAccountIdScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [acct, setAcct] = useState(null);
  useEffect(() => {
    (async () => {
      const { ok, data } = await apiFetch('/customer/dasta-account-id');
      if (ok && data?.success) setAcct(data);
      setLoading(false);
    })();
  }, []);
  return (
    <ScrollView pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom style={S.screen} contentContainerStyle={{ paddingBottom: 60 }}>
      <StatusBar style="light" />
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title={'Dasta Account ID'} />
      </View>
      <View style={{ padding: 20, alignItems: 'center' }}>
        {loading ? <ActivityIndicator color={C.saffron} size="large" style={{ marginTop: 40 }} /> : !acct ? (
          <Text style={S.cardSub}>Could not load your Dasta Account ID. Please try again.</Text>
        ) : (
          <>
            {/* STATIC by design -- never refreshes, unlike My Circle
                Account's 30-second rotating redemption QR. This one is a
                permanent identity for adding you to Circles, not a payment
                token. */}
            <View style={S.accountIdQrBox}>
              <QRCode value={acct.qr_payload} size={210} color={C.espresso} backgroundColor={C.white} />
            </View>
            <Text style={S.accountIdText} selectable>{acct.display}</Text>
            <Text style={[S.fieldHint, { textAlign: 'center' }]}>This code never changes.</Text>
            {/* Copy per SipSense_DDD_MyCircles §2.3 ("along these lines");
                verify against circles-foundation-idea.md's exact wording,
                which wasn't available when this was built. */}
            <Text style={[S.cardSub, { marginTop: 18, textAlign: 'center', lineHeight: 21 }]}>
              This ID is unique to you, while the phone number and email associated with it can be changed by you.
              By allowing a friend or family member to scan this QR code, you're giving them permission to add you to one of their Circles.
            </Text>
            <Pressable style={[S.btnOutlineLight, { marginTop: 22, alignSelf: 'stretch' }]} onPress={() => navigation.navigate('MyCircles')}>
              <Text style={S.btnOutlineLightText}>Go to My Circles</Text>
            </Pressable>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function MyCirclesScreen({ navigation, route }) {
  const [loading, setLoading] = useState(true);
  const [circles, setCircles] = useState([]);
  const [bonus, setBonus] = useState({ pending: 0, total: 0 });
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const load = async () => {
    setLoading(true);
    const [circlesRes, historyRes] = await Promise.all([
      apiFetch('/circles?include_archived=true'), apiFetch('/group-orders/history'),
    ]);
    if (circlesRes.ok && circlesRes.data?.success) {
      setCircles(circlesRes.data.circles || []);
      setBonus({ pending: circlesRes.data.circle_bonus_pending || 0, total: circlesRes.data.circle_bonus_leaves_earned_total || 0 });
    }
    if (historyRes.ok && historyRes.data?.success) setHistory(historyRes.data.group_orders || []);
    setLoading(false);
  };
  // refreshKey lets a caller (e.g. Leave Circle) force a reload even when
  // this screen was already the active one.
  useEffect(() => { load(); }, [route?.params?.refreshKey]);

  const owned = circles.filter(c => c.is_owner && c.status === 'active');
  const memberOf = circles.filter(c => !c.is_owner && c.status === 'active');
  const archived = circles.filter(c => c.is_owner && c.status === 'archived');

  const Row = ({ c }) => (
    <Pressable style={S.circleRow} onPress={() => navigation.navigate('CircleDetail', { circle_id: c.circle_id })}>
      <View style={{ flex: 1 }}>
        <Text style={S.menuItemName}>{c.display_name}</Text>
        <Text style={S.menuItemDesc}>
          {c.status === 'archived' ? 'Archived · add a member to bring it back' : `${c.member_count} member${c.member_count === 1 ? '' : 's'}`}
        </Text>
        {(() => {
          const open = (c.live_group_orders || (c.live_group_order ? [c.live_group_order] : [])).filter(g => g.status === 'open');
          if (open.length === 0) return null;
          // Every open group order gets its own tag + chips, soonest first
          // (PC, 2026-09-29 -- replaces "soonest one only", fourth-pass §3).
          return open.map(g => {
            const names = g.participant_first_names || [];
            const shown = names.slice(0, 4);
            return (
              <View key={g.group_order_id}>
                <Text style={S.circleLiveTag}>Group order open · pickup {formatLocalTime(g.pickup_time)}</Text>
                {names.length > 0 && (
                  <View style={S.chipRow}>
                    {shown.map((n, i) => (
                      <View key={i} style={[S.initialChip, i > 0 && { marginLeft: -6 }]}>
                        <Text style={S.initialChipText}>{(n || '?').trim().charAt(0).toUpperCase()}</Text>
                      </View>
                    ))}
                    {names.length > shown.length && <Text style={S.chipMore}>+{names.length - shown.length} more</Text>}
                  </View>
                )}
              </View>
            );
          });
        })()}
      </View>
      <Ionicons name="chevron-forward" size={18} color={C.muted} />
    </Pressable>
  );

  return (
    <>
    <ScrollView pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom style={S.screen} contentContainerStyle={{ paddingBottom: 60 }}>
      <StatusBar style="light" />
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <Text style={[S.wordmark, { fontSize: 22 }]}>My Circles</Text>
        <Text style={[S.wordmarkSub, { marginTop: 2 }]}>ORDER TOGETHER, EARN TOGETHER</Text>
      </View>
      <View style={{ padding: 16 }}>
        <Pressable style={S.btnSaffron} onPress={() => navigation.navigate('CreateCircle')}>
          <Text style={S.btnSaffronText}>＋ Create a Circle</Text>
        </Pressable>
        {/* Help links left, group-bonus pool status right (2026-09-30). The
            pool is global across all the customer's Circles. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 12 }}>
          <View style={{ flexShrink: 0, alignItems: 'flex-start' }}>
            <Pressable onPress={() => navigation.navigate('CircleHowTo')}>
              <Text style={[S.linkText, { textAlign: 'left', marginTop: 0 }]}>How to create my Circle?</Text>
            </Pressable>
            <Pressable onPress={() => navigation.navigate('CircleWhy')} style={{ marginTop: 4 }}>
              <Text style={[S.linkText, { textAlign: 'left' }]}>Why Create a Circle?</Text>
            </Pressable>
          </View>
          {!loading && (
            <View style={{ flex: 1, alignItems: 'flex-end', marginLeft: 12 }}>
              <Text style={{ color: C.black, fontSize: 12, textAlign: 'right' }}>
                {bonus.pending >= 0.5 ? '🍃 One more group order = a bonus leaf!' : 'Start a group order — earn half a bonus leaf'}
              </Text>
              <Text style={{ color: C.black, fontSize: 12, textAlign: 'right', marginTop: 4, fontWeight: '700' }}>
                Total Bonus Leaves Earned: {bonus.total}
              </Text>
            </View>
          )}
        </View>

        {loading ? <ActivityIndicator color={C.saffron} size="large" style={{ marginTop: 30 }} /> : (
          <>
            {/* Empty-state copy: verbatim from my-circles-help-and-benefits-copy.md
                ("Screen 0", PC-approved 2026-09-28) -- do not paraphrase. */}
            {owned.length === 0 && memberOf.length === 0 && (
              <Text style={[S.cardSub, { marginTop: 24, textAlign: 'center', lineHeight: 21 }]}>
                Create a circle with a friend, family member or a colleague by asking them to join Dasta Rewards, if they are interested to join, then ask them to allow you to scan their account ID QR code from their profile. After successful scan, you both will be in a circle where you can create a group order, order in advance, pay individually at your own convenience and pick up the group order at the time you specified.
              </Text>
            )}
            {/* Instructions §3 order: Circles you're in (owned first, then
                member-only) -> Group Order History -> Archived. */}
            {owned.length + memberOf.length > 0 && (
              <>
                <Text style={[S.fieldLabel, { marginTop: 22 }]}>Circles you're in</Text>
                {[...owned, ...memberOf].map(c => <Row key={c.circle_id} c={c} />)}
              </>
            )}
            {/* Same row + popup as Circle detail's Order History (PC,
                2026-09-28): shown the moment the customer is in any Circle,
                "None yet" until the first group order goes to the kitchen. */}
            {circles.length > 0 && (
              <Pressable style={[S.circleRow, { marginTop: 22 }]} onPress={() => setHistoryOpen(true)}
                accessibilityRole="button" accessibilityLabel="Group order history">
                <Ionicons name="receipt-outline" size={20} color={C.saffron} />
                <Text style={[S.menuItemName, { flex: 1 }]}>Group Order History</Text>
                <Text style={S.menuItemDesc}>{history.length === 0 ? 'None yet' : history.length}</Text>
                <Ionicons name="chevron-forward" size={18} color={C.muted} />
              </Pressable>
            )}
            {archived.length > 0 && (
              <>
                <Text style={[S.fieldLabel, { marginTop: 22, color: C.black }]}>Archived</Text>
                {archived.map(c => <Row key={c.circle_id} c={c} />)}
              </>
            )}
          </>
        )}
      </View>
    </ScrollView>
    <SheetModal visible={historyOpen} title="Group Order History" onClose={() => setHistoryOpen(false)}>
      {history.length === 0 ? (
        <Text style={[S.cardSub, { textAlign: 'left', marginTop: 8 }]}>
          No past group orders yet. Once one goes to the kitchen, it shows up here.
        </Text>
      ) : history.map(h => (
        /* Most recent pickup first, across every Circle. */
        <GroupOrderHistoryRow key={h.group_order_id} h={h}
          onPress={() => { setHistoryOpen(false); navigation.navigate('JoinGroupOrder', { group_order_id: h.group_order_id }); }} />
      ))}
    </SheetModal>
    </>
  );
}

const CIRCLE_LABEL_MAX = 11;
const CIRCLE_LABEL_PRESETS = ['Family', 'Friends', 'Co-Workers', 'Neighbors', 'Classmates', 'Roommates', 'Sorority', 'Colleagues'];

function CreateCircleScreen({ navigation, route }) {
  const customer = route?.params?.customer || null;
  const [preset, setPreset] = useState(null);      // a preset label, or 'custom'
  const [customLabel, setCustomLabel] = useState('');
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [infoModal, setInfoModal] = useState(null); // {title, message, onOk}
  const showInfo = (title, message, onOk) => setInfoModal({ title, message, onOk });

  const label = (preset === 'custom' ? customLabel : preset || '').trim();
  const preview = label ? `${customer?.first_name || 'My'} ${label} Circle` : null;

  const handleScanned = async (data) => {
    setScanning(false);
    setSaving(true);
    const { ok, data: res } = await apiFetch('/circles', { method: 'POST', body: { label, member_account_id: data } });
    setSaving(false);
    if (!ok || !res?.success) { showInfo("Couldn't create Circle", res?.detail || 'Please try again.'); return; }
    showInfo(res.reactivated ? 'Circle is back! 🎉' : 'Circle created! 🎉',
      `${res.added_member_first_name || 'Your friend'} is now in ${res.display_name}.`,
      () => navigation.navigate('CircleDetail', { circle_id: res.circle_id }));
  };

  return (
    <>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom style={S.screen} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 60 }}>
      <StatusBar style="light" />
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title={'Create a Circle'} onBack={() => navigation.navigate('MyCircles', { refreshKey: Date.now() })} />
      </View>
      <View style={{ padding: 16 }}>
        <Text style={S.fieldLabel}>1. Pick a label</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[...CIRCLE_LABEL_PRESETS, 'custom'].map(p => (
            <Pressable key={p} onPress={() => setPreset(p)} style={[S.menuCatTab, preset === p && S.menuCatTabActive]}>
              <Text style={[S.menuCatTabText, preset === p && S.menuCatTabTextActive]}>{p === 'custom' ? 'Custom…' : p}</Text>
            </Pressable>
          ))}
        </View>
        {preset === 'custom' && (
          <>
            <TextInput style={[S.input, { marginTop: 10 }]} value={customLabel} onChangeText={setCustomLabel}
              maxLength={CIRCLE_LABEL_MAX} placeholder="e.g. UBDC" placeholderTextColor={C.muted} autoCapitalize="words" />
            <Text style={S.fieldHint}>{customLabel.length}/{CIRCLE_LABEL_MAX} characters</Text>
          </>
        )}
        {!!preview && <Text style={[S.drinkFullName, { marginTop: 14 }]}>{preview}</Text>}

        <Text style={[S.fieldLabel, { marginTop: 22 }]}>2. Scan a friend to create it</Text>
        <Text style={S.cardSub}>
          A Circle always starts with at least one other person. Ask a friend who's with you to open
          Profile → Dasta Account ID, then scan their QR code.
        </Text>
        <Pressable style={[S.btnSaffron, { marginTop: 16 }, (!label || saving) && { opacity: 0.5 }]}
          disabled={!label || saving} onPress={() => setScanning(true)}>
          {saving ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Scan Account ID</Text>}
        </Pressable>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
    <QrScanOverlay visible={scanning} title="Scan to create" hint="Point at their Dasta Account ID QR"
      onScanned={handleScanned} onClose={() => setScanning(false)} />
    <InfoModal visible={!!infoModal} title={infoModal?.title} message={infoModal?.message}
      onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }} />
    </>
  );
}

function LiveGroupOrderCard({ order, onOpen, onView, onCancel, onCancelMine }) {
  const cutoffSecs = useSecondsUntil(order.join_cutoff_at);
  return (
    <View style={[S.groupOrderCard, { marginBottom: 10 }]}>
      <Text style={S.drinkFullName}>
        {order.status === 'pending' ? 'Your group order is waiting on your payment' : `${order.started_by_me ? 'You' : order.started_by_first_name} started a group order`}
      </Text>
      <Text style={S.cardSub}>
        Pickup {formatLocalTime(order.pickup_time)} · cutoff in {formatCountdown(cutoffSecs)}
        {order.status === 'open' ? ` · ${order.participant_count} in` : ''}
      </Text>
      {!!order.note && <Text style={S.groupOrderNote}>“{order.note}”</Text>}
      {/* One row, short labels (PC, 2026-09-29): View · Add (Join if you're
          not in yet) · Cancel -- Cancel only while your own contribution is
          held and joins are open (can_cancel; the server re-checks). A
          'pending' draft (nothing paid yet) shows Cancel · Finish order. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
        {order.status === 'open' && (
          <Pressable style={[S.btnOutlineLight, { flex: 1, marginTop: 0 }]} onPress={onView}>
            <Text style={S.btnOutlineLightText}>View</Text>
          </Pressable>
        )}
        {order.status === 'pending' && (
          <Pressable style={[S.btnOutlineLight, { flex: 1, marginTop: 0 }]} onPress={onCancel}>
            <Text style={S.btnOutlineLightText}>Cancel</Text>
          </Pressable>
        )}
        <Pressable style={[S.btnSaffron, { flex: 1, marginTop: 0, marginBottom: 0, width: undefined }]} onPress={onOpen}>
          <Text style={S.btnSaffronText}>
            {order.status === 'pending' ? 'Finish order' : order.i_have_joined ? 'Add/Edit' : 'Join'}
          </Text>
        </Pressable>
        {order.status === 'open' && order.can_cancel && (
          <Pressable style={[S.btnOutlineLight, { flex: 1, marginTop: 0 }]} onPress={onCancelMine}>
            <Text style={S.btnOutlineLightText}>Cancel</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function CircleDetailScreen({ navigation, route }) {
  const circleId = route?.params?.circle_id;
  const [loading, setLoading] = useState(true);
  const [circle, setCircle] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);     // {title, message, confirmLabel, onConfirm}
  const [infoModal, setInfoModal] = useState(null); // {title, message, onOk}
  const showInfo = (title, message, onOk) => setInfoModal({ title, message, onOk });
  // Members / Order History open as touch popups (PC, 2026-09-28).
  const [membersOpen, setMembersOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // "Choose a new owner" picker -- the last owner leaving with 2+ others
  // remaining must pick a successor (fourth-pass §2b; enforced server-side).
  const [successorOpen, setSuccessorOpen] = useState(false);
  const [history, setHistory] = useState([]);

  const load = async () => {
    if (!circleId) { setLoading(false); return; }
    setLoading(true);
    const [circleRes, historyRes] = await Promise.all([
      apiFetch(`/circles/${circleId}`), apiFetch(`/group-orders/history?circle_id=${circleId}`),
    ]);
    setCircle(circleRes.ok && circleRes.data?.success ? circleRes.data : null);
    setHistory(historyRes.ok && historyRes.data?.success ? (historyRes.data.group_orders || []) : []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [circleId]);

  // Several group orders can be open on one Circle at once (revised spec §2).
  const liveOrders = circle?.live_group_orders || (circle?.live_group_order ? [circle.live_group_order] : []);

  const addMember = async (scanned) => {
    setScanning(false);
    setBusy(true);
    const { ok, data } = await apiFetch(`/circles/${circleId}/members`, { method: 'POST', body: { member_account_id: scanned } });
    setBusy(false);
    if (!ok || !data?.success) { showInfo("Couldn't add member", data?.detail || 'Please try again.'); return; }
    showInfo('Added! 🎉', `${data.added_member_first_name || 'Your friend'} is now in ${circle.display_name}.`);
    load();
  };

  const errorText = (data, fallback) =>
    (typeof data?.detail === 'string' ? data.detail : data?.detail?.message) || fallback;

  const removeMember = async (m, newOwnerId) => {
    setBusy(true);
    const qs = newOwnerId ? `?new_owner_customer_id=${newOwnerId}` : '';
    const { ok, status, data } = await apiFetch(`/circles/${circleId}/members/${m.customer_id}${qs}`, { method: 'DELETE' });
    setBusy(false);
    if (!ok && status === 409 && data?.detail?.code === 'successor_required') { setSuccessorOpen(true); return; }
    if (!ok || !data?.success) { showInfo('Error', errorText(data, 'Please try again.')); return; }
    if (m.is_me) {
      if (data.new_owner_customer_id) {
        const newOwner = circle.members.find(x => x.customer_id === data.new_owner_customer_id);
        showInfo('You left the Circle', `${newOwner?.display_name || 'Your pick'} is now the owner of ${data.display_name}.`,
          () => navigation.navigate('MyCircles', { refreshKey: Date.now() }));
        return;
      }
      navigation.navigate('MyCircles', { refreshKey: Date.now() });
      return;
    }
    if (data.archived) {
      showInfo('Circle archived', `${circle.display_name} is down to one person, so it's archived. Add someone any time to bring it back.`,
        () => navigation.navigate('MyCircles', { refreshKey: Date.now() }));
      return;
    }
    load();
  };

  // "Cancel Order" on an unpaid draft: hard-deleted server-side, and the
  // in-progress checkout context dropped if it was this draft. No push, no
  // history, no leaf effect -- nothing was ever paid.
  const { groupOrder: activeGroupOrder, setGroupOrder } = useGroupOrder();
  const discardDraft = async (groupOrderId) => {
    setBusy(true);
    const { ok, data } = await apiFetch(`/group-orders/${groupOrderId}/discard`, { method: 'POST' });
    setBusy(false);
    if (!ok || !data?.success) { showInfo('Error', errorText(data, 'Please try again.')); return; }
    if (activeGroupOrder?.group_order_id === groupOrderId) setGroupOrder(null);
    load();
  };

  // "Cancel" on an open group order card -- the caller's own whole
  // contribution, before cutoff (fifth pass §2c). Hold released, no charge.
  const cancelMine = (g) => setConfirm({
    title: 'Cancel your order?',
    message: "This takes back everything you've added to this group order. Your payment hold is released — you won't be charged. Everyone else's order continues as normal.",
    confirmLabel: 'Cancel Order', cancelLabel: 'Keep it',
    onConfirm: async () => {
      setBusy(true);
      const { ok, data } = await apiFetch(`/group-orders/${g.group_order_id}/cancel-my-order`, { method: 'POST' });
      setBusy(false);
      if (!ok || !data?.success) { showInfo("Couldn't cancel", errorText(data, 'Please try again.')); load(); return; }
      showInfo('Order cancelled', data.group_order_cancelled
        ? "You weren't charged. You were the last one in, so this group order is now cancelled."
        : "You weren't charged, and you're no longer in this group order. You can rejoin any time before cutoff.");
      load();
    },
  });

  const setCoOwner = async (m, promote) => {
    setBusy(true);
    const { ok, data } = promote
      ? await apiFetch(`/circles/${circleId}/co-owners`, { method: 'POST', body: { customer_id: m.customer_id } })
      : await apiFetch(`/circles/${circleId}/co-owners/${m.customer_id}`, { method: 'DELETE' });
    setBusy(false);
    if (!ok || !data?.success) { showInfo('Error', errorText(data, 'Please try again.')); return; }
    load();
  };

  if (loading) {
    return <View style={[S.screen, { alignItems: 'center', justifyContent: 'center' }]}><StatusBar style="light" /><ActivityIndicator color={C.saffron} size="large" /></View>;
  }
  if (!circle) {
    return (
      <View style={[S.screen, { alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
        <StatusBar style="light" />
        <Text style={S.cardSub}>This Circle isn't available.</Text>
        <Pressable style={[S.btnSaffron, { marginTop: 16, alignSelf: 'stretch' }]} onPress={() => navigation.navigate('MyCircles', { refreshKey: Date.now() })}>
          <Text style={S.btnSaffronText}>My Circles</Text>
        </Pressable>
      </View>
    );
  }
  const me = circle.members.find(m => m.is_me);
  const archived = circle.status === 'archived';

  return (
    <>
    <ScrollView pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom style={S.screen} contentContainerStyle={{ paddingBottom: 60 }}>
      <StatusBar style="light" />
      {/* Back arrow, same as the group order screen (PC, 2026-09-29) --
          replaces the "‹ My Circles" link. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        {/* Same 44pt title row as HeroTitleRow, keeping this screen's own back target. */}
        <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <HeroBackArrow onPress={() => navigation.navigate('MyCircles', { refreshKey: Date.now() })} label="Back to My Circles" />
          <Text style={[S.wordmark, { fontSize: 22, flex: 1 }]}>{circle.display_name}</Text>
        </View>
      </View>
      <View style={{ padding: 16 }}>
        {archived ? (
          <View style={S.rewardVoucherBox}>
            <Text style={S.rewardVoucherText}>This Circle is archived. Add a member to bring it back — its history is still here.</Text>
          </View>
        ) : (
          <>
            {liveOrders.map(g => (
              <LiveGroupOrderCard key={g.group_order_id} order={g}
                onOpen={() => navigation.navigate('JoinGroupOrder', { group_order_id: g.group_order_id, viewOnly: false, refreshKey: Date.now() })}
                onView={() => navigation.navigate('JoinGroupOrder', { group_order_id: g.group_order_id, viewOnly: true, refreshKey: Date.now() })}
                onCancel={() => discardDraft(g.group_order_id)}
                onCancelMine={() => cancelMine(g)} />
            ))}
            <Pressable style={[S.btnSaffron, liveOrders.length > 0 && { marginTop: 12 }]}
              onPress={() => navigation.navigate('StartGroupOrder', { circle_id: circleId, circle_display_name: circle.display_name })}>
              <Text style={S.btnSaffronText}>Start a Group Order</Text>
            </Pressable>
            {circle.my_leaf_progress > 0 && (
              <Text style={{ color: C.black, fontSize: 13, marginTop: 10, textAlign: 'center' }}>
                🍃 You're halfway to a bonus leaf — one more group order in any Circle.
              </Text>
            )}
          </>
        )}

        {/* Order History, then Members -- each opens a scrollable popup. */}
        <Pressable style={[S.circleRow, { marginTop: 22 }]} onPress={() => setHistoryOpen(true)}
          accessibilityRole="button" accessibilityLabel="Order history">
          <Ionicons name="receipt-outline" size={20} color={C.saffron} />
          <Text style={[S.menuItemName, { flex: 1 }]}>Order History</Text>
          <Text style={S.menuItemDesc}>{history.length === 0 ? 'None yet' : history.length}</Text>
          <Ionicons name="chevron-forward" size={18} color={C.muted} />
        </Pressable>
        <Pressable style={S.circleRow} onPress={() => setMembersOpen(true)}
          accessibilityRole="button" accessibilityLabel="Members">
          <Ionicons name="people-outline" size={20} color={C.saffron} />
          <Text style={[S.menuItemName, { flex: 1 }]}>Members</Text>
          <Text style={S.menuItemDesc}>{circle.members.length}</Text>
          <Ionicons name="chevron-forward" size={18} color={C.muted} />
        </Pressable>

        {circle.is_owner && (
          <Pressable style={[S.btnOutlineLight, { marginTop: 16 }]} disabled={busy} onPress={() => setScanning(true)}>
            <Text style={[S.btnOutlineLightText, { color: C.black, fontSize: 17 }]}>Add Member</Text>
          </Pressable>
        )}

        {!!me && !archived && (
          <Pressable style={{ marginTop: 26, alignItems: 'center' }} disabled={busy} onPress={() => {
            const othersAfter = circle.members.length - 1;
            // Last owner with 2+ others staying: pick who takes over first.
            if (circle.is_owner && circle.owner_count === 1 && othersAfter >= 2) { setSuccessorOpen(true); return; }
            setConfirm({
              title: 'Leave this Circle?',
              message: othersAfter <= 1
                ? `A Circle needs at least two people, so leaving ends ${circle.display_name} — it will be archived. Any group order already paid for still goes ahead.`
                : `You'll stop seeing ${circle.display_name}. An owner can add you back by scanning your QR.`,
              confirmLabel: 'Leave', onConfirm: () => removeMember(me),
            });
          }}>
            <Text style={[S.linkText, { color: '#C0392B' }]}>Leave Circle</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
    <SheetModal visible={historyOpen} title="Order History" onClose={() => setHistoryOpen(false)}>
      {history.length === 0 ? (
        <Text style={[S.cardSub, { textAlign: 'left', marginTop: 8 }]}>
          No past group orders in this Circle yet. Once one goes to the kitchen, it shows up here.
        </Text>
      ) : history.map(h => (
        <GroupOrderHistoryRow key={h.group_order_id} h={h} showCircle={false}
          onPress={() => { setHistoryOpen(false); navigation.navigate('JoinGroupOrder', { group_order_id: h.group_order_id }); }} />
      ))}
    </SheetModal>
    <SheetModal visible={membersOpen} title={`Members (${circle.members.length})`} onClose={() => setMembersOpen(false)}>
      {circle.members.map(m => (
        <View key={m.customer_id} style={[S.circleRow, { flexWrap: 'wrap' }]}>
          <Text style={[S.menuItemName, { flex: 1 }]}>
            {m.display_name}{m.is_me ? ' (you)' : ''}
          </Text>
          {m.is_owner && <Text style={S.circleOwnerTag}>{circle.owner_count > 1 ? 'Co-owner' : 'Owner'}</Text>}
          {circle.is_owner && !m.is_me && (
            <View style={{ flexDirection: 'row', gap: 14, width: '100%', justifyContent: 'flex-end', marginTop: 6 }}>
              {!m.is_owner && circle.owner_count < (circle.max_owners || 2) && (
                <Pressable disabled={busy} hitSlop={10} onPress={() => { setMembersOpen(false); setCoOwner(m, true); }}>
                  <Text style={[S.linkText, { marginTop: 0 }]}>Make Co-Owner</Text>
                </Pressable>
              )}
              {m.is_owner && (
                <Pressable disabled={busy} hitSlop={10} onPress={() => { setMembersOpen(false); setCoOwner(m, false); }}>
                  <Text style={[S.linkText, { marginTop: 0 }]}>Remove as Co-Owner</Text>
                </Pressable>
              )}
              <Pressable disabled={busy} hitSlop={10} onPress={() => {
                setMembersOpen(false);
                setConfirm({
                  title: `Remove ${m.display_name}?`,
                  message: circle.members.length - 1 <= 1
                    ? `That leaves ${circle.display_name} with one person, so it will be archived.`
                    : `They'll no longer see ${circle.display_name}.`,
                  confirmLabel: 'Remove', onConfirm: () => removeMember(m),
                });
              }}>
                <Text style={[S.linkText, { marginTop: 0, color: '#C0392B' }]}>Remove</Text>
              </Pressable>
            </View>
          )}
        </View>
      ))}
      {/* Add Member lives here too (PC, 2026-09-28: it's the key action once a
          Circle exists). Owner-only, enforced server-side; a member instead
          sees who can add people, so a missing button isn't a mystery. */}
      {circle.is_owner ? (
        <Pressable style={[S.btnSaffron, { marginTop: 16, marginBottom: 0 }]} disabled={busy}
          onPress={() => { setMembersOpen(false); setScanning(true); }}>
          <Text style={S.btnSaffronText}>Add Member</Text>
        </Pressable>
      ) : (
        <Text style={[S.fieldHint, { marginTop: 14 }]}>
          Only {circle.members.filter(m => m.is_owner).map(m => m.display_name).join(' or ') || "the Circle's owner"} can add new members. To join someone to this Circle, ask them to show their Dasta Account ID QR to an owner.
        </Text>
      )}
    </SheetModal>
    <SheetModal visible={successorOpen} title="Choose a new owner" onClose={() => setSuccessorOpen(false)}>
      <Text style={[S.cardSub, { textAlign: 'left', marginTop: 4 }]}>
        You're the only owner, so someone has to take over before you leave. The Circle will be renamed after them.
      </Text>
      {circle.members.filter(m => !m.is_me).map(m => (
        <Pressable key={m.customer_id} style={S.circleRow} disabled={busy}
          onPress={() => { setSuccessorOpen(false); removeMember(me, m.customer_id); }}>
          <Text style={[S.menuItemName, { flex: 1 }]}>{m.display_name}</Text>
          <Text style={[S.linkText, { marginTop: 0 }]}>Make owner & leave</Text>
        </Pressable>
      ))}
    </SheetModal>
    <QrScanOverlay visible={scanning} title="Add a member" hint="Point at their Dasta Account ID QR"
      onScanned={addMember} onClose={() => setScanning(false)} />
    <ConfirmModal visible={!!confirm} title={confirm?.title} message={confirm?.message}
      confirmLabel={confirm?.confirmLabel} cancelLabel={confirm?.cancelLabel} onConfirm={() => confirm?.onConfirm()} onClose={() => setConfirm(null)} />
    <InfoModal visible={!!infoModal} title={infoModal?.title} message={infoModal?.message}
      onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }} />
    </>
  );
}

function StartGroupOrderScreen({ navigation, route }) {
  const circleId = route?.params?.circle_id;
  const circleName = route?.params?.circle_display_name;
  const { setGroupOrder } = useGroupOrder();
  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState([]);
  const [cutoffMinutes, setCutoffMinutes] = useState(60);
  const [picked, setPicked] = useState(null);
  const [note, setNote] = useState('');
  const [slotPickerOpen, setSlotPickerOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const cart = useCart();
  // Keep the note visible while typing (PC's report, 2026-09-28: the field
  // sits below the pickup-time list, and KeyboardAvoidingView alone shrank
  // the screen without scrolling the field into view). On keyboard show /
  // note focus, scroll to the end, where the note and buttons are. Android
  // also gets explicit bottom room the size of the keyboard rather than
  // relying on the window resizing, which edge-to-edge doesn't guarantee.
  const scrollRef = useRef(null);
  const [kbHeight, setKbHeight] = useState(0);
  const scrollToNote = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => { setKbHeight(e?.endCoordinates?.height || 0); scrollToNote(); });
    const hide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  // Same Favorites-based one-tap "My Usual" as the Join screen; the button
  // is omitted entirely with no saved favorite.
  const [usuals, setUsuals] = useState([]);
  useEffect(() => {
    (async () => {
      const { ok, data } = await apiFetch('/favorites/preview');
      if (ok && data?.success) setUsuals(data.items || []);
    })();
  }, []);
  const [infoModal, setInfoModal] = useState(null); // {title, message, onOk}
  const showInfo = (title, message, onOk) => setInfoModal({ title, message, onOk });

  useEffect(() => {
    (async () => {
      const { ok, data } = await apiFetch(`/circles/${circleId}/group-orders/pickup-slots`);
      if (ok && data?.success) { setSlots(data.slots || []); setCutoffMinutes(data.join_cutoff_minutes || 60); }
      setLoading(false);
    })();
  }, [circleId]);

  // Creates the unpaid draft + group-order context. No popup afterwards
  // (testing fixes round 1, item 2) -- each button goes straight on.
  const startDraft = async () => {
    const { ok, data } = await apiFetch(`/circles/${circleId}/group-orders`, {
      method: 'POST', body: { pickup_time: picked.pickup_time, note: note.trim() || undefined },
    });
    if (!ok || !data?.success) { showInfo("Couldn't start", data?.detail || 'Please try again.'); return false; }
    setGroupOrder({ group_order_id: data.group_order_id, circle_display_name: circleName,
      pickup_time: data.pickup_time, join_cutoff_at: data.join_cutoff_at, is_starter: true, is_new: true });
    return true;
  };

  const startPickItems = async () => {
    setStarting(true);
    const ok = await startDraft();
    setStarting(false);
    if (ok) navigation.navigate('OrderChooser', { backTo: { screen: 'StartGroupOrder', params: { circle_id: circleId, circle_display_name: circleName } } });
  };

  const startWithUsual = async () => {
    setStarting(true);
    if (!(await startDraft())) { setStarting(false); return; }
    if (usuals.length === 1) {
      const { ok } = await cart.addToCart(buildFavoriteAddPayload(usuals[0]));
      setStarting(false);
      if (ok) navigation.navigate('Cart');
      else showInfo('Error', "Couldn't add your usual to the cart. Please try again.");
      return;
    }
    setStarting(false);
    navigation.navigate('ChooseFavorite', { items: usuals, backTo: { screen: 'StartGroupOrder', params: { circle_id: circleId, circle_display_name: circleName } } });
  };

  return (
    <>
    {/* Keyboard-safe (testing fixes round 1, item 4b) -- the app's standard
        text-input pattern, same as Checkout / Personal Info / Add a Card:
        KeyboardAvoidingView (padding on iOS, height on Android) +
        a ScrollView that keeps taps and dismisses on drag. */}
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom ref={scrollRef} style={S.screen} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingBottom: 60 + (Platform.OS === 'android' ? kbHeight : 0) }}>
      <StatusBar style="light" />
      {/* Back to the Circle (PC, 2026-10-02) -- same banner as Group Order. */}
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
        <HeroBackArrow onPress={() => navigation.navigate('CircleDetail', { circle_id: circleId })} label="Back to Circle" />
        <View style={{ flex: 1 }}>
          <Text style={[S.wordmark, { fontSize: 22 }]}>Start a Group Order</Text>
          {!!circleName && <Text style={[S.wordmarkSub, { marginTop: 4 }]}>{circleName.toUpperCase()}</Text>}
        </View>
      </View>
      <View style={{ padding: 16 }}>
        <Text style={S.cardSub}>
          Pick a pickup time. Everyone who wants to join the group order will pick and pay for their own item before cutoff time
          {` (${cutoffMinutes} min before pickup)`} — then the kitchen makes it all together. If at least one other
          member joins the group order, everyone who ordered earns a half-leaf toward a bonus leaf, counted across all your Circles.
        </Text>
        <Text style={[S.fieldLabel, { marginTop: 18 }]}>Pickup time</Text>
        {loading ? <ActivityIndicator color={C.saffron} /> : slots.length === 0 ? (
          <Text style={S.cardSub}>No pickup times are far enough ahead right now. Try again a little later.</Text>
        ) : (
          // A single dropdown-style field instead of every slot as a pill
          // (PC, 2026-10-02): tapping it opens the slot list in a popup.
          <Pressable style={[S.input, { flexDirection: 'row', alignItems: 'center', marginBottom: 0 }]}
            onPress={() => setSlotPickerOpen(true)} accessibilityRole="button" accessibilityLabel="Choose a pickup time">
            <Text style={{ flex: 1, fontSize: 15, color: picked ? C.charcoal : C.muted }}>
              {picked ? formatSlotLabel(picked.pickup_time) : 'Choose a pickup time'}
            </Text>
            <Ionicons name="chevron-down" size={18} color={C.charcoal} />
          </Pressable>
        )}
        {!!picked && (
          <Text style={{ color: C.black, fontSize: 12, marginTop: 8 }}>Cutoff time for this group order is {formatLocalTime(picked.join_cutoff_at)}.</Text>
        )}
        <Text style={[S.fieldLabel, { marginTop: 18 }]}>Note (optional)</Text>
        <TextInput style={[S.input, { minHeight: 64, textAlignVertical: 'top' }]} value={note} onChangeText={setNote}
          onFocus={scrollToNote}
          maxLength={140} multiline placeholder="e.g. grabbing chai before the 9am meeting, join if free!"
          placeholderTextColor={C.muted} />
        <Text style={{ color: C.black, fontSize: 12, marginTop: -4, paddingLeft: 4 }}>{note.length}/140 · everyone in the Circle sees this, and it can't be changed later.</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 }}>
          {usuals.length > 0 && (
            <Pressable style={[S.btnOutlineLight, { flex: 1, marginTop: 0 }, (!picked || starting) && { opacity: 0.5 }]}
              disabled={!picked || starting} onPress={startWithUsual}>
              <Text style={S.btnOutlineLightText}>⚡ Add My Usual</Text>
            </Pressable>
          )}
          <Pressable style={[S.btnSaffron, { flex: 1, marginTop: 0, marginBottom: 0, width: undefined }, (!picked || starting) && { opacity: 0.5 }]}
            disabled={!picked || starting} onPress={startPickItems}>
            {starting ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Pick my items</Text>}
          </Pressable>
        </View>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
    <SheetModal visible={slotPickerOpen} title="Pickup time" onClose={() => setSlotPickerOpen(false)}>
      {slots.map(sl => {
        const on = picked?.pickup_time === sl.pickup_time;
        return (
          <Pressable key={sl.pickup_time} style={[S.profileMenuRow, { paddingHorizontal: 4 }]}
            onPress={() => { setPicked(sl); setSlotPickerOpen(false); }}>
            <Text style={[S.profileMenuRowText, { flex: 1, fontSize: 16 }, on && { fontWeight: '700', color: C.black }]}>{formatSlotLabel(sl.pickup_time)}</Text>
            {on && <Ionicons name="checkmark" size={20} color={C.saffron} />}
          </Pressable>
        );
      })}
    </SheetModal>
    <InfoModal visible={!!infoModal} title={infoModal?.title} message={infoModal?.message}
      onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }} />
    </>
  );
}

// "Fri 3:15 PM" -- a group-order pickup slot.
function formatSlotLabel(iso) {
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function JoinGroupOrderScreen({ navigation, route }) {
  const groupOrderId = route?.params?.group_order_id;
  const justPaid = !!route?.params?.justPaid;
  // "View" on the group order card (PC, 2026-09-29): read-only -- details
  // and who's in, no join/add/edit/cancel actions.
  const viewOnly = !!route?.params?.viewOnly;
  const { setGroupOrder } = useGroupOrder();
  const cart = useCart();
  const [loading, setLoading] = useState(true);
  const [go, setGo] = useState(null);
  const [joining, setJoining] = useState(false);
  // "Add My Usual" (fourth-pass §2 step 5.2): My Usual was merged into
  // Favorites (2026-08-10), so this reuses the same /favorites/preview
  // one-tap reorder Say[Mic]Go's "order my favorite" uses -- no second
  // reorder mechanism. Hidden entirely when there's no saved favorite.
  const [usuals, setUsuals] = useState([]);
  useEffect(() => {
    (async () => {
      const { ok, data } = await apiFetch('/favorites/preview');
      if (ok && data?.success) setUsuals(data.items || []);
    })();
  }, []);
  const [infoModal, setInfoModal] = useState(null); // {title, message, onOk}
  const showInfo = (title, message, onOk) => setInfoModal({ title, message, onOk });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmEdit, setConfirmEdit] = useState(false);

  const load = async () => {
    const { ok, data } = await apiFetch(`/group-orders/${groupOrderId}`);
    setGo(ok && data?.success ? data : null);
    setLoading(false);
    return ok && data?.success ? data : null;
  };
  // A card payment can settle server-side a moment after the card
  // sheet closes -- right after paying, re-check a few times until
  // this customer's own participation shows up.
  useEffect(() => {
    if (!groupOrderId) { setLoading(false); return; }
    let tries = 0, cancelled = false, timer = null;
    const poll = async () => {
      const d = await load();
      if (cancelled) return;
      if (justPaid && d && !d.i_have_joined && tries++ < 6) timer = setTimeout(poll, 2500);
    };
    poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [groupOrderId, justPaid, route?.params?.refreshKey]);

  const cutoffSecs = useSecondsUntil(go?.join_cutoff_at);

  // Server-side join gate first (cutoff etc.), then the group-order context
  // that Cart/Checkout read. Returns false if the gate refused.
  const enterGroupOrder = async () => {
    const { ok, data } = await apiFetch(`/group-orders/${groupOrderId}/join`, { method: 'POST' });
    if (!ok || !data?.success) { showInfo("Can't join", data?.detail || 'Please try again.'); load(); return false; }
    setGroupOrder({ group_order_id: groupOrderId, circle_display_name: go.circle_display_name,
      pickup_time: data.pickup_time, join_cutoff_at: data.join_cutoff_at, is_starter: go.started_by_me,
      is_new: go.status === 'pending' });
    return true;
  };

  // "Cancel Order" (fifth pass §2c): the viewer's whole contribution, any
  // time before cutoff. The hold is released -- nothing was charged. The
  // server rejects it at/after cutoff whatever this screen shows.
  const cancelMyOrder = async () => {
    setCancelling(true);
    const { ok, data } = await apiFetch(`/group-orders/${groupOrderId}/cancel-my-order`, { method: 'POST' });
    setCancelling(false);
    if (!ok || !data?.success) { showInfo("Couldn't cancel", data?.detail || 'Please try again.'); load(); return; }
    cart.refreshCounts();
    showInfo('Order cancelled',
      data.group_order_cancelled
        ? "You weren't charged. You were the last one in, so this group order is now cancelled."
        : "You weren't charged, and you're no longer in this group order. You can rejoin any time before cutoff.",
      data.group_order_cancelled ? () => navigation.navigate('CircleDetail', { circle_id: go.circle_id }) : undefined);
    load();
  };

  // "Edit My Order" (PC, 2026-09-29): the server puts this customer's held
  // items back in their cart and releases the hold; they change them in the
  // Cart and check out again (same group order) before the cutoff.
  const editMyOrder = async () => {
    setJoining(true);
    const { ok, data } = await apiFetch(`/group-orders/${groupOrderId}/edit-my-order`, { method: 'POST' });
    setJoining(false);
    if (!ok || !data?.success) { showInfo("Couldn't edit", data?.detail || 'Please try again.'); load(); return; }
    setGroupOrder({ group_order_id: groupOrderId, circle_display_name: data.circle_display_name || go.circle_display_name,
      pickup_time: data.pickup_time, join_cutoff_at: data.join_cutoff_at, is_starter: go.started_by_me, is_new: false });
    cart.refreshCounts();
    navigation.navigate('Cart');
  };

  const join = async () => {
    setJoining(true);
    const entered = await enterGroupOrder();
    setJoining(false);
    if (entered) navigation.navigate('OrderChooser', { backTo: { screen: 'JoinGroupOrder', params: { group_order_id: groupOrderId } } });   // no popup (testing fixes round 1, item 2)
  };

  const addMyUsual = async () => {
    setJoining(true);
    const entered = await enterGroupOrder();
    if (!entered) { setJoining(false); return; }
    if (usuals.length === 1) {
      const { ok } = await cart.addToCart(buildFavoriteAddPayload(usuals[0]));
      setJoining(false);
      if (ok) navigation.navigate('Cart');
      else showInfo('Error', "Couldn't add your usual to the cart. Please try again.");
      return;
    }
    setJoining(false);
    navigation.navigate('ChooseFavorite', { items: usuals, backTo: { screen: 'JoinGroupOrder', params: { group_order_id: groupOrderId } } });
  };

  if (loading) {
    return <View style={[S.screen, { alignItems: 'center', justifyContent: 'center' }]}><StatusBar style="light" /><ActivityIndicator color={C.saffron} size="large" /></View>;
  }
  if (!go) {
    return (
      <View style={[S.screen, { alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
        <StatusBar style="light" />
        <Text style={S.cardSub}>This group order isn't available.</Text>
        <Pressable style={[S.btnSaffron, { marginTop: 16, alignSelf: 'stretch' }]} onPress={() => navigation.navigate('MyCircles', { refreshKey: Date.now() })}>
          <Text style={S.btnSaffronText}>My Circles</Text>
        </Pressable>
      </View>
    );
  }

  const closed = !go.joinable;
  const statusLine = go.status === 'fired' || go.status === 'completed'
    ? `The kitchen has everyone's order — pickup at ${formatLocalTime(go.pickup_time)}.`
    : go.status === 'locked' ? `Cutoff time has passed — sending everyone's order to the kitchen for ${formatLocalTime(go.pickup_time)}.`
    : go.status === 'cancelled' ? 'This group order was cancelled — nobody was charged.'
    : closed ? 'Cutoff time for this group order has passed.'
    : `Cutoff in ${formatCountdown(cutoffSecs)} (at ${formatLocalTime(go.join_cutoff_at)}).`;

  return (
    <>
    <ScrollView pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom style={S.screen} contentContainerStyle={{ paddingBottom: 60 }}>
      <StatusBar style="light" />
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
        {/* Back to the Circle (PC, 2026-09-29) -- replaces the old
            "View Circle" link at the bottom of this screen. */}
        <HeroBackArrow onPress={() => navigation.navigate('CircleDetail', { circle_id: go.circle_id })} label="Back to Circle" />
        <View style={{ flex: 1 }}>
          <Text style={[S.wordmark, { fontSize: 22 }]}>Group Order</Text>
          {!!go.circle_display_name && <Text style={[S.wordmarkSub, { marginTop: 4 }]}>{go.circle_display_name.toUpperCase()}</Text>}
        </View>
      </View>
      <View style={{ padding: 16 }}>
        <View style={S.groupOrderCard}>
          <Text style={S.drinkFullName}>Pickup {formatLocalTime(go.pickup_time)}</Text>
          <Text style={S.cardSub}>Started by {go.started_by_me ? 'you' : go.started_by_first_name}</Text>
          {!!go.note && <Text style={S.groupOrderNote}>“{go.note}”</Text>}
          <Text style={[S.cardSub, { marginTop: 8, fontWeight: '700', color: closed ? C.black : C.saffron }]}>{statusLine}</Text>
        </View>

        {/* Read-only order details (history, or anything past cutoff):
            what everyone had, and when the ticket went to the kitchen. */}
        {(go.items || []).length > 0 && (
          <View style={[S.groupOrderCard, { marginTop: 14 }]}>
            <Text style={S.secTitle}>{go.joinable ? 'Order so far' : 'Order details'}</Text>
            {!!go.fired_at && (
              <Text style={[S.menuItemDesc, { marginBottom: 8 }]}>
                Sent to the kitchen {new Date(go.fired_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </Text>
            )}
            {go.items.map((it, i) => (
              <View key={i} style={{ flexDirection: 'row', paddingVertical: 4 }}>
                <Text style={[S.menuItemDesc, { width: 96, color: C.black, fontWeight: '600' }]} numberOfLines={1}>
                  {it.first_name}{it.is_me ? ' (you)' : ''}
                </Text>
                <Text style={[S.menuItemDesc, { flex: 1 }]}>
                  {it.quantity > 1 ? `${it.quantity}× ` : ''}{it.name}{it.size_oz ? ` · ${it.size_oz}oz` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}

        {justPaid && !go.i_have_joined && go.status !== 'cancelled' && (
          <Text style={[S.fieldHint, { marginTop: 12 }]}>Payment authorized — confirming your order…</Text>
        )}
        {go.my_payment_status === 'held' && (
          <View style={[S.rewardVoucherBox, { marginTop: 12 }]}>
            <Text style={S.rewardVoucherText}>{GROUP_HOLD_NOTE(go.join_cutoff_at)}</Text>
          </View>
        )}

        <Text style={[S.fieldLabel, { marginTop: 20 }]}>Who's in ({go.participants.length})</Text>
        {go.participants.length === 0 ? (
          <Text style={S.cardSub}>No one has paid yet.</Text>
        ) : go.participants.map((p, i) => (
          <View key={i} style={S.circleRow}>
            <Ionicons name="checkmark-circle" size={18} color={C.saffron} />
            <Text style={[S.menuItemName, { marginLeft: 8 }]}>{p.first_name}{p.is_me ? ' (you)' : ''}</Text>
          </View>
        ))}

        {/* Already in: Edit My Order + Add New Items. Not in yet: Add My
            Usual + Pick my items. View (read-only): nothing. */}
        {go.joinable && !viewOnly && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 }}>
            {go.my_payment_status === 'held' ? (
              <Pressable style={[S.btnOutlineLight, { flex: 1, marginTop: 0 }, joining && { opacity: 0.5 }]} disabled={joining} onPress={() => setConfirmEdit(true)}>
                <Text style={S.btnOutlineLightText}>Edit My Order</Text>
              </Pressable>
            ) : !go.i_have_joined && usuals.length > 0 ? (
              <Pressable style={[S.btnOutlineLight, { flex: 1, marginTop: 0 }, joining && { opacity: 0.5 }]} disabled={joining} onPress={addMyUsual}>
                <Text style={S.btnOutlineLightText}>⚡ Add My Usual</Text>
              </Pressable>
            ) : null}
            <Pressable style={[S.btnSaffron, { flex: 1, marginTop: 0, marginBottom: 0, width: undefined }, joining && { opacity: 0.5 }]} disabled={joining} onPress={join}>
              {joining ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>{go.i_have_joined ? 'Add New Items' : 'Pick my items'}</Text>}
            </Pressable>
          </View>
        )}
        {go.can_cancel && !viewOnly && (
          <Pressable style={[S.btnOutlineLight, { marginTop: 12 }, cancelling && { opacity: 0.5 }]}
            disabled={cancelling} onPress={() => setConfirmCancel(true)}>
            {cancelling ? <ActivityIndicator color={C.saffron} /> : <Text style={S.btnOutlineLightText}>Cancel Order</Text>}
          </Pressable>
        )}
        <Text style={[S.fieldHint, { marginTop: 12 }]}>
          Everyone pays for their own item — held when you join, charged at cutoff time. If at least one
          other member joins by the cutoff, everyone who ordered earns a half-leaf toward a bonus leaf, counted
          across all your Circles — once per group order, however many items you add.
        </Text>
      </View>
    </ScrollView>
    <ConfirmModal visible={confirmEdit} title="Edit your order?"
      message={`Your items go back to your cart so you can change them, and your current payment hold is released. Check out again before cutoff time (${formatLocalTime(go.join_cutoff_at)}) to stay in the group order.`}
      confirmLabel="Edit My Order" cancelLabel="Keep it"
      onConfirm={editMyOrder} onClose={() => setConfirmEdit(false)} />
    <ConfirmModal visible={confirmCancel} title="Cancel your order?"
      message="This takes back everything you've added to this group order. Your payment hold is released — you won't be charged. Everyone else's order continues as normal."
      confirmLabel="Cancel Order" cancelLabel="Keep it"
      onConfirm={cancelMyOrder} onClose={() => setConfirmCancel(false)} />
    <InfoModal visible={!!infoModal} title={infoModal?.title} message={infoModal?.message}
      onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }} />
    </>
  );
}

// Help/benefits pair -- two SEPARATE screens by design (How-to is purely
// instructional; Why is the persuasive pitch, linked from both My Circles
// and the bottom of How-to), mirroring the Discover Dasta Rewards /
// Rewards split.
//
// Copy is VERBATIM from my-circles-help-and-benefits-copy.md (PC,
// 2026-09-28; revised same day for the per-Circle half-leaf bonus and
// multiple open group orders) -- do not paraphrase; edit only against
// that file.
const CIRCLE_HOWTO_STEPS = [
  'Open Profile → My Circles → Create a Circle.',
  'Choose a label from the list — Family, Friends, Co-Workers, Neighbors, Classmates, Roommates, Sorority, Colleagues — or tap Custom to type your own (up to 11 characters).',
  'Your Circle is named automatically using your first name — for example, "Priya Friends Circle."',
  'Add at least one person to bring your Circle to life. Ask them to open their own Profile → Dasta Account ID and show you their QR code, then scan it. A Circle needs at least one other member besides you to exist.',
  "That's it — your Circle now appears at the top of your My Circles list, and everyone you've added sees it in theirs too.",
];
const CIRCLE_HOWTO_NOTES = [
  'Only you, as the owner, can add new members to a Circle you created. Anyone can remove themselves at any time.',
  'You can create as many Circles as you like — one for family, one for friends, one for your team — each with its own members.',
  "If everyone besides you ever leaves a Circle, it's set aside automatically (you'll get a notification) and its history is kept — add someone new later and it picks back up right where it left off.",
  "Group-order bonus leaves build up half a leaf at a time, counted across all of your Circles together — whenever a group order really happens, meaning someone else actually joins you, everyone who joined earns half a leaf, no matter which Circle it happened in. Two of those — in the same Circle or two different ones — and it becomes a full leaf, added straight to your rewards. Once you've earned a half-leaf, it's yours to keep for good, even if you later leave that Circle. A solo order that nobody else joins earns your usual leaf, just no bonus.",
];
const CIRCLE_BENEFITS = [
  { title: 'Order together, pay separately', body: 'anyone in your Circle can start a group order. Everyone who wants in picks and pays for their own drink or food, and it\'s all ready together for one pickup time. Want to add something to your own order after you\'ve already paid? Just go back in before the cutoff and add another item — it rides along with the rest.' },
  { title: 'Earn bonus leaves', body: 'every time a group order really happens (someone joins you), everyone who took part earns half a leaf — counted across all your Circles together, not just the one it happened in. Two of those and it adds up to a full extra leaf, yours to keep.' },
  { title: 'Know the moment it happens', body: 'the instant someone in your Circle starts a group order, everyone gets notified right away, so you can decide on the spot. Your Circle can have more than one group order going in the same day — join whichever pickup time works for you.' },
  { title: 'A reason to actually get together', body: 'your Circle makes it easy for friends, family, or coworkers to meet up for a chai, coffee, or breakfast and share ideas, thoughts, and — more importantly — have fun. Group ordering is the excuse; the meetup is the point.' },
  { title: 'Built for however your people are organized', body: 'a Family Circle, a Friends Circle, one for your team, your club, your sorority — create as many as you like.' },
];

function CircleHelpShell({ navigation, title, children }) {
  return (
    <ScrollView pinchGestureEnabled maximumZoomScale={3} minimumZoomScale={1} bouncesZoom style={S.screen} contentContainerStyle={{ paddingBottom: 60 }}>
      <StatusBar style="light" />
      <View style={[S.hero, { paddingTop: 54, paddingBottom: 20 }]}>
        <HeroTitleRow title={title} onBack={() => navigation.navigate('MyCircles', { refreshKey: Date.now() })} />
      </View>
      <View style={{ padding: 16 }}>
        {children}
      </View>
    </ScrollView>
  );
}

function CircleHowToScreen({ navigation }) {
  return (
    <CircleHelpShell navigation={navigation} title="How to Create My Circle">
      {CIRCLE_HOWTO_STEPS.map((step, i) => (
        <View key={i} style={S.helpStepRow}>
          <Text style={S.helpStepNum}>{i + 1}.</Text>
          <Text style={[S.cardSub, S.helpText]}>{step}</Text>
        </View>
      ))}
      <View style={S.helpNotesBox}>
        <Text style={S.secTitle}>A few things to know</Text>
        {CIRCLE_HOWTO_NOTES.map((note, i) => (
          <View key={i} style={S.helpStepRow}>
            <Text style={S.helpBullet}>•</Text>
            <Text style={[S.cardSub, S.helpText]}>{note}</Text>
          </View>
        ))}
      </View>
      <Pressable onPress={() => navigation.navigate('CircleWhy')} style={{ marginTop: 18, alignItems: 'center' }}>
        <Text style={S.linkText}>Curious what a Circle can do for you? See the benefits →</Text>
      </Pressable>
    </CircleHelpShell>
  );
}

function CircleWhyScreen({ navigation }) {
  return (
    <CircleHelpShell navigation={navigation} title="Why Create a Circle?">
      {CIRCLE_BENEFITS.map((b, i) => (
        <View key={i} style={S.helpStepRow}>
          <Text style={S.helpBullet}>•</Text>
          <Text style={[S.cardSub, S.helpText]}>
            <Text style={{ fontWeight: '700', color: C.charcoal }}>{b.title}</Text> — {b.body}
          </Text>
        </View>
      ))}
    </CircleHelpShell>
  );
}

// ── DEEP LINKS (iOS Universal Links, 2026-09-16) ────────────────
// Maps an incoming https://api.dastacafe.com/dasta-circle?open=... URL
// (the SAME claim_url the gift emails already send -- see
// SipSense_prod's universal_links_router.py + wallet_router.py) to a
// MainTabs tab + params. Only the two flows with a real native screen
// today; anything else (including discover-drink's own share/intent=gift
// links -- a separate, not-yet-scoped flow) returns null, so callers just
// ignore it and the OS's own normal web fallback handles the tap instead.
function parseDeepLink(url) {
  if (!url) return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.pathname !== '/dasta-circle') return null;
  const open = parsed.searchParams.get('open');
  if (open === 'gift_order_claim') {
    const token = parsed.searchParams.get('token');
    if (!token) return null;
    return { initialTab: 'GiftClaim', initialTabParams: { GiftClaim: { token } } };
  }
  if (open === 'redeem_gift_card') {
    return { initialTab: 'RedeemGiftCard', initialTabParams: {} };
  }
  // Auto-Reload Paused email's "Add Funds Now" button (2026-09-22,
  // renamed from 'manual_reload' to match the "Add Money" label used
  // everywhere else in the app/web) -- routes straight into the existing
  // native Add Money screen (same one MyCircleAccountScreen's "Reload
  // Dasta Card" button already opens, POST /wallet/reload + the Clover
  // card sheet) rather than any new charge mechanism. No
  // initialTabParams needed -- AddMoneyScreen reads `customer` from
  // MainTabs' own top-level route param, same as every other
  // fakeNav.navigate('AddMoney') call site.
  if (open === 'add_money') {
    return { initialTab: 'AddMoney', initialTabParams: {} };
  }
  return null;
}

// ── Idle Lock Overlay (2026-09-17) ─────────────────────────────────
// Warm in-app case: the app stays alive in JS memory (mid-session,
// foregrounded or briefly backgrounded) -- BootstrapScreen's own version
// of this same idle-bucket logic covers a cold relaunch instead (see its
// file comment). Mounted once inside MainTabs, guarded on a signed-in
// customer with Quick Unlock on -- same "only for a signed-in customer"
// scope limit BootstrapScreen's existing lock screen already applies.
//
// Single 2s poll loop instead of precisely-scheduled timers: simpler and
// just as correct for this UX (a warning appearing a couple seconds
// after the real 12:00 mark is imperceptible), and it sidesteps needing
// to reschedule a setTimeout on every touch. The loop only runs while
// actually foregrounded (per the file comment on IDLE_WARNING_MS --
// timers aren't reliable backgrounded, and nothing needs to keep
// ticking there); a backgrounded stretch is instead captured as one
// elapsed-time comparison the moment AppState reaches 'active' again.
function IdleLockOverlay({ customer, navigation }) {
  const [enabled, setEnabled] = useState(false);
  const [lockState, setLockState] = useState('none'); // 'none' | 'warning' | 'locked'
  const [remainingMs, setRemainingMs] = useState(0);
  const [checking, setChecking] = useState(false);
  const pollRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => { getQuickUnlockEnabled().then(setEnabled); }, []);

  const evaluate = () => {
    const elapsed = Date.now() - _lastActivityAt;
    const bucket = idleBucket(elapsed);
    setLockState(bucket);
    if (bucket === 'warning') setRemainingMs(IDLE_LOGOUT_MS - elapsed);
  };

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  const startPolling = () => { stopPolling(); evaluate(); pollRef.current = setInterval(evaluate, 2000); };

  useEffect(() => {
    if (!enabled || !customer) { stopPolling(); return; }
    if (AppState.currentState === 'active') startPolling();
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (next === 'active' && prev !== 'active') {
        evaluate();      // one-shot: did enough idle time pass while away?
        startPolling();  // resume the live cadence now that we're foregrounded again
      } else if (next !== 'active') {
        stopPolling();                                       // don't run JS timers backgrounded
        persistLastActivity(_lastActivityAt).catch(() => {}); // bridge a possible cold-kill while away
      }
    });
    return () => { sub.remove(); stopPolling(); };
  }, [enabled, customer]);

  const handleContinue = async () => {
    setChecking(true);
    const valid = await checkSessionStillValid();
    setChecking(false);
    if (!valid) { await fallbackToSignIn(navigation); return; }
    stampActivity();
    setLockState('none');
  };

  const handleUnlock = async () => {
    setChecking(true);
    const { ok: bioOk } = await runBiometricCheck('Unlock Dasta');
    if (!bioOk) { setChecking(false); return; } // stay on this screen -- "Sign in a different way" below covers the deliberate fallback
    const valid = await checkSessionStillValid();
    setChecking(false);
    if (!valid) { await fallbackToSignIn(navigation); return; }
    stampActivity();
    setLockState('none');
  };

  const handleLogOut = async () => { await fallbackToSignIn(navigation); };

  if (!enabled || !customer || lockState === 'none') return null;
  const minsLeft = Math.max(1, Math.ceil(remainingMs / 60000));

  return (
    <View style={S.idleLockOverlay}>
      <View style={S.idleLockCard}>
        {lockState === 'warning' ? (
          <>
            <Text style={S.drinkFullName}>Still there?</Text>
            <Text style={S.cardSub}>
              For your privacy, Dasta will lock in {minsLeft} minute{minsLeft === 1 ? '' : 's'} of inactivity.
            </Text>
            <Pressable style={[S.btnSaffron, { marginTop: 16 }]} disabled={checking} onPress={handleContinue}>
              {checking ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Yes, continue</Text>}
            </Pressable>
            <Pressable onPress={handleLogOut} disabled={checking} style={{ marginTop: 12, alignItems: 'center' }}>
              <Text style={[S.linkText, { color: C.black }]}>No, log out</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>🔒</Text>
            <Text style={S.drinkFullName}>Welcome back</Text>
            <Text style={S.cardSub}>For your privacy, continue to unlock this device.</Text>
            <Pressable style={[S.btnSaffron, { marginTop: 16 }]} disabled={checking} onPress={handleUnlock}>
              {checking ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>🔓 Unlock</Text>}
            </Pressable>
            <Pressable onPress={handleLogOut} disabled={checking} style={{ marginTop: 12, alignItems: 'center' }}>
              <Text style={[S.linkText, { color: C.black }]}>Sign in a different way</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

// ── MAIN TABS ─────────────────────────────────────────────────
function MainTabs({ route, navigation }) {
  const customer   = route?.params?.customer   || null;
  const initialTab = route?.params?.initialTab || 'Home';
  const [activeTab,  setActiveTab]  = useState(initialTab);
  const [tabParams,  setTabParams]  = useState({});
  // orderKey forces OrderScreen to remount fresh when "Start New Drink" is tapped
  const [orderKey,   setOrderKey]   = useState(0);
  // My Circles (2026-09-27) -- the group order the customer is currently
  // picking/paying for, if any (see GroupOrderContext).
  // Kept in SecureStore too (2026-10-01, PC's live report): it used to live
  // only in this component's state, so being signed out mid-order (a
  // connection drop) and signing back in rebuilt MainTabs without it --
  // the item was still in the server-side cart, Checkout showed no group
  // banner, and it went through as an ordinary ASAP order. Restored on
  // mount only while the server still says it's joinable for this customer.
  const [groupOrder, setGroupOrderState] = useState(null);
  const groupOrderKey = customer?.id ? `dasta_group_order_${customer.id}` : null;
  const setGroupOrder = useCallback((go) => {
    setGroupOrderState(go);
    if (!groupOrderKey) return;
    (go ? SecureStore.setItemAsync(groupOrderKey, JSON.stringify(go)) : SecureStore.deleteItemAsync(groupOrderKey))
      .catch(() => {});
  }, [groupOrderKey]);
  useEffect(() => {
    if (!groupOrderKey) return;
    let cancelled = false;
    (async () => {
      let saved = null;
      try { saved = JSON.parse(await SecureStore.getItemAsync(groupOrderKey) || 'null'); } catch {}
      if (!saved?.group_order_id) return;
      const forget = () => SecureStore.deleteItemAsync(groupOrderKey).catch(() => {});
      if (!(new Date(saved.join_cutoff_at) > new Date())) { forget(); return; }
      const { ok, data, networkError } = await apiFetch(`/group-orders/${saved.group_order_id}`);
      if (cancelled) return;
      // Offline: keep it -- /checkout/confirm re-checks the cutoff server-side.
      if (!networkError && !(ok && data?.joinable)) { forget(); return; }
      const restored = ok ? { ...saved, is_new: data.status === 'pending' } : saved;
      setGroupOrderState(prev => prev || restored);
    })();
    return () => { cancelled = true; };
  }, [groupOrderKey]);
  // Android nav-bar overlap fix (2026-09-19) -- see the import comment
  // above for why. iOS's home indicator doesn't overlap this custom
  // (non-SafeAreaView) tab bar the way Android's edge-to-edge nav bar
  // does, so this only adds padding on Android to avoid double-padding
  // iOS. insets.bottom covers BOTH 3-button nav (a fixed bar height) and
  // gesture nav (a slimmer handle-area height) correctly -- it's the
  // real system value either way, not a guessed constant for one style
  // that breaks on the other. Hook itself is always called (Platform.OS
  // never changes mid-lifecycle) -- only the value's use is conditional.
  const safeAreaBottom  = useSafeAreaInsets().bottom;
  const androidNavInset = Platform.OS === 'android' ? safeAreaBottom : 0;

  useEffect(() => {
    if (route?.params?.initialTab) setActiveTab(route.params.initialTab);
    // initialTabParams (2026-09-16, deep links) -- lets a caller (Bootstrap
    // on cold start, the warm-start Linking listener in App() below) seed
    // tabParams the same way fakeNav.navigate(screen, params) would from
    // inside this component. A fresh object each call (see parseDeepLink)
    // means this fires correctly even navigating to the SAME tab twice in
    // a row with a different token.
    if (route?.params?.initialTabParams) {
      setTabParams(prev => ({ ...prev, ...route.params.initialTabParams }));
    }
  }, [route?.params?.initialTab, route?.params?.initialTabParams]);

  // Icon swap (2026-09-13) -- vector icons instead of emoji for the tab
  // bar (an emoji here is the ONLY thing marking the control; renders
  // inconsistently across iOS/Android/OS versions). Copy/personality
  // emoji elsewhere in the app (greetings, loader messages, success
  // alerts) are deliberately left untouched.
  const tabs = [
    { name: 'Home',    icon: 'home',                label: 'Home'    },
    // Menu -> Scan (2026-09-29, PC): Menu duplicated Order -> Dasta Menu,
    // which still opens the same MenuScreen (kept mounted below).
    { name: 'Scan',    icon: 'qr-code-outline',      label: 'Scan'    },
    { name: 'Order',   icon: 'sparkles',             label: 'Order'   },
    { name: 'Rewards', icon: 'trophy-outline',       label: 'Rewards' },
    { name: 'More',    icon: 'ellipsis-horizontal',  label: 'More'    },
  ];

  // Header back arrow (2026-09-30, PC): a screen opened from the Say[Mic]Go
  // quick links or from More gets a back arrow to where it was opened from
  // -- the lightning-bolt list (Home with the list reopened) or the More
  // tab. Only while that screen is showing, and only when it really was
  // opened from there: any other way of arriving (the profile menu, a tab,
  // leaving and coming back) clears it, so a screen never claims a "back"
  // the customer didn't come from.
  const [backOrigin, setBackOrigin] = useState(null);   // { screen, from: 'quickLinks' | 'More' | 'quickActions' }
  const [reopenQuickLinks, setReopenQuickLinks] = useState(0);
  useEffect(() => {
    // Pairing is part of the Order screen (kept mounted under it), so an
    // Order back target survives a trip to Pairing and back.
    if (backOrigin && activeTab !== backOrigin.screen && !(backOrigin.screen === 'Order' && activeTab === 'Pairing')) setBackOrigin(null);
  }, [activeTab]);
  const headerBack = (screen) => {
    if (!backOrigin || backOrigin.screen !== screen) return undefined;
    if (backOrigin.from === 'quickLinks') {
      return () => { setBackOrigin(null); setActiveTab('Home'); setReopenQuickLinks(k => k + 1); };
    }
    if (backOrigin.from === 'quickActions') {
      // My Dasta Account, on its Saved Cards + Quick Actions page.
      return () => {
        setBackOrigin(null);
        setTabParams(prev => ({ ...prev, MyCircleAccount: { openTransactions: false, page: 1, navKey: Date.now() } }));
        setActiveTab('MyCircleAccount');
      };
    }
    if (backOrigin.from === 'backTo') {
      return () => {
        const bt = backOrigin.backTo;
        setBackOrigin(null);
        // Back to Start a Group Order from an unpaid new draft: discard it,
        // same as the group banner's X, so picking a time again doesn't
        // leave an orphan pending group order behind.
        if (bt.screen === 'StartGroupOrder' && groupOrder?.is_new) {
          apiFetch(`/group-orders/${groupOrder.group_order_id}/discard`, { method: 'POST' });
          setGroupOrder(null);
        }
        fakeNav.navigate(bt.screen, bt.params);
      };
    }
    if (backOrigin.from === 'Rewards') {
      // Redeem My Free Drink opened from the Rewards tab (PC, 2026-10-01).
      return () => { setBackOrigin(null); setActiveTab('Rewards'); };
    }
    return () => { setBackOrigin(null); setActiveTab('More'); };
  };

  const fakeNav = {
    navigate: (screen, params) => {
      const target = screen === 'MainTabs' ? params?.initialTab : screen;
      // backTo (PC, 2026-10-02): { screen, params } to return to -- params can
      // carry that screen's own backTo, so a chain (Circle -> Start a Group
      // Order -> choices -> Menu) can be walked back one step at a time.
      const from = params?.fromQuickLinks ? 'quickLinks' : params?.fromMore ? 'More'
        : params?.fromQuickActions ? 'quickActions' : params?.fromRewards ? 'Rewards'
        : params?.backTo ? 'backTo' : null;
      setBackOrigin(from && target ? { screen: target, from, backTo: params?.backTo } : null);
      if (['SignIn', 'ProfileStack'].includes(screen)) {
        navigation.navigate(screen, params);
      } else if (screen === 'MainTabs') {
        if (params?.initialTab) setActiveTab(params.initialTab);
      } else if (screen === 'StartNewDrink') {
        // Remount OrderScreen fresh (chip selection) then show it
        setOrderKey(k => k + 1);
        setActiveTab('Order');
      } else {
        if (params) setTabParams(prev => ({ ...prev, [screen]: params }));
        setActiveTab(screen);
      }
    },
    goBack: () => {
      // Pairing ← Back → drink card (Order tab, state preserved since OrderScreen stays mounted)
      if (activeTab === 'Pairing') setActiveTab('Order');
      else navigation.goBack();
    },
  };

  // Sign Out (2026-09-11) — clears the dasta_session cookie server-side
  // (POST /auth/logout is idempotent, so this is safe even if the
  // session already lapsed) and resets the top-level stack back to
  // SignIn so "back" can't return into a now-signed-out MainTabs.
  const handleSignOut = async () => {
    try { await apiFetch('/auth/logout', { method: 'POST' }); } catch {}
    navigation.reset({ index: 0, routes: [{ name: 'SignIn' }] });
  };

  // Account deletion (2026-09-16) — POST /account/delete already cleared
  // the session cookie server-side (unlike Sign Out, no separate
  // /auth/logout call needed here), so this just resets the stack the
  // same way handleSignOut does.
  //
  // Branded InfoModal (2026-09-16 sweep), onOk deferring the reset --
  // navigation.reset() here is the REAL React Navigation stack (not
  // fakeNav), so it unmounts MainTabs (and any modal it renders)
  // immediately; the reset now only fires once the customer dismisses
  // the confirmation, same pattern as every other screen in this sweep
  // whose success message was followed by an immediate navigate/close.
  const [infoModal, setInfoModal] = useState(null); // {title, message, onOk}
  const handleAccountDeleted = () => {
    setInfoModal({
      title: 'Account Deleted', message: 'Your account has been deleted.',
      onOk: () => navigation.reset({ index: 0, routes: [{ name: 'SignIn' }] }),
    });
  };

  const screenProps = { route: { params: { customer, guest: !customer } }, navigation: fakeNav };
  // Order tab now covers the chooser too (2026-09-13) — tapping the ✨
  // Order tab lands on OrderChooser, not straight into the craft flow;
  // 'Order'/'Pairing' cover the craft flow itself, reached via the
  // chooser's "Craft My Drink" option or a Favorites pick.
  const isOrderActive = ['Order', 'Pairing', 'OrderChooser', 'Menu'].includes(activeTab);

  return (
    <LanguageProvider>
    <CartProvider customer={customer}>
    <GroupOrderContext.Provider value={{ groupOrder, setGroupOrder }}>
    <View style={{ flex: 1 }}>
      {/* Screens kept mounted with display toggle — state survives tab switches */}
      <View style={{ flex: 1, display: activeTab === 'Home' ? 'flex' : 'none' }}>
        <HomeScreen {...screenProps} onSignOut={handleSignOut} isActive={activeTab === 'Home'} reopenQuickLinks={reopenQuickLinks} />
      </View>
      <View style={{ flex: 1, display: activeTab === 'Menu' ? 'flex' : 'none' }}>
        <MenuScreen {...screenProps} isActive={activeTab === 'Menu'} onHeaderBack={headerBack('Menu')} />
      </View>
      <View style={{ flex: 1, display: activeTab === 'Scan' ? 'flex' : 'none' }}>
        <ScanScreen {...screenProps} isActive={activeTab === 'Scan'} />
      </View>
      <View style={{ flex: 1, display: activeTab === 'OrderChooser' ? 'flex' : 'none' }}>
        <OrderChooserScreen route={{ params: { customer, ...tabParams['OrderChooser'] } }} navigation={fakeNav} onHeaderBack={headerBack('OrderChooser')} />
      </View>
      {/* OrderScreen stays mounted while Pairing is shown so drink card state is preserved */}
      <View style={{ flex: 1, display: ['Order', 'Pairing'].includes(activeTab) ? 'flex' : 'none' }}>
        <OrderScreen key={orderKey}
          route={{ params: { customer, guest: !customer, ...tabParams['Order'] } }}
          navigation={fakeNav} onHeaderBack={headerBack('Order')} />
      </View>
      <View style={{ flex: 1, display: activeTab === 'Rewards' ? 'flex' : 'none' }}>
        <RewardsScreen {...screenProps} isActive={activeTab === 'Rewards'} />
      </View>
      <View style={{ flex: 1, display: activeTab === 'More' ? 'flex' : 'none' }}>
        <MoreScreen {...screenProps} />
      </View>

      {/* My Profile / Cart / Gift / Wallet screens — not part of the 5-tab
          bar, only mounted while actually active (unlike the tabs above,
          which stay mounted for state preservation these don't need). */}
      {activeTab === 'PersonalInfo' && <PersonalInfoScreen {...screenProps} />}
      {activeTab === 'NotificationPreferences' && <NotificationPreferencesScreen {...screenProps} />}
      {activeTab === 'SignInContact' && <SignInContactScreen {...screenProps} />}
      {activeTab === 'MyCircleAccount' && (
        <MyCircleAccountScreen navigation={fakeNav} onHeaderBack={headerBack('MyCircleAccount')}
          route={{ params: { customer, guest: !customer, ...tabParams['MyCircleAccount'] } }} />
      )}
      {activeTab === 'LeafLoyaltyDemo' && <LeafLoyaltyDemoScreen {...screenProps} onHeaderBack={headerBack('LeafLoyaltyDemo')} />}
      {activeTab === 'JourneyToDasta' && <JourneyToDastaScreen navigation={fakeNav} onHeaderBack={headerBack('JourneyToDasta')} />}
      {activeTab === 'MeetSipSense' && <MeetSipSenseScreen navigation={fakeNav} onHeaderBack={headerBack('MeetSipSense')} />}
      {activeTab === 'AcademicReferences' && <AcademicReferencesScreen navigation={fakeNav} onHeaderBack={headerBack('AcademicReferences')} />}
      {activeTab === 'DiscoverRewards' && <DiscoverRewardsScreen navigation={fakeNav} onHeaderBack={headerBack('DiscoverRewards')} />}
      {activeTab === 'PrivacyPolicy' && <LegalDocumentScreen slug="privacy-policy" title="Privacy Policy" navigation={fakeNav} onHeaderBack={headerBack('PrivacyPolicy')} />}
      {activeTab === 'TermsOfUse' && <LegalDocumentScreen slug="terms-of-use" title="Terms of Use" navigation={fakeNav} onHeaderBack={headerBack('TermsOfUse')} />}
      {activeTab === 'JoinOurTeam' && <JoinOurTeamScreen navigation={fakeNav} onHeaderBack={headerBack('JoinOurTeam')} />}
      {activeTab === 'Contact' && <ContactScreen navigation={fakeNav} onHeaderBack={headerBack('Contact')} />}
      {activeTab === 'Cart' && <CartScreen route={{ params: { customer } }} navigation={fakeNav} />}
      {activeTab === 'Checkout' && <CheckoutScreen route={{ params: { customer } }} navigation={fakeNav} onHeaderBack={headerBack('Checkout')} />}
      {activeTab === 'GiftDraft' && <GiftDraftScreen route={{ params: { customer } }} navigation={fakeNav} onHeaderBack={headerBack('GiftDraft')} />}
      {activeTab === 'AddMoney' && <AddMoneyScreen route={{ params: { customer } }} navigation={fakeNav} onHeaderBack={headerBack('AddMoney')} />}
      {activeTab === 'GiftCardPurchase' && <GiftCardPurchaseScreen route={{ params: { customer } }} navigation={fakeNav} onHeaderBack={headerBack('GiftCardPurchase')} />}
      {activeTab === 'RedeemGiftCard' && <RedeemGiftCardScreen route={{ params: { customer } }} navigation={fakeNav} onHeaderBack={headerBack('RedeemGiftCard')} />}
      {activeTab === 'RedeemGift' && <RedeemGiftScreen route={{ params: { customer } }} navigation={fakeNav} onHeaderBack={headerBack('RedeemGift')} />}
      {activeTab === 'GiftClaim' && <GiftClaimScreen route={{ params: { customer, ...tabParams['GiftClaim'] } }} navigation={fakeNav} />}
      {activeTab === 'GiftsReceived' && <GiftsReceivedScreen route={{ params: { customer } }} navigation={fakeNav} onHeaderBack={headerBack('GiftsReceived')} />}
      {activeTab === 'SharedWithYou' && <SharedWithYouScreen route={{ params: { customer, ...tabParams['SharedWithYou'] } }} navigation={fakeNav} />}
      {activeTab === 'RedeemFreeDrink' && <RedeemFreeDrinkScreen route={{ params: { customer } }} navigation={fakeNav} onHeaderBack={headerBack('RedeemFreeDrink')} />}
      {activeTab === 'ChooseFavorite' && <ChooseFavoriteScreen route={{ params: { customer, ...tabParams['ChooseFavorite'] } }} navigation={fakeNav} onHeaderBack={headerBack('ChooseFavorite')} />}
      {/* My Circles (2026-09-27) -- push payloads route here by screen name
          (JoinGroupOrder / CircleDetail / MyCircles), via the same
          notificationDataToDeepLink -> initialTabParams path as every other push. */}
      {activeTab === 'DastaAccountId' && <DastaAccountIdScreen navigation={fakeNav} />}
      {activeTab === 'MyCircles' && <MyCirclesScreen route={{ params: { customer, ...tabParams['MyCircles'] } }} navigation={fakeNav} />}
      {activeTab === 'CreateCircle' && <CreateCircleScreen route={{ params: { customer } }} navigation={fakeNav} />}
      {activeTab === 'CircleDetail' && <CircleDetailScreen key={tabParams['CircleDetail']?.circle_id} route={{ params: { customer, ...tabParams['CircleDetail'] } }} navigation={fakeNav} />}
      {activeTab === 'StartGroupOrder' && <StartGroupOrderScreen route={{ params: { customer, ...tabParams['StartGroupOrder'] } }} navigation={fakeNav} />}
      {activeTab === 'JoinGroupOrder' && <JoinGroupOrderScreen key={tabParams['JoinGroupOrder']?.group_order_id} route={{ params: { customer, ...tabParams['JoinGroupOrder'] } }} navigation={fakeNav} />}
      {activeTab === 'CircleHowTo' && <CircleHowToScreen navigation={fakeNav} />}
      {activeTab === 'CircleWhy' && <CircleWhyScreen navigation={fakeNav} />}

      {/* Pairing overlays on top of the Order screen (drink card visible behind if needed).
          bottom uses the same Android nav-bar-aware tab bar height as above,
          not a bare 66 -- otherwise this would sit UNDER the taller Android
          tab bar by androidNavInset pixels. */}
      {activeTab === 'Pairing' && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: TAB_BAR_HEIGHT + androidNavInset }}>
          <PairingScreen
            route={{ params: { ...tabParams['Pairing'], customer, guest: !customer } }}
            navigation={fakeNav}
          />
        </View>
      )}

      {/* Persistent My Account/profile header (2026-09-13) — one copy,
          always on top, regardless of which screen under MainTabs is
          active. Matches the tab bar's own "always visible" convention. */}
      <GlobalAccountHeader customer={customer} navigation={fakeNav} onSignOut={handleSignOut} onAccountDeleted={handleAccountDeleted} activeTab={activeTab} />

      {/* Idle-based session lock (2026-09-17) -- real navigation, not
          fakeNav: a lock/logout needs to reset the actual root stack. */}
      <IdleLockOverlay customer={customer} navigation={navigation} />

      {/* Tab bar — ALWAYS visible on every screen. Extra bottom padding on
          Android only (androidNavInset) so the system nav bar/gesture
          handle never overlaps these buttons under edge-to-edge display. */}
      <View style={[S.tabBar, { height: TAB_BAR_HEIGHT + androidNavInset, paddingBottom: TAB_BAR_PADDING_BOTTOM + androidNavInset }]}>
        {tabs.map(tab => {
          const isActiveTab = (isOrderActive && tab.name === 'Order') || activeTab === tab.name;
          // Contrast fix (2026-09-17), corrected same day per tester
          // feedback -- Home was special-cased to always render Saffron,
          // which left it lit up alongside whichever tab was actually
          // active. Same rule for all five tabs now, Home included: bright
          // Saffron when active, pure white when not -- exactly one tab
          // highlighted at a time.
          const tabColor = isActiveTab ? C.saffron : C.white;
          return (
            <Pressable
              key={tab.name}
              style={({pressed}) => [S.tabItem, pressed && {opacity:0.7}]}
              onPress={() => setActiveTab(tab.name === 'Order' ? 'OrderChooser' : tab.name)}>
              <Ionicons name={tab.icon} size={22} color={tabColor} />
              <Text style={[S.tabLabel, { color: tabColor }]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <InfoModal
        visible={!!infoModal}
        title={infoModal?.title}
        message={infoModal?.message}
        onClose={() => { const cb = infoModal?.onOk; setInfoModal(null); cb?.(); }}
      />
    </View>
    </GroupOrderContext.Provider>
    </CartProvider>
    </LanguageProvider>
  );
}

// ── ROOT NAVIGATOR ────────────────────────────────────────────
// NEW: NotifyPerm added between ProfileStack and MainTabs
// ── BOOTSTRAP SCREEN ──────────────────────────────────────────
// (2026-09-11) First thing the app shows on cold launch. Checks
// GET /auth/me against whatever dasta_session cookie iOS's native
// cookie jar already has on file — that cookie survives app restarts
// the same way it survives a browser restart, so a customer who signed
// in previously lands straight in MainTabs, never re-prompted for an
// OTP. A missing/expired/invalid session (get_optional_customer_id-
// style: never an error state here) just goes to SignIn like a first
// launch would.
//
// (2026-09-12) If quick-unlock is enabled on this device, a valid
// session additionally gates behind Face ID/Touch ID here before
// MainTabs — see the file comment on the LocalAuthentication import
// above for why this is local-only, not a Cognito passkey.
function BootstrapScreen({ navigation }) {
  // 'locked' (>=15 min idle, Face ID needed) | 'warning' (12-15 min,
  // "Still there?" countdown) | null (still checking, or nothing to show)
  const [bootState,       setBootState]       = useState(null);
  const [pendingCustomer, setPendingCustomer] = useState(null);
  const [checking,        setChecking]        = useState(false);
  const [warnRemainingMs, setWarnRemainingMs] = useState(0);
  // Cold-start deep link (2026-09-16, Universal Links) -- a ref, not
  // state, since it's set once before first render-affecting use and
  // read (never re-rendered off of) by every branch below that reaches
  // MainTabs.
  const deepLinkRef = useRef(null);

  // Face ID success alone is never enough (2026-09-17, PC's explicit
  // ask) -- it only proves the device owner is present, not that the
  // session is still valid server-side. checkSessionStillValid runs
  // after every biometric success before actually resuming.
  const tryUnlock = async (customer) => {
    setChecking(true);
    const { ok: bioOk } = await runBiometricCheck('Unlock Dasta');
    if (!bioOk) {
      // Never strand the customer: iOS already offers its own passcode
      // fallback inside authenticateAsync for a bad biometric read; this
      // screen's own "Sign out instead" below covers everything else
      // (hardware unavailable, repeated failure, no enrollment).
      setChecking(false);
      setPendingCustomer(customer);
      setBootState('locked');
      return;
    }
    const valid = await checkSessionStillValid();
    setChecking(false);
    if (!valid) { await fallbackToSignIn(navigation); return; }
    stampActivity();
    navigation.replace('MainTabs', { customer, ...deepLinkRef.current });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let customer = null;
      // Checked alongside /auth/me, not after -- a cold launch from a
      // Universal Link is exactly as likely as a plain app-icon tap, no
      // reason to serialize them. Only ever applied for a signed-in
      // customer below (deliberate v1 scope limit): a guest tapping a
      // gift-claim link cold gets the normal SignIn screen, same as
      // today, and the deep link isn't preserved through sign-in yet --
      // GiftClaimScreen requires a real customer to claim into anyway.
      const [meResult, initialUrl, lastNotifResponse] = await Promise.all([
        (async () => {
          try {
            const { ok, data } = await apiFetch('/auth/me');
            if (ok && data?.success) return data.customer;
          } catch {
            // Network failure — fall through to SignIn, same as "not signed in"
          }
          return null;
        })(),
        Linking.getInitialURL().catch(() => null),
        // Push Notifications (2026-09-24) -- the cold-launch counterpart to
        // App()'s addNotificationResponseReceivedListener, same "read the
        // one-shot cold value alongside the live event listener" split as
        // Linking.getInitialURL vs. its 'url' event just above.
        Notifications.getLastNotificationResponseAsync().catch(() => null),
      ]);
      customer = meResult;
      if (cancelled) return;
      if (!customer) { navigation.replace('SignIn'); return; }
      // Fire-and-forget, not part of the unlock/navigate critical path above.
      reregisterPushTokenIfEnabled();
      // Universal Link wins if somehow both fired for the same cold launch
      // (won't happen in practice -- one launch has one trigger) -- order
      // here is an arbitrary but harmless tiebreak, not a real precedence rule.
      const deepLink = parseDeepLink(initialUrl)
        || notificationDataToDeepLink(lastNotifResponse?.notification?.request?.content?.data);
      if (deepLink) deepLinkRef.current = deepLink;
      const quickUnlockOn = await getQuickUnlockEnabled();
      if (cancelled) return;
      if (!quickUnlockOn) {
        stampActivity();
        navigation.replace('MainTabs', { customer, ...deepLinkRef.current });
        return;
      }
      // Idle-gated (2026-09-17) -- a cold relaunch (the OS reclaimed a
      // backgrounded app, or a genuine app-icon tap) is no different
      // from a warm resume: what matters is elapsed idle time, not
      // whether the JS process itself survived. The persisted last-
      // activity timestamp bridges exactly that gap; no record at all
      // (very first launch ever, or SecureStore unavailable) is treated
      // as fully idle -- the safe default is to ask, not to assume.
      //
      // Cold-launch race (2026-09-12, two rounds of bug reports) still
      // applies for the actual biometric prompt below -- waits for the
      // real 'active' signal instead of a fixed delay, see
      // waitForAppActive's own comment.
      await waitForAppActive();
      if (cancelled) return;
      const persisted = await getPersistedLastActivity();
      const elapsed = persisted != null ? (Date.now() - persisted) : Infinity;
      const bucket = idleBucket(elapsed);
      if (bucket === 'none') {
        stampActivity();
        navigation.replace('MainTabs', { customer, ...deepLinkRef.current });
      } else if (bucket === 'warning') {
        setPendingCustomer(customer);
        setWarnRemainingMs(IDLE_LOGOUT_MS - elapsed);
        setBootState('warning');
      } else {
        await tryUnlock(customer);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Live countdown while this screen is up, same "only ticks while
  // actually foregrounded" reasoning as IdleLockOverlay's own poll loop.
  useEffect(() => {
    if (bootState !== 'warning') return;
    const iv = setInterval(() => {
      setWarnRemainingMs(prev => {
        const next = prev - 1000;
        if (next <= 0) { setBootState('locked'); return 0; }
        return next;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [bootState]);

  const handleContinueFromWarning = async () => {
    setChecking(true);
    const valid = await checkSessionStillValid();
    setChecking(false);
    if (!valid) { await fallbackToSignIn(navigation); return; }
    stampActivity();
    navigation.replace('MainTabs', { customer: pendingCustomer, ...deepLinkRef.current });
  };

  if (bootState === 'warning') {
    const minsLeft = Math.max(1, Math.ceil(warnRemainingMs / 60000));
    return (
      <View style={[S.screen, { backgroundColor: C.espresso, alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
        <StatusBar style="light" />
        <Text style={[S.wordmark, { fontSize: 22, color: C.white, marginBottom: 8 }]}>Still there?</Text>
        <Text style={[S.cardSub, { color: C.ivory, marginBottom: 24, textAlign: 'center' }]}>
          For your privacy, Dasta will lock in {minsLeft} minute{minsLeft === 1 ? '' : 's'} of inactivity.
        </Text>
        <Pressable style={({pressed})=>[S.btnSaffron,pressed&&{backgroundColor:"#c95722"}]}
          disabled={checking} onPress={handleContinueFromWarning}>
          {checking ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>Yes, continue</Text>}
        </Pressable>
        <Pressable onPress={() => fallbackToSignIn(navigation)} disabled={checking}>
          <Text style={[S.linkText, { color: C.ivory, marginTop: 12 }]}>No, log out</Text>
        </Pressable>
      </View>
    );
  }

  if (bootState === 'locked') {
    return (
      <View style={[S.screen, { backgroundColor: C.espresso, alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
        <StatusBar style="light" />
        <Text style={{ fontSize: 48, marginBottom: 16 }}>🔒</Text>
        <Text style={[S.wordmark, { fontSize: 22, color: C.white, marginBottom: 8 }]}>Dasta is locked</Text>
        <Text style={[S.cardSub, { color: C.ivory, marginBottom: 24, textAlign: 'center' }]}>
          Unlock with Face ID / Touch ID to continue
        </Text>
        <Pressable style={({pressed})=>[S.btnSaffron,pressed&&{backgroundColor:"#c95722"}]}
          onPress={() => tryUnlock(pendingCustomer)} disabled={checking}>
          {checking ? <ActivityIndicator color={C.ivory} /> : <Text style={S.btnSaffronText}>🔓 Try Again</Text>}
        </Pressable>
        <Pressable onPress={() => fallbackToSignIn(navigation)} disabled={checking}>
          <Text style={[S.linkText, { color: C.ivory, marginTop: 12 }]}>Sign out instead</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[S.screen, { backgroundColor: C.espresso, alignItems: 'center', justifyContent: 'center' }]}>
      <StatusBar style="light" />
      <ActivityIndicator color={C.gold} size="large" />
    </View>
  );
}

// ── ROOT NAVIGATOR ────────────────────────────────────────────
export default function App() {
  // Typography (2026-09-13) -- mobile-restart-design-plan.md's "hero
  // numbers and drink names" Playfair Display pairing, never actually
  // wired in before now (zero fontFamily usage anywhere in this file
  // until this change). Only the two weights actually used (Bold for
  // wordmark/drink-name/price, SemiBold for section headings) — not the
  // full family. Gated behind fontsLoaded so there's no flash of
  // system-font UI before the swap.
  const [fontsLoaded] = useFonts({ PlayfairDisplay_700Bold, PlayfairDisplay_600SemiBold });
  // Warm-start deep links (2026-09-16, Universal Links) -- Bootstrap
  // above only ever runs once, on cold launch, so a Universal Link tapped
  // while the app is already running (backgrounded or foregrounded) needs
  // its own path: a plain ref (React Navigation's documented pattern for
  // navigating from outside the component tree) plus a 'url' event
  // listener that fires for exactly this case. Deliberately unconditional
  // -- same v1 scope limit as Bootstrap's cold-start handling, a guest
  // hitting this while signed out lands on MainTabs in guest mode rather
  // than being routed through sign-in first; less likely to matter here
  // since warm-start implies the app was already in active use.
  const navigationRef = useRef(null);
  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      const link = parseDeepLink(url);
      if (link) navigationRef.current?.navigate('MainTabs', link);
    });
    return () => sub.remove();
  }, []);
  // Push notification tap-to-open (2026-09-24) -- same navigationRef
  // mechanism as the Universal Link listener above, translating the
  // notification's {screen, params} data payload (see core/notifications.
  // py's send_push_notification callers) into the identical {initialTab,
  // initialTabParams} shape via notificationDataToDeepLink. This covers
  // a tap while the app is backgrounded/foregrounded; the cold-launch tap
  // (app not running) is instead folded into BootstrapScreen's existing
  // deepLinkRef alongside Universal Links (see its getLastNotificationResponseAsync
  // call) -- navigating via navigationRef before Bootstrap has even
  // decided sign-in state / customer would be a real race, same reasoning
  // as every other "cold vs. warm" split already in this file.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const link = notificationDataToDeepLink(response?.notification?.request?.content?.data);
      if (link) navigationRef.current?.navigate('MainTabs', link);
    });
    return () => sub.remove();
  }, []);
  if (!fontsLoaded) {
    return (
      <View style={[S.screen, { backgroundColor: C.espresso, alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={C.gold} size="large" />
      </View>
    );
  }
  return (
    // Idle-lock activity tracking (2026-09-17) -- onTouchStart on a
    // non-leaf View fires as a passive observer during the touch's
    // bubble phase; it does not consume the touch or block any nested
    // Pressable/ScrollView/etc. from getting it too, so this is a pure
    // "watch, don't intercept" wrapper at the very root of the app. See
    // stampActivity's own comment for why this updates a plain module
    // variable rather than React state.
    <SafeAreaProvider>
    <View style={{ flex: 1 }} onTouchStart={stampActivity}>
      <CloverPayProvider>
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Bootstrap">
            <Stack.Screen name="Bootstrap"    component={BootstrapScreen}  />
            <Stack.Screen name="SignIn"       component={SignInScreen}     />
            <Stack.Screen name="ProfileStack" component={ProfileScreen}    />
            <Stack.Screen name="NotifyPerm"   component={NotifyPermScreen} />
            <Stack.Screen name="MainTabs"     component={MainTabs}         />
          </Stack.Navigator>
        </NavigationContainer>
      </CloverPayProvider>
    </View>
    </SafeAreaProvider>
  );
}

// ── STYLES ────────────────────────────────────────────────────
const S = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: C.ivory },
  centered: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },

  // My Circles (2026-09-27)
  groupOrderBanner:      { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#FFF4EC', borderColor: C.saffron, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  groupOrderBannerTitle: { fontWeight: '700', color: C.charcoal, fontSize: 14 },
  groupOrderBannerSub:   { color: C.charcoal, fontSize: 12, marginTop: 3, lineHeight: 17 },
  groupOrderCard:        { backgroundColor: C.white, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border },
  circleRow:             { flexDirection: 'row', alignItems: 'center', backgroundColor: C.white, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 14, marginTop: 8, borderWidth: 1, borderColor: C.border, gap: 10 },
  circleLiveTag:         { color: C.saffron, fontSize: 12, fontWeight: '700', marginTop: 4 },
  circleOwnerTag:        { color: C.gold, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  accountIdQrBox:        { backgroundColor: C.white, padding: 18, borderRadius: 16, borderWidth: 1, borderColor: C.border },
  accountIdText:         { fontSize: 20, fontWeight: '700', letterSpacing: 1.5, color: C.charcoal, marginTop: 16, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  qrScanOverlay:         { position: 'absolute', top: 100, left: 0, right: 0, bottom: TAB_BAR_HEIGHT, backgroundColor: C.espresso, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden', zIndex: 50, elevation: 50 },
  qrScanHeader:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, paddingHorizontal: 18, paddingBottom: 12 },
  qrScanFrameWrap:       { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  qrScanFrame:           { width: 240, height: 240, borderWidth: 3, borderColor: C.saffron, borderRadius: 18 },
  groupOrderNote:        { fontStyle: 'italic', color: C.black, fontSize: 13, marginTop: 6, lineHeight: 18 },
  chipRow:               { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  initialChip:           { width: 24, height: 24, borderRadius: 12, backgroundColor: C.saffron, borderWidth: 2, borderColor: C.white, alignItems: 'center', justifyContent: 'center' },
  initialChipText:       { color: C.white, fontSize: 11, fontWeight: '700' },
  chipMore:              { color: C.black, fontSize: 12, marginLeft: 6 },
  helpStepRow:           { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  helpStepNum:           { width: 24, fontWeight: '700', color: C.saffron, fontSize: 15, lineHeight: 21 },
  helpBullet:            { width: 18, color: C.saffron, fontSize: 15, lineHeight: 21 },
  // Left-aligned (2026-09-28, PC) -- overrides cardSub's centered default,
  // which read oddly for numbered steps and bullet paragraphs.
  helpText:              { flex: 1, lineHeight: 21, marginTop: 0, marginBottom: 0, textAlign: 'left' },
  helpNotesBox:          { backgroundColor: C.white, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, marginTop: 10, gap: 8 },
  qrScanHint:            { color: C.white, marginTop: 18, fontSize: 14, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },

  hero:         { backgroundColor: C.espresso, padding: 18, paddingTop: 54 },
  heroTop:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 0 },
  // Pure white, not ivory (2026-09-17) -- same "stop dimming things that
  // should read as sharp" fix already applied to the tab bar; every dark
  // header title in the app uses this one shared style.
  wordmark:     { color: C.white, fontSize: 28, fontWeight: '700', fontStyle: 'italic', fontFamily: 'PlayfairDisplay_700Bold' },
  wordmarkSub:  { color: C.gold, fontSize: 9, fontWeight: '600', letterSpacing: 1.3 },
  heroIcons:    { flexDirection: 'row', gap: 16, paddingTop: 4 },
  heroIcon:     { fontSize: 20 },
  // Say[Mic]Go menu panel (2026-09-19 redesign) — full-screen between the
  // hero banner and the tab bar, not a small dropdown, per PC's ask for
  // bigger text and room to add more options later without a redesign.
  // No `elevation` here (2026-09-19 fix, PC's live report: Home/tab-bar/
  // header buttons stopped responding while this panel was open) --
  // elevation on Android can force a view's paint layer above OTHER
  // subtrees regardless of normal sibling order, which put this panel
  // (deep inside HomeScreen's own subtree) visually and touch-wise above
  // GlobalAccountHeader (elevation:50) and the tab bar even though both
  // are later MainTabs-level siblings that should already paint on top.
  // A small zIndex is enough to sit above HomeScreen's own ScrollView
  // content within its own subtree -- it never needs to compete with
  // siblings outside that subtree.
  sayMicGoPanel:           { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.ivory, zIndex: 5 },
  sayMicGoPanelHeader:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 2, borderBottomColor: C.saffron },
  sayMicGoPanelStatus:     { flex: 1, color: C.espresso, fontSize: 18, fontWeight: '700' },
  sayMicGoPanelClose:      { color: C.espresso, fontSize: 24, fontWeight: '700', paddingHorizontal: 4 },
  sayMicGoPanelRow:        { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  sayMicGoPanelRowNum:     { color: C.white, backgroundColor: C.saffron, width: 30, height: 30, borderRadius: 15, textAlign: 'center', lineHeight: 30, fontSize: 15, fontWeight: '700', overflow: 'hidden' },
  sayMicGoPanelRowText:    { flex: 1, color: C.charcoal, fontSize: 18 },
  goldTagline:  { color: C.gold, fontSize: 13, textAlign: 'center', marginTop: 10, letterSpacing: 1 },

  greetingStrip:  { backgroundColor: C.ivory, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 0 },
  greetingText:   { color: C.espresso, fontSize: 22, fontWeight: '700' },
  greetingCard:   { backgroundColor: C.saffron, borderRadius: 16, padding: 16 },
  greetingSmall:  { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginBottom: 4 },
  greetingBig:    { color: C.charcoal, fontSize: 20, fontWeight: '700', marginBottom: 4 },
  heroBtns:       { flexDirection: 'row', gap: 8, marginTop: 12 },
  btnIvory:       { flex: 1, backgroundColor: C.ivory, borderRadius: 20, padding: 10, alignItems: 'center' },
  btnIvoryText:   { color: C.saffron, fontWeight: '700', fontSize: 13 },
  btnOutline:     { flex: 1, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', borderRadius: 20, padding: 10, alignItems: 'center' },
  btnOutlineText: { color: C.white, fontWeight: '600', fontSize: 13 },
  // Outline button for LIGHT backgrounds (2026-09-28) -- btnOutline above is
  // white-on-dark; on ivory/white it was invisible (Add Member, Go to My
  // Circles, View order).
  // Same box as btnSaffron (radius 12, 14px padding less the 1.5px border,
  // 15px bold text) so the two sit side by side at identical size.
  // 2px border + Charcoal label (2026-09-29, PC: "Add Member" was hard to
  // read) -- Saffron text on white is only ~3.4:1; Charcoal is ~16:1.
  btnOutlineLight:     { borderWidth: 2, borderColor: C.saffron, borderRadius: 12, padding: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.white },
  btnOutlineLightText: { color: C.charcoal, fontWeight: '700', fontSize: 15 },

  section:   { paddingHorizontal: 16, paddingTop: 16 },
  secHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  secTitle:  { color: C.charcoal, fontSize: 15, fontWeight: '700' },

  quickGrid: { flexDirection: 'row', gap: 8 },
  qaItem:    { flex: 1, backgroundColor: C.white, borderRadius: 12, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  qaIcon:    { fontSize: 22, marginBottom: 4 },
  qaLabel:   { color: C.charcoal, fontSize: 9, fontWeight: '600' },

  sipBannerSplit:   { backgroundColor: '#1b120c', borderRadius: 16, overflow: 'hidden' },
  sipBannerRow:     { flexDirection: 'row', alignItems: 'center' },
  sipBannerLeft:    { flex: 1, paddingLeft: 20, paddingRight: 6, paddingVertical: 16, justifyContent: 'space-between', backgroundColor: '#1b120c' },
  sipBannerImg:     { width: '48%', height: 195 },
  patentPendingText:{ color: C.gold, fontWeight: '700', fontSize: 10, textAlign: 'center', paddingBottom: 12, letterSpacing: 0.3 },
  profileBtn:       { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 50, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  // zIndex/elevation 100 (PC, 2026-10-01): with no layer of its own, the
  // dropdown drew under the Say[Mic]Go Quick Actions panel (zIndex 5) even
  // though the profile icon (globalAccountHeader, 50) was still tappable.
  profileMenuBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'flex-end', paddingTop: 96, paddingRight: 16, zIndex: 100, elevation: 100 },
  profileMenuCard:      { backgroundColor: C.white, borderRadius: 14, paddingVertical: 8, width: 250, borderWidth: 1, borderColor: C.border, elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  profileMenuHeader:    { color: C.black, fontSize: 11, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  profileMenuRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  profileMenuIcon:      { marginRight: 10, width: 18 },
  profileMenuRowText:   { color: C.charcoal, fontSize: 14 },
  profileMenuDivider:   { height: 1, backgroundColor: C.border, marginVertical: 4 },
  // Cart/Gift header icons (2026-09-13)
  cartHeaderBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  // Persistent global account header (2026-09-13) — floats top-right on
  // every screen under MainTabs, matching the top-right slot each
  // screen's own hero already reserved (hero: paddingTop 54, padding 18).
  globalAccountHeader: { position: 'absolute', top: 54, right: 18, zIndex: 50, elevation: 50 },
  cartBadge:     { position: 'absolute', top: -2, right: -2, backgroundColor: C.saffron, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, borderWidth: 1.5, borderColor: C.espresso },
  cartBadgeText: { color: C.white, fontSize: 10, fontWeight: '700' },
  // Generic bottom-sheet modal (2026-09-13) — plain absolutely-positioned
  // View/Pressable, not RN's <Modal>, matching this app's already-fixed
  // profile-dropdown re-presentation bug (iOS Modal flakiness).
  //
  // Inset from top/bottom (2026-09-13 fix, PC's live report) -- a tall
  // sheet (Favorites detail in particular, maxHeight 90%) was extending
  // up far enough to sit UNDER the persistent GlobalAccountHeader/tab
  // bar, and this overlay's own full-screen backdrop Pressable then
  // intercepted taps meant for the header/tab bar instead of passing
  // them through -- "opening a favorite blocks navigating to Home/My
  // Account/Cart." Every modal built on this shared style now clears
  // both persistent zones by construction (matches globalAccountHeader's
  // own top:54 + its ~44px icon row, and tabBar's own height:66) instead
  // of each modal needing its own inset.
  modalOverlay: { position: 'absolute', top: 100, left: 0, right: 0, bottom: 66, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet:   { backgroundColor: C.ivory, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '100%' },
  sheetHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 },
  // Full-screen, unlike modalOverlay above -- this is a security lock, so
  // it deliberately covers the tab bar and GlobalAccountHeader too (no
  // reaching another tab or the profile menu while locked). Not
  // dismissible by tapping outside, matching web's own persistent-until-
  // resolved lock modal. elevation deliberately omitted -- same Android
  // shadow-artifact bug as buildOverlay elsewhere in this file: elevation
  // on a semi-transparent-background view casts a visible halo on
  // Android only. zIndex alone already stacks this above everything.
  idleLockOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(45,28,15,0.92)', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  idleLockCard:    { backgroundColor: C.ivory, borderRadius: 18, maxWidth: 340, width: '86%', padding: 24 },
  modifierRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, marginTop: 6, backgroundColor: C.white, borderWidth: 1, borderColor: C.border },
  modifierRowSelected: { borderColor: C.saffron, backgroundColor: '#FDEEE4' },
  // Branded confirmation modal (2026-09-14) — same overlay/sheet as
  // Discovery/Menu item popups; saffron for the destructive action
  // (brand palette has no red) instead of a native red iOS button.
  confirmModalTitle:      { fontSize: 18, fontWeight: '700', color: C.charcoal, fontFamily: 'PlayfairDisplay_600SemiBold' },
  confirmModalMessage:    { fontSize: 14, color: C.black, marginTop: 8, lineHeight: 20 },
  confirmModalCancelBtn:  { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  confirmModalCancelText: { color: C.charcoal, fontWeight: '700', fontSize: 14 },
  confirmModalConfirmBtn: { flex: 1, backgroundColor: C.saffron, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  confirmModalConfirmText:{ color: C.white, fontWeight: '700', fontSize: 14 },
  // Voice input (2026-09-14) — mic button states match web's setMic()
  // colors exactly (idle saffron, recording red, processing gray).
  micBtn:            { width: 44, height: 44, borderRadius: 22, backgroundColor: C.saffron, alignItems: 'center', justifyContent: 'center' },
  micBtnRecording:   { backgroundColor: '#c0392b' },
  micBtnProcessing:  { backgroundColor: '#888', opacity: 0.7 },
  micIcon:           { width: '65%', height: '65%' },
  // Mic-in-textbox layout (2026-09-15, PC's layout-refinement doc) — the
  // input reserves a fixed-width zone on its right via paddingRight, and
  // this smaller mic circle sits absolutely-positioned + vertically
  // centered inside that zone, a sibling of the TextInput rather than a
  // separate standalone control below it. micBtnRecording/Processing
  // above are reused unchanged (color swap reads fine at this size too).
  textAreaWrap:      { position: 'relative', marginBottom: 4 },
  textAreaWithMic:   { paddingRight: 52, marginBottom: 0 },
  micZone:           { position: 'absolute', top: 0, bottom: 0, right: 8, width: 36, justifyContent: 'center', alignItems: 'center' },
  micBtnInline:      { width: 36, height: 36, borderRadius: 18, backgroundColor: C.saffron, alignItems: 'center', justifyContent: 'center' },
  micIconInline:     { width: '62%', height: '62%' },
  // Clear button (2026-09-15) — small text link in the box's top-right
  // corner, matching web's clearSelectionsBtn placement (top:10px;
  // right:10px relative to the textarea's own container).
  clearAllBtn:       { position: 'absolute', top: 8, right: 10 },
  clearAllBtnText:   { color: C.black, fontSize: 11, fontWeight: '700', textDecorationLine: 'underline' },
  langPill:          { flexDirection: 'row', alignItems: 'center', borderRadius: 999, borderWidth: 1.5, borderColor: C.saffron, backgroundColor: C.white, paddingHorizontal: 12, paddingVertical: 6 },
  langPillHeader:    { paddingHorizontal: 9, paddingVertical: 5 }, // slightly tighter to fit the persistent header row (2026-09-15)
  langPillActive:    { backgroundColor: C.saffron },
  langPillText:      { color: C.saffron, fontSize: 12, fontWeight: '600' },
  langPillTextActive:{ color: C.white },
  micStatusText:     { color: C.saffron, fontSize: 12, fontStyle: 'italic' },
  micHeardEcho:      { color: C.black, fontSize: 12, fontStyle: 'italic', marginTop: 4 },
  modifierRowText:  { color: C.charcoal, fontSize: 14 },
  modifierRowPrice: { color: C.black, fontSize: 13 },
  checkoutHalfBox:   { flex: 1, height: CHECKOUT_COMPACT_H, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.white, paddingHorizontal: 10, paddingVertical: 8 },
  checkoutHalfTitle: { color: C.charcoal, fontSize: 13, fontWeight: '700' },
  checkoutTotalRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  checkoutTotalText: { color: C.black, fontSize: 13 },
  qtyBtn:     { width: 32, height: 32, borderRadius: 16, backgroundColor: C.white, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText: { fontSize: 18, fontWeight: '700', color: C.charcoal },
  // Today's Discovery (2026-09-13)
  discoveryBtn:      { alignSelf: 'flex-start', marginTop: 10, marginBottom: 4, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: '#534AB7', backgroundColor: 'transparent' },
  discoveryBtnText:  { color: '#534AB7', fontSize: 13, fontWeight: '600' },
  discoveryHeader:   { padding: 20, paddingBottom: 18, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  discoveryCloseBtn: { position: 'absolute', top: 14, right: 16, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  discoveryEyebrow:  { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: 'rgba(255,255,255,0.78)', textTransform: 'uppercase', marginBottom: 7 },
  discoveryDrinkName:{ fontSize: 18, fontWeight: '600', color: '#fff', paddingRight: 36, fontFamily: 'PlayfairDisplay_600SemiBold' },
  discoveryRegion:   { fontSize: 13, color: 'rgba(255,255,255,0.88)', fontWeight: '500', marginTop: 8 },
  discoverySentence: { fontSize: 14, color: '#2c2c2a', lineHeight: 21 },
  discoveryDykBox:   { marginTop: 14, padding: 12, borderRadius: 8, borderLeftWidth: 3 },
  discoveryBottomBox:{ flexDirection: 'row', alignItems: 'flex-start', borderRadius: 10, borderWidth: 1.5, padding: 12, marginBottom: 18 },
  // Crafting/Building loaders (2026-09-13)
  craftLoaderCard:   { maxWidth: 340, width: '86%', padding: 24, borderRadius: 16, backgroundColor: '#fff3e8', borderWidth: 2, borderColor: '#E26A2C' },
  craftLoaderTitle:  { fontSize: 16, fontWeight: '800', color: C.charcoal, marginBottom: 6 },
  craftLoaderDesc:   { fontSize: 13, color: C.black, marginBottom: 14 },
  craftStopBtn:      { alignSelf: 'flex-start', backgroundColor: C.white, borderWidth: 1.5, borderColor: '#E26A2C', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9 },
  craftStopBtnText:  { color: '#E26A2C', fontWeight: '700', fontSize: 13 },
  // Inset from top/bottom (2026-09-13 fix) -- same reasoning as
  // modalOverlay above: keeps the persistent header/tab bar reachable
  // even while a crafting/building overlay is up, in case a customer
  // wants to Stop and navigate away rather than wait.
  // elevation deliberately omitted (2026-09-17 Android fix) -- this view's
  // background is semi-transparent, and Android's elevation shadow is cast
  // as a solid rectangle beneath the view's own bounds, which showed
  // through as a halo/shadow artifact framing the overlay on Android only
  // (iOS ignores elevation, so it never had the bug). zIndex alone already
  // stacks this above its sibling content on both platforms.
  buildOverlay:      { position: 'absolute', top: 100, left: 0, right: 0, bottom: 66, backgroundColor: 'rgba(45,28,15,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 40 },
  buildCard:         { backgroundColor: '#fff3e8', borderWidth: 2, borderColor: '#E26A2C', borderRadius: 18, maxWidth: 340, width: '86%', padding: 28, alignItems: 'center' },
  buildHead:         { fontSize: 18, fontWeight: '800', color: C.charcoal, marginBottom: 6, textAlign: 'center' },
  buildSub:          { fontSize: 13, color: C.black, marginBottom: 16, textAlign: 'center' },
  buildBarTrack:     { width: '100%', height: 4, borderRadius: 4, backgroundColor: '#F6D9C4', overflow: 'hidden', marginBottom: 16 },
  buildBarFill:      { width: 140, height: '100%', borderRadius: 4, backgroundColor: '#E26A2C' },
  buildRot:          { fontSize: 13, color: '#E26A2C', fontWeight: '600', marginBottom: 18, textAlign: 'center', minHeight: 18 },
  // Cart line editors (2026-09-13) — size/temp/sweetness pills + Dasta
  // Menu's read-only modifier tags, ported from your-order_embed2.html.
  dastaMenuModTag:     { backgroundColor: 'rgba(31,31,31,0.06)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  dastaMenuModTagText: { fontSize: 11, fontWeight: '600', color: C.charcoal },
  sizePill:            { borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: C.white },
  sizePillActive:      { borderColor: C.saffron, backgroundColor: 'rgba(226,106,44,0.1)' },
  sizePillText:        { fontSize: 11, fontWeight: '700', color: C.charcoal },
  sizePillTextActive:  { color: C.saffron },
  modRowLabel:         { fontSize: 11, fontWeight: '700', color: C.black, width: 40 },
  pickupPill:          { flex: 1, borderRadius: 12, padding: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.white, alignItems: 'center' },
  pickupPillActive:    { backgroundColor: C.saffron, borderColor: C.saffron },
  pickupPillDisabled:  { opacity: 0.4 },
  pickupPillText:      { fontSize: 14, fontWeight: '700', color: C.charcoal },
  pickupPillSub:       { fontSize: 11, color: C.black, marginTop: 2 },
  pickupPillTextActive:{ color: C.white },
  aiBadge:     { backgroundColor: C.saffron, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 8 },
  aiBadgeText: { color: C.white, fontSize: 8, fontWeight: '700', letterSpacing: 1 },
  sipTitle:    { color: C.ivory, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  sipTry:      { color: C.ivory, fontSize: 16, fontWeight: '600', opacity: 0.9, lineHeight: 20 },
  sipName:     { color: C.ivory, fontSize: 34, fontWeight: '800', marginTop: 0, marginBottom: 8 },
  tmMark:      { fontSize: 12, color: C.ivory, fontWeight: '700', marginTop: 4, marginLeft: 1 },
  sipDesc:     { color: C.gold, fontSize: 12, lineHeight: 19.5, marginBottom: 0 },
  sipBtn:      { backgroundColor: C.saffron, borderRadius: 11, paddingHorizontal: 16, paddingVertical: 10, alignSelf: 'flex-start' },
  sipBtnText:  { color: C.white, fontWeight: '700', fontSize: 15 },   // Home's Craft My Drink; 12 -> 15 (PC, 2026-10-01)

  closedPill:  { backgroundColor: '#FDECEA', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  closedText:  { color: '#C62828', fontSize: 10, fontWeight: '700' },

  emptyFav:     { backgroundColor: C.white, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.border },
  emptyFavText: { color: C.black, fontSize: 13, marginBottom: 8 },
  signInLink:   { color: C.saffron, fontWeight: '700', fontSize: 13 },
  favCard:        { backgroundColor: C.white, borderRadius: 12, padding: 12, marginRight: 10, width: 130, borderWidth: 1, borderColor: C.border, justifyContent: 'space-between' },
  favCardExpanded:{ backgroundColor: C.white, borderRadius: 12, padding: 14, marginRight: 10, width: 200, borderWidth: 1.5, borderColor: C.saffron, justifyContent: 'space-between', minHeight: 150 },
  favCollapseHint:{ color: C.black, fontSize: 9, marginTop: 8, fontStyle: 'italic' },
  favName:      { color: C.charcoal, fontWeight: '600', fontSize: 12, marginBottom: 4 },
  favSub:       { color: C.black, fontSize: 10, marginBottom: 10 },
  favBtn:       { backgroundColor: C.espresso, borderRadius: 8, padding: 6, alignItems: 'center' },
  favBtnText:   { color: C.ivory, fontSize: 10, fontWeight: '600' },
  // Favorite detail modal (2026-09-13)
  favBadge:            { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  favBadgeText:        { color: '#fff', fontSize: 11, fontWeight: '700' },
  favIngredientsText:  { color: C.black, fontSize: 13, marginTop: 6, lineHeight: 19 },
  favDiscoveryBox:     { marginTop: 6, padding: 10, borderRadius: 10, backgroundColor: C.white, borderWidth: 1 },
  favDiscoveryText:    { color: C.black, fontSize: 13, lineHeight: 19 },
  favStatPill:         { backgroundColor: '#f0f0f0', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  favStatPillText:     { color: C.black, fontSize: 12 },
  favActionHeart:      { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: C.saffron, alignItems: 'center', justifyContent: 'center' },
  favActionBtn:        { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  favActionBtnText:    { color: '#fff', fontSize: 13, fontWeight: '700' },
  favActionBtnOutline: { backgroundColor: C.white, borderRadius: 999, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 10, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  favActionBtnOutlineText: { fontSize: 13, fontWeight: '700' },
  favActionBtnGold:    { backgroundColor: C.white, borderRadius: 999, borderWidth: 1.5, borderColor: C.gold, paddingHorizontal: 16, paddingVertical: 10, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  favActionBtnGoldText:{ color: '#7A3B10', fontSize: 13, fontWeight: '700' },

  infoCard:        { backgroundColor: C.white, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  infoRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoLeft:        { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  infoTitle:       { color: C.charcoal, fontSize: 12, fontWeight: '600' },
  infoHours:       { color: C.black, fontSize: 10, marginTop: 3 },
  infoSub:         { color: C.black, fontSize: 10, marginTop: 2 },
  openPill:        { backgroundColor: '#E8F5E9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  openText:        { color: '#2E7D32', fontSize: 10, fontWeight: '700' },
  infoDivider:     { height: 1, backgroundColor: C.border, marginVertical: 12 },
  infoRow2:        { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  infoContactText: { color: C.black, fontSize: 10 },

  signInHeader: { alignItems: 'center', marginBottom: 24 },

  card:          { backgroundColor: C.white, borderRadius: 20, padding: 24, width: '100%', borderWidth: 1, borderColor: C.border },
  cardTitle:     { color: C.charcoal, fontSize: 22, fontWeight: '700', marginBottom: 4, textAlign: 'center' },
  cardSub:       { color: C.black, fontSize: 13, textAlign: 'center', marginBottom: 16 },
  input:         { width: '100%', backgroundColor: C.ivory, borderRadius: 10, padding: 14, color: C.charcoal, fontSize: 15, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  fieldHint:     { color: C.gold, fontSize: 10, marginTop: -6, marginBottom: 10, paddingLeft: 4 },
  // Text under a scannable QR (2026-09-29, PC: the small gold hint wasn't
  // legible there) -- black and larger.
  qrCaption:     { color: C.black, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  errorText:     { color: '#C0392B', fontSize: 12, textAlign: 'center', marginTop: -2, marginBottom: 10 },

  // ── My Profile (Personal Info / Notification Preferences / Sign-in & Contact) ──
  fieldLabel:            { color: C.charcoal, fontWeight: '700', fontSize: 12, marginBottom: 6 },
  inputLocked:           { color: C.black, backgroundColor: C.border },
  notifCatCard:          { backgroundColor: C.white, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 10 },
  notifCatLabel:         { color: C.charcoal, fontWeight: '700', fontSize: 13 },
  notifChanBtn:          { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingVertical: 8, alignItems: 'center', backgroundColor: C.ivory },
  notifChanBtnActive:    { backgroundColor: C.saffron, borderColor: C.saffron },
  notifChanBtnText:      { color: C.black, fontSize: 12, fontWeight: '600' },
  notifChanBtnTextActive:{ color: C.white },
  contactRow:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.white, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 10 },
  contactValue:          { color: C.black, fontSize: 14, marginTop: 2 },
  contactChangeBox:      { backgroundColor: C.ivory, borderRadius: 12, padding: 14, marginBottom: 14, marginTop: -4 },

  // ── My Circle Account ──
  circleEyebrow:      { color: C.black, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  circleHeading:       { color: C.charcoal, fontSize: 18, fontWeight: '700', marginBottom: 4, fontFamily: 'PlayfairDisplay_600SemiBold' },
  circleDot:           { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  circleDotActive:     { backgroundColor: C.gold },
  // Progress row (leaf cycle + Sapling cycle both reuse this) — left/right
  // labels matching web's dc-prog-labels/dc-prog-l/dc-prog-r exactly.
  circleProgLabels:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, marginBottom: 6 },
  circleProgLeft:      { color: C.black, fontSize: 12 },
  circleProgRight:     { color: '#2D6A2F', fontSize: 12, fontWeight: '600' },
  circleProgTrack:     { height: 4, backgroundColor: 'rgba(31,31,31,0.07)', borderRadius: 2, overflow: 'hidden', marginBottom: 14 },
  circleProgFill:      { height: '100%', backgroundColor: '#4a9a3f', borderRadius: 2 },
  circleSaplingCard:   { backgroundColor: C.white, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, marginTop: 4 },
  circleLeafBadge:     { backgroundColor: C.espresso, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  circleLeafBadgeText: { color: C.gold, fontSize: 13, fontWeight: '600' },
  // Dasta Card artwork overlay — percentages measured directly off
  // DastaCard_blank_template.png in dasta-circle_embed1.html's own CSS
  // comment (not eyeballed): balance left:69%/top:40%/maxWidth:29%,
  // number left:33.2%/top:74.9%, since left:33.2%/top:84.5%.
  dastaCardImageWrap:      { width: '100%', aspectRatio: 1536 / 1024, borderRadius: 14, overflow: 'hidden', marginTop: 12, backgroundColor: '#e8ddc8' },
  dastaCardBg:             { width: '100%', height: '100%' },
  dastaCardBalanceOverlay: { position: 'absolute', left: '69%', top: '34%', maxWidth: '29%' },
  // Card text on the cream half (PC, 2026-10-01): full-strength and bold for
  // a crisp read -- the labels used to be faded (opacity 0.55-0.6), and the
  // number's light gold (#C9A86A) was only ~1.8:1 against the cream.
  dastaCardBalanceLabel:   { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, color: C.espresso, marginBottom: 2 },
  dastaCardBalanceVal:     { fontSize: 16, fontWeight: '700', color: C.espresso, fontFamily: 'PlayfairDisplay_700Bold' },
  dastaCardNumberOverlay:  { position: 'absolute', left: '30%', top: '70%' },
  // Deep metallic gold (the card's own swoosh tone) with a 1px light edge
  // underneath for an embossed look.
  dastaCardNumberText:     { fontSize: 12, letterSpacing: 2, fontWeight: '800', color: '#9A6B12',
                             textShadowColor: 'rgba(255,255,255,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 0 },
  dastaCardSinceOverlay:   { position: 'absolute', left: '30%', top: '82%' },
  dastaCardSinceText:      { fontSize: 8, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: C.espresso },
  // Redeem My Free Drink (2026-09-18) — zero state grays + voids the QR
  // rather than hiding the screen (DDD: "never hide this screen or
  // replace it with an error state").
  redeemVoidedOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  redeemVoidedText:    { color: '#C0392B', fontSize: 26, fontWeight: '900', letterSpacing: 3, transform: [{ rotate: '-18deg' }], borderWidth: 3, borderColor: '#C0392B', paddingHorizontal: 12, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.85)' },
  autoReloadRow:       { width: '100%', backgroundColor: '#FFF3EC', borderColor: 'rgba(226,106,44,0.2)', borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 14 },
  autoReloadText:      { fontSize: 12, color: C.charcoal, lineHeight: 18 },
  savedCardRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.white, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 10 },
  savedCardText:       { color: C.charcoal, fontSize: 14, fontWeight: '600' },
  savedCardDefault:    { color: C.saffron, fontSize: 10, fontWeight: '700', marginTop: 2 },
  quickActionsGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickActionTile:     { width: '31%', backgroundColor: C.white, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingVertical: 12, alignItems: 'center' },
  quickActionIcon:     { fontSize: 18, marginBottom: 4 },
  quickActionLabel:    { fontSize: 10, fontWeight: '600', color: C.charcoal, textAlign: 'center' },
  txOverlay:           { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.ivory },
  txRow:               { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  txDate:              { color: C.black, fontSize: 11, marginTop: 2 },
  txChevron:           { color: C.black, fontSize: 12, marginLeft: 10 },
  txDetailBox:         { backgroundColor: C.ivory, borderRadius: 10, padding: 12, marginTop: -2, marginBottom: 8 },
  txDetailItemRow:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  txDetailItemText:    { color: C.charcoal, fontSize: 12 },
  txDetailLine:        { color: C.black, fontSize: 12, marginTop: 4 },

  btnSaffron:      { backgroundColor: C.saffron, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 10, width: '100%' },
  btnSaffronText:  { color: C.white, fontWeight: '700', fontSize: 15 },
  btnEspresso:     { backgroundColor: C.espresso, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 10, width: '100%' },
  btnEspressoText: { color: C.ivory, fontWeight: '600', fontSize: 14 },
  btnIconRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  btnSuccess:      { backgroundColor: '#2d7a2d' },
  linkText:        { color: C.saffron, fontSize: 13, textAlign: 'center', textDecorationLine: 'underline', marginTop: 4 },

  btnApple:      { backgroundColor: C.charcoal, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 10, width: '100%', flexDirection: 'row', justifyContent: 'center', gap: 10 },
  appleLogoImg:  { width: 18, height: 18, resizeMode: 'contain' },
  btnAppleText:  { color: C.white, fontWeight: '600', fontSize: 15 },
  btnGoogle:     { backgroundColor: C.white, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 10, width: '100%', flexDirection: 'row', justifyContent: 'center', gap: 10, borderWidth: 1, borderColor: C.border },
  googleLogoImg: { width: 18, height: 18, resizeMode: 'contain' },
  btnGoogleText: { color: C.charcoal, fontWeight: '600', fontSize: 15 },

  dividerRow:  { flexDirection: 'row', alignItems: 'center', marginVertical: 12, gap: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { color: C.black, fontSize: 11 },

  comingSoonBadge: { backgroundColor: C.espresso, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  comingSoonText:  { color: C.gold, fontWeight: '700', fontSize: 12, letterSpacing: 1.5 },

  // ── Rewards (plant/leaf) ──
  rewardStep:            { marginBottom: 10, paddingLeft: 2 },
  rewardStepTitle:       { color: C.charcoal, fontWeight: '700', fontSize: 13, marginBottom: 1 },
  rewardStepDesc:        { color: C.black, fontSize: 12, lineHeight: 17 },
  rewardCupWrap:         { width: '100%', aspectRatio: 1215 / 1295, borderRadius: 18, overflow: 'hidden', marginTop: 16, marginBottom: 14, backgroundColor: C.ivory },
  rewardCupImage:        { width: '100%', height: '100%' },
  rewardTapHint:         { position: 'absolute', bottom: 14, left: 0, right: 0, alignItems: 'center' },
  rewardTapHintPill:     { backgroundColor: 'rgba(15,110,86,0.88)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  rewardTapHintText:     { color: C.white, fontSize: 12, fontWeight: '600' },
  rewardProgressCard:    { backgroundColor: C.white, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 16 },
  rewardProgressLabel:   { color: C.black, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },
  rewardProgressBarBg:   { height: 5, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
  rewardProgressBarFill: { height: '100%', backgroundColor: C.saffron, borderRadius: 3 },
  rewardProgressMsg:     { color: C.charcoal, fontSize: 13 },
  rewardVoucherBox:      { backgroundColor: '#fff8ec', borderRadius: 8, padding: 10, marginTop: 10 },
  rewardVoucherText:     { color: '#854F0B', fontSize: 12, lineHeight: 18 },

  // ── Menu ──
  menuCatTab:            { borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.white },
  menuCatTabActive:      { backgroundColor: C.saffron, borderColor: C.saffron },
  menuCatTabText:        { color: C.black, fontSize: 13, fontWeight: '600' },
  menuCatTabTextActive:  { color: C.white },
  menuItemCard:          { flexDirection: 'row', gap: 12, backgroundColor: C.white, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 12, marginBottom: 10 },
  sectionHeading:        { color: C.charcoal, fontSize: 14, fontWeight: '700' },
  menuItemImage:         { width: 64, height: 64, borderRadius: 10, backgroundColor: C.ivory },
  menuItemName:          { color: C.charcoal, fontWeight: '700', fontSize: 14, flex: 1, marginRight: 6 },
  menuItemFeatured:      { color: C.gold, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  menuItemDesc:          { color: C.black, fontSize: 12, marginTop: 2, lineHeight: 16 },
  menuItemPrice:         { color: C.saffron, fontWeight: '700', fontSize: 13, marginTop: 6 },
  // Dedicated style (2026-09-15 fix, PC's live report) — this row used to
  // reuse S.fieldHint, which has marginTop:-6 (correct for its original
  // use, tight under a form label) but pulled this hint text up into
  // menuItemPrice's own line here, overlapping "Tap to customize & order"
  // with the price instead of stacking cleanly below it.
  menuItemHint:          { color: C.gold, fontSize: 10, marginTop: 4 },

  moreSectionTitle: { color: C.charcoal, fontSize: 12, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8, paddingLeft: 2 },
  moreCard:         { backgroundColor: C.white, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  moreRow:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  moreRowLeft:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  moreRowLabel:     { color: C.charcoal, fontSize: 14 },
  moreChevron:      { color: C.black, fontSize: 22, fontWeight: '300' },
  moreRowDivider:   { height: 1, backgroundColor: C.border, marginLeft: 54 },
  versionText:      { color: C.black, fontSize: 10, textAlign: 'center', marginTop: 32, lineHeight: 16 },

  chipGroupLabel:   { color: C.saffron, fontWeight: '700', fontSize: 12, marginBottom: 8 },
  chipRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:             { borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: C.white },
  chipSelected:     { backgroundColor: C.saffron, borderColor: C.saffron },
  chipIcedSelected: { backgroundColor: '#1A7FC4', borderColor: '#1A7FC4' },
  chipText:         { color: C.black, fontSize: 12 },
  chipTextSelected: { color: C.white, fontWeight: '700' },
  orText:           { textAlign: 'center', color: C.black, marginVertical: 16, fontSize: 13 },
  textArea:         { backgroundColor: C.white, borderRadius: 12, padding: 14, color: C.charcoal, fontSize: 14, borderWidth: 1, borderColor: C.border, marginBottom: 14, minHeight: 80, textAlignVertical: 'top' },

  resultCard:       { backgroundColor: C.white, borderRadius: 16, padding: 18, marginTop: 20, borderWidth: 1, borderColor: C.border },
  drinkName:        { color: C.saffron, fontSize: 22, fontWeight: '700', marginBottom: 8 },
  drinkDesc:        { color: C.charcoal, fontSize: 14, lineHeight: 22, marginBottom: 10 },
  drinkWhy:         { color: C.black, fontSize: 12, fontStyle: 'italic', marginBottom: 14 },
  ingredientsTitle: { color: C.charcoal, fontWeight: '700', marginBottom: 6 },
  ingredientItem:   { color: C.black, fontSize: 12, marginBottom: 3 },
  priceRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.ivory, borderRadius: 10, padding: 12, marginBottom: 14 },
  priceLabel:       { color: C.black, fontSize: 13 },
  priceAmount:      { color: C.saffron, fontSize: 24, fontWeight: '700', fontFamily: 'PlayfairDisplay_700Bold' },

  pairingCard:     { backgroundColor: C.ivory, borderRadius: 12, padding: 14, marginTop: 12, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  pairingTitle:    { color: C.saffron, fontWeight: '700', fontSize: 15, marginBottom: 6 },
  pairingFood:     { color: C.charcoal, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  pairingCategory: { color: C.gold, fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  pairingReason:   { color: C.black, fontSize: 12, textAlign: 'center', lineHeight: 18 },

  // ── Start Over ──
  startOverBtn:  { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  startOverText: { color: C.ivory, fontSize: 13, fontWeight: '600' },

  // ── Drink Full Card ──
  drinkFullCard:      { margin: 16, backgroundColor: C.white, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: C.border },
  drinkFullBadgeRow:  { marginBottom: 12 },
  drinkFullBadge:     { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 6, textAlign: 'center' },
  drinkFullName:      { color: C.saffron, fontSize: 26, fontWeight: '700', marginBottom: 12, lineHeight: 32, fontFamily: 'PlayfairDisplay_700Bold' },
  drinkFullDesc:      { color: C.charcoal, fontSize: 15, lineHeight: 24, marginBottom: 12 },
  drinkWhyBox:        { backgroundColor: C.ivory, borderRadius: 10, padding: 12, marginBottom: 16 },
  drinkWhyText:       { color: C.black, fontSize: 13, fontStyle: 'italic', lineHeight: 20 },
  ingredientsBox:     { backgroundColor: C.ivory, borderRadius: 12, padding: 14, marginBottom: 16 },
  ingredientsBoxTitle:{ color: C.charcoal, fontWeight: '700', fontSize: 13, marginBottom: 10 },
  ingredientChip:     { backgroundColor: C.white, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: C.border, marginBottom: 6 },
  ingredientChipText: { color: C.charcoal, fontSize: 12 },

  // ── Size Selector ──
  sizeSectionLabel: { color: C.charcoal, fontWeight: '700', fontSize: 13, marginBottom: 10 },
  sizeRow:          { flexDirection: 'row', marginBottom: 16 },
  sizeBtn:          { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center' },
  sizeBtnActive:    { borderColor: C.saffron, backgroundColor: '#FFF3EC' },
  sizeBtnLabel:     { color: C.black, fontWeight: '700', fontSize: 15 },
  sizeBtnLabelActive: { color: C.saffron },
  sizeBtnTag:       { color: C.black, fontSize: 10, marginTop: 3 },
  sizeBtnTagActive: { color: C.saffron },

  // ── Food Pairing Full Card ──
  // Same top margin and centered badge as drinkFullCard (PC, 2026-10-01):
  // with marginTop 0 and a left-aligned badge, the pager's round ← arrow
  // (top/left 28, 34pt) sat on "RECOMMENDED PAIRING" and the food name.
  pairingFullCard:     { margin: 16, backgroundColor: C.white, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: C.border },
  pairingFullBadge:    { color: C.black, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 18, textAlign: 'center' },
  pairingFullFood:     { color: C.charcoal, fontSize: 24, fontWeight: '700', marginBottom: 4 },
  pairingFullCategory: { color: C.gold, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 },
  pairingFullWhy:      { color: C.charcoal, fontSize: 14, lineHeight: 22, marginBottom: 18 },
  pairingPriceBox:     { backgroundColor: C.ivory, borderRadius: 14, padding: 14, marginBottom: 12 },
  pairingPriceLine:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  pairingPriceItem:    { color: C.black, fontSize: 13, flex: 1, marginRight: 8 },
  pairingPriceVal:     { color: C.charcoal, fontSize: 13, fontWeight: '600' },
  pairingDivider:      { height: 1, backgroundColor: C.border, marginBottom: 8 },
  comboDealRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF3EC', borderRadius: 14, padding: 16, marginBottom: 18 },
  comboDealLabel:      { color: C.saffron, fontWeight: '700', fontSize: 15 },
  comboSavings:        { color: C.saffron, fontSize: 12, marginTop: 3 },
  comboPrice:          { color: C.saffron, fontSize: 34, fontWeight: '700' },
  pairingNote:         { borderLeftWidth: 3, borderLeftColor: C.saffron, paddingLeft: 14, marginBottom: 18 },
  pairingNoteText:     { color: C.black, fontSize: 13, lineHeight: 21 },

  // ── Featured Carousel ──
  featSection:    { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 0 },
  featBig:        { borderRadius: 16, overflow: 'hidden', height: 195, position: 'relative' },
  featBigImg:     { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  featBigImgAbs:  { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  featBigOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 14,
                    backgroundColor: 'rgba(26,12,4,0.65)', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  featBigTag:     { color: C.saffron, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, marginBottom: 3 },
  featBigName:    { color: C.ivory, fontSize: 16, fontWeight: '700' },
  featDots:       { position: 'absolute', bottom: 12, right: 14, flexDirection: 'row', gap: 5 },
  featDot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  featDotActive:  { width: 18, height: 6, borderRadius: 3, backgroundColor: C.saffron },

  tabBar:        { flexDirection: 'row', backgroundColor: C.espresso, borderTopWidth: 2, borderTopColor: C.saffron, paddingBottom: TAB_BAR_PADDING_BOTTOM, paddingTop: 8, height: TAB_BAR_HEIGHT },
  tabItem:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabIcon:       { fontSize: 22, color: C.muted },
  tabLabel:      { color: C.muted, fontSize: 9, fontWeight: '600', marginTop: 2 },

  // ── Content-API static screens (Journey/Academic/Rewards/Legal, 2026-09-15) ──
  contentAccentLine:   { width: 40, height: 3, backgroundColor: C.saffron, borderRadius: 2, marginTop: 6, marginBottom: 14 },
  contentSectionTitle: { color: C.charcoal, fontSize: 20, fontWeight: '700', fontFamily: 'PlayfairDisplay_700Bold' },
  contentParagraph:    { color: C.charcoal, fontSize: 14, lineHeight: 22, marginBottom: 12 },
  meetTagline:         { color: C.saffron, fontSize: 16, fontStyle: 'italic', fontWeight: '600', marginBottom: 18 },
  meetStep:            { color: C.saffron, fontSize: 15, fontWeight: '700', marginTop: 4, marginBottom: 6 },
  contentInitialsCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(201,168,106,0.15)', borderWidth: 1.5, borderColor: C.gold, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  contentInitialsText: { color: C.gold, fontSize: 22, fontWeight: '700', fontFamily: 'PlayfairDisplay_700Bold' },
  contentPersonName:   { color: C.charcoal, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  contentPersonTitle:  { color: C.black, fontSize: 13, textAlign: 'center', marginBottom: 4 },
  contentChecklistRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  contentCheckmark:    { color: C.saffron, fontSize: 15, fontWeight: '700', marginTop: 1 },
  contentChecklistText:{ color: C.charcoal, fontSize: 13, flex: 1, lineHeight: 19 },
  contentPullQuoteBox: { backgroundColor: '#FFF8EC', borderRadius: 12, padding: 16, marginTop: 4, marginBottom: 4 },
  contentPullQuoteText:{ color: C.espresso, fontSize: 14, fontStyle: 'italic', lineHeight: 21, textAlign: 'center' },
  contentModeCard:     { backgroundColor: C.white, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border, marginBottom: 10 },
  contentModeEmoji:    { fontSize: 20, marginBottom: 4 },
  contentModeTitle:    { color: C.charcoal, fontSize: 14, fontWeight: '700', marginBottom: 3 },
  contentModeBody:     { color: C.black, fontSize: 12.5, lineHeight: 18 },
  contentPointRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  contentPointIcon:    { fontSize: 18, marginTop: 1 },
  contentPointTitle:   { color: C.charcoal, fontSize: 14, fontWeight: '700', marginBottom: 2 },
  contentPointBody:    { color: C.black, fontSize: 12.5, lineHeight: 18 },
  contentTable:        { borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden', marginTop: 4 },
  contentTableHeaderRow: { flexDirection: 'row', backgroundColor: C.espresso },
  contentTableRow:     { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  contentTableRowAlt:  { backgroundColor: '#FBF7EF' },
  contentTableHeaderCell: { flex: 1, color: C.ivory, fontSize: 10.5, fontWeight: '700', padding: 8, textAlign: 'center' },
  contentTableCell:    { flex: 1, color: C.charcoal, fontSize: 11, padding: 8, textAlign: 'center' },
  contentSourceText:   { color: C.black, fontSize: 11.5, lineHeight: 17, marginBottom: 8 },
  contentImpactCard:   { backgroundColor: C.white, borderRadius: 16, borderWidth: 1.5, borderColor: '#E8D5B8', padding: 20, marginBottom: 16 },
  contentImpactTitle:  { color: C.charcoal, fontSize: 15, fontWeight: '700', marginBottom: 14, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: '#F0E6D6' },
  contentImpactRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F5F0EB' },
  contentImpactLabel:  { color: C.black, fontSize: 13, fontWeight: '500', flex: 1 },
  contentImpactNumber: { color: C.saffron, fontSize: 18, fontWeight: '800' },
  contentBulletRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  contentBulletDot:    { color: C.saffron, fontSize: 13, marginTop: 3 },
  contentBulletText:   { color: C.charcoal, fontSize: 13, flex: 1, lineHeight: 19 },
  contentStepRow:      { flexDirection: 'row', gap: 12, marginBottom: 14 },
  contentStepNum:      { width: 26, height: 26, borderRadius: 13, backgroundColor: C.saffron, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  contentStepNumText:  { color: C.white, fontSize: 12, fontWeight: '700' },
  contentStepTitle:    { color: C.charcoal, fontSize: 14, fontWeight: '700', marginBottom: 2 },
  contentStepBody:     { color: C.black, fontSize: 12.5, lineHeight: 18 },
  contentTierImage:    { width: '100%', height: 180, borderRadius: 12, marginBottom: 16 },
  contentTierCard:     { backgroundColor: C.white, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 12 },
  contentTierName:     { color: C.espresso, fontSize: 15, fontWeight: '700', fontFamily: 'PlayfairDisplay_700Bold', marginBottom: 2 },
  contentTierIntro:    { color: C.black, fontSize: 12, marginBottom: 8 },
  contentTierHighlight:{ color: C.saffron, fontSize: 12.5, fontWeight: '700', marginTop: 6 },
  contentFooterBanner: { backgroundColor: C.espresso, borderRadius: 12, padding: 16, marginTop: 8 },
  contentFooterBannerText: { color: C.ivory, fontSize: 12.5, fontWeight: '600', textAlign: 'center' },
  contentLoadErrorBox: { padding: 30, alignItems: 'center' },

  // ── Sip-card swiper arrows (2026-09-16) ──
  sipArrowBtn:  { position: 'absolute', top: 28, zIndex: 5, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(31,31,31,0.55)', alignItems: 'center', justifyContent: 'center' },
  sipArrowText: { color: C.white, fontSize: 18, fontWeight: '700' },
});
