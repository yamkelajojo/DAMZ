/**
 * Sheet — Reusables Primitive (Bottom Sheet)
 *
 * Drag with the composed `Gesture.Pan()` API from react-native-gesture-handler;
 * animate and snap with Reanimated. Reanimated 4 removed both
 * `useAnimatedGestureHandler` and the `PanGestureHandler` component, so the
 * composed gesture API is the only supported path. The drag origin is kept in a
 * shared value rather than the old gesture-context object.
 *
 * Supports multiple snap points, backdrop, handle.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, Dimensions, View, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { cn } from '../../utils/cn';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface SheetProps {
  children: ReactNode;
  snapPoints?: number[]; // fractions of screen height (0-1)
  defaultIndex?: number;
  handleText?: string;
  showHandle?: boolean;
  backdrop?: boolean;
  backdropOpacity?: number;
  onClose?: () => void;
  className?: string;
  contentClassName?: string;
}

export function Sheet({
  children,
  snapPoints = [0.25, 0.5, 0.9],
  defaultIndex = 1,
  handleText,
  showHandle = true,
  backdrop = true,
  backdropOpacity = 0.4,
  onClose,
  contentClassName,
  className,
}: SheetProps) {
  const translateY = useSharedValue(SCREEN_HEIGHT * (1 - snapPoints[defaultIndex]));
  const startY = useSharedValue(0);
  // Initialised here rather than from an effect: effects must not be the place
  // where a value is first computed, and `snapPoints` defaults to a fresh array
  // literal on every render, so it could not safely be a dependency anyway.
  const backdropOpacityAnim = useSharedValue(backdrop ? backdropOpacity : 0);

  // React state, not a shared value: `isOpen` is read while rendering, and a
  // shared value read during render never triggers a re-render, so the backdrop
  // would stay mounted forever.
  const [isOpen, setIsOpen] = useState(true);

  const backdropStyle = useAnimatedStyle(
    () => ({
      opacity: backdropOpacityAnim.value,
    }),
    [],
  );

  const containerStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateY: translateY.value }],
    }),
    [],
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          startY.value = translateY.value;
        })
        .onUpdate((event) => {
          translateY.value = startY.value + event.translationY;
        })
        .onEnd((event) => {
          const velocity = event.velocityY;
          const snapY = snapPoints.map((point) => SCREEN_HEIGHT * (1 - point));

          let targetIndex = 0;
          let minDist = Infinity;

          snapY.forEach((y, i) => {
            const dist = Math.abs(translateY.value - y);
            if (dist < minDist) {
              minDist = dist;
              targetIndex = i;
            }
          });

          // Velocity-based snap
          if (velocity > 1000 && targetIndex < snapPoints.length - 1) targetIndex++;
          if (velocity < -1000 && targetIndex > 0) targetIndex--;

          const targetY = SCREEN_HEIGHT * (1 - snapPoints[targetIndex]);

          translateY.value = withSpring(targetY, { damping: 25, stiffness: 200 }, (finished) => {
            // Dismissed by dragging past the lowest snap point.
            if (finished && targetIndex === 0) {
              if (onClose) runOnJS(onClose)();
              runOnJS(setIsOpen)(false);
            }
          });

          backdropOpacityAnim.value = withSpring(targetIndex > 0 ? backdropOpacity : 0, {
            duration: 200,
          });
        }),
    [snapPoints, backdropOpacity, onClose, startY, translateY, backdropOpacityAnim],
  );

  const handleBackdropPress = () => {
    if (snapPoints[0] !== 0) return;

    translateY.value = withSpring(SCREEN_HEIGHT, { damping: 25, stiffness: 200 }, (finished) => {
      if (finished) {
        if (onClose) runOnJS(onClose)();
        runOnJS(setIsOpen)(false);
      }
    });
    backdropOpacityAnim.value = withSpring(0, { duration: 200 });
  };

  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      {backdrop && isOpen && (
        <Animated.View
          style={[StyleSheet.absoluteFill, backdropStyle, { backgroundColor: 'rgba(2, 1, 1, 0.4)' }]}
          onTouchStart={handleBackdropPress}
          pointerEvents={isOpen ? 'auto' : 'none'}
        />
      )}
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[
            {
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              backgroundColor: '#FFFCF9',
              maxHeight: SCREEN_HEIGHT,
            },
            containerStyle,
          ]}
          className={cn(className)}
        >
          {showHandle && (
            <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 8 }}>
              <View
                style={{
                  width: 36,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: '#DCCFC4',
                }}
              />
              {handleText && (
                <Text style={{ marginTop: 8, fontSize: 14, color: '#6B625C' }}>
                  {handleText}
                </Text>
              )}
            </View>
          )}
          <View style={{ paddingBottom: 24 }} className={cn(contentClassName)}>
            {children}
          </View>
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}
