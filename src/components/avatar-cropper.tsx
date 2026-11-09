import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useState } from 'react';
import { Alert, Modal, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarButton, BottomBar } from '@/components/bottom-bar';
import { Intro } from '@/components/intro';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { registerAvatarCropper, type CropSource, type PickedImage } from '@/lib/profile';

const MAX_ZOOM = 4;
// Output side in px. The largest avatar is 96pt, 288px at @3x.
const OUT = 512;
// How far the dim reaches past the circle: more than any screen's half-diagonal.
const FAR = 1000;

type Job = { src: CropSource; done: (img: PickedImage | null) => void };

/**
 * The round crop screen that pickAvatarImage() opens after the photo picker.
 * Mounted once in the root layout.
 */
export function AvatarCropperHost() {
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => {
    registerAvatarCropper((src, done) => setJob({ src, done }));
    return () => registerAvatarCropper(null);
  }, []);

  if (!job) return null;
  const finish = (img: PickedImage | null) => {
    job.done(img);
    setJob(null);
  };
  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => finish(null)}>
      <Cropper key={job.src.uri} src={job.src} onDone={finish} />
    </Modal>
  );
}

function Cropper({ src, onDone }: { src: CropSource; onDone: (img: PickedImage | null) => void }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  // The circle, and the photo at zoom 1: its short side fills the circle.
  const D = screenW - Spacing.four * 2;
  const base = D / Math.min(src.width, src.height);
  const w = src.width * base;
  const h = src.height * base;

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const start = useSharedValue({ scale: 1, x: 0, y: 0 });

  // Keep the circle covered: the photo's edge never moves inside it.
  const clamp = (v: number, size: number, k: number) => {
    'worklet';
    const max = (size * k - D) / 2;
    return Math.min(max, Math.max(-max, v));
  };

  const pan = Gesture.Pan()
    .onStart(() => {
      start.value = { scale: scale.value, x: tx.value, y: ty.value };
    })
    .onUpdate((e) => {
      tx.value = clamp(start.value.x + e.translationX, w, scale.value);
      ty.value = clamp(start.value.y + e.translationY, h, scale.value);
    });
  const pinch = Gesture.Pinch()
    .onStart(() => {
      start.value = { scale: scale.value, x: tx.value, y: ty.value };
    })
    .onUpdate((e) => {
      scale.value = Math.min(MAX_ZOOM, Math.max(1, start.value.scale * e.scale));
      tx.value = clamp(tx.value, w, scale.value);
      ty.value = clamp(ty.value, h, scale.value);
    });
  const gesture = Gesture.Simultaneous(pan, pinch);

  const photoStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  // Throws if the photo can't be read; Buttons says so.
  async function choose() {
    // Screen points → photo pixels: the circle's centre sits (-tx, -ty) from
    // the photo's centre, and one pixel shows as f points.
    const f = base * scale.value;
    const size = Math.min(src.width, src.height, Math.round(D / f));
    const fit = (v: number, max: number) => Math.round(Math.min(max - size, Math.max(0, v)));
    const originX = fit(src.width / 2 - tx.value / f - size / 2, src.width);
    const originY = fit(src.height / 2 - ty.value / f - size / 2, src.height);
    const ref = await ImageManipulator.manipulate(src.uri)
      .crop({ originX, originY, width: size, height: size })
      .resize({ width: Math.min(OUT, size) })
      .renderAsync();
    const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    onDone({ uri: out.uri, mimeType: 'image/jpeg' });
  }

  return (
    // A Modal is its own window: gestures need their own root in it.
    <GestureHandlerRootView style={[styles.root, { backgroundColor: c.background }]}>
      <View style={[styles.head, { paddingTop: insets.top + Spacing.four }]}>
        <Intro title="Move and scale" body="Drag the photo, pinch to zoom." />
      </View>

      <GestureDetector gesture={gesture}>
        <View
          style={styles.stage}
          accessible
          accessibilityLabel="Photo in the circle. Drag to move it, pinch to zoom.">
          <View style={{ width: D, height: D }}>
            <Animated.View
              style={[
                { position: 'absolute', left: (D - w) / 2, top: (D - h) / 2, width: w, height: h },
                photoStyle,
              ]}>
              <Image source={{ uri: src.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            </Animated.View>
            {/* The dim around the circle: a ring whose hole is the circle and
                whose border reaches past every screen corner. */}
            <View
              pointerEvents="none"
              style={[
                styles.ring,
                {
                  left: -FAR,
                  top: -FAR,
                  width: D + FAR * 2,
                  height: D + FAR * 2,
                  borderRadius: D / 2 + FAR,
                  borderColor: c.background,
                },
              ]}
            />
          </View>
        </View>
      </GestureDetector>

      <Buttons onCancel={() => onDone(null)} onChoose={choose} />
    </GestureHandlerRootView>
  );
}

// Its own component so `busy` re-renders only the buttons: re-rendering the
// cropper re-runs the photo's animated style on the JS thread, which Reanimated
// warns about.
function Buttons({ onCancel, onChoose }: { onCancel: () => void; onChoose: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  async function choose() {
    setBusy(true);
    try {
      await onChoose();
    } catch (e) {
      console.error('avatar crop:', e);
      setBusy(false);
      Alert.alert('Could not use this photo', 'Try again, or choose another one.');
    }
  }

  return (
    <BottomBar>
      <View style={styles.buttons}>
        <BarButton title="Cancel" secondary onPress={onCancel} disabled={busy} style={styles.flex} />
        <BarButton title="Choose" onPress={choose} busy={busy} style={styles.flex} />
      </View>
    </BottomBar>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { paddingHorizontal: Spacing.four },
  // Clips the photo and the ring, so neither covers the Intro or the buttons.
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ring: { position: 'absolute', borderWidth: FAR, opacity: 0.8 },
  buttons: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
});
