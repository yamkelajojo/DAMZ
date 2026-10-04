/**
 * Sheet — Reusables Primitive (Bottom Sheet)
 *
 * Uses Reanimated 3 for smooth spring animations.
 * Supports multiple snap points, backdrop, handle.
 */

import React, { useRef, type ReactNode } from 'react';
import { StyleSheet, type ViewStyle, Dimensions, View, Text, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  useAnimatedGestureHandler,
  runOnJS,
  PanGestureHandler,
} from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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
  className,
  contentClassName,
}: SheetProps) {
  const translateY = useSharedValue(SCREEN_HEIGHT * (1 - snapPoints[defaultIndex]));
  const backdropOpacityAnim = useSharedValue(0);
  const isOpen = useSharedValue(true);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacityAnim.value,
  }), []);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }), []);

  const handleDrag = useAnimatedGestureHandler({
    onStart: (_, ctx: any) => {
      ctx.startY = translateY.value;
    },
    onActive: (event, ctx: any) => {
      translateY.value = ctx.startY + event.translationY;
    },
    onEnd: (event) => {
      const velocity = event.velocityY;
      const snapY = snapPoints.map(p => SCREEN_HEIGHT * (1 - p));

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
        if (finished && targetIndex === 0 && onClose) {
          runOnJS(onClose)();
          isOpen.value = false;
        }
      });

      backdropOpacityAnim.value = withSpring(targetIndex > 0 ? backdropOpacity : 0, { duration: 200 });
    },
  });

  const handleBackdropPress = () => {
    if (snapPoints[0] === 0) {
      translateY.value = withSpring(SCREEN_HEIGHT, { damping: 25, stiffness: 200 }, (finished) => {
        if (finished && onClose) {
          runOnJS(onClose)();
          isOpen.value = false;
        }
      });
      backdropOpacityAnim.value = withSpring(0, { duration: 200 });
    }
  };

  // Initialize
  React.useEffect(() => {
    translateY.value = SCREEN_HEIGHT * (1 - snapPoints[defaultIndex]);
    backdropOpacityAnim.value = backdrop ? backdropOpacity : 0;
  }, []);

  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      {backdrop && isOpen.value && (
        <Animated.View
          style={[StyleSheet.absoluteFill, backdropStyle, { backgroundColor: 'rgba(2, 1, 1, 0.4)' }]}
          onTouchStart={handleBackdropPress}
          pointerEvents={isOpen.value ? 'auto' : 'none'}
        />
      )}
      <PanGestureHandler onGestureEvent={handleDrag}>
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
            className,
          ]}
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
          <View style={[{ paddingBottom: 24 }, contentClassName]}>{children}</View>
        </Animated.View>
      </PanGestureHandler>
    </GestureHandlerRootView>
  );
}